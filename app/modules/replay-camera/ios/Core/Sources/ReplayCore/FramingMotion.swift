import Foundation

/// How much a framing moves, in the lab's own numbers (`sg_framing.score`), for the Diagnóstico log (plan 2026-11-12,
/// I5): a camera that jumps shows as a number in the field test, not only on video.
public enum FramingMotion {
  /// `rects`: x, y, width, height per row (0..1 of the video), one every `stepMs`. `panP95`: the 95th percentile of the
  /// crop centre's speed, in frame sizes per second; `turnsPer10s`: reversals of its direction between turning points at
  /// least 2% of the frame apart. Only the axes the crop does not fill count.
  public static func stats(rects: [[Double]], stepMs: Double) -> (panP95: Double, turnsPer10s: Double) {
    let rows = rects.filter { $0.count == 4 }
    guard rows.count > 1, stepMs > 0 else { return (0, 0) }
    var speeds = [Double](repeating: 0, count: rows.count - 1)
    var flips = 0
    for axis in 0..<2 {
      guard let smallest = rows.map({ $0[2 + axis] }).min(), smallest < 0.999 else { continue }
      let c = rows.map { $0[axis] + $0[2 + axis] / 2 }
      for i in 0..<speeds.count { speeds[i] = max(speeds[i], abs(c[i + 1] - c[i]) / (stepMs / 1000)) }
      var last = 0.0, ref = c[0]
      for p in c.dropFirst() {
        let d = p - ref
        if abs(d) >= 0.02 {
          let s = d > 0 ? 1.0 : -1.0
          if last != 0 && s != last { flips += 1 }
          last = s
          ref = p
        } else if last != 0 && d * last > 0 {
          ref = p
        }
      }
    }
    let sorted = speeds.sorted()
    let at = 0.95 * Double(sorted.count - 1)
    let lo = Int(at.rounded(.down)), hi = min(sorted.count - 1, lo + 1)
    let p95 = sorted[lo] + (sorted[hi] - sorted[lo]) * (at - Double(lo))
    return (p95, Double(flips) * 10_000 / (Double(rows.count) * stepMs))
  }
}
