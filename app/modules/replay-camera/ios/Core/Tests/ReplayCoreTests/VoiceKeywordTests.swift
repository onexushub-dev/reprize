import Foundation
import XCTest
@testable import ReplayCore

/// The "salvar" detector's math matches the voice lab (plan 2026-11-24 voice keyword detector, Tasks 2–3).
/// Fixture: `Fixtures/voice-golden.json`, written by `docs/voice-lab/lab/tools/export_detector.py build`; the filterbank
/// and classifier are the shipped files in `ios/Models/voice/salvar-v1/`. The Android tests read the same fixture.
final class VoiceKeywordTests: XCTestCase {
  struct Golden: Decodable {
    let pcm16k: String
    let mel: [[Double]]
    let embeddings: [[Double]]
    let scores: [Double]
    let fires: [Double]
  }

  static let modelDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // ReplayCoreTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // Core
    .deletingLastPathComponent()  // ios
    .appendingPathComponent("Models/voice/salvar-v1")

  func golden() throws -> Golden {
    let url = try XCTUnwrap(Bundle.module.url(forResource: "voice-golden", withExtension: "json", subdirectory: "Fixtures"))
    return try JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
  }

  func goldenPCM(_ g: Golden) throws -> [Float] {
    let data = try XCTUnwrap(Data(base64Encoded: g.pcm16k))
    return data.withUnsafeBytes { raw in
      raw.bindMemory(to: Int16.self).map { Float(Int16(littleEndian: $0)) / 32767 }
    }
  }

  func filterbank() throws -> [Float] {
    let data = try Data(contentsOf: Self.modelDir.appendingPathComponent("mel_filterbank.bin"))
    return data.withUnsafeBytes { raw in raw.bindMemory(to: Float32.self).map { Float($0) } }
  }

  func makeMel() throws -> MelFrontend {
    MelFrontend(filterbank: try filterbank(), nFft: 512, winLength: 400, hop: 160, nMels: 32)
  }

  func mel(_ samples: [Float], chunk: Int) throws -> [[Float]] {
    let frontend = try makeMel()
    var frames: [[Float]] = []
    var i = 0
    while i < samples.count {
      frames += frontend.push(Array(samples[i..<min(samples.count, i + chunk)]))
      i += chunk
    }
    return frames
  }

  static func rms(_ x: ArraySlice<Float>) -> Double {
    sqrt(x.reduce(0.0) { $0 + Double($1) * Double($1) } / Double(x.count))
  }

  // MARK: Task 2: resampler and mel

  func testMelMatchesGolden() throws {
    let g = try golden()
    let frames = try mel(try goldenPCM(g), chunk: 1600)
    XCTAssertGreaterThanOrEqual(frames.count, g.mel.count)
    var worst = 0.0
    for (f, ref) in zip(frames, g.mel) {
      for (a, b) in zip(f, ref) { worst = max(worst, abs(Double(a) - b)) }
    }
    XCTAssertLessThan(worst, 1e-3)
  }

  func testMelDoesNotDependOnChunking() throws {
    let pcm = Array(try goldenPCM(try golden()).prefix(32000))
    let a = try mel(pcm, chunk: 1600)
    let b = try mel(pcm, chunk: 333)
    XCTAssertEqual(a.count, b.count)
    XCTAssertEqual(a, b)
  }

  func testResamplerBlocksAliasing() {
    func through(_ hz: Double) -> (Double, Double) {
      let x = (0..<48000).map { Float(sin(2 * Double.pi * hz * Double($0) / 48000)) }
      let r = Resampler(fromRate: 48000, channels: 1)
      var y: [Float] = []
      var i = 0
      while i < x.count {
        y += r.process(Array(x[i..<min(x.count, i + 1024)]))
        i += 1024
      }
      return (Self.rms(y[1600..<(y.count - 1600)]), Self.rms(x[...]))
    }
    let (high, highIn) = through(12000)
    XCTAssertLessThan(high / highIn, 0.01)
    let (low, lowIn) = through(1000)
    XCTAssertGreaterThan(low / lowIn, 0.95)
  }

  func testResamplerStereo48kMatches16kMono() throws {
    let pcm = try goldenPCM(try golden())
    let up = Resampler(fromRate: 16000, channels: 1, toRate: 48000)
    var mono48: [Float] = []
    var i = 0
    while i < pcm.count {
      mono48 += up.process(Array(pcm[i..<min(pcm.count, i + 1600)]))
      i += 1600
    }
    var stereo: [Float] = []
    stereo.reserveCapacity(mono48.count * 2)
    for s in mono48 { stereo += [s, s] }
    let down = Resampler(fromRate: 48000, channels: 2)
    var back: [Float] = []
    i = 0
    while i < stereo.count {
      back += down.process(Array(stereo[i..<min(stereo.count, i + 2048)]))
      i += 2048
    }
    let ref = try mel(pcm, chunk: 1600)
    let got = try mel(back, chunk: 1600)
    let n = min(ref.count, got.count)
    XCTAssertGreaterThan(n, 1000)
    var close = 0
    var total = 0
    for f in 10..<(n - 10) {
      for m in 0..<32 {
        total += 1
        if abs(ref[f][m] - got[f][m]) < 0.05 { close += 1 }
      }
    }
    XCTAssertGreaterThan(Double(close) / Double(total), 0.95)
  }

