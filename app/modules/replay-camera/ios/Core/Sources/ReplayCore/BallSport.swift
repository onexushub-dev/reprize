import Foundation

/// Seguir a Bola per sport (Modo Foco lab, tests 45–48): each sport has its own detector, path numbers, camera rule,
/// zoom rule and verdict on whether the mode is worth applying. Basketball keeps exactly the values it had before beach
/// tennis came (`.basketball`); a sport without a profile has no Seguir a Bola yet ("EM BREVE").
public struct BallSport: Equatable {
  /// The app's sport id, as the recording / the player's choice says it.
  public var id: String
  /// The compiled Core ML model in the pod's resources (`ios/Models/<modelId>.mlmodelc`); also keys the detections
  /// cache, so a clip analysed with another sport's model is analysed again.
  public var modelId: String
  /// Written into the framing file ("rules").
  public var rules: String
  public var path: BallPathParams
  /// Camera: only runs of trusted points at least `minRun` 100 ms frames long are followed (a run ends after `runGap`
  /// frames without the ball); 0 = every trusted point (test 46b).
  public var minRun: Int
  public var runGap: Int
  public var zoom: BallZoomParams
  /// Leave out the candidates inside a video screen at the venue (test 47b).
  public var screens: Bool
  /// When the mode is worth applying (test 47a); nil = always.
  public var verdict: BallVerdictParams?
  /// The camera's dead zone and smoothing (test 49b).
  public var camera: BallCameraParams
  /// The players in the camera (test 49): the court lock and the aim toward the hitter; nil = the ball alone.
  public var follow: BallFollowParams?

  public init(id: String, modelId: String, rules: String, path: BallPathParams, minRun: Int, runGap: Int,
              zoom: BallZoomParams, screens: Bool, verdict: BallVerdictParams?,
              camera: BallCameraParams = BallCameraParams(), follow: BallFollowParams? = nil) {
    self.id = id; self.modelId = modelId; self.rules = rules; self.path = path; self.minRun = minRun
    self.runGap = runGap; self.zoom = zoom; self.screens = screens; self.verdict = verdict
    self.camera = camera; self.follow = follow
  }

  /// Basketball as it was (tests 28–42): `ball_tiny_gym`, still filter 0.5, every trusted point, test 31's
  /// zoom.
  public static let basketball = BallSport(
    id: "basquete", modelId: "ball_tiny_gym", rules: "ball-t42", path: .basketball, minRun: 0, runGap: 4,
    zoom: BallZoomParams(), screens: false, verdict: nil)

  /// Beach tennis (tests 45–49): its own detector (public sets + both of Victor's arenas, every ball marked), the
  /// still filter at 0.6% of the long side, runs of 1 s, 1.0x horizontal / test 31's rule up to x1.5 vertical, screens
  /// out, the verdict, a faster camera, the rally's court (by the ball and by the main players), the aim toward the
  /// hitter, the near pair kept whole where the ball allows, a ball gone out at the top taken back only at the top (our ball looked for meanwhile), and the target going
  /// on the ball's way where it is lost in flight.
  public static let beachTennis = BallSport(
    id: "beachTennis", modelId: "ball_tiny_btpl", rules: "ball-bt-t49f", path: .beachTennis, minRun: 10, runGap: 4,
    zoom: .beachTennis, screens: true, verdict: .beachTennis, camera: .beachTennis, follow: .beachTennis)

  /// The profile for a sport id; nil = no Seguir a Bola for it yet.
  public static func of(_ id: String) -> BallSport? {
    switch id {
    case basketball.id: return basketball
    case beachTennis.id: return beachTennis
    default: return nil
    }
  }
}

