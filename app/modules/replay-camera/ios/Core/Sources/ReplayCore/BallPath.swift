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
  /// A shirt, not the ball (test 50): a candidate at least `personAsp` times taller than wide, inside a person's box
  /// that the picture does not cut (`personEdge` from every side) and bigger than `personRatio` of that person's height
  /// (the tallest such person), has its score × `personW` (0 = left out). People: today's Modo Foco boxes per frame.
  /// personRatio 0 = off.
  public var personRatio = 0.0
  public var personAsp = 0.0
  public var personW = 0.0
  public var personEdge = 0.01
  /// A head, not the ball (test 52, beach tennis: the path sat on a near player's head while the partner volleyed): a
  /// candidate inside a person's box within `headTop` of its height from the top scores × `headW` (0 = left out). 0 =
  /// off.
  public var headTop = 0.0
  public var headW = 0.0
  /// Car lights, not the ball (2026-11-12, Victor's field clips by an avenue: lights behind the fence slid across the
  /// picture at one height and the path took them for the ball for seconds): the path's stretches where, over `flat`
  /// 100 ms frames, the points stay within `flatDy` in y while x moves `flatDx` frame widths per second or more, mostly
  /// one way, lose their candidates and the path is chosen again (up to 3 times). Only outside the play area: beyond
  /// the main players' x range ± `flatPad`, or as low as the far players' heads or lower (a ball flying flat high over
  /// the court stays). Horizontal clips only (on vertical ones a ball crossing at the far players' height looks flat).
  /// Needs the people; 0 = off. The lab's `ball_track.track_flat`.
  public var flat = 0
  public var flatDy = 0.03
  public var flatDx = 0.04
  public var flatPad = 0.2

  public init() {}

  /// Basketball (test 35): the still filter at 0.5, so a ball held or dribbled in place is kept. Test 50: the passer's
  /// yellow shirt (0.64) kept the path while the passed ball flew at 0.2–0.3; shirts score × 0.3.
  public static var basketball: BallPathParams {
    var p = BallPathParams()
    p.stillShare = 0.5
    p.personRatio = 0.3
    p.personAsp = 1.35
    p.personW = 0.3
    return p
  }

  /// Beach tennis (test 46): a ball lying on the sand is found within a few px of the same spot, so the still radius
  /// is 0.6% of the long side (2% also caught the ball in play passing near one), share 0.3.
  public static var beachTennis: BallPathParams {
    var p = BallPathParams()
    p.stillR = 0.006
    p.stillShare = 0.3
    // test 52
    p.headTop = 0.15
    p.headW = 0
    // 2026-11-12: car lights
    p.flat = 8
    return p
  }
}

/// The ball per 100 ms frame from the detector's candidates: the lab's `ball_track.track` with `dp=1` (shape filter,
/// still filter, dynamic programming over the whole clip, then the 100 ms upsampling of `low_fps.upsample`).
public enum BallPath {
  /// `frames`: one entry per 100 ms frame of the clip, nil on the frames not analysed (every `step`-th is). `width`,
  /// `height`: the upright video in pixels (only their ratio matters). `screens`: video screens at the venue (x0, y0,
  /// x1, y1, 0..1; `BallScreen`), whose candidates are left out (test 47b). `people`: person boxes per frame (x, y,
  /// width, height, 0..1, top-left origin; today's Modo Foco file), for the shirt rule (`personRatio`, test 50); none =
  /// the rule is off. `stale` (motion-gated tiles, test 54): per frame, what the tiles that were not looked at held the
  /// last time they were: evidence for the still-object filter only, never a point of the path. Returns one entry per
  /// frame.
  public static func track(frames: [[BallCandidate]?], width: Double, height: Double, step: Int,
                           params P: BallPathParams = .basketball, screens: [[Double]] = [],
                           people: [[[Double]]] = [], stale: [[BallCandidate]?] = []) -> [BallPoint?] {
    func once(_ f: [[BallCandidate]?]) -> [BallPoint?] {
      trackOnce(frames: f, width: width, height: height, step: step, params: P, screens: screens, people: people,
                stale: stale)
    }
    var pred = once(frames)
    // car lights (`flat`): horizontal clips with people only
    guard P.flat > 0, width > height else { return pred }
    let area = playArea(people)
    var fr = frames
    for _ in 0..<3 {
      let pts: [BallXY?] = pred.map { $0.map { BallXY(x: $0.cx, y: $0.cy) } }
      let kept = dropFlat(pts, length: P.flat, dy: P.flatDy, dx: P.flatDx)
      let marked = pts.indices.filter { pts[$0] != nil && kept[$0] == nil }
      var flagged: [Int] = []
      for seg in segments(marked) {
        let mx = mean(seg.map { pts[$0]!.x }), my = mean(seg.map { pts[$0]!.y })
        let inside = area.map { $0.lo - P.flatPad <= mx && mx <= $0.hi + P.flatPad } ?? true
        let high = area.flatMap { a in a.head.map { my < $0 - 0.03 } } ?? false
        if inside && (high || area == nil || area?.head == nil) { continue }
        flagged += seg.filter { $0 < fr.count && !(fr[$0]?.isEmpty ?? true) }
      }
      if flagged.isEmpty { break }
      for k in flagged {
        let p = pts[k]!
        fr[k] = fr[k]!.filter { Foundation.hypot($0.cx - p.x, $0.cy - p.y) > 0.02 }
      }
      pred = once(fr)
    }
    return pred
  }