  func testSilenceAndClippingAreFinite() throws {
    let silence = [Float](repeating: 0, count: 16000)
    let square = (0..<16000).map { Float(($0 / 20) % 2 == 0 ? 1 : -1) }
    for signal in [silence, square] {
      let frames = try mel(signal, chunk: 1600)
      XCTAssertFalse(frames.isEmpty)
      XCTAssertTrue(frames.allSatisfy { $0.allSatisfy { $0.isFinite } })
    }
  }

  func testResamplerPassesThrough16kMono() {
    let x: [Float] = [0.1, -0.2, 0.3]
    XCTAssertEqual(Resampler(fromRate: 16000, channels: 1).process(x), x)
  }

  // MARK: Task 3: config, scorer, firing rule

  func loadShipped() throws -> (config: KeywordConfig, filterbank: [Float], scorer: KeywordScorer) {
    try KeywordConfig.load(directory: Self.modelDir)
  }

  func testLoadsShippedModel() throws {
    let (config, filterbank, scorer) = try loadShipped()
    XCTAssertEqual(config.version, "salvar-v1")
    XCTAssertEqual(config.threshold, 0.95)
    XCTAssertEqual(config.consecutive, 2)
    XCTAssertEqual(config.refractorySec, 1.5)
    XCTAssertEqual(filterbank.count, 257 * 32)
    XCTAssertEqual(scorer.inputSize, 16 * 96)
    XCTAssertEqual(scorer.hidden, 128)
  }

  func goldenScores(_ g: Golden, _ scorer: KeywordScorer, _ config: KeywordConfig) -> [Double] {
    let emb = g.embeddings.map { $0.map(Float.init) }
    return (0...(emb.count - config.windows)).map { j in
      scorer.score(Array(emb[j..<(j + config.windows)].joined()))
    }
  }

  func testScoresMatchGolden() throws {
    let g = try golden()
    let (config, _, scorer) = try loadShipped()
    let scores = goldenScores(g, scorer, config)
    XCTAssertEqual(scores.count, g.scores.count)
    for (a, b) in zip(scores, g.scores) { XCTAssertEqual(a, b, accuracy: 1e-4) }
  }

  func testFiresMatchGolden() throws {
    let g = try golden()
    let (config, _, _) = try loadShipped()
    var rule = FiringRule(config: config)
    var fires: [Double] = []
    for (j, s) in g.scores.enumerated() {
      let t = config.scoreTime(index: j)
      if rule.feed(score: s, at: t) { fires.append(t) }
    }
    XCTAssertEqual(fires.count, g.fires.count)
    for (a, b) in zip(fires, g.fires) { XCTAssertEqual(a, b, accuracy: 0.001) }
  }

  func testRuleNeedsTwoInARowAndRefractory() {
    var rule = FiringRule(threshold: 0.95, consecutive: 2, refractorySec: 1.5)
    var fires: [Double] = []
    let first: [Double] = [0.96, 0.5, 0.96, 0.97, 0.99, 0.99]
    for (i, s) in first.enumerated() {
      let t = Double(i) * 0.08
      if rule.feed(score: s, at: t) { fires.append(t) }
    }
    let later: [(Double, Double)] = [(1.24, 0.99), (1.32, 0.99), (1.84, 0.99), (1.92, 0.99)]
    for (t, s) in later {
      if rule.feed(score: s, at: t) { fires.append(t) }
    }
    XCTAssertEqual(fires.count, 2)
    XCTAssertEqual(fires[0], 0.24, accuracy: 1e-9)
    XCTAssertEqual(fires[1], 1.84, accuracy: 1e-9)
  }

  func testBrokenModelFolderThrows() throws {
    let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("voice-\(UUID().uuidString)")
    try FileManager.default.copyItem(at: Self.modelDir, to: tmp)
    defer { try? FileManager.default.removeItem(at: tmp) }
    let classifier = tmp.appendingPathComponent("classifier.bin")
    let data = try Data(contentsOf: classifier)
    try data.dropLast(4).write(to: classifier)
    XCTAssertThrowsError(try KeywordConfig.load(directory: tmp)) { error in
      guard case KeywordModelError.corrupt = error else { return XCTFail("expected .corrupt, got \(error)") }
    }
    try FileManager.default.removeItem(at: tmp.appendingPathComponent("detector.json"))
    XCTAssertThrowsError(try KeywordConfig.load(directory: tmp)) { error in
      XCTAssertEqual(error as? KeywordModelError, .missing("detector.json"))
    }
  }

  func testScorerIsFiniteOnSilenceAndClipping() throws {
    let (config, filterbank, scorer) = try loadShipped()
    XCTAssertEqual(filterbank.count, 257 * config.nMels)
    for value: Float in [0, -8, 50] {
      let s = scorer.score([Float](repeating: value, count: scorer.inputSize))
      XCTAssertTrue(s.isFinite)
      XCTAssertTrue(s >= 0 && s <= 1)
    }
  }
}