/// Test 49 (`cam_bt.py`): the players in the ball camera.
public struct BallFollowParams: Equatable {
  /// The main players: boxes at least this share of the clip's 80th-percentile box height.
  public var mainShare: Double
  /// Court lock: a ball point more than this many frame widths outside the main players' x (their box centres' 5–95%
  /// over the clip) is another court's and is not followed (test 49a).
  public var courtMargin: Double
  /// The camera aims `blend` of the way from the ball to the hitter's centre (test 49b)…
  public var blend: Double
  /// …the hitter being the main player nearest to the ball, if within `near` long sides (centre to centre).
  public var near: Double
  /// Court lock by the ball (test 49d): the rally's (longest run's) x range, 5–95% ± this many frame widths; another
  /// run whose median x, or a point whose x, is outside is not followed (the next court's ball once the rally's has left
  /// the picture). 0 = off.
  public var ballCourtMargin: Double
  /// Keep both near players (the two tallest main boxes) whole in the crop where the ball can stay inside too, with
  /// `pairPad` crop widths of room (test 49c).
  public var keepPair: Bool
  public var pairPad: Double
  /// A ball gone out at the top comes back only at the top (test 49e): a point still rising that, at its speed, is
  /// within `exitTop` of the top edge 2 frames later is going out; the points after it are not followed until one is
  /// back within `exitBack` of the top edge and `exitDx` frame widths of where it went out. 0 = off.
  public var exitTop: Double
  public var exitBack: Double
  public var exitDx: Double
  /// While the ball is out (test 49f): our ball looked for among the detector's moving candidates (score >=
  /// `ownMinScore`; 0 = off), back at the top first, then candidate to candidate within `ownStep` long sides per frame;
  /// `ownLost` frames without it = looked for at the top again.
  public var ownMinScore: Double
  public var ownStep: Double
  public var ownLost: Int
  /// The near pair kept whole only while the ball is within `pairNear` long sides of one of them (0 = always).
  public var pairNear: Double
  /// Where the ball is lost in flight, the camera's target goes on the ball's way for up to `glide` frames (0 = off).
  public var glide: Int

  public init(mainShare: Double, courtMargin: Double, blend: Double, near: Double, ballCourtMargin: Double = 0,
              keepPair: Bool = false, pairPad: Double = 0, exitTop: Double = 0, exitBack: Double = 0.2,
              exitDx: Double = 0.25, ownMinScore: Double = 0, ownStep: Double = 0.08, ownLost: Int = 4,
              pairNear: Double = 0, glide: Int = 0) {
    self.mainShare = mainShare; self.courtMargin = courtMargin; self.blend = blend; self.near = near
    self.ballCourtMargin = ballCourtMargin; self.keepPair = keepPair; self.pairPad = pairPad
    self.exitTop = exitTop; self.exitBack = exitBack; self.exitDx = exitDx
    self.ownMinScore = ownMinScore; self.ownStep = ownStep; self.ownLost = ownLost
    self.pairNear = pairNear; self.glide = glide
  }

  public static let beachTennis = BallFollowParams(mainShare: 0.6, courtMargin: 0.2, blend: 0.4, near: 0.25,
                                                   ballCourtMargin: 0.25, keepPair: true, pairPad: 0,
                                                   exitTop: 0.05, exitBack: 0.2, exitDx: 0.25, ownMinScore: 0.5,
                                                   ownStep: 0.08, ownLost: 4, pairNear: 0.25, glide: 6)
}

/// `cam_bt.main_players` / `keep_players_court` / `aim_x` (test 49). Boxes are x, y, width, height, 0..1 of the upright
/// video, top-left origin, one row of boxes per 100 ms frame (today's Modo Foco file, "people").
public enum BallPlayers {
  /// The boxes at least `share` of the 80th-percentile height of every box of the clip.
  public static func main(_ rows: [[[Double]]], share: Double) -> [[[Double]]] {
    let hs = rows.flatMap { $0.filter { $0.count >= 4 }.map { $0[3] } }
    if hs.isEmpty { return rows.map { _ in [] } }
    let hmin = share * percentile(hs, 80)
    return rows.map { $0.filter { $0.count >= 4 && $0[3] >= hmin } }
  }

