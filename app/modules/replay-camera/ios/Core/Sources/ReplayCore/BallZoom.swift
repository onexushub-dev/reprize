import Foundation

/// The clip's zoom for Seguir a Bola: the lab's `story.auto_zoom` (test 31 rule, spec 2026-11-09 §4.5). The smallest of
/// - quality: the 9:16 crop is not upscaled more than `maxUpscale`× to 1080 wide,
/// - content: today's Modo Foco zoom (× `factorPortrait` on portrait videos),
/// - ball: the largest zoom (in 0.05 steps from 1) that leaves at most `miss` of the trusted points outside the crop,
/// and with few trusted points (under `minShare` of the frames), no closer than a safe zoom.
public struct BallZoomParams: Equatable {
  public var maxUpscale = 2.2
  public var factorLandscape = 1.0
  public var factorPortrait = 1.2
  public var miss = 0.03
  public var minShare = 0.35
  /// Test 46d (beach tennis): a fixed zoom for horizontal videos instead of the rule; nil = the rule.
  public var fixedLandscape: Double? = nil
  /// Test 46d: the quality limit for vertical videos when it differs from `maxUpscale`; nil = `maxUpscale`.
  public var maxUpscalePortrait: Double? = nil
  public init() {}

  /// Beach tennis (test 46d, Victor): horizontal 1.0x (the 9:16 crop already moves without losing resolution);
  /// vertical test 31's rule (today's zoom × 1.2) up to ×1.5 upscale (quality over movement).
  public static var beachTennis: BallZoomParams {
    var p = BallZoomParams()
    p.fixedLandscape = 1.0
    p.maxUpscalePortrait = 1.5
    return p
  }
}

public struct BallZoomResult: Equatable {
  public var zoom: Double
  public var content: Double
  public var quality: Double
  public var ball: Double
  public var share: Double
}

public enum BallZoom {
  /// `today`: today's 9:16 rects per frame (for the camera); `native`: today's rects in the video's own orientation
  /// (their median size gives today's zoom); `width`, `height`: the upright video in pixels.
  /// `cameraBall`: the points the camera follows when they differ from `ball` (a sport's run filter, test 46b); the
  /// share and the points kept in the crop are still `ball`'s (`story.ball_share` / `story.self_miss`).
  public static func zoom(ball: [BallXY?], today: [[Double]], native: [[Double]], width W: Double, height H: Double,
                          params P: BallZoomParams = BallZoomParams(),
                          camera: BallCameraParams = BallCameraParams(),
                          cameraBall: [BallXY?]? = nil) -> BallZoomResult {
    let landscape = W >= H
    let maxUp = landscape ? P.maxUpscale : (P.maxUpscalePortrait ?? P.maxUpscale)
    let quality = max(1.0, min(W, (9.0 / 16.0) * H) * maxUp / 1080.0)
    let todayZ = median(native.map { 1 / max($0[2], $0[3]) })
    let content = max(1.0, todayZ * (landscape ? P.factorLandscape : P.factorPortrait))
    var top = min(quality, content)
    let count = ball.filter { $0 != nil }.count
    let share = ball.isEmpty ? 0 : Double(count) / Double(ball.count)
    if landscape, let fixed = P.fixedLandscape {
      return BallZoomResult(zoom: fixed, content: content, quality: quality, ball: fixed, share: share)
    }
    if share < P.minShare {
      top = min(top, landscape ? 1.0 : max(1.0, todayZ))
    }
    let pts = ball.enumerated().compactMap { e in e.element.map { (e.offset, $0) } }
    var zBall = 1.0
    // numpy.arange(1.0, top + 1e-6, 0.05)
    let steps = max(0, Int(((top + 1e-6 - 1.0) / 0.05).rounded(.up)))
    for s in 0..<steps {
      let z = 1.0 + Double(s) * 0.05
      let r = BallCamera.rects(ball: cameraBall ?? ball, today: today, width: W, height: H, zoom: z, params: camera)
      let out = pts.filter { i, p in
        !(r[i][0] <= p.x && p.x <= r[i][0] + r[i][2] && r[i][1] <= p.y && p.y <= r[i][1] + r[i][3])
      }.count
      if (pts.isEmpty ? 0 : Double(out) / Double(pts.count)) <= P.miss { zBall = z } else { break }
    }
    let z = zBall < top ? min(top, zBall) : top
    return BallZoomResult(zoom: (z * 100).rounded(.toNearestOrEven) / 100, content: content, quality: quality,
                          ball: zBall, share: share)
  }

  /// numpy.median
  static func median(_ v: [Double]) -> Double {
    if v.isEmpty { return 1 }
    let s = v.sorted()
    return s.count % 2 == 1 ? s[s.count / 2] : (s[s.count / 2 - 1] + s[s.count / 2]) / 2
  }
}
