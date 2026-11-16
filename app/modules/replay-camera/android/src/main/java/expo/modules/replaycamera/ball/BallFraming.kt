package expo.modules.replaycamera.ball

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/**
 * Seguir a Bola from the stored detections to the 9:16 framing (port of `BallFraming.swift`): the cut's 100 ms grid,
 * which grid frames are analysed (every `step`-th, 5 fps), then path → trusted points → zoom → camera.
 */
object BallFraming {
  const val stepMs = 100.0
  /** Analyse every 2nd 100 ms frame (5 fps). */
  const val step = 2

  /** One analysed picture of the clip: its presentation time and its candidates (0..1 of the upright frame). */
  data class Detection(val tMs: Double, val candidates: List<BallCandidate>, val stale: List<BallCandidate> = emptyList())

  /** The cut's grid: row k at `startMs + k × 100`, for every tick before `endMs`. */
  fun rows(startMs: Double, endMs: Double): Int = max(0, ceil((endMs - startMs) / stepMs - 1e-9).toInt())

  /** The detection that stands for tick `tick`: the first picture at or after it within its 100 ms. */
  internal fun detection(tick: Double, sorted: List<Detection>): Detection? {
    var lo = 0
    var hi = sorted.size
    while (lo < hi) {
      val mid = (lo + hi) / 2
      if (sorted[mid].tMs < tick - 0.5) lo = mid + 1 else hi = mid
    }
    return if (lo < sorted.size && sorted[lo].tMs < tick + stepMs - 0.5) sorted[lo] else null
  }

  /** Which grid frames to analyse (k ≡ phase mod step): the phase whose ticks the cache covers most; 0 for none. */
  fun phase(startMs: Double, endMs: Double, cached: List<Detection>): Int {
    val n = rows(startMs, endMs)
    val sorted = cached.sortedBy { it.tMs }
    var best = 0
    var bestHits = -1
    for (p in 0 until step) {
      val hits = (p until n step step).count { detection(startMs + it * stepMs, sorted) != null }
      if (hits > bestHits) { best = p; bestHits = hits }
    }
    return best
  }

  /** The ticks (ms) of the analysed grid frames that the cache does not have yet. */
  fun missingTicks(startMs: Double, endMs: Double, phase: Int, cached: List<Detection>): List<Double> {
    val sorted = cached.sortedBy { it.tMs }
    if (phase >= rows(startMs, endMs)) return emptyList()
    return (phase until rows(startMs, endMs) step step).map { startMs + it * stepMs }.filter { detection(it, sorted) == null }
  }

  /** The grid the path reads (candidates on the analysed frames that have a picture, null elsewhere) and the held evidence. */
  fun grids(startMs: Double, endMs: Double, phase: Int, detections: List<Detection>): Pair<List<List<BallCandidate>?>, List<List<BallCandidate>?>> {
    val n = rows(startMs, endMs)
    val sorted = detections.sortedBy { it.tMs }
    val out = arrayOfNulls<List<BallCandidate>>(n)
    val held = arrayOfNulls<List<BallCandidate>>(n)
    if (phase < n) for (k in phase until n step step) {
      val d = detection(startMs + k * stepMs, sorted)
      out[k] = d?.candidates
      held[k] = d?.stale
    }
    return Pair(out.toList(), held.toList())
  }

  private fun candidateRows(c: List<BallCandidate>) = JSONArray(c.map { JSONArray(listOf(it.cx, it.cy, it.width, it.height, it.score)) })

  /** `<clip>.balldet.json`: every analysed picture's candidates, valid while the model is the same; the screens found. */
  fun detectionsJSON(dets: List<Detection>, width: Int, height: Int, model: String, screens: List<List<Double>>): JSONObject {
    val f = JSONObject().put("v", 1).put("model", model).put("size", JSONArray(listOf(width, height)))
      .put("frames", JSONArray(dets.sortedBy { it.tMs }.map { d ->
        val fr = JSONObject().put("t", BallMath.roundTo(d.tMs, 3)).put("c", candidateRows(d.candidates))
        if (d.stale.isNotEmpty()) fr.put("s", candidateRows(d.stale))
        fr
      }))
    if (screens.isNotEmpty()) f.put("screens", JSONArray(screens.map { JSONArray(it) }))
    return f
  }

  /** The video screens kept in `<clip>.balldet.json` (none when absent). */
  fun screens(json: JSONObject?): List<List<Double>> {
    val s = json?.optJSONArray("screens") ?: return emptyList()
    return (0 until s.length()).mapNotNull { i -> s.optJSONArray(i)?.let { a -> if (a.length() == 4) (0 until 4).map { a.getDouble(it) } else null } }
  }

