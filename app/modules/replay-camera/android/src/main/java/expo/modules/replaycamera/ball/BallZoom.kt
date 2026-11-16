package expo.modules.replaycamera.ball

import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/** Port of `BallZoomParams`. */
class BallZoomParams {
  var maxUpscale = 2.2
  var factorLandscape = 1.0
  var factorPortrait = 1.2
  var miss = 0.03
  var minShare = 0.35
  var fixedLandscape: Double? = null
  var maxUpscalePortrait: Double? = null

  companion object {
    /** Beach tennis (test 46d). */
    val beachTennis: BallZoomParams get() = BallZoomParams().apply { fixedLandscape = 1.0; maxUpscalePortrait = 1.5 }
  }
}

data class BallZoomResult(val zoom: Double, val content: Double, val quality: Double, val ball: Double, val share: Double)

/** The clip's zoom for Seguir a Bola (port of `BallZoom.swift`, the lab's `story.auto_zoom`). */
object BallZoom {
  fun zoom(ball: List<BallXY?>, today: List<List<Double>>, native: List<List<Double>>, width: Double, height: Double,
           params: BallZoomParams = BallZoomParams(), camera: BallCameraParams = BallCameraParams(),
           cameraBall: List<BallXY?>? = null): BallZoomResult {
    val p = params
    val landscape = width >= height
    val maxUp = if (landscape) p.maxUpscale else (p.maxUpscalePortrait ?: p.maxUpscale)
    val quality = max(1.0, min(width, (9.0 / 16.0) * height) * maxUp / 1080.0)
    val todayZ = median(native.map { 1 / max(it[2], it[3]) })
    val content = max(1.0, todayZ * (if (landscape) p.factorLandscape else p.factorPortrait))
    var top = min(quality, content)
    val count = ball.count { it != null }
    val share = if (ball.isEmpty()) 0.0 else count.toDouble() / ball.size
    val fixed = p.fixedLandscape
    if (landscape && fixed != null) return BallZoomResult(fixed, content, quality, fixed, share)
    if (share < p.minShare) top = min(top, if (landscape) 1.0 else max(1.0, todayZ))
    val pts = ball.withIndex().mapNotNull { e -> e.value?.let { Pair(e.index, it) } }
    var zBall = 1.0
    // numpy.arange(1.0, top + 1e-6, 0.05)
    val steps = max(0, ceil((top + 1e-6 - 1.0) / 0.05).toInt())
    for (s in 0 until steps) {
      val z = 1.0 + s.toDouble() * 0.05
      val r = BallCamera.rects(cameraBall ?: ball, today, width, height, z, camera)
      val out = pts.count { (i, q) -> !(r[i][0] <= q.x && q.x <= r[i][0] + r[i][2] && r[i][1] <= q.y && q.y <= r[i][1] + r[i][3]) }
      if ((if (pts.isEmpty()) 0.0 else out.toDouble() / pts.size) <= p.miss) zBall = z else break
    }
    val z = if (zBall < top) min(top, zBall) else top
    return BallZoomResult(Math.rint(z * 100) / 100, content, quality, zBall, share)
  }

  /** numpy.median; 1 for none. */
  fun median(v: List<Double>): Double = BallMath.median(v)
}
