package expo.modules.replaycamera.ball

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/** The ball path's numbers (port of `BallPathParams`: the lab's `ball_track.py` `P` + `SPORT_P`). */
class BallPathParams {
  var boxMax = 0.06
  var aspectMax = 2.5
  var conf = 0.05
  var stillR = 0.02
  var stillShare = 0.2
  var stillWin = 20
  var s0 = 0.05
  var vmax = 0.12
  var moveCost = 1.0
  var dpGap = 10
  var stillCost = 0.05
  var minLen = 3
  var personRatio = 0.0
  var personAsp = 0.0
  var personW = 0.0
  var personEdge = 0.01
  var headTop = 0.0
  var headW = 0.0
  var flat = 0
  var flatDy = 0.03
  var flatDx = 0.04
  var flatPad = 0.2

  companion object {
    /** Basketball (tests 35, 50). */
    val basketball: BallPathParams
      get() = BallPathParams().apply {
        stillShare = 0.5
        personRatio = 0.3
        personAsp = 1.35
        personW = 0.3
      }

    /** Beach tennis (tests 46, 52; 2026-11-12 car lights). */
    val beachTennis: BallPathParams
      get() = BallPathParams().apply {
        stillR = 0.006
        stillShare = 0.3
        headTop = 0.15
        headW = 0.0
        flat = 8
      }
  }
}

/**
 * The ball per 100 ms frame from the detector's candidates (port of `BallPath.swift`: the lab's `ball_track.track` with
 * `dp=1`, shape filter, still filter, dynamic programming over the whole clip, then the 100 ms upsampling).
 */
object BallPath {
  /** See `BallPath.track` in Swift for the meaning of each argument. Returns one entry per frame. */
  fun track(frames: List<List<BallCandidate>?>, width: Double, height: Double, step: Int,
            params: BallPathParams = BallPathParams.basketball, screens: List<List<Double>> = emptyList(),
            people: List<List<List<Double>>> = emptyList(), stale: List<List<BallCandidate>?> = emptyList()): List<BallPoint?> {
    val p = params
    fun once(f: List<List<BallCandidate>?>) = trackOnce(f, width, height, step, p, screens, people, stale)
    var pred = once(frames)
    // car lights (`flat`): horizontal clips with people only
    if (!(p.flat > 0 && width > height)) return pred
    val area = playArea(people)
    val fr = frames.toMutableList()
    repeat(3) {
      val pts: List<BallXY?> = pred.map { it?.let { q -> BallXY(q.cx, q.cy) } }
      val kept = dropFlat(pts, p.flat, p.flatDy, p.flatDx)
      val marked = pts.indices.filter { pts[it] != null && kept[it] == null }
      val flagged = ArrayList<Int>()
      for (seg in segments(marked)) {
        val mx = BallMath.mean(seg.map { pts[it]!!.x })
        val my = BallMath.mean(seg.map { pts[it]!!.y })
        val inside = area?.let { it.lo - p.flatPad <= mx && mx <= it.hi + p.flatPad } ?: true
        val high = area?.head?.let { my < it - 0.03 } ?: false
        if (inside && (high || area == null || area.head == null)) continue
        flagged += seg.filter { it < fr.size && !(fr[it]?.isEmpty() ?: true) }
      }
      if (flagged.isEmpty()) return pred
      for (k in flagged) {
        val q = pts[k]!!
        fr[k] = fr[k]!!.filter { hypot(it.cx - q.x, it.cy - q.y) > 0.02 }
      }
      pred = once(fr)
    }
    return pred
  }

  /** One pass of the path (`ball_track.track`). */
  internal fun trackOnce(frames: List<List<BallCandidate>?>, width: Double, height: Double, step: Int, p: BallPathParams,
                         screens: List<List<Double>>, people: List<List<List<Double>>>, stale: List<List<BallCandidate>?>): List<BallPoint?> {
    val n = frames.size
    val w = width
    val h = height
    val l = max(width, height)
    val an = (0 until n).filter { frames[it] != null }
    val moving = moving(frames, stale, width, height, p, screens, people)
    val dist = { a: BallCandidate, b: BallCandidate -> hypot((a.cx - b.cx) * w, (a.cy - b.cy) * h) / l }
    val chosen = viterbi(an, moving, dist, step, p)
    return points(chosen, an, n, step)
  }