  /// One pass of the path (`ball_track.track`).
  static func trackOnce(frames: [[BallCandidate]?], width: Double, height: Double, step: Int, params P: BallPathParams,
                        screens: [[Double]], people: [[[Double]]], stale: [[BallCandidate]?]) -> [BallPoint?] {
    let n = frames.count
    let W = width, H = height, L = max(width, height)
    let an = (0..<n).filter { frames[$0] != nil }
    let moving = Self.moving(frames: frames, stale: stale, width: width, height: height, params: P, screens: screens,
                             people: people)
    func dist(_ a: BallCandidate, _ b: BallCandidate) -> Double {
      ((a.cx - b.cx) * W).hypot((a.cy - b.cy) * H) / L
    }
    // 3. the path
    let chosen = viterbi(an: an, moving: moving, dist: dist, step: step, P: P)
    return points(chosen: chosen, an: an, count: n, step: step)
  }

  /// Steps 0 to 2 of `track`: per analysed frame, the candidates that pass the shape and score filter and are not
  /// still things.
  static func moving(frames: [[BallCandidate]?], stale: [[BallCandidate]?], width: Double, height: Double,
                     params P: BallPathParams, screens: [[Double]] = [],
                     people: [[[Double]]] = []) -> [Int: [BallCandidate]] {
    let n = frames.count
    let W = width, H = height, L = max(width, height)
    let an = (0..<n).filter { frames[$0] != nil }
    // 0. shirts (test 50): their score lowered before the shape and score filter, as `ball_track.track`
    let usePeople = (P.personRatio > 0 || P.headTop > 0) && people.contains { !$0.isEmpty }
    // 1. shape and score
    func shaped(_ k: Int, _ items: [BallCandidate]) -> [BallCandidate] {
      let rows = usePeople && k < people.count ? people[k] : []
      let weighed: [BallCandidate] = items.compactMap { c0 in
        var c = c0
        // test 52: a head (before the shirt rule, as `ball_track.track`)
        if !rows.isEmpty && P.headTop > 0 && isHead(c, boxes: rows, P: P) {
          if P.headW <= 0 { return nil }
          c.score = c.score * P.headW
        }
        guard !rows.isEmpty, P.personRatio > 0, c.height * H >= P.personAsp * c.width * W,
              isShirt(c, size: max(c.width * W, c.height * H), boxes: rows, H: H, P: P) else { return c }
        if P.personW <= 0 { return nil }
        c.score = c.score * P.personW
        return c
      }
      return weighed.filter { c in
        let wp = c.width * W, hp = c.height * H
        if c.score < P.conf || max(wp, hp) > P.boxMax * L { return false }
        if max(wp, hp) / max(1e-6, min(wp, hp)) > P.aspectMax { return false }
        return !screens.contains { $0[0] <= c.cx && c.cx <= $0[2] && $0[1] <= c.cy && c.cy <= $0[3] }
      }
    }
    var cand: [Int: [BallCandidate]] = [:]
    // what each frame's still filter may count as "seen there": its candidates and the evidence held for it
    var seen: [Int: [BallCandidate]] = [:]
    for k in an {
      let own = shaped(k, frames[k] ?? [])
      cand[k] = own
      seen[k] = k < stale.count ? own + shaped(k, stale[k] ?? []) : own
    }
    func dist(_ a: BallCandidate, _ b: BallCandidate) -> Double {
      ((a.cx - b.cx) * W).hypot((a.cy - b.cy) * H) / L
    }
    // 2. still things
    var moving: [Int: [BallCandidate]] = [:]
    for k in an {
      let near = an.filter { $0 != k && abs($0 - k) <= P.stillWin }
      moving[k] = (cand[k] ?? []).filter { c in
        let hits = near.filter { q in (seen[q] ?? []).contains { dist(c, $0) <= P.stillR } }.count
        return !(!near.isEmpty && Double(hits) >= P.stillShare * Double(near.count))
      }
    }
    return moving
  }

