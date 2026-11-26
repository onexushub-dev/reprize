import Foundation
#if canImport(Accelerate)
import Accelerate
#endif

/// The "salvar" detector's numbers, read from `detector.json` (plan 2026-11-24 voice keyword detector, Task 3).
/// Field names match the file exactly; nothing here is a code constant.
public struct KeywordConfig: Decodable, Equatable {
  public let version: String
  public let sampleRate: Int
  public let nFft: Int
  public let winLength: Int
  public let hop: Int
  public let nMels: Int
  public let fMin: Double
  public let fMax: Double
  public let embedEvery: Int
  public let embedFrames: Int
  public let embedSize: Int
  public let windows: Int
  public let hidden: Int
  public let threshold: Double
  public let consecutive: Int
  public let refractorySec: Double

  /// Seconds of audio at which score `index` exists (end of its last embedding's last mel frame).
  public func scoreTime(index: Int) -> Double {
    let lastFrame = (index + windows - 1) * embedEvery + embedFrames - 1
    return Double(lastFrame * hop + nFft) / Double(sampleRate)
  }

  /// Size of one classifier input: `windows` embeddings of `embedSize`.
  public var classifierInput: Int { windows * embedSize }

  /// A model folder (`detector.json`, `mel_filterbank.bin`, `classifier.bin`): its config, filterbank and scorer.
  public static func load(directory: URL) throws -> (config: KeywordConfig, filterbank: [Float], scorer: KeywordScorer) {
    let config: KeywordConfig
    do {
      config = try JSONDecoder().decode(KeywordConfig.self, from: try read(directory, "detector.json"))
    } catch let error as KeywordModelError {
      throw error
    } catch {
      throw KeywordModelError.corrupt("detector.json: \(error)")
    }
    let filterbank = try floats(try read(directory, "mel_filterbank.bin"), name: "mel_filterbank.bin",
                                count: (config.nFft / 2 + 1) * config.nMels)
    let weights = try read(directory, "classifier.bin")
    let scorer = try KeywordScorer(weights: try floats(weights, name: "classifier.bin",
                                                       count: KeywordScorer.weightCount(inputSize: config.classifierInput,
                                                                                        hidden: config.hidden)),
                                   inputSize: config.classifierInput, hidden: config.hidden)
    return (config, filterbank, scorer)
  }

  private static func read(_ directory: URL, _ name: String) throws -> Data {
    let url = directory.appendingPathComponent(name)
    guard FileManager.default.fileExists(atPath: url.path) else { throw KeywordModelError.missing(name) }
    return try Data(contentsOf: url)
  }

  private static func floats(_ data: Data, name: String, count: Int) throws -> [Float] {
    guard data.count == count * 4 else {
      throw KeywordModelError.corrupt("\(name): \(data.count) bytes, expected \(count * 4)")
    }
    return data.withUnsafeBytes { raw in
      (0..<count).map { Float(bitPattern: UInt32(littleEndian: raw.loadUnaligned(fromByteOffset: $0 * 4, as: UInt32.self))) }
    }
  }
}

public enum KeywordModelError: Error, Equatable {
  case missing(String)
  case corrupt(String)
}

/// The classifier: `windows` embeddings in a row → 1 hidden layer (ReLU) → sigmoid score in 0…1.
/// Weights, float32 little-endian, in this order: W1 (input × hidden, row-major), b1 (hidden), W2 (hidden), b2 (1).
public final class KeywordScorer {
  public let inputSize: Int
  public let hidden: Int
  private let w1: [Float]
  private let b1: [Float]
  private let w2: [Float]
  private let b2: Float

  public static func weightCount(inputSize: Int, hidden: Int) -> Int { inputSize * hidden + hidden + hidden + 1 }

  public init(weights: [Float], inputSize: Int, hidden: Int) throws {
    guard weights.count == KeywordScorer.weightCount(inputSize: inputSize, hidden: hidden) else {
      throw KeywordModelError.corrupt("classifier: \(weights.count) weights for \(inputSize)×\(hidden)")
    }
    self.inputSize = inputSize
    self.hidden = hidden
    var at = 0
    w1 = Array(weights[at..<(at + inputSize * hidden)])
    at += inputSize * hidden
    b1 = Array(weights[at..<(at + hidden)])
    at += hidden
    w2 = Array(weights[at..<(at + hidden)])
    at += hidden
    b2 = weights[at]
  }

  /// `window`: the last `windows` embeddings concatenated, oldest first (`inputSize` values).
  public func score(_ window: [Float]) -> Double {
    precondition(window.count == inputSize, "classifier input must be \(inputSize) values")
    #if canImport(Accelerate)
    // hidden = window (1×inputSize) · w1 (inputSize×hidden) + b1, ReLU, then · w2 + b2 (vDSP, Float accumulation).
    var h = [Float](repeating: 0, count: hidden)
    let n = vDSP_Length(hidden)
    h.withUnsafeMutableBufferPointer { hp in
      let p = hp.baseAddress!
      vDSP_mmul(window, 1, w1, 1, p, 1, 1, n, vDSP_Length(inputSize))
      vDSP_vadd(p, 1, b1, 1, p, 1, n)
      var zero: Float = 0
      vDSP_vthr(p, 1, &zero, p, 1, n)
    }
    var dot: Float = 0
    vDSP_dotpr(h, 1, w2, 1, &dot, vDSP_Length(hidden))
    let zf = Double(dot) + Double(b2)
    return 1 / (1 + exp(-zf))
    #else
    var acc = b1.map { Double($0) }
    for i in 0..<inputSize {
      let x = window[i]
      if x == 0 { continue }
      let row = i * hidden
      for j in 0..<hidden { acc[j] += Double(x * w1[row + j]) }
    }
    var z = Double(b2)
    for j in 0..<hidden where acc[j] > 0 { z += acc[j] * Double(w2[j]) }
    return 1 / (1 + exp(-z))
    #endif
  }
}

/// Fires when `consecutive` scores in a row reach `threshold`, then stays quiet for `refractorySec`.
public struct FiringRule {
  public let threshold: Double
  public let consecutive: Int
  public let refractorySec: Double
  private var run = 0
  private var lastFire = -Double.infinity

  public init(config: KeywordConfig) {
    self.init(threshold: config.threshold, consecutive: config.consecutive, refractorySec: config.refractorySec)
  }

  public init(threshold: Double, consecutive: Int, refractorySec: Double) {
    self.threshold = threshold
    self.consecutive = consecutive
    self.refractorySec = refractorySec
  }

  /// One score at `seconds` of audio; true exactly when the rule fires.
  public mutating func feed(score: Double, at seconds: Double) -> Bool {
    run = score >= threshold ? run + 1 : 0
    guard run >= consecutive, seconds - lastFire >= refractorySec else { return false }
    lastFire = seconds
    return true
  }

  public mutating func reset() {
    run = 0
    lastFire = -Double.infinity
  }
}
