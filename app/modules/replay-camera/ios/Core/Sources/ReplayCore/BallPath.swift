import Foundation

/// One detector candidate in an analysed frame: centre and size 0..1 of the upright video, and the detector's score.
public struct BallCandidate: Equatable {
  public var cx: Double, cy: Double, width: Double, height: Double, score: Double
  public init(cx: Double, cy: Double, width: Double, height: Double, score: Double) {
    self.cx = cx; self.cy = cy; self.width = width; self.height = height; self.score = score
  }
}

/// The ball on one 100 ms frame of the path: centre and size 0..1, the ellipse's area (0..1 of the frame), the share of
/// it in one piece (1 for a detector box) and the score (interpolated frames keep the earlier frame's score).
public struct BallPoint: Equatable {
  public var cx: Double, cy: Double, width: Double, height: Double, area: Double, main: Double, score: Double
  public init(cx: Double, cy: Double, width: Double, height: Double, area: Double, main: Double, score: Double) {
    self.cx = cx; self.cy = cy; self.width = width; self.height = height; self.area = area; self.main = main
    self.score = score
  }
}

/// The ball path's numbers: the Modo Foco lab's `ball_track.py` `P` + `SPORT_P` (tests 17, 35; spec 2026-11-09 §4.5).
public struct BallPathParams: Equatable {
  /// A candidate larger than this share of the long side, or longer than `aspectMax` wide/tall, is not a ball.
  public var boxMax = 0.06
  public var aspectMax = 2.5
  public var conf = 0.05
  /// Still things (a spare ball, the rim, a lamp): a candidate with another one within `stillR` long sides on
  /// `stillShare` or more of the analysed frames within ±`stillWin` 100 ms frames.
  public var stillR = 0.02
  public var stillShare = 0.2
  public var stillWin = 20
  /// The path (Viterbi): gain = score − s0 per frame on the ball, minus moveCost × long sides moved, minus stillCost
  /// when it does not move; at most vmax long sides per 100 ms; it may skip up to dpGap 100 ms frames.
  public var s0 = 0.05
  public var vmax = 0.12
  public var moveCost = 1.0
  public var dpGap = 10
  public var stillCost = 0.05
  /// Paths shorter than this (analysed frames) are dropped.
  public var minLen = 3

  public init() {}

  /// Basketball (test 35): the still filter at 0.5, so a ball held or dribbled in place is kept.
  public static var basketball: BallPathParams {
    var p = BallPathParams()
    p.stillShare = 0.5
    return p
  }

  /// Beach tennis (test 46): a ball lying on the sand is found within a few px of the same spot, so the still radius
  /// is 0.6% of the long side (2% also caught the ball in play passing near one), share 0.3.
  public static var beachTennis: BallPathParams {
    var p = BallPathParams()
    p.stillR = 0.006
    p.stillShare = 0.3
    return p
  }
}

/// The ball per 100 ms frame from the detector's candidates: the lab's `ball_track.track` with `dp=1` (shape filter,
/// still filter, dynamic programming over the whole clip, then the 100 ms upsampling of `low_fps.upsample`).
public enum BallPath {
  /// `frames`: one entry per 100 ms frame of the clip, nil on the frames not analysed (every `step`-th is). `width`,
  /// `height`: the upright video in pixels (only their ratio matters). `screens`: video screens at the venue (x0, y0,
  /// x1, y1, 0..1; `BallScreen`), whose candidates are left out (test 47b). Returns one entry per frame.
  public static func track(frames: [[BallCandidate]?], width: Double, height: Double, step: Int,
                           params P: BallPathParams = .basketball, screens: [[Double]] = []) -> [BallPoint?] {
    let n = frames.count
    let W = width, H = height, L = max(width, height)
    let an = (0..<n).filter { frames[$0] != nil }
    // 1. shape and score
    var cand: [Int: [BallCandidate]] = [:]
    for k in an {
      cand[k] = (frames[k] ?? []).filter { c in
        let wp = c.width * W, hp = c.height * H
        if c.score < P.conf || max(wp, hp) > P.boxMax * L { return false }
        if max(wp, hp) / max(1e-6, min(wp, hp)) > P.aspectMax { return false }
        return !screens.contains { $0[0] <= c.cx && c.cx <= $0[2] && $0[1] <= c.cy && c.cy <= $0[3] }
      }
    }
    func dist(_ a: BallCandidate, _ b: BallCandidate) -> Double {
      ((a.cx - b.cx) * W).hypot((a.cy - b.cy) * H) / L
    }
    // 2. still things
    var moving: [Int: [BallCandidate]] = [:]
    for k in an {
      let near = an.filter { $0 != k && abs($0 - k) <= P.stillWin }
      moving[k] = (cand[k] ?? []).filter { c in
        let hits = near.filter { q in (cand[q] ?? []).contains { dist(c, $0) <= P.stillR } }.count
        return !(!near.isEmpty && Double(hits) >= P.stillShare * Double(near.count))
      }
    }
    // 3. the path
    let chosen = viterbi(an: an, moving: moving, dist: dist, step: step, P: P)
    var pred: [Int: BallPoint?] = [:]
    for k in an {
      if let c = chosen[k] {
        let area = roundTo((Double.pi / 4) * c.width * c.height, 7)
        pred[k] = BallPoint(cx: c.cx, cy: c.cy, width: c.width, height: c.height, area: area, main: 1.0,
                            score: c.score)
      } else {
        pred[k] = .some(nil)
      }
    }
    let off = an.first.map { $0 % step } ?? 0
    return step > 1 ? upsample(pred, n: n, step: step, off: off) : (0..<n).map { pred[$0] ?? nil }
  }

