import AVFoundation
import CoreML
import Foundation
import QuartzCore

/// The "salvar" detector on the phone (plan 2026-11-24 voice keyword detector; spec
/// docs/superpowers/specs/2026-11-24-voice-keyword-detector-design.md). VoiceBench (Phase 1) and the app (Phase 2)
/// run this same file.
///
/// Any audio in (capture `CMSampleBuffer`s or the remote's `AVAudioPCMBuffer`s) → `Resampler` (16 kHz mono) →
/// `MelFrontend` → every 8 mel frames, the embedding of the last 76 (Core ML) → `KeywordScorer` on the last 16
/// embeddings → `FiringRule`. Everything after the format conversion runs on its own serial queue; audio that would
/// push the backlog past 2 s is dropped and counted (`DropCounter`), never blocking the caller.
final class KeywordDetector {
  struct Stats {
    /// Embedding + score steps run, and the seconds they took (Core ML + classifier).
    var steps = 0
    var stepSeconds = 0.0
    var droppedSeconds = 0.0
  }

  /// A "salvar": its score (on the main queue).
  var onCommand: ((Double) -> Void)?
  /// Diagnostic lines, never anything that was said.
  var log: ((String) -> Void)?

  let config: KeywordConfig
  private let scorer: KeywordScorer
  private let embedding: MLModel
  private let input: MLMultiArray
  private let queue = DispatchQueue(label: "voice.keyword", qos: .userInitiated)
  private let lock = NSLock()
  private var backlog = DropCounter(capacitySeconds: 2)
  private var stepCount = 0
  private var stepSeconds = 0.0
  private var fireLag = 0.0          // seconds between the audio arriving and the step that fired on it
  private var currentArrival = 0.0   // on `queue`: when the buffer being processed arrived

  // State on `queue`.
  private var resampler: Resampler?
  private var formatRate = 0.0
  private var formatChannels = 0
  private let mel: MelFrontend
  private var melWindow: [[Float]] = []
  private var melCount = 0
  private var embeddings: [[Float]] = []
  private var embedCount = 0
  private var rule: FiringRule

  /// `directory`: `detector.json`, `mel_filterbank.bin`, `classifier.bin`. `embeddingModel`: the compiled
  /// `voice_embedding.mlmodelc`.
  init(directory: URL, embeddingModel: URL, computeUnits: MLComputeUnits = .all) throws {
    let loaded = try KeywordConfig.load(directory: directory)
    config = loaded.config
    scorer = loaded.scorer
    let mlConfig = MLModelConfiguration()
    mlConfig.computeUnits = computeUnits
    embedding = try MLModel(contentsOf: embeddingModel, configuration: mlConfig)
    input = try MLMultiArray(shape: [1, NSNumber(value: loaded.config.embedFrames), NSNumber(value: loaded.config.nMels), 1],
                             dataType: .float32)
    mel = MelFrontend(filterbank: loaded.filterbank, nFft: loaded.config.nFft, winLength: loaded.config.winLength,
                      hop: loaded.config.hop, nMels: loaded.config.nMels)
    rule = FiringRule(config: loaded.config)
  }

  /// How far behind real time the detector was at its last "salvar" (ms): the audio that completed the word arrived
  /// this long before the detector fired. Grows when the phone is slow or hot; drops start at 2 s.
  var lastFireLagMs: Double {
    lock.lock()
    defer { lock.unlock() }
    return fireLag * 1000
  }

  var stats: Stats {
    lock.lock()
    defer { lock.unlock() }
    return Stats(steps: stepCount, stepSeconds: stepSeconds, droppedSeconds: backlog.droppedSeconds)
  }

  /// Forget the audio so far (a new session or listening turned back on).
  func reset() {
    queue.async {
      self.resampler = nil
      self.formatRate = 0
      self.formatChannels = 0
      self.melWindow = []
      self.melCount = 0
      self.embeddings = []
      self.embedCount = 0
      self.rule.reset()
      self.mel.reset()
    }
  }

