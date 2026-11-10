import Foundation

/// Seguir a Bola from the stored detections to the 9:16 framing file (spec 2026-11-09 §4.5–4.6): the cut's 100 ms grid,
/// which grid frames are analysed (every `step`-th, 5 fps) and which of them the detections cache already has, then
/// path → trusted points → zoom → camera.
public enum BallFraming {
  public static let stepMs = 100.0
  /// Analyse every 2nd 100 ms frame (5 fps; test 42: 2.5 fps loses the ball).
  public static let step = 2
  /// Basketball's (the defaults below); each sport's are in `BallSport`.
  public static let modelId = BallSport.basketball.modelId
  public static let rules = BallSport.basketball.rules

  /// One analysed picture of the clip: its presentation time and its candidates (0..1 of the upright frame).
  public struct Detection: Equatable {
    public var tMs: Double
    public var candidates: [BallCandidate]
    public init(tMs: Double, candidates: [BallCandidate]) { self.tMs = tMs; self.candidates = candidates }
  }

  /// The cut's grid: row k at `startMs + k × 100`, for every tick before `endMs`.
  public static func rows(startMs: Double, endMs: Double) -> Int {
    max(0, Int(((endMs - startMs) / stepMs - 1e-9).rounded(.up)))
  }

  /// The detection that stands for tick `tick`: the first picture at or after it within its 100 ms (as `FocusGrid`).
  static func detection(at tick: Double, in sorted: [Detection]) -> Detection? {
    // binary search for the first tMs ≥ tick − 0.5
    var lo = 0, hi = sorted.count
    while lo < hi {
      let mid = (lo + hi) / 2
      if sorted[mid].tMs < tick - 0.5 { lo = mid + 1 } else { hi = mid }
    }
    return lo < sorted.count && sorted[lo].tMs < tick + stepMs - 0.5 ? sorted[lo] : nil
  }

  /// Which grid frames to analyse (k ≡ phase mod step): the phase whose ticks the cache covers most, so a changed cut
  /// reuses what was found; 0 when nothing is cached.
  public static func phase(startMs: Double, endMs: Double, cached: [Detection]) -> Int {
    let n = rows(startMs: startMs, endMs: endMs)
    let sorted = cached.sorted { $0.tMs < $1.tMs }
    var best = 0, bestHits = -1
    for p in 0..<step {
      let hits = stride(from: p, to: n, by: step).filter { detection(at: startMs + Double($0) * stepMs, in: sorted) != nil }
        .count
      if hits > bestHits { best = p; bestHits = hits }
    }
    return best
  }

  /// The ticks (ms) of the analysed grid frames that the cache does not have yet.
  public static func missingTicks(startMs: Double, endMs: Double, phase: Int, cached: [Detection]) -> [Double] {
    let sorted = cached.sorted { $0.tMs < $1.tMs }
    return stride(from: phase, to: rows(startMs: startMs, endMs: endMs), by: step)
      .map { startMs + Double($0) * stepMs }
      .filter { detection(at: $0, in: sorted) == nil }
  }

  /// The grid the path reads: candidates on the analysed frames that have a picture, nil elsewhere.
  public static func grid(startMs: Double, endMs: Double, phase: Int, detections: [Detection]) -> [[BallCandidate]?] {
    let n = rows(startMs: startMs, endMs: endMs)
    let sorted = detections.sorted { $0.tMs < $1.tMs }
    var out = [[BallCandidate]?](repeating: nil, count: n)
    for k in stride(from: phase, to: n, by: step) {
      out[k] = detection(at: startMs + Double(k) * stepMs, in: sorted)?.candidates
    }
    return out
  }

  public struct Result: Equatable {
    /// 9:16 rects per 100 ms frame of the cut, x, y, width, height, 0..1 of the upright video.
    public var rects: [[Double]]
    public var zoom: BallZoomResult
    /// Frames with the ball on the path / trusted.
    public var ballFrames: Int
    public var trustedFrames: Int
    /// Whether the mode is worth applying (sports with a verdict; nil = always).
    public var verdict: BallVerdict? = nil
  }