  /** Reads `<clip>.balldet.json`; anything unreadable, another model or another frame size gives an empty cache. */
  fun detections(json: JSONObject?, width: Int, height: Int, model: String): List<Detection> {
    val f = json ?: return emptyList()
    return try {
      if (f.optInt("v") != 1 || f.optString("model") != model) return emptyList()
      val size = f.getJSONArray("size")
      if (size.length() != 2 || size.getInt(0) != width || size.getInt(1) != height) return emptyList()
      val frames = f.getJSONArray("frames")
      fun cands(a: JSONArray?): List<BallCandidate> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { i ->
        val v = a.getJSONArray(i)
        if (v.length() == 5) BallCandidate(v.getDouble(0), v.getDouble(1), v.getDouble(2), v.getDouble(3), v.getDouble(4)) else null
      }
      (0 until frames.length()).mapNotNull { i ->
        val fr = frames.getJSONObject(i)
        if (!fr.has("t") || fr.optJSONArray("c") == null) null
        else Detection(fr.getDouble("t"), cands(fr.getJSONArray("c")), cands(fr.optJSONArray("s")))
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  /** Swift's `.rounded()`: half away from zero. */
  private fun r4(v: Double): Double = (if (v >= 0) Math.floor(v * 10000 + 0.5) else -Math.floor(-v * 10000 + 0.5)) / 10000

  /** `<clip>.ball.json`: the Modo Foco file's format (v1, 100 ms rows) with the 9:16 track under "portrait". */
  fun framingJSON(r: Result, startMs: Double, width: Double, height: Double, rules: String): JSONObject {
    val f = JSONObject().put("v", 1).put("rules", rules).put("stepMs", stepMs).put("startMs", startMs)
      .put("size", JSONArray(listOf(width, height)))
      .put("portrait", JSONArray(r.rects.map { row -> JSONArray(row.map { r4(it) }) })).put("landscape", JSONArray())
      .put("zoom", r.zoom.zoom).put("ballShare", BallMath.roundTo(r.zoom.share, 3))
    r.verdict?.let { v ->
      f.put("verdict", JSONObject().put("apply", v.reason == null).put("reason", v.reason?.raw ?: "")
        .put("share", BallMath.roundTo(v.share, 3)).put("ballPx", BallMath.roundTo(v.ballPx, 1)).put("pan", BallMath.roundTo(v.pan, 2)))
    }
    return f
  }

  data class Result(
    val rects: List<List<Double>>,
    val zoom: BallZoomResult,
    val ballFrames: Int,
    val trustedFrames: Int,
    val verdict: BallVerdict? = null,
  )

  /** Path → trusted → zoom → camera C (see `BallFraming.compute` in Swift for each argument). */
  fun compute(grid: List<List<BallCandidate>?>, width: Double, height: Double, today: List<List<Double>>,
              native: List<List<Double>>, sport: BallSport = BallSport.basketball, screens: List<List<Double>> = emptyList(),
              players: Double? = null, people: List<List<List<Double>>> = emptyList(),
              stale: List<List<BallCandidate>?> = emptyList()): Result {
    val w = width
    val h = height
    val n = grid.size
    val sp = sport.path
    val path = BallPath.track(grid, w, h, step, sp, if (sport.screens) screens else emptyList(),
      if (sp.personRatio > 0 || sp.headTop > 0 || sp.flat > 0) people else emptyList(), stale)
    val trusted = BallTrust.trusted(path, w, h)
    var followed = BallRuns.keep(trusted, sport.minRun, sport.runGap)
    var main: List<List<List<Double>>> = emptyList()
    val rowsN = (0 until n).map { if (it < people.size) people[it] else emptyList() }
    val f = sport.follow
    if (f != null) {
      followed = BallRuns.courtLock(followed, f.ballCourtMargin, sport.runGap)
      if (people.any { it.isNotEmpty() }) {
        main = BallPlayers.main(rowsN, f.mainShare)
        followed = BallPlayers.courtLock(followed, main, f.courtMargin)
      }
      val cands = if (f.ownMinScore > 0) BallRuns.movingCandidates(grid, if (sport.screens) screens else emptyList(), f.ownMinScore) else null
      followed = BallRuns.keepExits(followed, f.exitTop, f.exitBack, f.exitDx, cands, f.ownStep, f.ownLost, h / w)
      followed = BallPlayers.keepPlay(followed, rowsN, w, h, f.playSpeed, f.playOnPerson, sport.runGap)
    }
    val todayRows = aligned(today, n, w, h)
    val nativeRows = if (native.isEmpty()) listOf(listOf(0.0, 0.0, 1.0, 1.0)) else native
    val zoom = BallZoom.zoom(trusted, todayRows, nativeRows, w, h, sport.zoom, cameraBall = if (sport.minRun > 0) followed else null)
    var aim: List<Double?>? = null
    if (f != null) {
      val crop = min(1.0, (9.0 / 16.0) * h / w) / zoom.zoom
      var a = BallPlayers.aim(followed, main, w, h, f.blend, f.near)
      if (f.keepPair) a = BallPlayers.keepPair(a, followed, main, crop, f.pairPad, f.pairNear, w, h)
      a = BallPlayers.glide(a, followed, main, f.glide, f.courtMargin)
      if (f.hitBox > 0) {
        val boxes = BallPlayers.hitBoxes(followed, main, w, h, f.near, f.hitHorizon)
        a = BallPlayers.keepBox(a, followed, boxes, crop, f.hitPad, f.hitBox < 2)
      }
      a = BallPlayers.nearFallback(a, main, f.nearGap, crop)
      aim = a
    }
    val rects = if (n == 0) emptyList() else BallCamera.rects(followed, todayRows, w, h, zoom.zoom, sport.camera, aim)
    var verdict: BallVerdict? = null
    val v = sport.verdict
    if (v != null) {
      val early = BallVerdicts.before(players, w, h, sport)
      verdict = if (early != null) BallVerdict(early, players, 0.0, 0.0, 0.0)
      else BallVerdicts.after(followed, path, rects, w, h, players, v)
    }
    return Result(rects, zoom, path.count { it != null }, trusted.count { it != null }, verdict)
  }

  internal fun aligned(rows: List<List<Double>>, n: Int, width: Double, height: Double): List<List<Double>> {
    val good = rows.filter { it.size == 4 }
    if (good.isEmpty()) {
      val w = min(1.0, (9.0 / 16.0) * height / width)
      val h = min(1.0, (16.0 / 9.0) * width / height)
      return List(n) { listOf((1 - w) / 2, (1 - h) / 2, w, h) }
    }
    return (0 until n).map { good[min(it, good.size - 1)] }
  }
}
