package expo.modules.replaycamera.ball

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Seguir a Bola per sport (port of `BallSport.swift`): each sport has its own detector, path numbers, camera rule, zoom
 * rule and verdict. The profiles are shared values: never change one in place, `copy` it.
 */
data class BallSport(
  val id: String,
  val modelId: String,
  val rules: String,
  val path: BallPathParams,
  val minRun: Int,
  val runGap: Int,
  val zoom: BallZoomParams,
  val screens: Boolean,
  val verdict: BallVerdictParams?,
  val camera: BallCameraParams = BallCameraParams(),
  val follow: BallFollowParams? = null,
) {
  companion object {
    val basketball = BallSport("basquete", "ball_tiny_gym", "ball-t50", BallPathParams.basketball, 0, 4, BallZoomParams(),
      false, null, BallCameraParams.basketball)

    val beachTennis = BallSport("beachTennis", "ball_tiny_btpl", "ball-bt-t60", BallPathParams.beachTennis, 10, 4,
      BallZoomParams.beachTennis, true, BallVerdictParams.beachTennis, BallCameraParams.beachTennis, BallFollowParams.beachTennis)

    /** The profile for a sport id; null = no Seguir a Bola for it yet. */
    fun of(id: String): BallSport? = when (id) {
      basketball.id -> basketball
      beachTennis.id -> beachTennis
      else -> null
    }
  }
}

/** Test 49 (`cam_bt.py`): the players in the ball camera (see the Swift for each field). */
data class BallFollowParams(
  val mainShare: Double,
  val courtMargin: Double,
  val blend: Double,
  val near: Double,
  val ballCourtMargin: Double = 0.0,
  val keepPair: Boolean = false,
  val pairPad: Double = 0.0,
  val exitTop: Double = 0.0,
  val exitBack: Double = 0.2,
  val exitDx: Double = 0.25,
  val ownMinScore: Double = 0.0,
  val ownStep: Double = 0.08,
  val ownLost: Int = 4,
  val pairNear: Double = 0.0,
  val glide: Int = 0,
  val hitBox: Int = 0,
  val hitHorizon: Int = 10,
  val hitPad: Double = 0.02,
  val nearGap: Int = 0,
  val playSpeed: Double = 0.0,
  val playOnPerson: Double = 0.6,
) {
  companion object {
    val beachTennis = BallFollowParams(mainShare = 0.6, courtMargin = 0.2, blend = 0.4, near = 0.25, ballCourtMargin = 0.25,
      keepPair = true, pairPad = 0.0, exitTop = 0.05, exitBack = 0.2, exitDx = 0.25, ownMinScore = 0.5, ownStep = 0.08,
      ownLost = 4, pairNear = 0.25, glide = 6, hitBox = 2, hitHorizon = 10, hitPad = 0.02, nearGap = 10,
      playSpeed = 0.007, playOnPerson = 0.6)
  }
}

/** Test 47a: the limits of a sport's verdict (`ball_verdict.VERDICT`). */
data class BallVerdictParams(
  val playersMin: Double,
  val shareMin: Double,
  val ballPxMin: Double,
  val panMin: Double,
  val playMin: Double = 0.0,
) {
  companion object {
    val beachTennis = BallVerdictParams(playersMin = 0.10, shareMin = 0.25, ballPxMin = 16.0, panMin = 0.6, playMin = 2.0)
  }
}

/** Why Seguir a Bola is not applied to a clip; `raw` is what the files and JS read. */
enum class BallVerdictReason(val raw: String) { TOO_FAR("tooFar"), RARELY_FOUND("rarelyFound"), TOO_SMALL("tooSmall"), STILL("still") }

data class BallVerdict(val reason: BallVerdictReason?, val players: Double?, val share: Double, val ballPx: Double, val pan: Double)

object BallVerdicts {
  /** The largest zoom the sport's story rule allows for a video (horizontal fixed, vertical capped by quality). */
  fun maxZoom(width: Double, height: Double, zoom: BallZoomParams): Double {
    if (width >= height) return zoom.fixedLandscape ?: 1.0
    return max(1.0, min(width, (9.0 / 16.0) * height) * (zoom.maxUpscalePortrait ?: zoom.maxUpscale) / 1080.0)
  }

  /** Before the ball analysis: the players too small in the output = too far; null height = not judged. */
  fun before(playersHeight: Double?, width: Double, height: Double, sport: BallSport): BallVerdictReason? {
    val v = sport.verdict ?: return null
    val h = playersHeight ?: return null
    return if (h * maxZoom(width, height, sport.zoom) < v.playersMin) BallVerdictReason.TOO_FAR else null
  }

  /** After: `followed` = the points the camera follows, `path` = the ball path (sizes), `rects` = the 9:16 camera. */
  fun after(followed: List<BallXY?>, path: List<BallPoint?>, rects: List<List<Double>>, width: Double, height: Double,
            players: Double?, params: BallVerdictParams): BallVerdict {
    val p = params
    val n = followed.size
    val share = if (n == 0) 0.0 else followed.count { it != null }.toDouble() / n
    val sizes = ArrayList<Double>()
    for (k in 0 until min(n, path.size)) {
      if (followed[k] == null) continue
      path[k]?.let { sizes.add(max(it.width * width, it.height * height)) }
    }
    var sumW = 0.0
    for (r in rects) sumW += r[2]
    val meanW = if (rects.isEmpty()) 1.0 else sumW / rects.size
    val srcW = max(1.0, Math.rint(meanW * width))
    val ballPx = if (sizes.isEmpty()) 0.0 else BallMath.median(sizes) * 1080.0 / srcW
    var pan = 0.0
    if (rects.size > 1) {
      for (i in 1 until rects.size) {
        val a = rects[i - 1][0] + rects[i - 1][2] / 2
        val b = rects[i][0] + rects[i][2] / 2
        pan += abs(b - a) / rects[i][2]
      }
      pan /= rects.size.toDouble() / 100.0
    }
    val reason = when {
      p.playMin > 0 -> if (followed.count { it != null }.toDouble() / 10.0 < p.playMin) BallVerdictReason.RARELY_FOUND else null
      share < p.shareMin -> BallVerdictReason.RARELY_FOUND
      ballPx < p.ballPxMin -> BallVerdictReason.TOO_SMALL
      pan < p.panMin -> BallVerdictReason.STILL
      else -> null
    }
    return BallVerdict(reason, players, share, ballPx, pan)
  }
}