  /// Path → trusted → zoom → camera C. `today`: Modo Foco's portrait rows for the same cut (row k at the same tick;
  /// missing rows repeat the last, none at all = a centred crop); `native`: its rows in the video's orientation (the zoom
  /// reads today's zoom from them). `width`, `height`: the upright video. `sport`: the profile (basketball as before);
  /// `screens`: video screens found in the clip (`BallScreen`, sports with `screens`); `players`: the players' median
  /// height from today's analysis, for the verdict; `people`: today's person boxes per row of the cut (sports with
  /// `follow`: the court lock and the aim toward the hitter; none = the ball alone).
  public static func compute(grid: [[BallCandidate]?], width W: Double, height H: Double, today: [[Double]],
                             native: [[Double]], sport: BallSport = .basketball, screens: [[Double]] = [],
                             players: Double? = nil, people: [[[Double]]] = []) -> Result {
    let n = grid.count
    let path = BallPath.track(frames: grid, width: W, height: H, step: step, params: sport.path,
                              screens: sport.screens ? screens : [])
    let trusted = BallTrust.trusted(path, width: W, height: H)
    var followed = BallRuns.keep(trusted, minRun: sport.minRun, gap: sport.runGap)
    var main: [[[Double]]] = []
    if let f = sport.follow {
      followed = BallRuns.courtLock(followed, margin: f.ballCourtMargin, gap: sport.runGap)
      if people.contains(where: { !$0.isEmpty }) {
        main = BallPlayers.main((0..<n).map { $0 < people.count ? people[$0] : [] }, share: f.mainShare)
        followed = BallPlayers.courtLock(followed, main: main, margin: f.courtMargin)
      }
      let cands = f.ownMinScore > 0
        ? BallRuns.movingCandidates(grid, screens: sport.screens ? screens : [], minScore: f.ownMinScore) : nil
      followed = BallRuns.keepExits(followed, top: f.exitTop, back: f.exitBack, dx: f.exitDx, cands: cands,
                                    step: f.ownStep, lost: f.ownLost, aspect: H / W)
    }
    let todayRows = aligned(today, count: n, width: W, height: H)
    let nativeRows = native.isEmpty ? [[0, 0, 1, 1]] : native
    let zoom = BallZoom.zoom(ball: trusted, today: todayRows, native: nativeRows, width: W, height: H,
                             params: sport.zoom, cameraBall: sport.minRun > 0 ? followed : nil)
    var aim: [Double?]? = nil
    if let f = sport.follow {
      var a = BallPlayers.aim(followed, main: main, width: W, height: H, blend: f.blend, near: f.near)
      if f.keepPair {
        a = BallPlayers.keepPair(a, tr: followed, main: main, cropWidth: min(1.0, (9.0 / 16.0) * H / W) / zoom.zoom,
                                 pad: f.pairPad, nearOnly: f.pairNear, width: W, height: H)
      }
      aim = BallPlayers.glide(a, tr: followed, main: main, frames: f.glide, margin: f.courtMargin)
    }
    let rects = n == 0 ? [] : BallCamera.rects(ball: followed, today: todayRows, width: W, height: H, zoom: zoom.zoom,
                                               params: sport.camera, aim: aim)
    var r = Result(rects: rects, zoom: zoom, ballFrames: path.filter { $0 != nil }.count,
                   trustedFrames: trusted.filter { $0 != nil }.count)
    if let v = sport.verdict {
      if let early = BallVerdicts.before(playersHeight: players, width: W, height: H, sport: sport) {
        r.verdict = BallVerdict(reason: early, players: players, share: 0, ballPx: 0, pan: 0)
      } else {
        r.verdict = BallVerdicts.after(followed: followed, path: path, rects: rects, width: W, height: H,
                                       players: players, params: v)
      }
    }
    return r
  }

