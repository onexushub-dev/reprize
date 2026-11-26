import AVFoundation

/// The microphone as Reprize hears it: an `AVCaptureSession` with the default audio device and an
/// `AVCaptureAudioDataOutput`, in a play-and-record / video-recording audio session (the app's capture session also
/// plays its chimes). Every buffer goes to `onBuffer` (on the capture queue) and into an AAC .m4a of the session.
///
/// The .m4a is written in 10 s fragments, so it stays readable even if the recording stops abruptly. If the writer
/// fails or the microphone's format changes, recording goes on in a new part (`<name>-2.m4a`, …) and `onIssue` says why.
final class AudioCapture: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
  /// Set from the main queue, read on the capture queue.
  var onBuffer: ((CMSampleBuffer) -> Void)? {
    get { lock.lock(); defer { lock.unlock() }; return handler }
    set { lock.lock(); handler = newValue; lock.unlock() }
  }
  /// Something that may have disturbed the session (interruption, writer error); called on any queue.
  var onIssue: ((String) -> Void)?

  private let lock = NSLock()
  private var handler: ((CMSampleBuffer) -> Void)?
  private let session = AVCaptureSession()
  private let output = AVCaptureAudioDataOutput()
  private let queue = DispatchQueue(label: "bench.capture", qos: .userInitiated)
  private var configured = false
  private var writer: AVAssetWriter?
  private var writerInput: AVAssetWriterInput?
  private var writerRate = 0.0
  private var writerChannels: UInt32 = 0
  private var recordURL: URL?
  private var parts: [String] = []
  private var recording = false

  override init() {
    super.init()
    let center = NotificationCenter.default
    center.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: session, queue: nil) { [weak self] note in
      let reason = (note.userInfo?[AVCaptureSessionInterruptionReasonKey] as? NSNumber)?.intValue ?? -1
      self?.onIssue?("microfone interrompido (motivo \(reason))")
    }
    center.addObserver(forName: AVCaptureSession.interruptionEndedNotification, object: session, queue: nil) { [weak self] _ in
      self?.onIssue?("microfone voltou")
    }
    center.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: nil) { [weak self] note in
      let error = note.userInfo?[AVCaptureSessionErrorKey] as? NSError
      self?.onIssue?("erro da captura: \(error?.localizedDescription ?? "?")")
    }
    center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { [weak self] note in
      let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue ?? 99
      self?.onIssue?(type == AVAudioSession.InterruptionType.began.rawValue ? "áudio interrompido pelo sistema" : "áudio do sistema voltou")
    }
    center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) { [weak self] note in
      let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue ?? 0
      // 1 new device, 2 old device unavailable (fones, AirPods); category changes are ours.
      if reason == 1 || reason == 2 { self?.onIssue?("rota de áudio mudou (motivo \(reason))") }
    }
  }

  func configure() throws {
    guard !configured else { return }
    let audio = AVAudioSession.sharedInstance()
    try audio.setCategory(.playAndRecord, mode: .videoRecording, options: [.defaultToSpeaker, .mixWithOthers])
    try audio.setActive(true)
    session.automaticallyConfiguresApplicationAudioSession = false
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    guard let mic = AVCaptureDevice.default(for: .audio) else { throw BenchError.message("Sem microfone") }
    let micInput = try AVCaptureDeviceInput(device: mic)
    guard session.canAddInput(micInput), session.canAddOutput(output) else { throw BenchError.message("Captura indisponível") }
    session.addInput(micInput)
    output.setSampleBufferDelegate(self, queue: queue)
    session.addOutput(output)
    configured = true
  }

  /// Starts the microphone and records it to `url` (and `<name>-2.m4a`… if a part has to be started over).
  func start(recordTo url: URL) {
    queue.async {
      self.recordURL = url
      self.parts = []
      self.writer = nil
      self.writerInput = nil
      self.recording = true
    }
    DispatchQueue.global(qos: .userInitiated).async { self.session.startRunning() }
  }

  /// Stops and finishes the .m4a; `done` (on the main queue) gets the audio files' names, in order.
  func stop(done: @escaping ([String]) -> Void) {
    DispatchQueue.global(qos: .userInitiated).async {
      self.session.stopRunning()
      self.queue.async {
        self.recording = false
        let parts = self.parts
        guard let writer = self.writer, let input = self.writerInput, writer.status == .writing else {
          if let writer = self.writer, writer.status == .failed {
            self.onIssue?("gravação falhou no fim: \(writer.error?.localizedDescription ?? "?")")
          }
          self.writer = nil
          DispatchQueue.main.async { done(parts) }
          return
        }
        input.markAsFinished()
        writer.finishWriting {
          if writer.status != .completed {
            self.onIssue?("gravação não fechou: \(writer.error?.localizedDescription ?? "?")")
          }
          DispatchQueue.main.async { done(parts) }
        }
        self.writer = nil
      }
    }
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    onBuffer?(sampleBuffer)
    guard recording else { return }
    if let writer, writer.status == .failed || writer.status == .cancelled {
      onIssue?("gravação parou: \(writer.error?.localizedDescription ?? "?") — seguindo em nova parte")
      self.writer = nil
      writerInput = nil
    }
    if let writer, let asbd = Self.format(sampleBuffer),
       asbd.mSampleRate != writerRate || asbd.mChannelsPerFrame != writerChannels {
      onIssue?("formato do microfone mudou para \(Int(asbd.mSampleRate)) Hz × \(asbd.mChannelsPerFrame) — nova parte")
      writerInput?.markAsFinished()
      writer.finishWriting {}
      self.writer = nil
      writerInput = nil
    }
    if writer == nil { startWriter(sampleBuffer) }
    if let input = writerInput, input.isReadyForMoreMediaData { input.append(sampleBuffer) }
  }

  private static func format(_ buffer: CMSampleBuffer) -> AudioStreamBasicDescription? {
    guard let desc = CMSampleBufferGetFormatDescription(buffer) else { return nil }
    return CMAudioFormatDescriptionGetStreamBasicDescription(desc)?.pointee
  }

  private func startWriter(_ first: CMSampleBuffer) {
    guard let base = recordURL, let desc = CMSampleBufferGetFormatDescription(first), let asbd = Self.format(first) else { return }
    let name = base.deletingPathExtension().lastPathComponent
    let url = parts.isEmpty ? base : base.deletingLastPathComponent().appendingPathComponent("\(name)-\(parts.count + 1).m4a")
    try? FileManager.default.removeItem(at: url)
    guard let writer = try? AVAssetWriter(outputURL: url, fileType: .m4a) else {
      onIssue?("não consegui criar \(url.lastPathComponent)")
      recording = false
      return
    }
    writer.movieFragmentInterval = CMTime(seconds: 10, preferredTimescale: 600)
    let channels = max(1, Int(asbd.mChannelsPerFrame))
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: asbd.mSampleRate,
      AVNumberOfChannelsKey: channels,
      AVEncoderBitRateKey: 64000 * channels,
    ]
    let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings, sourceFormatHint: desc)
    input.expectsMediaDataInRealTime = true
    guard writer.canAdd(input) else {
      onIssue?("gravação recusou o formato \(Int(asbd.mSampleRate)) Hz × \(channels)")
      recording = false
      return
    }
    writer.add(input)
    writer.startWriting()
    writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(first))
    self.writer = writer
    writerInput = input
    writerRate = asbd.mSampleRate
    writerChannels = asbd.mChannelsPerFrame
    parts.append(url.lastPathComponent)
  }
}

enum BenchError: LocalizedError {
  case message(String)
  var errorDescription: String? {
    switch self {
    case .message(let text): return text
    }
  }
}