  private struct Node: Hashable, Comparable {
    let k: Int, j: Int
    static func < (a: Node, b: Node) -> Bool { a.k != b.k ? a.k < b.k : a.j < b.j }
  }

  /// `ball_track.dp_track`: the best path ends anywhere; the frames left get the next best disjoint paths.
  private static func viterbi(an: [Int], moving: [Int: [BallCandidate]],
                              dist: (BallCandidate, BallCandidate) -> Double, step: Int,
                              P: BallPathParams) -> [Int: BallCandidate] {
    var best: [Node: Double] = [:]
    var back: [Node: Node?] = [:]
    var order: [Node] = []
    let back1 = P.dpGap / step + 1
    for (i, k) in an.enumerated() {
      let prevs = an[max(0, i - back1)..<i]
      for (j, c) in (moving[k] ?? []).enumerated() {
        let g = c.score - P.s0
        var b = g
        var bp: Node? = nil // start a path here
        for q in prevs where k - q <= P.dpGap {
          for (jj, cc) in (moving[q] ?? []).enumerated() {
            guard let prev = best[Node(k: q, j: jj)] else { continue }
            let d = dist(c, cc)
            if d > P.vmax * Double(k - q) { continue }
            let v = prev + g - P.moveCost * d - (d < 0.005 * Double(k - q) ? P.stillCost : 0)
            if v > b { b = v; bp = Node(k: q, j: jj) }
          }
        }
        let node = Node(k: k, j: j)
        best[node] = b
        back[node] = .some(bp)
        order.append(node)
      }
    }
    var chosen: [Int: BallCandidate] = [:]
    var used = Set<Node>()
    while true {
      // Python's max over (value, (k, j)): the highest value, ties to the larger node
      var top: (v: Double, key: Node)? = nil
      for node in order where !used.contains(node) && chosen[node.k] == nil {
        let v = best[node]!
        if let t = top {
          if v > t.v || (v == t.v && t.key < node) { top = (v, node) }
        } else {
          top = (v, node)
        }
      }
      guard let t = top, t.v > 0.5 else { break }
      var path: [Node] = []
      var key: Node? = t.key
      while let kk = key, !used.contains(kk), chosen[kk.k] == nil {
        path.append(kk)
        key = back[kk] ?? nil
      }
      if path.count < P.minLen {
        for kk in path { used.insert(kk) }
        continue
      }
      for kk in path {
        chosen[kk.k] = moving[kk.k]![kk.j]
        used.insert(kk)
      }
      for node in order where chosen[node.k] != nil { used.insert(node) }
    }
    return chosen
  }

  /// `low_fps.upsample`: the analysed frames as they are; a frame between two analysed frames that both have the ball
  /// gets centre, size and area interpolated (6 decimals), the rest from the earlier one; else nil.
  static func upsample(_ pred: [Int: BallPoint?], n: Int, step: Int, off: Int) -> [BallPoint?] {
    (0..<n).map { k -> BallPoint? in
      if let p = pred[k], (k - off) % step == 0 { return p }
      let a = off + Int((Double(k - off) / Double(step)).rounded(.down)) * step
      let b = a + step
      guard a >= off, b < n, let va = pred[a] ?? nil, let vb = pred[b] ?? nil else { return nil }
      let f = Double(k - a) / Double(step)
      func lerp(_ x: Double, _ y: Double) -> Double { roundTo(x + (y - x) * f, 6) }
      return BallPoint(cx: lerp(va.cx, vb.cx), cy: lerp(va.cy, vb.cy), width: lerp(va.width, vb.width),
                       height: lerp(va.height, vb.height), area: lerp(va.area, vb.area), main: va.main,
                       score: va.score)
    }
  }

  static func roundTo(_ v: Double, _ digits: Int) -> Double {
    let s = pow(10.0, Double(digits))
    return (v * s).rounded(.toNearestOrEven) / s
  }
}

extension Double {
  fileprivate func hypot(_ y: Double) -> Double { Foundation.hypot(self, y) }
}