  /** Steps 0 to 2 of `track`: per analysed frame, the candidates that pass the shape and score filter and are not still. */
  internal fun moving(frames: List<List<BallCandidate>?>, stale: List<List<BallCandidate>?>, width: Double, height: Double,
                      p: BallPathParams, screens: List<List<Double>> = emptyList(),
                      people: List<List<List<Double>>> = emptyList()): Map<Int, List<BallCandidate>> {
    val n = frames.size
    val w = width
    val h = height
    val l = max(width, height)
    val an = (0 until n).filter { frames[it] != null }
    val usePeople = (p.personRatio > 0 || p.headTop > 0) && people.any { it.isNotEmpty() }
    fun shaped(k: Int, items: List<BallCandidate>): List<BallCandidate> {
      val rows = if (usePeople && k < people.size) people[k] else emptyList()
      val weighed = items.mapNotNull { c0 ->
        var c = c0
        if (rows.isNotEmpty() && p.headTop > 0 && isHead(c, rows, p)) {
          if (p.headW <= 0) return@mapNotNull null
          c = c.copy(score = c.score * p.headW)
        }
        if (!(rows.isNotEmpty() && p.personRatio > 0 && c.height * h >= p.personAsp * c.width * w &&
            isShirt(c, max(c.width * w, c.height * h), rows, h, p))) return@mapNotNull c
        if (p.personW <= 0) return@mapNotNull null
        c.copy(score = c.score * p.personW)
      }
      return weighed.filter { c ->
        val wp = c.width * w
        val hp = c.height * h
        if (c.score < p.conf || max(wp, hp) > p.boxMax * l) return@filter false
        if (max(wp, hp) / max(1e-6, min(wp, hp)) > p.aspectMax) return@filter false
        !screens.any { it[0] <= c.cx && c.cx <= it[2] && it[1] <= c.cy && c.cy <= it[3] }
      }
    }
    val cand = HashMap<Int, List<BallCandidate>>()
    val seen = HashMap<Int, List<BallCandidate>>()
    for (k in an) {
      val own = shaped(k, frames[k] ?: emptyList())
      cand[k] = own
      seen[k] = if (k < stale.size) own + shaped(k, stale[k] ?: emptyList()) else own
    }
    fun dist(a: BallCandidate, b: BallCandidate) = hypot((a.cx - b.cx) * w, (a.cy - b.cy) * h) / l
    val moving = HashMap<Int, List<BallCandidate>>()
    for (k in an) {
      val near = an.filter { it != k && abs(it - k) <= p.stillWin }
      moving[k] = (cand[k] ?: emptyList()).filter { c ->
        val hits = near.count { q -> (seen[q] ?: emptyList()).any { dist(c, it) <= p.stillR } }
        !(near.isNotEmpty() && hits.toDouble() >= p.stillShare * near.size.toDouble())
      }
    }
    return moving
  }

  /** The chosen candidate per analysed frame as the path's points, on every 100 ms frame (`low_fps.upsample`). */
  private fun points(chosen: Map<Int, BallCandidate>, an: List<Int>, n: Int, step: Int): List<BallPoint?> {
    val pred = HashMap<Int, BallPoint?>()
    for (k in an) {
      val c = chosen[k]
      pred[k] = c?.let {
        BallPoint(it.cx, it.cy, it.width, it.height, BallMath.roundTo((Math.PI / 4) * it.width * it.height, 7), 1.0, it.score)
      }
    }
    val off = an.firstOrNull()?.let { it % step } ?: 0
    return if (step > 1) upsample(pred, n, step, off) else (0 until n).map { pred[it] }
  }

  /** Test 52: inside a person's box, within `headTop` of its height from its top. */
  internal fun isHead(c: BallCandidate, boxes: List<List<Double>>, p: BallPathParams): Boolean {
    for (t in boxes) {
      if (t.size < 4) continue
      val bx = t[0] + t[2] / 2
      val by = t[1] + t[3] / 2
      val bw = t[2]
      val bh = t[3]
      val top = by - bh / 2
      if (abs(c.cx - bx) <= bw / 2 && top <= c.cy && c.cy <= top + p.headTop * bh) return true
    }
    return false
  }

