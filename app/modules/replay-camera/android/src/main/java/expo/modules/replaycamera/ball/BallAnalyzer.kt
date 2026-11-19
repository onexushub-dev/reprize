package expo.modules.replaycamera.ball

import android.content.Context
import android.os.Process
import android.util.Log
import expo.modules.replaycamera.core.FramingMotion
import expo.modules.replaycamera.core.Heat
import expo.modules.replaycamera.core.ScanTicks
import expo.modules.replaycamera.focus.ClipScan
import expo.modules.replaycamera.focus.FocusAnalyzer
import expo.modules.replaycamera.focus.FocusFrames
import expo.modules.replaycamera.focus.FocusSample
import expo.modules.replaycamera.focus.Pixels
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Collections

/**
 * Seguir a Bola analysis (the Android side of `BallAnalyzer.swift`): the sport's detector on the cut at 5 fps — the whole
 * frame and every 416 px tile — then `BallFraming` (path, trusted points, zoom, camera) into `<clip>.ball.json`, the
 * Modo Foco file's format with the 9:16 track under "portrait". The detections are kept in `<clip>.balldet.json`, so a
 * changed cut, a cancel or a stop for heat continues from what was found. When the Jogadores file is missing, has no
 * person boxes or does not cover the cut, the same pass finds the people and writes it.
 *
 * Heat as on the iPhone: wait to start while serious or worse (a cut up to `shortCutMs` only while critical), always
 * finish once started, stop at critical keeping the detections. One analysis at a time (`ClipScan.lock`).
 */
object BallAnalyzer {
  private const val TAG = "ReprizeBall"
  const val shortCutMs = 15_000.0
  /** Below the UI and playback, but not THREAD_PRIORITY_BACKGROUND (10), which pins the work to the little cores. */
  private const val ANALYSIS_PRIORITY = 5

  /** Jogadores' range, interval and people file, for the pass to make the Jogadores file; no range = never. */
  class Players(val startMs: Double = 0.0, val endMs: Double = 0.0, val everyMs: Double = 100.0, val peoplePath: String = "")

  class Outcome(
    val ready: Boolean, val analysed: Int, val reused: Int, val ballFrames: Int, val trustedFrames: Int, val ballShare: Double,
    val zoom: Double, val elapsedMs: Double, val verdict: String, val focus: String, val stages: ClipScan.Stages,
    val panP95: Double, val turnsPer10s: Double, val playSeconds: Double = -1.0,
  )

  /** What one run will do, decided before any frame is read. */
  internal class Plan(
    val hasPeople: Boolean, val makeFocus: Boolean, val detModel: String, val ballWidth: Int, val ballHeight: Int,
    val dets: List<BallFraming.Detection>, val screens: List<List<Double>>, val phase: Int, val missing: List<Double>,
    val total: Int, val reused: Int, val peopleEvery: Double, val keptPeople: List<FocusSample>, val peopleTicks: List<Double>,
  )

  /** Progress for the card: `state` "cooling", "running", "framing". */
  @Volatile var emit: ((clipPath: String, done: Int, total: Int, state: String) -> Unit)? = null

  private val cancelled: MutableSet<String> = Collections.synchronizedSet(HashSet())
  /** Kept between runs; one sport's model at a time. Used under `ClipScan.lock` only. */
  private var detector: BallDetector? = null

  fun cancel(clipPath: String) { cancelled.add(clipPath) }

  private fun isCancelled(clipPath: String) = cancelled.contains(clipPath)

  /** Whether a Jogadores file's rows (from its `startMs`, one per `stepMs`) reach over `startMs`…`endMs`. */
  internal fun covers(file: JSONObject, startMs: Double, endMs: Double): Boolean {
    val rows = file.optJSONArray("people") ?: return false
    val from = file.optDouble("startMs", 0.0)
    val step = file.optDouble("stepMs", 100.0)
    return from <= startMs + 0.5 && from + rows.length() * step >= endMs - step - 0.5
  }

