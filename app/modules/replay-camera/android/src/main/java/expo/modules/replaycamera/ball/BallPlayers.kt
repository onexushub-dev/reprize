package expo.modules.replaycamera.ball

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * `cam_bt.main_players` / `keep_players_court` / `aim_x` and friends (port of `BallPlayers` in `BallSport.swift`). Boxes
 * are x, y, width, height, 0..1 of the upright video, top-left origin, one row of boxes per 100 ms frame.
 */
object BallPlayers {
  /** The boxes at least `share` of the 80th-percentile height of every box of the clip. */
  fun main(rows: List<List<List<Double>>>, share: Double): List<List<List<Double>>> {
    val hs = rows.flatMap { r -> r.filter { it.size >= 4 }.map { it[3] } }
    if (hs.isEmpty()) return rows.map { emptyList() }
    val hmin = share * percentile(hs, 80.0)
    return rows.map { r -> r.filter { it.size >= 4 && it[3] >= hmin } }
  }

  /** The trusted points inside the main players' court; unchanged when fewer than 20 boxes or margin <= 0. */
  fun courtLock(tr: List<BallXY?>, main: List<List<List<Double>>>, margin: Double): List<BallXY?> {
    if (margin <= 0) return tr
    val xs = main.flatMap { r -> r.map { it[0] + it[2] / 2 } }
    if (xs.size < 20) return tr
    val lo = percentile(xs, 5.0) - margin
    val hi = percentile(xs, 95.0) + margin
    return tr.map { p -> if (p != null && lo <= p.x && p.x <= hi) p else null }
  }

  /** The camera's target x per frame: the ball's, moved `blend` of the way to the hitter's centre where there is one. */
  fun aim(tr: List<BallXY?>, main: List<List<List<Double>>>, width: Double, height: Double, blend: Double, near: Double): List<Double?> {
    val xs = tr.map { it?.x }.toMutableList()
    if (blend <= 0) return xs
    for ((k, p) in tr.withIndex()) {
      if (p == null || k >= main.size) continue
      val hb = hitter(p, main[k], width, height, near) ?: continue
      xs[k] = (1 - blend) * p.x + blend * (hb[0] + hb[2] / 2)
    }
    return xs
  }

  /** The two tallest boxes, ties in their order (Python's stable sort). */
  private fun tallestTwo(row: List<List<Double>>): List<List<Double>> =
    row.withIndex().sortedWith { a, b ->
      if (a.value[3] != b.value[3]) b.value[3].compareTo(a.value[3]) else a.index.compareTo(b.index)
    }.take(2).map { it.value }

  /** `cam_bt.keep_pair` (mode 1); `nearOnly` > 0: only where the ball is within that many long sides of one of the two. */
  fun keepPair(xs: List<Double?>, tr: List<BallXY?>, main: List<List<List<Double>>>, cropWidth: Double, pad: Double,
               nearOnly: Double = 0.0, width: Double = 1.0, height: Double = 1.0): List<Double?> {
    val w = cropWidth
    val out = xs.toMutableList()
    for ((k, x) in xs.withIndex()) {
      if (x == null || k >= tr.size || k >= main.size) continue
      val ball = tr[k] ?: continue
      val bs = tallestTwo(main[k])
      if (bs.size < 2) continue
      if (nearOnly > 0 && hitter(ball, bs, width, height, nearOnly) == null) continue
      val left = bs.minOf { it[0] } - pad * w
      val right = bs.maxOf { it[0] + it[2] } + pad * w
      val lo = max(right - w / 2, ball.x - w / 2 + pad * w)
      val hi = min(left + w / 2, ball.x + w / 2 - pad * w)
      if (lo <= hi) out[k] = min(max(x, lo), hi)
    }
    return out
  }