  /// The trusted points inside the main players' court (`margin` frame widths around the 5–95% of their box centres'
  /// x); unchanged when fewer than 20 boxes or margin <= 0.
  public static func courtLock(_ tr: [BallXY?], main: [[[Double]]], margin: Double) -> [BallXY?] {
    if margin <= 0 { return tr }
    let xs = main.flatMap { $0.map { $0[0] + $0[2] / 2 } }
    if xs.count < 20 { return tr }
    let lo = percentile(xs, 5) - margin, hi = percentile(xs, 95) + margin
    return tr.map { p in
      guard let p = p else { return nil }
      return lo <= p.x && p.x <= hi ? p : nil
    }
  }

  /// The camera's target x per frame: the ball's, moved `blend` of the way to the hitter's centre where there is one.
  public static func aim(_ tr: [BallXY?], main: [[[Double]]], width W: Double, height H: Double, blend: Double,
                         near: Double) -> [Double?] {
    var xs: [Double?] = tr.map { $0.map { $0.x } }
    if blend <= 0 { return xs }
    for (k, p) in tr.enumerated() {
      guard let p = p, k < main.count, let hb = hitter(p, boxes: main[k], width: W, height: H, near: near) else {
        continue
      }
      xs[k] = (1 - blend) * p.x + blend * (hb[0] + hb[2] / 2)
    }
    return xs
  }

  /// `cam_bt.keep_pair` (mode 1): each target x moved, where it can be, into the centres that keep the two tallest
  /// boxes (+ `pad` crop widths) and the ball (with the same pad) inside a crop `cropWidth` wide; left alone where no
  /// such centre exists (the ball wins).
  /// `nearOnly` > 0 (test 49f): only where the ball is within that many long sides of one of the two (`width`,
  /// `height`: the picture).
  public static func keepPair(_ xs: [Double?], tr: [BallXY?], main: [[[Double]]], cropWidth w: Double,
                              pad: Double, nearOnly: Double = 0, width W: Double = 1,
                              height H: Double = 1) -> [Double?] {
    var out = xs
    for (k, x) in xs.enumerated() {
      guard let x = x, k < tr.count, let ball = tr[k], k < main.count else { continue }
      // the two tallest, ties in their order (Python's stable sort)
      let bs = main[k].enumerated().sorted { a, b in
        a.element[3] != b.element[3] ? a.element[3] > b.element[3] : a.offset < b.offset
      }.prefix(2).map { $0.element }
      if bs.count < 2 { continue }
      if nearOnly > 0 && hitter(ball, boxes: bs, width: W, height: H, near: nearOnly) == nil { continue }
      let left = bs.map { $0[0] }.min()! - pad * w
      let right = bs.map { $0[0] + $0[2] }.max()! + pad * w
      let lo = max(right - w / 2, ball.x - w / 2 + pad * w)
      let hi = min(left + w / 2, ball.x + w / 2 - pad * w)
      if lo <= hi { out[k] = min(max(x, lo), hi) }
    }
    return out
  }

  /// `cam_bt.glide` (test 49f): where the target ends while the ball was in flight, it goes on the ball's way (x speed
  /// of its last two points, at most 2 frames apart) for up to `frames` frames, inside the main players' court (5–95%
  /// of their box centres' x ± `margin`; the whole width with fewer than 20 boxes).
  public static func glide(_ xs: [Double?], tr: [BallXY?], main: [[[Double]]], frames: Int,
                           margin: Double) -> [Double?] {
    if frames <= 0 { return xs }
    let mx = main.flatMap { $0.map { $0[0] + $0[2] / 2 } }
    let lo = mx.count >= 20 ? percentile(mx, 5) - margin : 0
    let hi = mx.count >= 20 ? percentile(mx, 95) + margin : 1
    var out = xs
    let n = xs.count
    for k in 0..<n {
      guard let xk = xs[k], k + 1 < n, xs[k + 1] == nil else { continue }
      var j = k - 1
      while j >= 0 && k - j <= 2 && tr[j] == nil { j -= 1 }
      guard j >= 0, k - j <= 2, let pj = tr[j], let pk = tr[k] else { continue }
      let vx = (pk.x - pj.x) / Double(k - j)
      var m = k + 1
      while m < n && xs[m] == nil && m - k <= frames {
        out[m] = min(max(xk + vx * Double(m - k), lo), hi)
        m += 1
      }
    }
    return out
  }

