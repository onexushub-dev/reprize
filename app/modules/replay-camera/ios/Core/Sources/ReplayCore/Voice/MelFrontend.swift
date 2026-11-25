import Foundation

/// 16 kHz mono samples to the voice detector's mel frames (plan 2026-11-24 voice keyword detector, Task 2), exactly as
/// `docs/voice-lab/lab/tools/export_detector.py` computes them: samples ×32767, frames of `nFft` every `hop` (no
/// padding), periodic Hann(`winLength`) centred in the frame, real FFT, power, the `mel_filterbank.bin` filterbank,
/// then `log10(max(p, 1e-10)) + 2` (= 10·log10 / 10 + 2). No top-dB floor, so the frames do not depend on how the audio
/// is split into `push` calls.
public final class MelFrontend {
  public let nFft: Int
  public let hop: Int
  public let nMels: Int
  private let bins: Int
  private let filterbank: [Float]   // bins × nMels, row-major
  private let window: [Double]
  private let fft: RealFFT
  private var pending: [Float] = []
  private var pendingStart = 0      // first unused index of `pending`

  public init(filterbank: [Float], nFft: Int, winLength: Int, hop: Int, nMels: Int) {
    precondition(nFft > 0 && nFft & (nFft - 1) == 0, "nFft must be a power of two")
    self.nFft = nFft
    self.hop = hop
    self.nMels = nMels
    bins = nFft / 2 + 1
    precondition(filterbank.count == bins * nMels, "filterbank must be \(bins)×\(nMels)")
    self.filterbank = filterbank
    var w = [Double](repeating: 0, count: nFft)
    let offset = (nFft - winLength) / 2
    for n in 0..<winLength {
      w[offset + n] = 0.5 - 0.5 * cos(2 * Double.pi * Double(n) / Double(winLength))
    }
    window = w
    fft = RealFFT(size: nFft)
  }

  /// Drops buffered samples (a new session).
  public func reset() {
    pending = []
    pendingStart = 0
  }

  /// Samples in [-1, 1]. Returns the mel frames (each `nMels` values) completed by this push, oldest first.
  public func push(_ samples16k: [Float]) -> [[Float]] {
    pending.append(contentsOf: samples16k)
    var frames: [[Float]] = []
    var re = [Double](repeating: 0, count: nFft)
    var power = [Double](repeating: 0, count: bins)
    while pending.count - pendingStart >= nFft {
      for n in 0..<nFft {
        re[n] = Double(pending[pendingStart + n]) * 32767 * window[n]
      }
      fft.power(re, into: &power)
      var frame = [Float](repeating: 0, count: nMels)
      for m in 0..<nMels {
        var e = 0.0
        for k in 0..<bins { e += power[k] * Double(filterbank[k * nMels + m]) }
        frame[m] = Float(log10(max(e, 1e-10)) + 2)
      }
      frames.append(frame)
      pendingStart += hop
    }
    if pendingStart > 4096 {
      pending.removeFirst(pendingStart)
      pendingStart = 0
    }
    return frames
  }
}

/// Power spectrum (bins 0…n/2) of a real signal of power-of-two length, by an iterative radix-2 complex FFT.
final class RealFFT {
  let size: Int
  private let bitReverse: [Int]
  private let cosTable: [Double]
  private let sinTable: [Double]

  init(size: Int) {
    self.size = size
    var levels = 0
    while (1 << levels) < size { levels += 1 }
    bitReverse = (0..<size).map { i in
      var r = 0
      var x = i
      for _ in 0..<levels {
        r = (r << 1) | (x & 1)
        x >>= 1
      }
      return r
    }
    cosTable = (0..<size / 2).map { cos(2 * Double.pi * Double($0) / Double(size)) }
    sinTable = (0..<size / 2).map { -sin(2 * Double.pi * Double($0) / Double(size)) }
  }

  func power(_ input: [Double], into power: inout [Double]) {
    var re = [Double](repeating: 0, count: size)
    var im = [Double](repeating: 0, count: size)
    for i in 0..<size { re[bitReverse[i]] = input[i] }
    var len = 2
    while len <= size {
      let halfLen = len / 2
      let step = size / len
      var start = 0
      while start < size {
        for j in 0..<halfLen {
          let wr = cosTable[j * step]
          let wi = sinTable[j * step]
          let a = start + j
          let b = a + halfLen
          let tr = re[b] * wr - im[b] * wi
          let ti = re[b] * wi + im[b] * wr
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
        }
        start += len
      }
      len <<= 1
    }
    for k in 0...(size / 2) { power[k] = re[k] * re[k] + im[k] * im[k] }
  }
}
