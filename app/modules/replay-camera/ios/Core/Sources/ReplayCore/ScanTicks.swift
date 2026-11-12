import Foundation

/// Which pictures of a clip an analysis needs (plan 2026-11-12, I1): Jogadores and Bola each want one picture per tick
/// of their own grid, and one pass over the clip's frames serves both. A tick stands for the `windowMs` after it; the
/// picture kept for it is the first frame at or after it inside that window.
public enum ScanTicks {
  /// The grid of a range: `startMs`, then every `everyMs`, before `endMs`.
  public static func ticks(startMs: Double, endMs: Double, everyMs: Double) -> [Double] {
    guard everyMs > 0, endMs > startMs else { return [] }
    return Array(stride(from: startMs, to: endMs, by: everyMs))
  }

  /// The ticks with no kept picture (`have`: their times, any order) in their window.
  public static func missing(ticks: [Double], have: [Double], windowMs: Double) -> [Double] {
    let sorted = have.sorted()
    return ticks.filter { tick in
      // binary search for the first time ≥ tick − 0.5
      var lo = 0, hi = sorted.count
      while lo < hi {
        let mid = (lo + hi) / 2
        if sorted[mid] < tick - 0.5 { lo = mid + 1 } else { hi = mid }
      }
      return !(lo < sorted.count && sorted[lo] < tick + windowMs - 0.5)
    }
  }

  /// Walks the frames in time order and says which to keep: the first at or after each tick, inside its window. A tick
  /// whose window passes with no frame is passed over.
  public struct Cursor {
    public let ticks: [Double]
    public let windowMs: Double
    private var next = 0

    public init(ticks: [Double], windowMs: Double) {
      self.ticks = ticks
      self.windowMs = windowMs
    }

    public var done: Bool { next >= ticks.count }

    public mutating func take(_ tMs: Double) -> Bool {
      while next < ticks.count && tMs >= ticks[next] + windowMs - 0.5 { next += 1 }
      guard next < ticks.count, tMs >= ticks[next] - 0.5 else { return false }
      next += 1
      return true
    }
  }

  /// The stretch of the clip to read for both lists of ticks (each with its window); nil when there is nothing to read.
  public static func span(people: [Double], peopleWindowMs: Double, ball: [Double],
                          ballWindowMs: Double) -> (fromMs: Double, toMs: Double)? {
    var from = Double.infinity, to = -Double.infinity
    if let a = people.min(), let b = people.max() { from = min(from, a); to = max(to, b + peopleWindowMs) }
    if let a = ball.min(), let b = ball.max() { from = min(from, a); to = max(to, b + ballWindowMs) }
    return from <= to ? (from, to) : nil
  }
}