  /// `cam_bt.hitter`: the box whose centre is nearest to the ball (distance in long sides), if within `near`.
  public static func hitter(_ ball: BallXY, boxes: [[Double]], width W: Double, height H: Double,
                            near: Double) -> [Double]? {
    let L = max(W, H)
    var best: (d: Double, box: [Double])? = nil
    for b in boxes {
      let cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2
      let d = ((cx - ball.x) * W * (cx - ball.x) * W + (cy - ball.y) * H * (cy - ball.y) * H).squareRoot() / L
      if best == nil || d < best!.d { best = (d, b) }
    }
    guard let b = best, b.d <= near else { return nil }
    return b.box
  }

  /// numpy.percentile (linear).
  static func percentile(_ v: [Double], _ q: Double) -> Double {
    let s = v.sorted()
    let pos = q / 100 * Double(s.count - 1)
    let i = Int(pos.rounded(.down)), f = pos - Double(i)
    return i + 1 < s.count ? s[i] + f * (s[i + 1] - s[i]) : s[i]
  }
}

/// `story.keep_runs`: the trusted points with the runs shorter than `minRun` frames removed (a run ends where the next
/// point is more than `gap` frames away). minRun 0 = unchanged.
public enum BallRuns {
  public static func keep(_ tr: [BallXY?], minRun: Int, gap: Int) -> [BallXY?] {
    if minRun <= 0 { return tr }
    var out = tr
    let idx = tr.indices.filter { tr[$0] != nil }
    var start: Int? = nil
    for (j, k) in idx.enumerated() {
      if start == nil { start = k }
      if j + 1 == idx.count || idx[j + 1] - k > gap {
        if let a = start, k - a + 1 < minRun {
          for i in a...k { out[i] = nil }
        }
        start = nil
      }
    }
    return out
  }

  /// `cam_bt.runs_of`: (first, last) frames of the runs of points (a run ends where the next point is more than `gap`
  /// frames away).
  static func runs(_ tr: [BallXY?], gap: Int) -> [(Int, Int)] {
    var out: [(Int, Int)] = []
    var start: Int? = nil, last = 0
    for (k, p) in tr.enumerated() where p != nil {
      if let s = start, k - last > gap { out.append((s, last)); start = k } else if start == nil { start = k }
      last = k
    }
    if let s = start { out.append((s, last)) }
    return out
  }

  /// `cam_bt.moving_candidates` (test 49f): per frame, the detector's candidates with score >= `minScore`, not inside a
  /// video screen (x0, y0, x1, y1) and not still (no candidate within `still` at the analysed frame before or after:
  /// lamps, logos, balls lying on the sand). Frames not analysed have none.
  public static func movingCandidates(_ grid: [[BallCandidate]?], screens: [[Double]], minScore: Double,
                                      still: Double = 0.01) -> [[BallXY]] {
    let keyed = grid.indices.filter { grid[$0] != nil }
    var out = [[BallXY]](repeating: [], count: grid.count)
    for (i, k) in keyed.enumerated() {
      let nb = [i - 1, i + 1].filter { $0 >= 0 && $0 < keyed.count }.map { grid[keyed[$0]]! }
      for c in grid[k]! where c.score >= minScore {
        if screens.contains(where: { $0.count == 4 && $0[0] <= c.cx && c.cx <= $0[2] && $0[1] <= c.cy && c.cy <= $0[3] }) {
          continue
        }
        if nb.contains(where: { f in f.contains { abs($0.cx - c.cx) <= still && abs($0.cy - c.cy) <= still } }) {
          continue
        }
        out[k].append(BallXY(x: c.cx, y: c.cy))
      }
    }
    return out
  }