  /** `cam_bt.glide` (test 49f). */
  fun glide(xs: List<Double?>, tr: List<BallXY?>, main: List<List<List<Double>>>, frames: Int, margin: Double): List<Double?> {
    if (frames <= 0) return xs
    val mx = main.flatMap { r -> r.map { it[0] + it[2] / 2 } }
    val lo = if (mx.size >= 20) percentile(mx, 5.0) - margin else 0.0
    val hi = if (mx.size >= 20) percentile(mx, 95.0) + margin else 1.0
    val out = xs.toMutableList()
    val n = xs.size
    for (k in 0 until n) {
      val xk = xs[k] ?: continue
      if (!(k + 1 < n && xs[k + 1] == null)) continue
      var j = k - 1
      while (j >= 0 && k - j <= 2 && tr[j] == null) j -= 1
      if (!(j >= 0 && k - j <= 2)) continue
      val pj = tr[j] ?: continue
      val pk = tr[k] ?: continue
      val vx = (pk.x - pj.x) / (k - j).toDouble()
      var m = k + 1
      while (m < n && xs[m] == null && m - k <= frames) {
        out[m] = min(max(xk + vx * (m - k).toDouble(), lo), hi)
        m += 1
      }
    }
    return out
  }

  /** `cam_bt.turns_of` (test 52): the frames where the ball's x direction turns. */
  internal fun turns(tr: List<BallXY?>, minDv: Double = 0.004): List<Int> {
    val n = tr.size
    val vx = arrayOfNulls<Double>(n)
    if (n > 1) for (k in 1 until n) {
      val a = tr[k]
      val b = tr[k - 1]
      if (a != null && b != null) vx[k] = a.x - b.x
    }
    val out = ArrayList<Int>()
    if (n > 2) for (k in 2 until n) {
      val a = vx[k]
      val b = vx[k - 1]
      if (a != null && b != null && a * b < 0 && abs(a - b) > minDv) out.add(k)
    }
    return out
  }

  /** `cam_bt.hit_boxes` (test 52): per frame, the box of the main player who plays the ball next; null elsewhere. */
  fun hitBoxes(tr: List<BallXY?>, main: List<List<List<Double>>>, width: Double, height: Double, near: Double, horizon: Int,
               back: Int = 2): List<List<Double>?> {
    val n = tr.size
    val hits = ArrayList<Pair<Int, List<Double>>>()
    for (t in turns(tr)) {
      val p = tr[t] ?: continue
      if (t >= main.size) continue
      val hb = hitter(p, main[t], width, height, near) ?: continue
      hits.add(Pair(t, hb))
    }
    val out = arrayOfNulls<List<Double>>(n)
    var j = 0
    for (k in 0 until n) {
      while (j < hits.size && hits[j].first < k - back) j += 1
      if (j < hits.size && hits[j].first - k <= horizon) out[k] = hits[j].second
    }
    return out.toList()
  }

  /** `cam_bt.keep_box` (test 52). */
  fun keepBox(xs: List<Double?>, tr: List<BallXY?>, boxes: List<List<Double>?>, cropWidth: Double, pad: Double,
              ballFirst: Boolean): List<Double?> {
    val w = cropWidth
    val out = xs.toMutableList()
    for ((k, x) in xs.withIndex()) {
      if (x == null || k >= boxes.size) continue
      val b = boxes[k] ?: continue
      val left = b[0] - pad * w
      val right = b[0] + b[2] + pad * w
      var lo = right - w / 2
      var hi = left + w / 2
      val p = if (k < tr.size) tr[k] else null
      if (p != null) {
        val blo = p.x - w / 2
        val bhi = p.x + w / 2
        if (max(lo, blo) <= min(hi, bhi)) {
          lo = max(lo, blo)
          hi = min(hi, bhi)
        } else if (ballFirst) {
          continue
        }
      }
      if (lo <= hi) out[k] = min(max(x, lo), hi)
    }
    return out
  }

  /** `cam_bt.hitter`: the box whose centre is nearest to the ball (distance in long sides), if within `near`. */
  fun hitter(ball: BallXY, boxes: List<List<Double>>, width: Double, height: Double, near: Double): List<Double>? {
    val l = max(width, height)
    var bestD = 0.0
    var best: List<Double>? = null
    for (b in boxes) {
      val cx = b[0] + b[2] / 2
      val cy = b[1] + b[3] / 2
      val d = sqrt((cx - ball.x) * width * (cx - ball.x) * width + (cy - ball.y) * height * (cy - ball.y) * height) / l
      if (best == null || d < bestD) { bestD = d; best = b }
    }
    return if (best != null && bestD <= near) best else null
  }

  /** `cam_bt.on_person`: inside a person's box widened by 20% of its width on each side. */
  internal fun onPerson(p: BallXY, rows: List<List<Double>>): Boolean =
    rows.any { b -> b.size >= 4 && b[0] - 0.2 * b[2] <= p.x && p.x <= b[0] + 1.2 * b[2] && b[1] <= p.y && p.y <= b[1] + b[3] }

