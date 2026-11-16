package expo.modules.replaycamera.ball

import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sqrt

/** `story.keep_runs` and the beach tennis run rules (port of `BallRuns` in `BallSport.swift`). */
object BallRuns {
  /** The trusted points with the runs shorter than `minRun` frames removed. minRun 0 = unchanged. */
  fun keep(tr: List<BallXY?>, minRun: Int, gap: Int): List<BallXY?> {
    if (minRun <= 0) return tr
    val out = tr.toMutableList()
    val idx = tr.indices.filter { tr[it] != null }
    var start: Int? = null
    for ((j, k) in idx.withIndex()) {
      if (start == null) start = k
      if (j + 1 == idx.size || idx[j + 1] - k > gap) {
        val a = start
        if (k - a + 1 < minRun) for (i in a..k) out[i] = null
        start = null
      }
    }
    return out
  }

  /** `cam_bt.runs_of`: (first, last) frames of the runs of points. */
  internal fun runs(tr: List<BallXY?>, gap: Int): List<Pair<Int, Int>> {
    val out = ArrayList<Pair<Int, Int>>()
    var start: Int? = null
    var last = 0
    for ((k, p) in tr.withIndex()) {
      if (p == null) continue
      val s = start
      if (s != null && k - last > gap) { out.add(Pair(s, last)); start = k } else if (s == null) start = k
      last = k
    }
    start?.let { out.add(Pair(it, last)) }
    return out
  }

  /** `cam_bt.moving_candidates` (test 49f). */
  fun movingCandidates(grid: List<List<BallCandidate>?>, screens: List<List<Double>>, minScore: Double,
                       still: Double = 0.01): List<List<BallXY>> {
    val keyed = grid.indices.filter { grid[it] != null }
    val out = List(grid.size) { ArrayList<BallXY>() }
    for ((i, k) in keyed.withIndex()) {
      val nb = listOf(i - 1, i + 1).filter { it >= 0 && it < keyed.size }.map { grid[keyed[it]]!! }
      for (c in grid[k]!!) {
        if (c.score < minScore) continue
        if (screens.any { it.size == 4 && it[0] <= c.cx && c.cx <= it[2] && it[1] <= c.cy && c.cy <= it[3] }) continue
        if (nb.any { f -> f.any { abs(it.cx - c.cx) <= still && abs(it.cy - c.cy) <= still } }) continue
        out[k].add(BallXY(c.cx, c.cy))
      }
    }
    return out
  }

  private enum class ExitState { PATH, GONE, OWN }

  /** `cam_bt.keep_exits` (tests 49e–f). `aspect`: height / width of the picture. top <= 0 = unchanged. */
  fun keepExits(tr: List<BallXY?>, top: Double, back: Double, dx: Double, cands: List<List<BallXY>>? = null,
                step: Double = 0.08, lost: Int = 4, aspect: Double = 1.0): List<BallXY?> {
    if (top <= 0) return tr
    val sx = if (aspect <= 1) 1.0 else 1.0 / aspect
    val sy = if (aspect <= 1) aspect else 1.0
    fun dist(a: BallXY, b: BallXY) = sqrt(((a.x - b.x) * sx) * ((a.x - b.x) * sx) + ((a.y - b.y) * sy) * ((a.y - b.y) * sy))
    fun goingOut(q: BallXY, kq: Int, c: BallXY, kc: Int): Boolean {
      val vy = (c.y - q.y) / (kc - kq).toDouble()
      return vy < -0.01 && c.y + 2 * vy < top
    }
    val out = tr.toMutableList()
    var state = ExitState.PATH
    var gx = 0.0
    var prev: Int? = null
    var ownK = 0
    var ownP: BallXY? = null
    for ((k, p) in tr.withIndex()) {
      if (state != ExitState.PATH) {
        val ref = if (state == ExitState.GONE) gx else ownP!!.x
        if (p != null && p.y <= back && abs(p.x - ref) <= dx) { state = ExitState.PATH; ownP = null }
      }
      if (state == ExitState.PATH) {
        if (p != null) {
          val j = prev
          if (j != null && k - j <= 2) {
            val q = tr[j]
            if (q != null && goingOut(q, j, p, k)) { state = ExitState.GONE; gx = p.x }
          }
          prev = k
        }
        continue
      }
      out[k] = null
      if (cands == null || k >= cands.size) continue
      val o0 = ownP
      if (state == ExitState.OWN && o0 != null && k - ownK > lost) { state = ExitState.GONE; gx = o0.x; ownP = null }
      if (state == ExitState.GONE) {
        var best: BallXY? = null
        for (c in cands[k]) {
          if (!(c.y <= back && abs(c.x - gx) <= dx)) continue
          val b = best
          if (b == null || abs(c.x - gx) < abs(b.x - gx)) best = c
        }
        val c = best
        if (c != null) { state = ExitState.OWN; ownK = k; ownP = c; out[k] = c }
      } else {
        val o = ownP ?: continue
        var best: BallXY? = null
        for (c in cands[k]) {
          if (!(dist(c, o) <= step * min(k - ownK, 2).toDouble())) continue
          val b = best
          if (b == null || dist(c, o) < dist(b, o)) best = c
        }
        val c = best
        if (c != null) {
          out[k] = c
          if (goingOut(o, ownK, c, k)) { state = ExitState.GONE; gx = c.x; ownP = null } else { ownK = k; ownP = c }
        }
      }
    }
    return out
  }

  /** `cam_bt.keep_court` (test 49d): the court by the ball. */
  fun courtLock(tr: List<BallXY?>, margin: Double, gap: Int): List<BallXY?> {
    if (margin <= 0) return tr
    val rs = runs(tr, gap)
    if (rs.size < 2) return tr
    fun xs(r: Pair<Int, Int>) = (r.first..r.second).mapNotNull { tr[it]?.x }
    var main = 0
    for (i in rs.indices) if (xs(rs[i]).size > xs(rs[main]).size) main = i
    val mx = xs(rs[main])
    val lo = BallPlayers.percentile(mx, 5.0) - margin
    val hi = BallPlayers.percentile(mx, 95.0) + margin
    val out = tr.toMutableList()
    for (i in rs.indices) {
      if (i == main) continue
      val m = BallPlayers.percentile(xs(rs[i]), 50.0)
      if (!(lo <= m && m <= hi)) for (k in rs[i].first..rs[i].second) out[k] = null
    }
    for (k in out.indices) {
      val p = out[k]
      if (p != null && !(lo <= p.x && p.x <= hi)) out[k] = null
    }
    return out
  }
}
