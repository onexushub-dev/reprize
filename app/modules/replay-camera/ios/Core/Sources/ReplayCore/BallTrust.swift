import Foundation

/// The ball path's points the camera may follow: the lab's `hybrid.trusted` for basketball and the other non-racket
/// sports (spec 2026-11-09 §4.5). A point is dropped when it does not look like a ball (too big, not round, in pieces),
/// when it jumps away from the last kept point, or when it stays still (a ball on the floor, a light).
public struct BallTrustParams: Equatable {
  public var areaMax = 0.003
  public var boxMaxFrac = 0.06
  public var fillMin = 0.45
  public var mainMin = 0.7
  public var aspectMax = 3.0
  public var jumpFrac = 0.09
  public var jumpCap = 8
  public var stillFrac = 0.012
  public var stillWin = 10
  public init() {}
}

public struct BallXY: Equatable {
  public var x: Double, y: Double
  public init(x: Double, y: Double) { self.x = x; self.y = y }
}

public enum BallTrust {
  /// `width`, `height`: the size the path's 0..1 numbers refer to (only the ratio matters).
  public static func trusted(_ path: [BallPoint?], width W: Double, height H: Double,
                             params T: BallTrustParams = BallTrustParams()) -> [BallXY?] {
    let n = path.count
    let L = max(W, H)
    var raw = [BallXY?](repeating: nil, count: n)
    for i in 0..<n {
      guard let p = path[i], p.area <= T.areaMax, p.area > 0 else { continue }
      let wpx = p.width * W, hpx = p.height * H
      let fill = p.area * W * H / max(1.0, wpx * hpx)
      if max(wpx, hpx) > T.boxMaxFrac * L || fill < T.fillMin || p.main < T.mainMin { continue }
      if max(wpx, hpx) / max(1e-6, min(wpx, hpx)) > T.aspectMax { continue }
      raw[i] = BallXY(x: p.cx, y: p.cy)
    }
    func dist(_ a: BallXY, _ b: BallXY) -> Double { hypot((a.x - b.x) * W, (a.y - b.y) * H) / L }
    // jumps: against the last kept point, allowing more across gaps (up to jumpCap frames)
    var out = [BallXY?](repeating: nil, count: n)
    var last: BallXY? = nil
    var lastI = 0
    for i in 0..<n {
      var p = raw[i]
      if let q = p, let l = last, dist(q, l) > T.jumpFrac * Double(min(i - lastI, T.jumpCap)) { p = nil }
      out[i] = p
      if let q = p { last = q; lastI = i }
    }
    // still: stays within stillFrac over ±stillWin frames
    var res = out
    for i in 0..<n {
      guard let p = out[i] else { continue }
      let win = out[max(0, i - T.stillWin)..<min(n, i + T.stillWin + 1)].compactMap { $0 }
      if win.count >= T.stillWin {
        let spread = win.map { dist($0, p) }.max() ?? 0
        if spread < T.stillFrac { res[i] = nil }
      }
    }
    return res
  }
}