  // MARK: Audio in

  /// A capture buffer (any linear PCM: float32 / int16 / int32, interleaved or not, any rate and channel count).
  func consider(_ buffer: CMSampleBuffer) {
    guard let desc = CMSampleBufferGetFormatDescription(buffer),
          let asbdPointer = CMAudioFormatDescriptionGetStreamBasicDescription(desc) else { return }
    let asbd = asbdPointer.pointee
    let frames = CMSampleBufferGetNumSamples(buffer)
    let channels = Int(asbd.mChannelsPerFrame)
    guard frames > 0, channels > 0, asbd.mFormatID == kAudioFormatLinearPCM else { return }

    var listSize = 0
    CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      buffer, bufferListSizeNeededOut: &listSize, bufferListOut: nil, bufferListSize: 0,
      blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil)
    guard listSize > 0 else { return }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: listSize, alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { raw.deallocate() }
    let list = raw.bindMemory(to: AudioBufferList.self, capacity: 1)
    var block: CMBlockBuffer?
    let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      buffer, bufferListSizeNeededOut: nil, bufferListOut: list, bufferListSize: listSize,
      blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
      flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, blockBufferOut: &block)
    guard status == noErr else { return }

    let isFloat = asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0
    let nonInterleaved = asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0
    let bits = Int(asbd.mBitsPerChannel)
    var out = [Float](repeating: 0, count: frames * channels)
    for (b, audio) in UnsafeMutableAudioBufferListPointer(list).enumerated() {
      guard let data = audio.mData, bits > 0 else { continue }
      let count = Int(audio.mDataByteSize) / (bits / 8)
      func value(_ i: Int) -> Float {
        if isFloat && bits == 32 { return data.assumingMemoryBound(to: Float.self)[i] }
        if !isFloat && bits == 16 { return Float(data.assumingMemoryBound(to: Int16.self)[i]) / 32768 }
        if !isFloat && bits == 32 { return Float(Double(data.assumingMemoryBound(to: Int32.self)[i]) / 2147483648) }
        return 0
      }
      if nonInterleaved {
        guard b < channels else { continue }
        for f in 0..<min(frames, count) { out[f * channels + b] = value(f) }
      } else {
        for i in 0..<min(out.count, count) { out[i] = value(i) }
      }
    }
    submit(out, rate: asbd.mSampleRate, channels: channels)
  }

  /// A microphone buffer from an audio engine tap (the remote phone).
  func consider(_ buffer: AVAudioPCMBuffer) {
    let frames = Int(buffer.frameLength)
    let channels = Int(buffer.format.channelCount)
    guard frames > 0, channels > 0 else { return }
    var out = [Float](repeating: 0, count: frames * channels)
    if let data = buffer.floatChannelData {
      if buffer.format.isInterleaved {
        for i in 0..<out.count { out[i] = data[0][i] }
      } else {
        for c in 0..<channels { for f in 0..<frames { out[f * channels + c] = data[c][f] } }
      }
    } else if let data = buffer.int16ChannelData {
      if buffer.format.isInterleaved {
        for i in 0..<out.count { out[i] = Float(data[0][i]) / 32768 }
      } else {
        for c in 0..<channels { for f in 0..<frames { out[f * channels + c] = Float(data[c][f]) / 32768 } }
      }
    } else {
      return
    }
    submit(out, rate: buffer.format.sampleRate, channels: channels)
  }

  private func submit(_ samples: [Float], rate: Double, channels: Int) {
    guard rate > 0 else { return }
    let seconds = Double(samples.count / channels) / rate
    let arrived = CACurrentMediaTime()
    lock.lock()
    let accepted = backlog.offer(seconds)
    lock.unlock()
    guard accepted else { return }
    queue.async {
      self.currentArrival = arrived
      self.process(samples, rate: rate, channels: channels)
      self.lock.lock()
      self.backlog.release(seconds)
      self.lock.unlock()
    }
  }

  // MARK: Pipeline (on `queue`)

  private func process(_ samples: [Float], rate: Double, channels: Int) {
    if resampler == nil || rate != formatRate || channels != formatChannels {
      // A route change (AirPods in or out) changes the format mid-recording: keep the mel and embeddings going.
      resampler = Resampler(fromRate: rate, channels: channels, toRate: Double(config.sampleRate))
      formatRate = rate
      formatChannels = channels
      log?("voz: áudio \(Int(rate)) Hz × \(channels)")
    }
    guard let resampler = resampler else { return }
    for frame in mel.push(resampler.process(samples)) {
      melWindow.append(frame)
      if melWindow.count > config.embedFrames { melWindow.removeFirst(melWindow.count - config.embedFrames) }
      melCount += 1
      if melCount >= config.embedFrames && (melCount - config.embedFrames) % config.embedEvery == 0 {
        step()
      }
    }
  }

  /// One embedding (Core ML) and, once there are enough, one score and the firing rule.
  private func step() {
    let started = CACurrentMediaTime()
    let n = config.embedFrames * config.nMels
    let pointer = input.dataPointer.bindMemory(to: Float32.self, capacity: n)
    for (f, frame) in melWindow.enumerated() {
      for m in 0..<config.nMels { pointer[f * config.nMels + m] = frame[m] }
    }
    let vector: [Float]
    do {
      let features = try MLDictionaryFeatureProvider(dictionary: ["mel": MLFeatureValue(multiArray: input)])
      let result = try embedding.prediction(from: features)
      guard let array = result.featureValue(for: "embedding")?.multiArrayValue, array.count == config.embedSize else {
        log?("voz: embedding sem saída")
        return
      }
      vector = (0..<config.embedSize).map { array[$0].floatValue }
    } catch {
      log?("voz: embedding falhou (\(error.localizedDescription))")
      return
    }
    embeddings.append(vector)
    if embeddings.count > config.windows { embeddings.removeFirst(embeddings.count - config.windows) }
    let index = embedCount
    embedCount += 1
    if embeddings.count == config.windows {
      let score = scorer.score(Array(embeddings.joined()))
      let seconds = config.scoreTime(index: index - (config.windows - 1))
      if rule.feed(score: score, at: seconds) {
        let lag = CACurrentMediaTime() - currentArrival
        lock.lock()
        fireLag = lag
        lock.unlock()
        let callback = onCommand
        DispatchQueue.main.async { callback?(score) }
      }
    }
    let took = CACurrentMediaTime() - started
    lock.lock()
    stepCount += 1
    stepSeconds += took
    lock.unlock()
  }
}