  /// `cam_bt.keep_exits` (tests 49e–f): the points after a ball went out at the top are dropped until it is back at
  /// the top (see `BallFollowParams.exitTop`); meanwhile, with `cands`, our ball is looked for among them (back at the
  /// top first, then candidate to candidate within `step` long sides per frame, 2 frames' worth at most; out at the top
  /// again, or `lost` frames without it, = at the top again). `aspect`: height / width of the picture. top <= 0 =
  /// unchanged.
  public static func keepExits(_ tr: [BallXY?], top: Double, back: Double, dx: Double, cands: [[BallXY]]? = nil,
                               step: Double = 0.08, lost: Int = 4, aspect: Double = 1) -> [BallXY?] {
    if top <= 0 { return tr }
    let sx = aspect <= 1 ? 1.0 : 1.0 / aspect, sy = aspect <= 1 ? aspect : 1.0
    func dist(_ a: BallXY, _ b: BallXY) -> Double {
      (((a.x - b.x) * sx) * ((a.x - b.x) * sx) + ((a.y - b.y) * sy) * ((a.y - b.y) * sy)).squareRoot()
    }
    func goingOut(_ q: BallXY, _ kq: Int, _ c: BallXY, _ kc: Int) -> Bool {
      let vy = (c.y - q.y) / Double(kc - kq)
      return vy < -0.01 && c.y + 2 * vy < top
    }
    enum State { case path, gone, own }
    var out = tr
    var state = State.path, gx = 0.0
    var prev: Int? = nil
    var own: (k: Int, p: BallXY)? = nil
    for (k, p) in tr.enumerated() {
      if state != .path {
        let ref = state == .gone ? gx : own!.p.x
        // back: checked below like any path point (it may be going out again)
        if let p = p, p.y <= back && abs(p.x - ref) <= dx { state = .path; own = nil }
      }
      if state == .path {
        if let p = p {
          if let j = prev, k - j <= 2, let q = tr[j], goingOut(q, j, p, k) { state = .gone; gx = p.x }
          prev = k
        }
        continue
      }
      out[k] = nil
      guard let cands = cands, k < cands.count else { continue }
      if state == .own, let o = own, k - o.k > lost { state = .gone; gx = o.p.x; own = nil }
      if state == .gone {
        var best: BallXY? = nil
        for c in cands[k] where c.y <= back && abs(c.x - gx) <= dx {
          if best == nil || abs(c.x - gx) < abs(best!.x - gx) { best = c }
        }
        if let c = best { state = .own; own = (k, c); out[k] = c }
      } else if let o = own {
        var best: BallXY? = nil
        for c in cands[k] where dist(c, o.p) <= step * Double(min(k - o.k, 2)) {
          if best == nil || dist(c, o.p) < dist(best!, o.p) { best = c }
        }
        if let c = best {
          out[k] = c
          if goingOut(o.p, o.k, c, k) { state = .gone; gx = c.x; own = nil } else { own = (k, c) }
        }
      }
    }
    return out
  }

  /// `cam_bt.keep_court` (test 49d): the court by the ball. The longest run (most points; the first of equals) gives the
  /// x range (5–95% of its points ± `margin` frame widths); any other run whose median x is outside goes, then any point
  /// outside. Unchanged with fewer than two runs or margin <= 0.
  public static func courtLock(_ tr: [BallXY?], margin: Double, gap: Int) -> [BallXY?] {
    if margin <= 0 { return tr }
    let rs = runs(tr, gap: gap)
    if rs.count < 2 { return tr }
    func xs(_ r: (Int, Int)) -> [Double] { (r.0...r.1).compactMap { tr[$0]?.x } }
    var main = 0
    for i in rs.indices where xs(rs[i]).count > xs(rs[main]).count { main = i }
    let mx = xs(rs[main])
    let lo = BallPlayers.percentile(mx, 5) - margin, hi = BallPlayers.percentile(mx, 95) + margin
    var out = tr
    for i in rs.indices where i != main {
      let m = BallPlayers.percentile(xs(rs[i]), 50)
      if !(lo <= m && m <= hi) {
        for k in rs[i].0...rs[i].1 { out[k] = nil }
      }
    }
    for k in out.indices {
      if let p = out[k], !(lo <= p.x && p.x <= hi) { out[k] = nil }
    }
    return out
  }
}