  internal fun plan(focus: JSONObject?, det: JSONObject?, people: JSONObject?, width: Int, height: Int, startMs: Double,
                    endMs: Double, sport: BallSport, maxWidth: Int, players: Players, focusPath: String): Plan {
    val hasPeople = focus != null && focus.optInt("v") == 1 && focus.has("people") && covers(focus, startMs, endMs)
    val makeFocus = !hasPeople && players.endMs > players.startMs && focusPath.isNotEmpty()
    val (dw, dh) = ClipScan.ballSize(width, height, maxWidth)
    val scaled = dw != width || dh != height
    val detModel = if (scaled) "${sport.modelId}@$maxWidth" else sport.modelId
    val dets = BallFraming.detections(det, width, height, detModel)
    val screens = if (dets.isEmpty()) emptyList() else BallFraming.screens(det)
    val phase = BallFraming.phase(startMs, endMs, dets)
    val missing = BallFraming.missingTicks(startMs, endMs, phase, dets)
    val total = (BallFraming.rows(startMs, endMs) - phase + BallFraming.step - 1) / BallFraming.step
    val peopleEvery = maxOf(FocusAnalyzer.stepMs, players.everyMs)
    val kept = if (makeFocus) FocusFrames.read(people, width, height) else emptyList()
    val peopleTicks = if (makeFocus) ScanTicks.missing(ScanTicks.ticks(players.startMs, players.endMs, peopleEvery), kept.map { it.tMs },
      peopleEvery) else emptyList()
    return Plan(hasPeople, makeFocus, detModel, dw, dh, dets, screens, phase, missing, maxOf(0, total), maxOf(0, total) - missing.size,
      peopleEvery, kept, peopleTicks)
  }

  fun analyze(context: Context, clipPath: String, startMs: Double, endMs: Double, detPath: String, outPath: String, focusPath: String,
              sport: BallSport, maxWidth: Int, players: Players, sideBySide: Boolean): Outcome =
    synchronized(ClipScan.lock) {
      try {
        Process.setThreadPriority(ANALYSIS_PRIORITY)
        val video = ClipScan.Video.load(clipPath)
        run(context, video, clipPath, startMs, if (endMs > startMs) minOf(endMs, video.durationMs) else video.durationMs, detPath,
          outPath, focusPath, sport, maxWidth, players, sideBySide)
      } finally {
        cancelled.remove(clipPath)
      }
    }