extension KeywordDetector {
  /// The model shipped with the app (plan 2026-11-24, Phase 2): the files of `ios/Models/voice/<version>/` and
  /// `voice_embedding.mlmodelc`, in the pod's resource bundle `ReplayCameraModels` (or the main bundle, as in
  /// VoiceBench). nil, with a `voz:` line, when something is missing or broken; the caller then stays on dictation.
  static func loadBundled(log: ((String) -> Void)?) -> KeywordDetector? {
    var bundles = [Bundle.main, Bundle(for: KeywordDetector.self)]
    for b in [Bundle.main, Bundle(for: KeywordDetector.self)] {
      if let u = b.url(forResource: "ReplayCameraModels", withExtension: "bundle"), let inner = Bundle(url: u) {
        bundles.append(inner)
      }
    }
    for b in bundles {
      guard let config = b.url(forResource: "detector", withExtension: "json"),
            let model = b.url(forResource: "voice_embedding", withExtension: "mlmodelc") else { continue }
      do {
        return try KeywordDetector(directory: config.deletingLastPathComponent(), embeddingModel: model)
      } catch {
        log?("voz: modelo indisponível (\(error)) — usando ditado")
        return nil
      }
    }
    log?("voz: modelo indisponível (arquivos não encontrados) — usando ditado")
    return nil
  }
}