/// `ball_track.screen_boxes` (test 47b): video screens at the venue (an LED screen showing a stream). On grey
/// thumbnails of consecutive analysed frames (5 fps, 160 px wide), a pixel is active when it changes by more than 12
/// grey levels from the previous frame; a connected active region (share of steps active > 0.12, at least 0.2% of the
/// thumbnail) is a screen when its bounding box is at least `fill` active, at least half of the box changes at once on
/// at least `sync` of the steps, and the box covers at least `area` of the frame: a screen changes all over at once,
/// the sand never, a player only in part of a region at a time.
public enum BallScreen {
  public static let thumbWidth = 160
  public static let fill = 0.75, sync = 0.12, area = 0.015

  /// `frames`: grey thumbnails (row-major, `width` × `height`, 0–255) in time order. Boxes x0, y0, x1, y1, 0..1.
  public static func boxes(frames: [[UInt8]], width W: Int, height H: Int) -> [[Double]] {
    let T = frames.count - 1
    guard T >= 2, W > 0, H > 0, frames.allSatisfy({ $0.count == W * H }) else { return [] }
    let n = W * H
    // changed[t][i]: pixel i changed between frame t and t + 1
    var changed = [[Bool]](repeating: [Bool](repeating: false, count: n), count: T)
    var act = [Double](repeating: 0, count: n)
    for t in 0..<T {
      let a = frames[t], b = frames[t + 1]
      for i in 0..<n where abs(Int(b[i]) - Int(a[i])) > 12 {
        changed[t][i] = true
        act[i] += 1
      }
    }
    for i in 0..<n { act[i] /= Double(T) }
    // 8-connected components of act > 0.12
    var label = [Int](repeating: -1, count: n)
    var out: [[Double]] = []
    for s in 0..<n where act[s] > 0.12 && label[s] < 0 {
      var stack = [s]
      label[s] = s
      var x0 = W, y0 = H, x1 = -1, y1 = -1, count = 0
      while let p = stack.popLast() {
        count += 1
        let px = p % W, py = p / W
        x0 = min(x0, px); x1 = max(x1, px); y0 = min(y0, py); y1 = max(y1, py)
        for dy in -1...1 {
          for dx in -1...1 where dx != 0 || dy != 0 {
            let qx = px + dx, qy = py + dy
            guard qx >= 0, qx < W, qy >= 0, qy < H else { continue }
            let q = qy * W + qx
            if act[q] > 0.12 && label[q] < 0 { label[q] = s; stack.append(q) }
          }
        }
      }
      if Double(count) < 0.002 * Double(n) { continue }
      let bw = x1 - x0 + 1, bh = y1 - y0 + 1
      var activeInBox = 0
      for y in y0...y1 { for x in x0...x1 where act[y * W + x] > 0.12 { activeInBox += 1 } }
      let boxFill = Double(activeInBox) / Double(bw * bh)
      var syncSteps = 0
      for t in 0..<T {
        var c = 0
        for y in y0...y1 { for x in x0...x1 where changed[t][y * W + x] { c += 1 } }
        if Double(c) / Double(bw * bh) > 0.5 { syncSteps += 1 }
      }
      let boxSync = Double(syncSteps) / Double(T)
      if boxFill >= fill && boxSync >= sync && Double(bw * bh) >= area * Double(n) {
        out.append([Double(x0) / Double(W), Double(y0) / Double(H), Double(x1 + 1) / Double(W),
                    Double(y1 + 1) / Double(H)])
      }
    }
    return out
  }
}

/// Test 47a: the limits of a sport's verdict (`ball_verdict.VERDICT`).
public struct BallVerdictParams: Equatable {
  /// Before the ball analysis: the players' median height in the 9:16 output at the sport's largest zoom.
  public var playersMin: Double
  /// After: share of the frames with a followed ball, the ball's median size in the output (px of 1080), the camera's
  /// movement on screen (crop widths per 10 s).
  public var shareMin: Double
  public var ballPxMin: Double
  public var panMin: Double

