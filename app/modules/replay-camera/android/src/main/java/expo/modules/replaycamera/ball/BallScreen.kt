package expo.modules.replaycamera.ball

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** `ball_track.screen_boxes` (test 47b, port of `BallScreen`): video screens at the venue, from grey thumbnails. */
object BallScreen {
  const val thumbWidth = 160
  const val fill = 0.75
  const val sync = 0.12
  const val area = 0.015

  /** `frames`: grey thumbnails (row-major, `width` × `height`, 0–255) in time order. Boxes x0, y0, x1, y1, 0..1. */
  fun boxes(frames: List<ByteArray>, width: Int, height: Int): List<List<Double>> {
    val w = width
    val h = height
    val t = frames.size - 1
    if (!(t >= 2 && w > 0 && h > 0 && frames.all { it.size == w * h })) return emptyList()
    val n = w * h
    val changed = Array(t) { BooleanArray(n) }
    val act = DoubleArray(n)
    for (s in 0 until t) {
      val a = frames[s]
      val b = frames[s + 1]
      for (i in 0 until n) {
        if (abs((b[i].toInt() and 0xFF) - (a[i].toInt() and 0xFF)) > 12) { changed[s][i] = true; act[i] += 1.0 }
      }
    }
    for (i in 0 until n) act[i] /= t.toDouble()
    val label = IntArray(n) { -1 }
    val out = ArrayList<List<Double>>()
    for (s in 0 until n) {
      if (!(act[s] > 0.12 && label[s] < 0)) continue
      val stack = ArrayList<Int>()
      stack.add(s)
      label[s] = s
      var x0 = w
      var y0 = h
      var x1 = -1
      var y1 = -1
      var count = 0
      while (stack.isNotEmpty()) {
        val p = stack.removeAt(stack.size - 1)
        count += 1
        val px = p % w
        val py = p / w
        x0 = min(x0, px); x1 = max(x1, px); y0 = min(y0, py); y1 = max(y1, py)
        for (dy in -1..1) for (dx in -1..1) {
          if (dx == 0 && dy == 0) continue
          val qx = px + dx
          val qy = py + dy
          if (!(qx >= 0 && qx < w && qy >= 0 && qy < h)) continue
          val q = qy * w + qx
          if (act[q] > 0.12 && label[q] < 0) { label[q] = s; stack.add(q) }
        }
      }
      if (count.toDouble() < 0.002 * n) continue
      val bw = x1 - x0 + 1
      val bh = y1 - y0 + 1
      var activeInBox = 0
      for (y in y0..y1) for (x in x0..x1) if (act[y * w + x] > 0.12) activeInBox += 1
      val boxFill = activeInBox.toDouble() / (bw * bh).toDouble()
      var syncSteps = 0
      for (st in 0 until t) {
        var c = 0
        for (y in y0..y1) for (x in x0..x1) if (changed[st][y * w + x]) c += 1
        if (c.toDouble() / (bw * bh).toDouble() > 0.5) syncSteps += 1
      }
      val boxSync = syncSteps.toDouble() / t.toDouble()
      if (boxFill >= fill && boxSync >= sync && (bw * bh).toDouble() >= area * n) {
        out.add(listOf(x0.toDouble() / w, y0.toDouble() / h, (x1 + 1).toDouble() / w, (y1 + 1).toDouble() / h))
      }
    }
    return out
  }
}
