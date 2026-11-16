package expo.modules.replaycamera.ball

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Port of `BallCameraParams` (the lab's story camera C). */
class BallCameraParams {
  var deadZone = 0.10
  var smoothA = 3.0
  var smoothB = 300.0
  var weightNoBall = 0.2
  var anchorY = 0.05
  var top = 0.15
  var bottom = 0.10
  var bridge = 10

  companion object {
    /** Basketball (test 50). */
    val basketball: BallCameraParams get() = BallCameraParams().apply { smoothA = 1.0; smoothB = 100.0 }

    /** Beach tennis (tests 49b, 52). */
    val beachTennis: BallCameraParams get() = BallCameraParams().apply { smoothA = 0.3; smoothB = 30.0 }
  }
}

/**
 * The 9:16 camera that follows the ball (port of `BallCamera.swift`). Rects are x, y, width, height, 0..1 of the upright
 * video, one per 100 ms frame.
 */
object BallCamera {
  /** `ball`: trusted points; `today`: today's 9:16 Modo Foco rects; `aim`: the target x per frame instead of the ball's. */
  fun rects(ball: List<BallXY?>, today: List<List<Double>>, width: Double, height: Double, zoom: Double,
            params: BallCameraParams = BallCameraParams(), aim: List<Double?>? = null): List<List<Double>> {
    val p = params
    val n = ball.size
    val wmax = min(1.0, (9.0 / 16.0) * height / width)
    val hmax = min(1.0, (16.0 / 9.0) * width / height)
    val w = wmax / zoom
    val h = hmax / zoom
    val cx0 = (0 until n).map { today[it][0] + today[it][2] / 2 }
    val cy0 = (0 until n).map { today[it][1] + today[it][3] / 2 }
    val cx: List<Double> = if (w < 0.999) {
      val tx = targetX(aim ?: ball.map { it?.x }, cx0, p.bridge)
      val wt = ball.map { if (it == null) p.weightNoBall else 1.0 }
      bandPath(tx.map { it - p.deadZone * w }, tx.map { it + p.deadZone * w }, wt, cx0, 0.0, p.smoothA, p.smoothB)
    } else List(n) { 0.5 }
    val cy: List<Double> = if (h < 0.999) {
      val by = bridged(ball.map { it?.y }, p.bridge)
      val lo = by.map { v -> v?.let { it - (0.5 - p.bottom) * h } ?: Double.NEGATIVE_INFINITY }
      val hi = by.map { v -> v?.let { it + (0.5 - p.top) * h } ?: Double.POSITIVE_INFINITY }
      bandPath(lo, hi, List(n) { 1.0 }, cy0, p.anchorY, p.smoothA, p.smoothB)
    } else List(n) { 0.5 }
    return (0 until n).map { i ->
      val x = min(max(cx[i], w / 2), 1 - w / 2) - w / 2
      val y = min(max(cy[i], h / 2), 1 - h / 2) - h / 2
      listOf(x, y, w, h)
    }
  }

  /** `sg_framing.target_x` "hold". */
  internal fun targetX(balls: List<Double?>, fallback: List<Double>, bridge: Int): List<Double> {
    val x = fallback.toMutableList()
    val idx = balls.indices.filter { balls[it] != null }
    for (i in idx) x[i] = balls[i]!!
    for (t in 0 until idx.size - 1) {
      val a = idx[t]
      val b = idx[t + 1]
      val va = balls[a]!!
      val vb = balls[b]!!
      if (b - a > 1 && b - a <= bridge) {
        for (k in a + 1 until b) x[k] = linspace(va, vb, b - a + 1, k - a)
      } else if (b - a > bridge) {
        for (k in a + 1 until b) x[k] = va
      }
    }
    val l = idx.lastOrNull()
    if (l != null && l + 1 < x.size) for (k in l + 1 until x.size) x[k] = balls[l]!!
    return x
  }

  /** `sg_lazy3.bridged`: gaps up to `gap` frames filled by a straight line, null elsewhere. */
  internal fun bridged(vals: List<Double?>, gap: Int): List<Double?> {
    val out = vals.toMutableList()
    val idx = vals.indices.filter { vals[it] != null }
    for (t in 0 until idx.size - 1) {
      val p = idx[t]
      val q = idx[t + 1]
      if (q - p > 1 && q - p <= gap) for (k in p + 1 until q) out[k] = linspace(vals[p]!!, vals[q]!!, q - p + 1, k - p)
    }
    return out
  }

  /** numpy.linspace(a, b, count)[i] */
  internal fun linspace(a: Double, b: Double, count: Int, i: Int): Double {
    val div = (count - 1).toDouble()
    if (i == count - 1) return b
    return a + i.toDouble() * ((b - a) / div)
  }

  /** `sg_lazy3.band_path` (see the Swift). */
  internal fun bandPath(lo: List<Double>, hi: List<Double>, weight: List<Double>, anchor: List<Double>, anchorWeight: Double,
                        a: Double, b: Double, iters: Int = 40): List<Double> {
    val wa = anchorWeight
    val n = lo.size
    if (n == 0) return emptyList()
    val d0 = DoubleArray(n) { wa + 1e-6 }
    val d1 = DoubleArray(max(0, n - 1))
    val d2 = DoubleArray(max(0, n - 2))
    for (i in 0 until n - 1) {
      d0[i] += a; d0[i + 1] += a; d1[i] -= a
    }
    if (n >= 3) {
      for (i in 0 until n - 2) {
        d0[i] += b; d0[i + 1] += 4 * b; d0[i + 2] += b
        d1[i] -= 2 * b; d1[i + 1] -= 2 * b
        d2[i] += b
      }
    }
    val ra = wa + 1e-6
    val d1l = d1.toList()
    val d2l = d2.toList()
    var c = (0 until n).map { if (lo[it].isFinite()) (lo[it] + hi[it]) / 2 else anchor[it] }
    for (iter in 0 until iters) {
      val diag = d0.copyOf()
      val rhs = DoubleArray(n)
      for (i in 0 until n) {
        val out = c[i] < lo[i] || c[i] > hi[i]
        val y = min(max(c[i], lo[i]), hi[i])
        val wd = if (out) weight[i] else 0.0
        diag[i] += wd
        rhs[i] = wd * (if (y.isFinite()) y else 0.0) + ra * anchor[i]
      }
      val next = solvePenta(diag.toList(), d1l, d2l, rhs.toList())
      var delta = 0.0
      for (i in 0 until n) delta = max(delta, abs(next[i] - c[i]))
      c = next
      if (delta < 1e-5) break
    }
    return c
  }

  /** Symmetric pentadiagonal solve (Gaussian elimination without pivoting; the matrix is positive definite). */
  internal fun solvePenta(diag: List<Double>, off1: List<Double>, off2: List<Double>, rhs: List<Double>): List<Double> {
    val n = diag.size
    val m = Array(n) { DoubleArray(5) }
    val r = rhs.toDoubleArray()
    for (i in 0 until n) {
      if (i >= 2) m[i][0] = off2[i - 2]
      if (i >= 1) m[i][1] = off1[i - 1]
      m[i][2] = diag[i]
      if (i + 1 < n) m[i][3] = off1[i]
      if (i + 2 < n) m[i][4] = off2[i]
    }
    for (k in 0 until n) {
      if (k + 1 >= n) break
      val piv = m[k][2]
      for (i in (k + 1)..min(n - 1, k + 2)) {
        val s = i - k
        val f = m[i][2 - s] / piv
        if (f == 0.0) continue
        for (j in 0..2) if (k + j < n) m[i][2 - s + j] -= f * m[k][2 + j]
        r[i] -= f * r[k]
      }
    }
    val x = DoubleArray(n)
    for (i in n - 1 downTo 0) {
      var s = r[i]
      if (i + 1 < n) s -= m[i][3] * x[i + 1]
      if (i + 2 < n) s -= m[i][4] * x[i + 2]
      x[i] = s / m[i][2]
    }
    return x.toList()
  }
}
