import Foundation

/// Seguir a Bola from the stored detections to the 9:16 framing file (spec 2026-11-09 §4.5–4.6): the cut's 100 ms grid,
/// which grid frames are analysed (every `step`-th, 5 fps) and which of them the detections cache already has, then
/// path → trusted points → zoom → camera.
public enum BallFraming {
  public static let stepMs = 100.0
  /// Analyse every 2nd 100 ms frame (5 fps; test 42: 2.5 fps loses the ball).
  public static let step = 2
  public static let modelId = "ball_tiny_gym"
  public static let rules = "ball-t42"

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
  }

  /// Path → trusted → zoom → camera C. `today`: Modo Foco's portrait rows for the same cut (row k at the same tick;
  /// missing rows repeat the last, none at all = a centred crop); `native`: its rows in the video's orientation (the zoom
  /// reads today's zoom from them). `width`, `height`: the upright video.
  public static func compute(grid: [[BallCandidate]?], width W: Double, height H: Double, today: [[Double]],
                             native: [[Double]]) -> Result {
    let n = grid.count
    let path = BallPath.track(frames: grid, width: W, height: H, step: step)
    let trusted = BallTrust.trusted(path, width: W, height: H)
    let todayRows = aligned(today, count: n, width: W, height: H)
    let nativeRows = native.isEmpty ? [[0, 0, 1, 1]] : native
    let zoom = BallZoom.zoom(ball: trusted, today: todayRows, native: nativeRows, width: W, height: H)
    let rects = n == 0 ? [] : BallCamera.rects(ball: trusted, today: todayRows, width: W, height: H, zoom: zoom.zoom)
    return Result(rects: rects, zoom: zoom, ballFrames: path.filter { $0 != nil }.count,
                  trustedFrames: trusted.filter { $0 != nil }.count)
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

  /// `<clip>.balldet.json`: every analysed picture's candidates, valid while the model is the same.
  public static func detectionsJSON(_ dets: [Detection], width: Int, height: Int) -> [String: Any] {
    [
      "v": 1, "model": modelId, "size": [width, height],
      "frames": dets.sorted { $0.tMs < $1.tMs }.map { d -> [String: Any] in
        ["t": BallPath.roundTo(d.tMs, 3),
         "c": d.candidates.map { [$0.cx, $0.cy, $0.width, $0.height, $0.score] }]
      },
    ]
  }

  /// Reads `<clip>.balldet.json`; anything unreadable, another model or another frame size gives an empty cache.
  public static func detections(fromJSON obj: Any?, width: Int, height: Int) -> [Detection] {
    guard let f = obj as? [String: Any], (f["v"] as? NSNumber)?.intValue == 1, f["model"] as? String == modelId,
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
  public static func framingJSON(_ r: Result, startMs: Double, width: Double, height: Double) -> [String: Any] {
    let r4 = { (v: Double) in (v * 10000).rounded() / 10000 }
    return [
      "v": 1, "rules": rules, "stepMs": stepMs, "startMs": startMs, "size": [width, height],
      "portrait": r.rects.map { $0.map(r4) }, "landscape": [[Double]](),
      "zoom": r.zoom.zoom, "ballShare": BallPath.roundTo(r.zoom.share, 3),
    ]
  }
}