  private fun run(context: Context, video: ClipScan.Video, clipPath: String, startMs: Double, endMs: Double, detPath: String,
                  outPath: String, focusPath: String, sport: BallSport, maxWidth: Int, want: Players, sideBySide: Boolean): Outcome {
    val started = System.nanoTime()
    val w = video.width
    val h = video.height
    val stages = ClipScan.Stages()
    fun elapsed() = (System.nanoTime() - started) / 1e6
    val p = plan(readJSON(focusPath), readJSON(detPath), readJSON(want.peoplePath), w, h, startMs, endMs, sport, maxWidth, want, focusPath)
    // Test 47a, before any frame is analysed: players too small for the 9:16 output = recorded too far.
    if (p.hasPeople) {
      val early = BallVerdicts.before(playersHeight(focusPath), w.toDouble(), h.toDouble(), sport)
      if (early != null) return Outcome(true, 0, 0, 0, 0, 0.0, 1.0, elapsed(), early.raw, "", stages, 0.0, 0.0)
    }
    var dets = p.dets
    var screens = p.screens
    val foundPeople = ArrayList<FocusSample>()
    if (p.missing.isNotEmpty() || p.peopleTicks.isNotEmpty()) {
      // the card counts every picture the pass still has to look at, for the ball or for the players
      val all = p.total + p.peopleTicks.size
      waitUntilCool(context, clipPath, p.reused, all, endMs - startMs <= shortCutMs)
      var job: ClipScan.BallJob? = null
      if (p.missing.isNotEmpty()) {
        val d = detector?.takeIf { it.modelId == sport.modelId } ?: run {
          detector?.close()
          detector = null
          BallDetector(context, sport.modelId).also { detector = it }
        }
        job = ClipScan.BallJob(p.missing, d, p.ballWidth, p.ballHeight, sport.screens)
      }
      val found = ArrayList<BallFraming.Detection>()
      val thumbs = ArrayList<Pixels.Grey>()
      fun keepDets() = writeJSON(BallFraming.detectionsJSON(dets + found, w, h, p.detModel, screens), detPath)
      fun keepPeople() = writeJSON(FocusFrames.json(FocusFrames.merged(p.keptPeople, foundPeople), w, h), want.peoplePath)
      emit?.invoke(clipPath, p.reused, all, "running")
      try {
        ClipScan.run(context, video, p.peopleTicks, p.peopleEvery, job, sideBySide, stages, { isCancelled(clipPath) },
          { Heat.now(context) == Heat.Level.CRITICAL }) { f ->
          f.people?.let {
            foundPeople.add(it)
            if (foundPeople.size % 25 == 0) keepPeople()
          }
          f.thumbnail?.let { thumbs.add(it) }
          f.ball?.let {
            found.add(it)
            if (found.size % 25 == 0) keepDets()
          }
          val seen = found.size + foundPeople.size
          if (seen % 5 == 0) emit?.invoke(clipPath, p.reused + seen, all, "running")
        }
        // most of the cut seen in this run: its screens replace the kept ones
        if (sport.screens && thumbs.size >= 10 && thumbs.size * 2 >= p.total) {
          screens = BallScreen.boxes(thumbs.map { it.pixels }, thumbs[0].width, thumbs[0].height)
        }
      } finally {
        // whatever happened, keep what was found
        if (found.isNotEmpty()) keepDets()
        if (foundPeople.isNotEmpty()) keepPeople()
      }
      dets = dets + found
    }

    emit?.invoke(clipPath, p.total, p.total, "framing")
    val framed = System.nanoTime()
    var focus = ""
    if (p.makeFocus) {
      val frames = FocusAnalyzer.inRange(FocusFrames.merged(p.keptPeople, foundPeople), want.startMs, want.endMs)
      val file = FocusAnalyzer.write(frames, want.startMs, want.endMs, p.peopleEvery, w.toDouble(), h.toDouble(), focusPath, false)
      focus = if (file.first) "ready" else "none"
    }
    val playersH = playersHeight(focusPath)
    val (grid, _) = BallFraming.grids(startMs, endMs, p.phase, dets)
    val landscape = w >= h
    val today = todayRows(focusPath, startMs, grid.size, landscape)
    val people = if (sport.follow == null && sport.path.personRatio <= 0) emptyList() else peopleRows(focusPath, startMs, grid.size)
    val r = BallFraming.compute(grid, w.toDouble(), h.toDouble(), today.first, today.second, sport, screens, playersH, people)
    if (r.rects.isEmpty()) throw ClipScan.Unreadable("no framing")
    val file = BallFraming.framingJSON(r, startMs, w.toDouble(), h.toDouble(), sport.rules).put("endMs", endMs)
    writeAtomic(file.toString(), outPath)
    stages.path += (System.nanoTime() - framed) / 1e6
    val motion = FramingMotion.stats(r.rects, BallFraming.stepMs)
    val verdict = r.verdict
    val outcome = Outcome(true, grid.count { it != null }, p.reused, r.ballFrames, r.trustedFrames, r.zoom.share, r.zoom.zoom, elapsed(),
      verdict?.reason?.raw ?: "", focus, stages, motion.first, motion.second,
      verdict?.let { it.share * r.rects.size / 10.0 } ?: -1.0)
    Log.i(TAG, "${File(clipPath).name}: ${outcome.analysed} frames (${outcome.reused} kept), ball ${"%.0f".format(outcome.ballShare * 100)}%, " +
      "zoom ${outcome.zoom}, ${"%.1f".format(outcome.elapsedMs / 1000)} s, ${detector?.backend ?: "-"}, verdict '${outcome.verdict}', focus '$focus'")
    return outcome
  }

