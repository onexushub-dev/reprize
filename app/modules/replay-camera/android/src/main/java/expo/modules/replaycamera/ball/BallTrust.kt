package expo.modules.replaycamera.ball

import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/** Port of `BallTrustParams`. */
class BallTrustParams {
  var areaMax = 0.003
  var boxMaxFrac = 0.06
  var fillMin = 0.45
  var mainMin = 0.7
  var aspectMax = 3.0
  var jumpFrac = 0.09
  var jumpCap = 8
  var stillFrac = 0.012
  var stillWin = 10
}

/**
 * The ball path's points the camera may follow (port of `BallTrust.swift`, the lab's `hybrid.trusted`): a point is
 * dropped when it does not look like a ball, when it jumps away from the last kept point, or when it stays still.
 */
object BallTrust {
  /** `width`, `height`: the size the path's 0..1 numbers refer to (only the ratio matters). */
  fun trusted(path: List<BallPoint?>, width: Double, height: Double, params: BallTrustParams = BallTrustParams()): List<BallXY?> {
    val t = params
    val n = path.size
    val w = width
    val h = height
    val l = max(w, h)
    val raw = arrayOfNulls<BallXY>(n)
    for (i in 0 until n) {
      val p = path[i] ?: continue
      if (!(p.area <= t.areaMax && p.area > 0)) continue
      val wpx = p.width * w
      val hpx = p.height * h
      val fill = p.area * w * h / max(1.0, wpx * hpx)
      if (max(wpx, hpx) > t.boxMaxFrac * l || fill < t.fillMin || p.main < t.mainMin) continue
      if (max(wpx, hpx) / max(1e-6, min(wpx, hpx)) > t.aspectMax) continue
      raw[i] = BallXY(p.cx, p.cy)
    }
    fun dist(a: BallXY, b: BallXY) = hypot((a.x - b.x) * w, (a.y - b.y) * h) / l
    // jumps: against the last kept point, allowing more across gaps (up to jumpCap frames)
    val out = arrayOfNulls<BallXY>(n)
    var last: BallXY? = null
    var lastI = 0
    for (i in 0 until n) {
      var p = raw[i]
      val q = p
      val lp = last
      if (q != null && lp != null && dist(q, lp) > t.jumpFrac * min(i - lastI, t.jumpCap).toDouble()) p = null
      out[i] = p
      if (p != null) { last = p; lastI = i }
    }
    // still: stays within stillFrac over ±stillWin frames
    val res = out.copyOf()
    for (i in 0 until n) {
      val p = out[i] ?: continue
      val win = (max(0, i - t.stillWin) until min(n, i + t.stillWin + 1)).mapNotNull { out[it] }
      if (win.size >= t.stillWin) {
        val spread = win.maxOfOrNull { dist(it, p) } ?: 0.0
        if (spread < t.stillFrac) res[i] = null
      }
    }
    return res.toList()
  }
}