  static func aligned(_ rows: [[Double]], count n: Int, width W: Double, height H: Double) -> [[Double]] {
    let good = rows.filter { $0.count == 4 }
    if good.isEmpty {
      let w = min(1.0, (9.0 / 16.0) * H / W), h = min(1.0, (16.0 / 9.0) * W / H)
      return [[Double]](repeating: [(1 - w) / 2, (1 - h) / 2, w, h], count: n)
    }
    return (0..<n).map { good[min($0, good.count - 1)] }
  }

  // MARK: - files

  /// `<clip>.balldet.json`: every analysed picture's candidates, valid while the model is the same; `screens`: the
  /// video screens found (kept, as the thumbnails they come from are not).
  public static func detectionsJSON(_ dets: [Detection], width: Int, height: Int, model: String = BallFraming.modelId,
                                    screens: [[Double]] = []) -> [String: Any] {
    var f: [String: Any] = [
      "v": 1, "model": model, "size": [width, height],
      "frames": dets.sorted { $0.tMs < $1.tMs }.map { d -> [String: Any] in
        ["t": BallPath.roundTo(d.tMs, 3),
         "c": d.candidates.map { [$0.cx, $0.cy, $0.width, $0.height, $0.score] }]
      },
    ]
    if !screens.isEmpty { f["screens"] = screens }
    return f
  }

  /// The video screens kept in `<clip>.balldet.json` (none when absent).
  public static func screens(fromJSON obj: Any?) -> [[Double]] {
    guard let f = obj as? [String: Any], let s = f["screens"] as? [[NSNumber]] else { return [] }
    return s.filter { $0.count == 4 }.map { $0.map { $0.doubleValue } }
  }

  /// Reads `<clip>.balldet.json`; anything unreadable, another model or another frame size gives an empty cache.
  public static func detections(fromJSON obj: Any?, width: Int, height: Int,
                                model: String = BallFraming.modelId) -> [Detection] {
    guard let f = obj as? [String: Any], (f["v"] as? NSNumber)?.intValue == 1, f["model"] as? String == model,
          let size = f["size"] as? [NSNumber], size.count == 2, size[0].intValue == width, size[1].intValue == height,
          let frames = f["frames"] as? [[String: Any]] else { return [] }
    return frames.compactMap { fr -> Detection? in
      guard let t = (fr["t"] as? NSNumber)?.doubleValue, let c = fr["c"] as? [[NSNumber]] else { return nil }
      return Detection(tMs: t, candidates: c.compactMap { v in
        v.count == 5 ? BallCandidate(cx: v[0].doubleValue, cy: v[1].doubleValue, width: v[2].doubleValue,
                                     height: v[3].doubleValue, score: v[4].doubleValue) : nil
      })
    }
  }

  /// `<clip>.ball.json`: the Modo Foco file's format (v1, 100 ms rows) with the 9:16 track under "portrait".
  public static func framingJSON(_ r: Result, startMs: Double, width: Double, height: Double,
                                 rules: String = BallFraming.rules) -> [String: Any] {
    let r4 = { (v: Double) in (v * 10000).rounded() / 10000 }
    var f: [String: Any] = [
      "v": 1, "rules": rules, "stepMs": stepMs, "startMs": startMs, "size": [width, height],
      "portrait": r.rects.map { $0.map(r4) }, "landscape": [[Double]](),
      "zoom": r.zoom.zoom, "ballShare": BallPath.roundTo(r.zoom.share, 3),
    ]
    if let v = r.verdict {
      f["verdict"] = [
        "apply": v.reason == nil, "reason": v.reason?.rawValue ?? "", "share": BallPath.roundTo(v.share, 3),
        "ballPx": BallPath.roundTo(v.ballPx, 1), "pan": BallPath.roundTo(v.pan, 2),
      ] as [String: Any]
    }
    return f
  }
}
