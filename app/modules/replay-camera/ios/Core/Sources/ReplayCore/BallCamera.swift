import Foundation

/// The 9:16 camera that follows the ball: the lab's story camera C (`story.camera`, test 31) — a dead zone of ±10% of
/// the crop around the ball sideways, the ball kept between 15% from the top and 10% from the bottom, a smooth path
/// (first and second differences penalised), and today's Modo Foco framing where the ball is not seen.
/// Rects are x, y, width, height, 0..1 of the upright video, one per 100 ms frame.
public struct BallCameraParams: Equatable {
  public var deadZone = 0.10
  public var smoothA = 3.0
  public var smoothB = 300.0
  /// Weight of the "keep the ball in the band" pull on frames without the ball (held / bridged x).
  public var weightNoBall = 0.2
  /// Vertical pull towards today's framing.
  public var anchorY = 0.05
  public var top = 0.15
  public var bottom = 0.10
  /// Gaps up to this many frames are bridged with a straight line.
  public var bridge = 10
  public init() {}

  /// Basketball (test 50): the beach tennis speed — on a long pass the calmer camera C reached the receiver late; never
  /// worse on the 32 labelled basketball clips (ball in crop 96.6 -> 97.3%, after passes 92.2 -> 93.9%).
  public static var basketball: BallCameraParams {
    var p = BallCameraParams()
    p.smoothA = 1
    p.smoothB = 100
    return p
  }

  /// Beach tennis (test 49b): a faster camera (the ball crosses the court fast; a calmer one cuts the hitter more).
  /// Test 52 (diagonal views: the near player attacking was cut): faster again, a 0.3, b 30 (labelled hits: hitter whole
  /// 79 -> 87%, ball in crop unchanged).
  public static var beachTennis: BallCameraParams {
    var p = BallCameraParams()
    p.smoothA = 0.3
    p.smoothB = 30
    return p
  }
}

public enum BallCamera {
  /// `ball`: trusted points; `today`: today's 9:16 Modo Foco rects (same frames); `width`, `height`: the upright video.
  /// `aim`: the target x per frame instead of the ball's (test 49b: between the ball and the hitter; nil = the ball).
  public static func rects(ball: [BallXY?], today: [[Double]], width W: Double, height H: Double, zoom: Double,
                           params P: BallCameraParams = BallCameraParams(), aim: [Double?]? = nil) -> [[Double]] {
    let n = ball.count
    let wmax = min(1.0, (9.0 / 16.0) * H / W)
    let hmax = min(1.0, (16.0 / 9.0) * W / H)
    let w = wmax / zoom, h = hmax / zoom
    let cx0 = (0..<n).map { today[$0][0] + today[$0][2] / 2 }
    let cy0 = (0..<n).map { today[$0][1] + today[$0][3] / 2 }
    var cx: [Double]
    if w < 0.999 {
      let tx = targetX(aim ?? ball.map { $0.map { $0.x } }, fallback: cx0, bridge: P.bridge)
      let wt = ball.map { $0 == nil ? P.weightNoBall : 1.0 }
      cx = bandPath(lo: tx.map { $0 - P.deadZone * w }, hi: tx.map { $0 + P.deadZone * w }, weight: wt,
                    anchor: cx0, anchorWeight: 0, a: P.smoothA, b: P.smoothB)
    } else {
      cx = [Double](repeating: 0.5, count: n)
    }
    var cy: [Double]
    if h < 0.999 {
      let by = bridged(ball.map { $0.map { $0.y } }, gap: P.bridge)
      let lo = by.map { v in v.map { $0 - (0.5 - P.bottom) * h } ?? -Double.infinity }
      let hi = by.map { v in v.map { $0 + (0.5 - P.top) * h } ?? Double.infinity }
      cy = bandPath(lo: lo, hi: hi, weight: [Double](repeating: 1, count: n), anchor: cy0, anchorWeight: P.anchorY,
                    a: P.smoothA, b: P.smoothB)
    } else {
      cy = [Double](repeating: 0.5, count: n)
    }
    return (0..<n).map { i in
      let x = min(max(cx[i], w / 2), 1 - w / 2) - w / 2
      let y = min(max(cy[i], h / 2), 1 - h / 2) - h / 2
      return [x, y, w, h]
    }
  }

  /// `sg_framing.target_x` "hold": the ball's x; gaps up to `bridge` frames as a straight line; longer gaps and the
  /// end hold the last x; before the first ball, the fallback.
  static func targetX(_ balls: [Double?], fallback: [Double], bridge: Int) -> [Double] {
    var x = fallback
    let idx = balls.indices.filter { balls[$0] != nil }
    for i in idx { x[i] = balls[i]! }
    for (a, b) in zip(idx, idx.dropFirst()) {
      let va = balls[a]!, vb = balls[b]!
      if b - a > 1 && b - a <= bridge {
        for k in (a + 1)..<b { x[k] = linspace(va, vb, count: b - a + 1, at: k - a) }
      } else if b - a > bridge {
        for k in (a + 1)..<b { x[k] = va }
      }
    }
    if let l = idx.last, l + 1 < x.count {
      for k in (l + 1)..<x.count { x[k] = balls[l]! }
    }
    return x
  }