  /// The chosen candidate per analysed frame as the path's points, on every 100 ms frame (`low_fps.upsample`).
  private static func points(chosen: [Int: BallCandidate], an: [Int], count n: Int, step: Int) -> [BallPoint?] {
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

  /// Test 52: inside a person's box, within `headTop` of its height from its top (boxes top-left; centres worked out
  /// as the lab's centre boxes).
  static func isHead(_ c: BallCandidate, boxes: [[Double]], P: BallPathParams) -> Bool {
    for t in boxes where t.count >= 4 {
      let bx = t[0] + t[2] / 2, by = t[1] + t[3] / 2, bw = t[2], bh = t[3]
      let top = by - bh / 2
      if abs(c.cx - bx) <= bw / 2 && top <= c.cy && c.cy <= top + P.headTop * bh { return true }
    }
    return false
  }

  /// `ball_track.person_big`: inside a person's box (one the picture does not cut) and bigger than `personRatio` of the
  /// tallest such person's height. Boxes are top-left; their centres are worked out as the lab's centre boxes.
  static func isShirt(_ c: BallCandidate, size: Double, boxes: [[Double]], H: Double, P: BallPathParams) -> Bool {
    let e = P.personEdge
    var tallest: Double? = nil
    for t in boxes where t.count >= 4 {
      let bx = t[0] + t[2] / 2, by = t[1] + t[3] / 2, bw = t[2], bh = t[3]
      guard abs(c.cx - bx) <= bw / 2, abs(c.cy - by) <= bh / 2, by - bh / 2 > e, by + bh / 2 < 1 - e,
            bx - bw / 2 > e, bx + bw / 2 < 1 - e else { continue }
      tallest = max(tallest ?? 0, bh * H)
    }
    guard let t = tallest else { return false }
    return size > P.personRatio * t
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

  /// `ball_track.play_area`: the main players' x range (5–95% of their box centres, at least 20) and the far players'
  /// head line (median top of the smaller people, under 0.6 of the 80th-percentile height, within that range ± 0.05; at
  /// least 10, else nil). People: boxes per frame, top-left. Nil without enough people.
  static func playArea(_ rows: [[[Double]]]) -> (lo: Double, hi: Double, head: Double?)? {
    let all = rows.flatMap { $0.filter { $0.count >= 4 } }
    let allH = all.map { $0[3] }
    let mx = BallPlayers.main(rows, share: 0.6).flatMap { $0.map { $0[0] + $0[2] / 2 } }
    if mx.count < 20 || allH.isEmpty { return nil }
    let lo = BallPlayers.percentile(mx, 5), hi = BallPlayers.percentile(mx, 95)
    let small = 0.6 * BallPlayers.percentile(allH, 80)
    let far = all.filter { b in lo - 0.05 <= b[0] + b[2] / 2 && b[0] + b[2] / 2 <= hi + 0.05 && b[3] < small }
      .map { $0[1] }
    return (lo, hi, far.count >= 10 ? BallZoom.median(far) : nil)
  }

  /// `cam_bt.drop_flat`: the points of every window of `length` frames (at least 70% of them with a point) that stay
  /// within `dy` in y while x travels `dx` × length / 10 or more, mostly one way (at most 35% of the steps back, none
  /// back by 0.04 or more), set to nil; then each dropped stretch takes the neighbouring points that go on at the same
  /// height the same way (up to 3 frames without a point between them).
  static func dropFlat(_ tr: [BallXY?], length L: Int, dy: Double, dx: Double) -> [BallXY?] {
    if L <= 0 { return tr }
    var out = tr
    if tr.count >= L {
      for s0 in 0...(tr.count - L) {
        let pts = tr[s0..<(s0 + L)].compactMap { $0 }
        if Double(pts.count) < 0.7 * Double(L) { continue }
        let ys = pts.map { $0.y }, xs = pts.map { $0.x }
        if ys.max()! - ys.min()! >= dy || abs(xs.last! - xs.first!) < dx * Double(L) / 10 { continue }
        let way = xs.last! >= xs.first! ? 1.0 : -1.0
        let d = (0..<(xs.count - 1)).map { (xs[$0 + 1] - xs[$0]) * way }
        if d.isEmpty { continue }
        let back = Double(d.filter { $0 < 0 }.count) / Double(d.count)
        if back <= 0.35 && d.map({ -$0 }).max()! < 0.04 {
          for k in s0..<(s0 + L) { out[k] = nil }
        }
      }
    }
    let marked = tr.indices.filter { tr[$0] != nil && out[$0] == nil }
    for seg in segments(marked) {
      let ym = mean(seg.map { tr[$0]!.y })
      let way = tr[seg.last!]!.x >= tr[seg.first!]!.x ? 1.0 : -1.0
      for step in [-1, 1] {
        var k = step < 0 ? seg.first! : seg.last!
        var last = tr[k]!
        var miss = 0
        while 0 <= k + step && k + step < tr.count && miss <= 3 {
          k += step
          guard let p = tr[k] else { miss += 1; continue }
          if abs(p.y - ym) > dy || (p.x - last.x) * way * Double(step) < -0.04 { break }
          out[k] = nil
          last = p
          miss = 0
        }
      }
    }
    return out
  }

  /// `cam_bt._segments`: runs of frame indices (a gap of up to `gap` frames inside a run).
  static func segments(_ ks: [Int], gap: Int = 3) -> [[Int]] {
    var out: [[Int]] = []
    for k in ks {
      if let l = out.last?.last, k - l <= gap { out[out.count - 1].append(k) } else { out.append([k]) }
    }
    return out
  }

  static func mean(_ v: [Double]) -> Double { v.reduce(0, +) / Double(v.count) }

  static func roundTo(_ v: Double, _ digits: Int) -> Double {
    let s = pow(10.0, Double(digits))
    return (v * s).rounded(.toNearestOrEven) / s
  }
}

extension Double {
  fileprivate func hypot(_ y: Double) -> Double { Foundation.hypot(self, y) }
}