  /** `ball_track.person_big`: inside a person's box the picture does not cut, bigger than `personRatio` of the tallest. */
  internal fun isShirt(c: BallCandidate, size: Double, boxes: List<List<Double>>, h: Double, p: BallPathParams): Boolean {
    val e = p.personEdge
    var tallest: Double? = null
    for (t in boxes) {
      if (t.size < 4) continue
      val bx = t[0] + t[2] / 2
      val by = t[1] + t[3] / 2
      val bw = t[2]
      val bh = t[3]
      if (!(abs(c.cx - bx) <= bw / 2 && abs(c.cy - by) <= bh / 2 && by - bh / 2 > e && by + bh / 2 < 1 - e &&
          bx - bw / 2 > e && bx + bw / 2 < 1 - e)) continue
      tallest = max(tallest ?: 0.0, bh * h)
    }
    val t = tallest ?: return false
    return size > p.personRatio * t
  }

  private data class Node(val k: Int, val j: Int) : Comparable<Node> {
    override fun compareTo(other: Node): Int = if (k != other.k) k.compareTo(other.k) else j.compareTo(other.j)
  }

  /** `ball_track.dp_track`: the best path ends anywhere; the frames left get the next best disjoint paths. */
  private fun viterbi(an: List<Int>, moving: Map<Int, List<BallCandidate>>, dist: (BallCandidate, BallCandidate) -> Double,
                      step: Int, p: BallPathParams): Map<Int, BallCandidate> {
    val best = HashMap<Node, Double>()
    val back = HashMap<Node, Node?>()
    val order = ArrayList<Node>()
    val back1 = p.dpGap / step + 1
    for ((i, k) in an.withIndex()) {
      val prevs = an.subList(max(0, i - back1), i)
      for ((j, c) in (moving[k] ?: emptyList()).withIndex()) {
        val g = c.score - p.s0
        var b = g
        var bp: Node? = null
        for (q in prevs) {
          if (k - q > p.dpGap) continue
          for ((jj, cc) in (moving[q] ?: emptyList()).withIndex()) {
            val prev = best[Node(q, jj)] ?: continue
            val d = dist(c, cc)
            if (d > p.vmax * (k - q).toDouble()) continue
            val v = prev + g - p.moveCost * d - (if (d < 0.005 * (k - q).toDouble()) p.stillCost else 0.0)
            if (v > b) { b = v; bp = Node(q, jj) }
          }
        }
        val node = Node(k, j)
        best[node] = b
        back[node] = bp
        order.add(node)
      }
    }
    val chosen = HashMap<Int, BallCandidate>()
    val used = HashSet<Node>()
    while (true) {
      // Python's max over (value, (k, j)): the highest value, ties to the larger node
      var topV = 0.0
      var topKey: Node? = null
      for (node in order) {
        if (used.contains(node) || chosen.containsKey(node.k)) continue
        val v = best[node]!!
        val tk = topKey
        if (tk == null || v > topV || (v == topV && tk < node)) { topV = v; topKey = node }
      }
      val tk = topKey
      if (tk == null || topV <= 0.5) break
      val path = ArrayList<Node>()
      var key: Node? = tk
      while (true) {
        val kk = key ?: break
        if (used.contains(kk) || chosen.containsKey(kk.k)) break
        path.add(kk)
        key = back[kk]
      }
      if (path.size < p.minLen) {
        used.addAll(path)
        continue
      }
      for (kk in path) {
        chosen[kk.k] = moving[kk.k]!![kk.j]
        used.add(kk)
      }
      for (node in order) if (chosen.containsKey(node.k)) used.add(node)
    }
    return chosen
  }

