package expo.modules.replaycamera.core

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** How much a framing moves (port of `FramingMotion.swift`), for the Diagnóstico line: (panP95, turnsPer10s). */
object FramingMotion {
  fun stats(rects: List<List<Double>>, stepMs: Double): Pair<Double, Double> {
    val rows = rects.filter { it.size == 4 }
    if (!(rows.size > 1 && stepMs > 0)) return Pair(0.0, 0.0)
    val speeds = DoubleArray(rows.size - 1)
    var flips = 0
    for (axis in 0 until 2) {
      val smallest = rows.minOf { it[2 + axis] }
      if (!(smallest < 0.999)) continue
      val c = rows.map { it[axis] + it[2 + axis] / 2 }
      for (i in speeds.indices) speeds[i] = max(speeds[i], abs(c[i + 1] - c[i]) / (stepMs / 1000))
      var last = 0.0
      var ref = c[0]
      for (p in c.drop(1)) {
        val d = p - ref
        if (abs(d) >= 0.02) {
          val s = if (d > 0) 1.0 else -1.0
          if (last != 0.0 && s != last) flips += 1
          last = s
          ref = p
        } else if (last != 0.0 && d * last > 0) {
          ref = p
        }
      }
    }
    val sorted = speeds.sorted()
    val at = 0.95 * (sorted.size - 1).toDouble()
    val lo = floor(at).toInt()
    val hi = min(sorted.size - 1, lo + 1)
    val p95 = sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo)
    return Pair(p95, flips.toDouble() * 10_000 / (rows.size.toDouble() * stepMs))
  }
}
