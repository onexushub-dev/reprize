package expo.modules.replaycamera.ball

/** One detector candidate in an analysed frame: centre and size 0..1 of the upright video, and the detector's score. */
data class BallCandidate(val cx: Double, val cy: Double, val width: Double, val height: Double, val score: Double)

/**
 * The ball on one 100 ms frame of the path: centre and size 0..1, the ellipse's area (0..1 of the frame), the share of
 * it in one piece (1 for a detector box) and the score (interpolated frames keep the earlier frame's score).
 */
data class BallPoint(
  val cx: Double, val cy: Double, val width: Double, val height: Double, val area: Double, val main: Double, val score: Double,
)

data class BallXY(val x: Double, val y: Double)

/** The Swift core's numeric helpers, with its rounding (`BallPath.roundTo`: half to even). */
object BallMath {
  fun roundTo(v: Double, digits: Int): Double {
    val s = Math.pow(10.0, digits.toDouble())
    return Math.rint(v * s) / s
  }

  fun mean(v: List<Double>): Double {
    var s = 0.0
    for (x in v) s += x // in order, as Swift's reduce
    return s / v.size
  }

  /** numpy.median; 1 for none (as `BallZoom.median`). */
  fun median(v: List<Double>): Double {
    if (v.isEmpty()) return 1.0
    val s = v.sorted()
    return if (s.size % 2 == 1) s[s.size / 2] else (s[s.size / 2 - 1] + s[s.size / 2]) / 2
  }
}