  /**
   * `low_fps.upsample`: the analysed frames as they are; a frame between two analysed frames that both have the ball gets
   * centre, size and area interpolated (6 decimals), the rest from the earlier one; else null. `pred` holds a key for
   * every analysed frame (its value null when no ball).
   */
  internal fun upsample(pred: Map<Int, BallPoint?>, n: Int, step: Int, off: Int): List<BallPoint?> =
    (0 until n).map { k ->
      if (pred.containsKey(k) && (k - off) % step == 0) return@map pred[k]
      val a = off + floor((k - off).toDouble() / step.toDouble()).toInt() * step
      val b = a + step
      if (!(a >= off && b < n)) return@map null
      val va = pred[a] ?: return@map null
      val vb = pred[b] ?: return@map null
      val f = (k - a).toDouble() / step.toDouble()
      fun lerp(x: Double, y: Double) = BallMath.roundTo(x + (y - x) * f, 6)
      BallPoint(lerp(va.cx, vb.cx), lerp(va.cy, vb.cy), lerp(va.width, vb.width), lerp(va.height, vb.height),
        lerp(va.area, vb.area), va.main, va.score)
    }

  internal class PlayArea(val lo: Double, val hi: Double, val head: Double?)

  /** `ball_track.play_area`: the main players' x range and the far players' head line; null without enough people. */
  internal fun playArea(rows: List<List<List<Double>>>): PlayArea? {
    val all = rows.flatMap { r -> r.filter { it.size >= 4 } }
    val allH = all.map { it[3] }
    val mx = BallPlayers.main(rows, 0.6).flatMap { r -> r.map { it[0] + it[2] / 2 } }
    if (mx.size < 20 || allH.isEmpty()) return null
    val lo = BallPlayers.percentile(mx, 5.0)
    val hi = BallPlayers.percentile(mx, 95.0)
    val small = 0.6 * BallPlayers.percentile(allH, 80.0)
    val far = all.filter { b -> lo - 0.05 <= b[0] + b[2] / 2 && b[0] + b[2] / 2 <= hi + 0.05 && b[3] < small }.map { it[1] }
    return PlayArea(lo, hi, if (far.size >= 10) BallMath.median(far) else null)
  }

  /** `cam_bt.drop_flat` (see the Swift for the rule). */
  internal fun dropFlat(tr: List<BallXY?>, length: Int, dy: Double, dx: Double): List<BallXY?> {
    val len = length
    if (len <= 0) return tr
    val out = tr.toMutableList()
    if (tr.size >= len) {
      for (s0 in 0..(tr.size - len)) {
        val pts = tr.subList(s0, s0 + len).filterNotNull()
        if (pts.size.toDouble() < 0.7 * len) continue
        val ys = pts.map { it.y }
        val xs = pts.map { it.x }
        if (ys.max() - ys.min() >= dy || abs(xs.last() - xs.first()) < dx * len / 10) continue
        val way = if (xs.last() >= xs.first()) 1.0 else -1.0
        val d = (0 until xs.size - 1).map { (xs[it + 1] - xs[it]) * way }
        if (d.isEmpty()) continue
        val backShare = d.count { it < 0 }.toDouble() / d.size
        if (backShare <= 0.35 && d.maxOf { -it } < 0.04) for (k in s0 until s0 + len) out[k] = null
      }
    }
    val marked = tr.indices.filter { tr[it] != null && out[it] == null }
    for (seg in segments(marked)) {
      val ym = BallMath.mean(seg.map { tr[it]!!.y })
      val way = if (tr[seg.last()]!!.x >= tr[seg.first()]!!.x) 1.0 else -1.0
      for (st in intArrayOf(-1, 1)) {
        var k = if (st < 0) seg.first() else seg.last()
        var last = tr[k]!!
        var miss = 0
        while (0 <= k + st && k + st < tr.size && miss <= 3) {
          k += st
          val p = tr[k]
          if (p == null) { miss += 1; continue }
          if (abs(p.y - ym) > dy || (p.x - last.x) * way * st < -0.04) break
          out[k] = null
          last = p
          miss = 0
        }
      }
    }
    return out
  }

  /** `cam_bt._segments`: runs of frame indices (a gap of up to `gap` frames inside a run). */
  internal fun segments(ks: List<Int>, gap: Int = 3): List<List<Int>> {
    val out = ArrayList<MutableList<Int>>()
    for (k in ks) {
      val l = out.lastOrNull()?.lastOrNull()
      if (l != null && k - l <= gap) out.last().add(k) else out.add(mutableListOf(k))
    }
    return out
  }
}