  /** `cam_bt.keep_play` (2026-11-13). */
  fun keepPlay(tr: List<BallXY?>, rows: List<List<List<Double>>>, width: Double, height: Double, minSpeed: Double,
               maxOnPerson: Double, gap: Int): List<BallXY?> {
    if (minSpeed <= 0) return tr
    val l = max(width, height)
    val out = tr.toMutableList()
    val runs = ArrayList<MutableList<Int>>()
    for (k in tr.indices) {
      if (tr[k] == null) continue
      val last = runs.lastOrNull()?.lastOrNull()
      if (last != null && k - last <= gap) runs.last().add(k) else runs.add(mutableListOf(k))
    }
    for (ks in runs) {
      if (ks.size < 3) continue
      val steps = (0 until ks.size - 1).map { t ->
        val i = ks[t]
        val j = ks[t + 1]
        hypot((tr[j]!!.x - tr[i]!!.x) * width, (tr[j]!!.y - tr[i]!!.y) * height) / l / (j - i).toDouble()
      }
      val speed = BallMath.median(steps)
      var on = 0
      for (k in ks) {
        var r = if (k < rows.size) rows[k] else emptyList()
        if (r.isEmpty() && k > 0 && k <= rows.size) r = rows[k - 1]
        if (onPerson(tr[k]!!, r)) on += 1
      }
      if (speed < minSpeed || on.toDouble() >= maxOnPerson * ks.size) for (k in ks) out[k] = null
    }
    return out
  }

  /** `cam_bt.near_targets`. */
  internal fun nearTargets(main: List<List<List<Double>>>, cropWidth: Double): List<List<Double>> =
    main.map { row ->
      val pair = tallestTwo(row)
      if (pair.isEmpty()) return@map emptyList()
      val x0 = pair.minOf { it[0] }
      val x1 = pair.maxOf { it[0] + it[2] }
      if (x1 - x0 <= 0.9 * cropWidth) listOf((x0 + x1) / 2) else pair.map { it[0] + it[2] / 2 }
    }

  /** `cam_bt.near_x`. */
  internal fun nearX(main: List<List<List<Double>>>, cropWidth: Double, start: Double? = null): List<Double?> {
    var cur = start
    val out = ArrayList<Double?>()
    for (o in nearTargets(main, cropWidth)) {
      if (o.isNotEmpty()) {
        val c = cur
        cur = if (c != null) o.minByOrNull { abs(it - c) } else o[0]
      }
      out.add(cur)
    }
    val first = out.firstOrNull { it != null }
    return out.map { it ?: first }
  }

  /** `cam_bt.near_fallback` (2026-11-13). */
  fun nearFallback(xs: List<Double?>, main: List<List<List<Double>>>, gap: Int, cropWidth: Double): List<Double?> {
    val n = xs.size
    if (gap <= 0 || main.all { it.isEmpty() }) return xs
    val idx = (0 until n).filter { xs[it] != null }
    val first = idx.firstOrNull() ?: return nearX(main, cropWidth)
    val lastK = idx.last()
    val out = xs.toMutableList()
    val spans = ArrayList<Triple<Int, Int, Double>>()
    spans.add(Triple(0, first, xs[first]!!))
    for (t in 0 until idx.size - 1) {
      val a = idx[t]
      val b = idx[t + 1]
      if (b - a > gap) spans.add(Triple(a + 1, b, xs[a]!!))
    }
    spans.add(Triple(lastK + 1, n, xs[lastK]!!))
    for ((a, b, from) in spans) {
      if (b <= a) continue
      val rows = main.subList(a, min(b, main.size)) + List(max(0, b - main.size)) { emptyList<List<Double>>() }
      val nx = if (a == 0) nearX(rows.reversed(), cropWidth, from).reversed() else nearX(rows, cropWidth, from)
      for ((i, k) in (a until b).withIndex()) out[k] = nx[i]
    }
    return out
  }

  /** numpy.percentile (linear). */
  fun percentile(v: List<Double>, q: Double): Double {
    val s = v.sorted()
    val pos = q / 100 * (s.size - 1).toDouble()
    val i = Math.floor(pos).toInt()
    val f = pos - i
    return if (i + 1 < s.size) s[i] + f * (s[i + 1] - s[i]) else s[i]
  }
}
