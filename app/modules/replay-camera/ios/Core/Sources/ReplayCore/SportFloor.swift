import CoreGraphics
import Foundation

/// Test 51 (Modo Foco lab, `sport_sand.py`): what the floor of a frame is made of, to tell a sand court (beach tennis)
/// from a gym or a hard court with no question to the player. The frame is scaled to 320 px wide; in its bottom 55%:
/// - `sand`: the share of sand-coloured pixels (OpenCV's HSV scale: hue 8–28, saturation 25–140, value >= 90);
/// - `texture`: their fine texture, the median of |grey − Gaussian blur (σ 1.5)| over them (0 under 50 such pixels).
/// Wooden floors are sand-coloured but smooth; sand is grainy. The thresholds live in JS (`focus/sportCheck.ts`).
public enum SportFloor {
  public struct Measure: Equatable {
    public var sand: Double
    public var texture: Double
    public init(sand: Double, texture: Double) { self.sand = sand; self.texture = texture }
  }

  public static let width = 320

  /// The measure of a picture (nil when it cannot be drawn).
  public static func measure(_ image: CGImage) -> Measure? {
    guard image.width > 0, image.height > 0 else { return nil }
    let w = width
    let h = max(1, Int((Double(image.height) * Double(w) / Double(image.width)).rounded()))
    var px = [UInt8](repeating: 0, count: w * h * 4)
    let drawn: Bool = px.withUnsafeMutableBytes { buf -> Bool in
      guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }
      ctx.interpolationQuality = .high
      ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
      return true
    }
    guard drawn else { return nil }
    return measure(rgba: px, width: w, height: h)
  }

  /// The measure of an RGBA picture (row 0 at the top), already 320 px wide.
  public static func measure(rgba px: [UInt8], width w: Int, height h: Int) -> Measure? {
    let y0 = Int(Double(h) * 0.45)
    let rows = h - y0
    guard w > 0, rows > 2, px.count >= w * h * 4 else { return nil }
    var grey = [Double](repeating: 0, count: rows * w)
    var sand = [Bool](repeating: false, count: rows * w)
    var count = 0
    for y in 0..<rows {
      for x in 0..<w {
        let i = ((y0 + y) * w + x) * 4
        let r = Double(px[i]), g = Double(px[i + 1]), b = Double(px[i + 2])
        grey[y * w + x] = (0.299 * r + 0.587 * g + 0.114 * b).rounded()
        if isSand(r: r, g: g, b: b) {
          sand[y * w + x] = true
          count += 1
        }
      }
    }
    let share = Double(count) / Double(rows * w)
    if count <= 50 { return Measure(sand: share, texture: 0) }
    let blur = gaussian(grey, width: w, height: rows, sigma: 1.5)
    var hp: [Double] = []
    hp.reserveCapacity(count)
    for i in 0..<(rows * w) where sand[i] { hp.append(abs(grey[i] - blur[i])) }
    return Measure(sand: share, texture: median(hp))
  }

  /// OpenCV's 8-bit HSV (hue 0–180, saturation and value 0–255, rounded) inside the sand box.
  static func isSand(r: Double, g: Double, b: Double) -> Bool {
    let v = max(r, max(g, b)), mn = min(r, min(g, b)), d = v - mn
    if v < 90 { return false }
    let s = (v > 0 ? 255 * d / v : 0).rounded()
    if s < 25 || s > 140 || d <= 0 { return false }
    var hue: Double
    if v == r {
      hue = 60 * (g - b) / d
    } else if v == g {
      hue = 120 + 60 * (b - r) / d
    } else {
      hue = 240 + 60 * (r - g) / d
    }
    if hue < 0 { hue += 360 }
    let h = (hue / 2).rounded()
    return h >= 8 && h <= 28
  }

  /// OpenCV's GaussianBlur with ksize (0, 0): an 11-tap kernel for σ 1.5, border reflected without repeating the edge.
  static func gaussian(_ src: [Double], width w: Int, height h: Int, sigma: Double) -> [Double] {
    let radius = 5
    var k = (-radius...radius).map { i in exp(-Double(i * i) / (2 * sigma * sigma)) }
    let sum = k.reduce(0, +)
    k = k.map { $0 / sum }
    func reflect(_ i: Int, _ n: Int) -> Int {
      if n == 1 { return 0 }
      var j = i
      while j < 0 || j >= n { j = j < 0 ? -j : 2 * n - 2 - j }
      return j
    }
    var tmp = [Double](repeating: 0, count: w * h)
    for y in 0..<h {
      for x in 0..<w {
        var acc = 0.0
        for t in -radius...radius { acc += k[t + radius] * src[y * w + reflect(x + t, w)] }
        tmp[y * w + x] = acc
      }
    }
    var out = [Double](repeating: 0, count: w * h)
    for y in 0..<h {
      for x in 0..<w {
        var acc = 0.0
        for t in -radius...radius { acc += k[t + radius] * tmp[reflect(y + t, h) * w + x] }
        out[y * w + x] = acc
      }
    }
    return out
  }

  /// numpy.median
  public static func median(_ v: [Double]) -> Double {
    if v.isEmpty { return 0 }
    let s = v.sorted()
    return s.count % 2 == 1 ? s[s.count / 2] : (s[s.count / 2 - 1] + s[s.count / 2]) / 2
  }
}
