import Foundation

/// Any capture format to the voice detector's 16 kHz mono (plan 2026-11-24 voice keyword detector, Task 2).
///
/// Channels are averaged, then a windowed-sinc low-pass (cutoff 7.2 kHz, Hann window) is evaluated at each output
/// instant, so court noise above 8 kHz is removed before decimation instead of folding into the voice band. The
/// filter is centred on each output instant (no delay). State carries across calls, so the result does not depend on
/// how the audio is split. At 16 kHz mono in, samples pass through untouched.
public final class Resampler {
  public let fromRate: Double
  public let channels: Int
  public let toRate: Double
  private let ratio: Double      // input samples per output sample
  private let half: Int          // filter half-width, in input samples
  private let cutoff: Double     // cycles per input sample
  private let passThrough: Bool
  private let table: [Double]       // kernel sampled every 1/tableSteps input samples over [0, half]
  private static let tableSteps = 512
  private var buffer: [Float] = []  // mono input still needed (absolute index bufferStart + i)
  private var bufferStart = 0
  private var nextOut = 0           // absolute index of the next output sample

  public init(fromRate: Double, channels: Int, toRate: Double = 16000, cutoffHz: Double = 7200,
              halfWidthOut: Int = 16) {
    self.fromRate = fromRate
    self.channels = max(1, channels)
    self.toRate = toRate
    ratio = fromRate / toRate
    let halfWidth = max(1, Int((Double(halfWidthOut) * max(1, fromRate / toRate)).rounded(.up)))
    let cyclesPerSample = min(cutoffHz, toRate / 2) / fromRate
    half = halfWidth
    cutoff = cyclesPerSample
    passThrough = fromRate == toRate && max(1, channels) == 1
    table = (0...(halfWidth * Resampler.tableSteps + 1)).map { i in
      Resampler.exactKernel(Double(i) / Double(Resampler.tableSteps), half: halfWidth, cutoff: cyclesPerSample)
    }
  }

  /// Interleaved samples in [-1, 1] (any count, even mid-frame splits are fine as long as whole frames of `channels`
  /// samples arrive). Returns the 16 kHz mono samples that became computable.
  public func process(_ interleaved: [Float]) -> [Float] {
    if passThrough { return interleaved }
    let frames = interleaved.count / channels
    if channels == 1 {
      buffer.append(contentsOf: interleaved)
    } else {
      buffer.reserveCapacity(buffer.count + frames)
      let scale = 1 / Float(channels)
      for f in 0..<frames {
        var sum: Float = 0
        for c in 0..<channels { sum += interleaved[f * channels + c] }
        buffer.append(sum * scale)
      }
    }
    var out: [Float] = []
    out.reserveCapacity(Int(Double(frames) / ratio) + 2)
    let available = bufferStart + buffer.count
    while true {
      let p = Double(nextOut) * ratio
      let centre = Int(p.rounded(.down))
      if centre + half >= available { break }
      var acc = 0.0
      var weight = 0.0
      var k = centre - half + 1
      while k <= centre + half {
        let x = p - Double(k)
        let h = kernel(x)
        if k >= 0 {
          acc += h * Double(buffer[k - bufferStart])
        }
        weight += h
        k += 1
      }
      out.append(Float(weight != 0 ? acc / weight : 0))
      nextOut += 1
    }
    // Keep only what the next output still reaches back to.
    let keepFrom = Int((Double(nextOut) * ratio).rounded(.down)) - half + 1
    let drop = min(buffer.count, max(0, keepFrom - bufferStart))
    if drop > 0 {
      buffer.removeFirst(drop)
      bufferStart += drop
    }
    return out
  }

  /// Windowed sinc at distance `x` input samples from the output instant, from the table (linear interpolation).
  private func kernel(_ x: Double) -> Double {
    let pos = abs(x) * Double(Resampler.tableSteps)
    let i = Int(pos)
    if i >= table.count - 1 { return 0 }
    let frac = pos - Double(i)
    return table[i] + (table[i + 1] - table[i]) * frac
  }

  static func exactKernel(_ x: Double, half: Int, cutoff: Double) -> Double {
    let ax = abs(x)
    if ax >= Double(half) { return 0 }
    let window = 0.5 * (1 + cos(Double.pi * x / Double(half)))
    let arg = 2 * cutoff * x
    let sinc = arg == 0 ? 1 : sin(Double.pi * arg) / (Double.pi * arg)
    return 2 * cutoff * sinc * window
  }
}