  public init(playersMin: Double, shareMin: Double, ballPxMin: Double, panMin: Double) {
    self.playersMin = playersMin; self.shareMin = shareMin; self.ballPxMin = ballPxMin; self.panMin = panMin
  }

  /// Calibrated on 30 beach tennis clips (test 47a).
  public static let beachTennis = BallVerdictParams(playersMin: 0.10, shareMin: 0.25, ballPxMin: 16, panMin: 0.6)
}

/// Why Seguir a Bola is not applied to a clip (the chip says it in a few words).
public enum BallVerdictReason: String, Equatable {
  /// The players are tiny in the output: recorded too far (a 0.5x lens, the far end of a big court).
  case tooFar
  /// The ball is found on too few frames.
  case rarelyFound
  /// The ball is too small in the output.
  case tooSmall
  /// The 9:16 camera would hardly move: nothing to follow.
  case still
}

public struct BallVerdict: Equatable {
  /// The first reason, nil = apply.
  public var reason: BallVerdictReason?
  public var players: Double?
  public var share: Double
  public var ballPx: Double
  public var pan: Double
}

public enum BallVerdicts {
  /// The largest zoom the sport's story rule allows for a video (horizontal fixed, vertical capped by quality).
  public static func maxZoom(width W: Double, height H: Double, zoom P: BallZoomParams) -> Double {
    if W >= H { return P.fixedLandscape ?? 1.0 }
    return max(1.0, min(W, (9.0 / 16.0) * H) * (P.maxUpscalePortrait ?? P.maxUpscale) / 1080.0)
  }

  /// Before the ball analysis: `playersHeight` (median person height, share of the frame height, from today's Modo
  /// Foco analysis) too small = too far. nil height = unknown, not judged.
  public static func before(playersHeight: Double?, width W: Double, height H: Double, sport: BallSport)
    -> BallVerdictReason? {
    guard let v = sport.verdict, let h = playersHeight else { return nil }
    return h * maxZoom(width: W, height: H, zoom: sport.zoom) < v.playersMin ? .tooFar : nil
  }

  /// After: `followed` = the trusted points the camera follows (runs), `path` = the ball path (sizes), `rects` = the
  /// 9:16 camera. `ball_verdict.verdict` (story.scores' pan; the crop width rounded to px as there).
  public static func after(followed: [BallXY?], path: [BallPoint?], rects: [[Double]], width W: Double,
                           height H: Double, players: Double?, params P: BallVerdictParams) -> BallVerdict {
    let n = followed.count
    let share = n == 0 ? 0 : Double(followed.filter { $0 != nil }.count) / Double(n)
    var sizes: [Double] = []
    for k in 0..<min(n, path.count) where followed[k] != nil {
      if let p = path[k] { sizes.append(max(p.width * W, p.height * H)) }
    }
    let meanW = rects.isEmpty ? 1.0 : rects.map { $0[2] }.reduce(0, +) / Double(rects.count)
    let srcW = max(1.0, (meanW * W).rounded(.toNearestOrEven))
    let ballPx = sizes.isEmpty ? 0 : BallZoom.median(sizes) * 1080.0 / srcW
    var pan = 0.0
    if rects.count > 1 {
      for i in 1..<rects.count {
        let a = rects[i - 1][0] + rects[i - 1][2] / 2, b = rects[i][0] + rects[i][2] / 2
        pan += abs(b - a) / rects[i][2]
      }
      pan /= Double(rects.count) / 100.0
    }
    var reason: BallVerdictReason? = nil
    if share < P.shareMin {
      reason = .rarelyFound
    } else if ballPx < P.ballPxMin {
      reason = .tooSmall
    } else if pan < P.panMin {
      reason = .still
    }
    return BallVerdict(reason: reason, players: players, share: share, ballPx: ballPx, pan: pan)
  }
}