  /** Waits (cancellable) while the phone is serious or worse (critical for a short cut), the card showing "Aguardando". */
  private fun waitUntilCool(context: Context, clipPath: String, done: Int, total: Int, short: Boolean) {
    var told = false
    while (Heat.mustWait(Heat.now(context), short)) {
      if (isCancelled(clipPath)) throw ClipScan.Cancelled()
      if (!told) { emit?.invoke(clipPath, done, total, "cooling"); told = true }
      Thread.sleep(2000)
    }
  }

  /** The players' median height (share of the frame height) that today's Modo Foco analysis kept, if any. */
  private fun playersHeight(focusPath: String): Double? {
    val f = readJSON(focusPath) ?: return null
    return if (f.has("playersHeight")) f.getDouble("playersHeight") else null
  }

  private fun rowsOf(a: JSONArray): List<List<Double>> = (0 until a.length()).map { i -> a.getJSONArray(i).let { r -> (0 until r.length()).map { r.getDouble(it) } } }

  /** Today's person boxes for the cut's rows; none when the Modo Foco file has none. */
  private fun peopleRows(focusPath: String, startMs: Double, n: Int): List<List<List<Double>>> {
    val f = readJSON(focusPath) ?: return emptyList()
    if (f.optInt("v") != 1 || !f.has("startMs")) return emptyList()
    val rows = f.optJSONArray("people") ?: return emptyList()
    val off = Math.round((startMs - f.getDouble("startMs")) / BallFraming.stepMs).toInt()
    if (off < 0 || off >= rows.length()) return emptyList()
    return (off until minOf(rows.length(), off + n)).map { i -> rowsOf(rows.getJSONArray(i)).filter { it.size == 4 } }
  }

  /** Today's Modo Foco rows for the cut: portrait (the camera's fallback) and the video's own orientation (today's zoom). */
  private fun todayRows(focusPath: String, startMs: Double, n: Int, landscape: Boolean): Pair<List<List<Double>>, List<List<Double>>> {
    val f = readJSON(focusPath) ?: return Pair(emptyList(), emptyList())
    if (f.optInt("v") != 1 || !f.has("startMs")) return Pair(emptyList(), emptyList())
    val portrait = f.optJSONArray("portrait")?.let { rowsOf(it) } ?: return Pair(emptyList(), emptyList())
    val native = f.optJSONArray(if (landscape) "landscape" else "portrait")?.let { rowsOf(it) } ?: emptyList()
    val off = Math.round((startMs - f.getDouble("startMs")) / BallFraming.stepMs).toInt()
    fun slice(rows: List<List<Double>>) = if (off < 0 || off >= rows.size) rows else rows.subList(off, minOf(rows.size, off + n))
    return Pair(slice(portrait), slice(native))
  }

  private fun readJSON(path: String): JSONObject? {
    if (path.isEmpty()) return null
    return try { JSONObject(File(path).readText()) } catch (e: Exception) { null }
  }

  private fun writeJSON(o: JSONObject, path: String) {
    if (path.isEmpty()) return
    try { writeAtomic(o.toString(), path) } catch (e: Exception) { Log.w(TAG, "cannot keep $path: $e") }
  }

  /** Never a half-written file to read. */
  private fun writeAtomic(text: String, path: String) {
    val tmp = File("$path.tmp")
    tmp.writeText(text)
    if (!tmp.renameTo(File(path))) { tmp.delete(); throw ClipScan.Unreadable("cannot write $path") }
  }
}