  /// `sg_lazy3.bridged`: gaps up to `gap` frames filled by a straight line, nil elsewhere.
  static func bridged(_ vals: [Double?], gap: Int) -> [Double?] {
    var out = vals
    let idx = vals.indices.filter { vals[$0] != nil }
    for (p, q) in zip(idx, idx.dropFirst()) where q - p > 1 && q - p <= gap {
      for k in (p + 1)..<q { out[k] = linspace(vals[p]!, vals[q]!, count: q - p + 1, at: k - p) }
    }
    return out
  }

  /// numpy.linspace(a, b, count)[i]
  static func linspace(_ a: Double, _ b: Double, count: Int, at i: Int) -> Double {
    let div = Double(count - 1)
    if i == count - 1 { return b }
    return a + Double(i) * ((b - a) / div)
  }

  /// `sg_lazy3.band_path`: a smooth path c that stays inside [lo, hi] where it can — minimise
  /// Σ w·(c − clip(c))² over frames outside the band + a·|Δc|² + b·|Δ²c|² + wa·|c − anchor|², by repeated solves of the
  /// pentadiagonal system.
  static func bandPath(lo: [Double], hi: [Double], weight: [Double], anchor: [Double], anchorWeight wa: Double,
                       a: Double, b: Double, iters: Int = 40) -> [Double] {
    let n = lo.count
    if n == 0 { return [] }
    // R = a·D1ᵀD1 + b·D2ᵀD2 + (wa + 1e-6)·I as bands: d0 (diagonal), d1 (±1), d2 (±2)
    var d0 = [Double](repeating: wa + 1e-6, count: n)
    var d1 = [Double](repeating: 0, count: max(0, n - 1))
    var d2 = [Double](repeating: 0, count: max(0, n - 2))
    for i in 0..<(n - 1) { // D1 rows: e[i+1] − e[i]
      d0[i] += a; d0[i + 1] += a; d1[i] -= a
    }
    if n >= 3 {
      for i in 0..<(n - 2) { // D2 rows: e[i] − 2e[i+1] + e[i+2]
        d0[i] += b; d0[i + 1] += 4 * b; d0[i + 2] += b
        d1[i] -= 2 * b; d1[i + 1] -= 2 * b
        d2[i] += b
      }
    }
    let ra = wa + 1e-6
    var c = (0..<n).map { lo[$0].isFinite ? (lo[$0] + hi[$0]) / 2 : anchor[$0] }
    for _ in 0..<iters {
      var diag = d0
      var rhs = [Double](repeating: 0, count: n)
      for i in 0..<n {
        let out = c[i] < lo[i] || c[i] > hi[i]
        let y = min(max(c[i], lo[i]), hi[i])
        let wd = out ? weight[i] : 0
        diag[i] += wd
        rhs[i] = wd * (y.isFinite ? y : 0) + ra * anchor[i]
      }
      let next = solvePenta(diag: diag, off1: d1, off2: d2, rhs: rhs)
      var delta = 0.0
      for i in 0..<n { delta = max(delta, abs(next[i] - c[i])) }
      c = next
      if delta < 1e-5 { break }
    }
    return c
  }

  /// Symmetric pentadiagonal solve (Gaussian elimination without pivoting; the matrix is positive definite).
  static func solvePenta(diag: [Double], off1: [Double], off2: [Double], rhs: [Double]) -> [Double] {
    let n = diag.count
    // rows as bands: a[i][j] for column i + j − 2, j = 0...4
    var m = [[Double]](repeating: [0, 0, 0, 0, 0], count: n)
    var r = rhs
    for i in 0..<n {
      if i >= 2 { m[i][0] = off2[i - 2] }
      if i >= 1 { m[i][1] = off1[i - 1] }
      m[i][2] = diag[i]
      if i + 1 < n { m[i][3] = off1[i] }
      if i + 2 < n { m[i][4] = off2[i] }
    }
    for k in 0..<n {
      if k + 1 >= n { break }
      let piv = m[k][2]
      for i in (k + 1)...min(n - 1, k + 2) {
        let s = i - k // row i's band index for column k is 2 − s
        let f = m[i][2 - s] / piv
        if f == 0 { continue }
        for j in 0...2 where k + j < n { // columns k...k+2 of row k: band 2+j; of row i: band 2−s+j
          m[i][2 - s + j] -= f * m[k][2 + j]
        }
        r[i] -= f * r[k]
      }
    }
    var x = [Double](repeating: 0, count: n)
    for i in stride(from: n - 1, through: 0, by: -1) {
      var s = r[i]
      if i + 1 < n { s -= m[i][3] * x[i + 1] }
      if i + 2 < n { s -= m[i][4] * x[i + 2] }
      x[i] = s / m[i][2]
    }
    return x
  }
}
