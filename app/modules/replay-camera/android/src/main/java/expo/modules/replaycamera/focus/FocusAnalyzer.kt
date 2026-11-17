package expo.modules.replaycamera.focus

import android.content.Context
import android.os.Process
import android.util.Log
import expo.modules.replaycamera.core.FramingMotion
import expo.modules.replaycamera.core.ScanTicks
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Collections

/**
 * Modo Foco: Jogadores (the Android side of `FocusAnalyzer.swift`). One picture every `everyMs` between `startMs` and
 * `endMs` through the shared pass (`ClipScan`), people found by `PeopleDetector` on the whole frame and the nine
 * half-frame tiles, the framing computed by the iPhone's rules (`FocusPath`) and written next to the clip
 * (<clip>.focus.json, the same format: tracks, person boxes per row, the players' median height). The people of each
 * analysed picture are kept in <clip>.people.json, so an analysis that was stopped goes on from where it was. One
 * analysis at a time across Jogadores and Bola (`ClipScan.lock`). Logs to logcat (tag `ReprizeFocus`).
 */
object FocusAnalyzer {
  private const val TAG = "ReprizeFocus"
  /** Below the UI and playback, but not THREAD_PRIORITY_BACKGROUND (10), which pins the work to the little cores (3x slower). */
  private const val ANALYSIS_PRIORITY = 5
  /** The file's rows: one every 100 ms whatever the analysis interval (as the iPhone's). */
  const val stepMs = 100.0
  private val cancelled: MutableSet<String> = Collections.synchronizedSet(HashSet())

  /** Progress for the card and the tag (Marcus, 2026-11-17): `done` of `total` pictures of the range, kept ones done. */
  @Volatile var emit: ((clipPath: String, done: Int, total: Int) -> Unit)? = null

  data class Outcome(
    val ready: Boolean, val frames: Int, val reused: Int, val framesWithPeople: Int, val meanPeople: Double, val elapsedMs: Double,
    val stages: ClipScan.Stages, val panP95: Double, val turnsPer10s: Double,
  )

  /** Stops the analysis of this clip if it is waiting or running; it then fails with `ClipScan.Cancelled`. */
  fun cancel(clipPath: String) { cancelled.add(clipPath) }

  private fun isCancelled(clipPath: String) = cancelled.contains(clipPath)

  /**
   * `peoplePath`: where the people of each analysed picture are kept ("" = not kept). `nextCourt`: leave the people on
   * the next court out of the framing (`NextCourt`; beach tennis).
   */
  fun analyze(context: Context, clipPath: String, startMs: Double, endMs: Double, outPath: String, peoplePath: String, debug: Boolean,
              everyMs: Double, nextCourt: Boolean = false): Outcome =
    synchronized(ClipScan.lock) {
      try {
        Process.setThreadPriority(ANALYSIS_PRIORITY)
        run(context, clipPath, startMs, endMs, outPath, peoplePath, debug, everyMs, nextCourt)
      } finally {
        cancelled.remove(clipPath)
      }
    }

  private fun run(context: Context, clipPath: String, startMs: Double, endMs: Double, outPath: String, peoplePath: String,
                  debug: Boolean, everyMs: Double, nextCourt: Boolean): Outcome {
    val started = System.nanoTime()
    if (isCancelled(clipPath)) throw ClipScan.Cancelled()
    val video = ClipScan.Video.load(clipPath)
    val every = maxOf(stepMs, everyMs)
    val end = if (endMs > startMs) endMs else video.durationMs
    val kept = FocusFrames.read(readJSON(peoplePath), video.width, video.height)
    val ticks = ScanTicks.ticks(startMs, end, every)
    val missing = ScanTicks.missing(ticks, kept.map { it.tMs }, every)
    val total = ticks.size
    var analysed = 0
    fun tell() { emit?.invoke(clipPath, maxOf(0, total - missing.size) + analysed, total) }
    tell()
    val stages = ClipScan.Stages()
    val found = ArrayList<FocusSample>()
    fun keep() {
      if (peoplePath.isEmpty()) return
      try {
        writeAtomic(FocusFrames.json(FocusFrames.merged(kept, found), video.width, video.height).toString(), peoplePath)
      } catch (e: Exception) {
        Log.w(TAG, "cannot keep $peoplePath: $e")
      }
    }
    try {
      ClipScan.run(context, video, missing, every, null, false, stages, { isCancelled(clipPath) }, { false }) { f ->
        analysed++
        tell()
        f.people?.let {
          found.add(it)
          if (found.size % 25 == 0) keep()
        }
      }
    } finally {
      if (found.isNotEmpty()) keep() // whatever happened, keep what was found
    }
    val frames = inRange(FocusFrames.merged(kept, found), startMs, end)
    if (frames.isEmpty()) throw ClipScan.Unreadable("no frames")
    val framed = System.nanoTime()
    val file = write(frames, startMs, endMs, every, video.width.toDouble(), video.height.toDouble(), outPath, debug, nextCourt)
    stages.path += (System.nanoTime() - framed) / 1e6
    val motion = FramingMotion.stats(file.second.map { listOf(it.x, it.y, it.width, it.height) }, stepMs)
    val people = frames.sumOf { it.boxes.size }
    val outcome = Outcome(file.first, frames.size, frames.size - found.size, frames.count { it.boxes.isNotEmpty() },
      people.toDouble() / frames.size, (System.nanoTime() - started) / 1e6, stages, motion.first, motion.second)
    Log.i(TAG, "${File(clipPath).name}: ${frames.size} frames (${outcome.reused} kept), ${outcome.framesWithPeople} with people, " +
      "${"%.1f".format(outcome.meanPeople)} per frame, ${"%.1f".format(outcome.elapsedMs / 1000)} s, ready=${file.first}")
    return outcome
  }

  /** The kept pictures that belong to a range. */
  fun inRange(frames: List<FocusSample>, startMs: Double, endMs: Double): List<FocusSample> =
    frames.filter { it.tMs >= startMs - 0.5 && it.tMs < endMs }

  /**
   * The Jogadores file of a range from its analysed pictures (in time order). `endMs` as the analysis was asked (at or
   * before `startMs` = to the end of the clip). Returns whether there is a framing, and its rects in the video's own
   * orientation. `nextCourt`: the framing leaves out the people on the next court (`NextCourt`); the file's people stay
   * as found.
   */
  fun write(frames: List<FocusSample>, startMs: Double, endMs: Double, everyMs: Double, width: Double, height: Double,
            outPath: String, debug: Boolean, nextCourt: Boolean = false): Pair<Boolean, List<FocusRect>> {
    // Row k of the file is at startMs + k × 100 ms, whatever gaps the frames had.
    val samples = FocusGrid.samples(frames, startMs, if (endMs > startMs) endMs else Double.POSITIVE_INFINITY, stepMs).toMutableList()
    // At 5 fps the last analysed frame can be up to 200 ms before the end; its people are held to the end so the file
    // has as many rows as at 10 fps (Bola reads them row by row).
    val last = samples.lastOrNull()
    if (everyMs > stepMs && endMs > startMs && last != null) {
      var tick = last.tMs + stepMs
      while (tick < endMs - 0.5) { samples.add(FocusSample(tick, last.boxes)); tick += stepMs }
    }
    val landscape = width >= height
    val main = if (landscape) FocusAspect.LANDSCAPE else FocusAspect.PORTRAIT
    val other = if (landscape) FocusAspect.PORTRAIT else FocusAspect.LANDSCAPE
    val framed = if (nextCourt) samples.map { FocusSample(it.tMs, NextCourt.keep(it.boxes)) } else samples
    val mainRects = FocusPath.compute(framed, width, height, main, zoom = true, t = FocusTuning.ACTION)
    val otherRects = if (mainRects == null) null else FocusPath.compute(framed, width, height, other, zoom = false, t = FocusTuning.ACTION)
    val file = JSONObject()
      .put("v", 1).put("rules", "v15-acao-zoom110").put("stepMs", stepMs).put("startMs", startMs)
      .put("size", JSONArray(listOf(width, height)))
      .put("landscape", rows(if (landscape) mainRects else otherRects))
      .put("portrait", rows(if (landscape) otherRects else mainRects))
    // Test 47a: the players' median height (share of the frame height, every box of every frame), for Bola's verdict.
    val heights = frames.flatMap { f -> f.boxes.map { it.height } }.sorted()
    if (heights.isNotEmpty()) {
      val mid = heights.size / 2
      file.put("playersHeight", r4(if (heights.size % 2 == 1) heights[mid] else (heights[mid - 1] + heights[mid]) / 2))
    }
    // Test 49: the person boxes per row (x, y, width, height, top-left), for Bola's rules.
    file.put("people", JSONArray(samples.map { s -> JSONArray(s.boxes.map { box(it) }) }))
    if (debug) file.put("samples", JSONArray(samples.map { s -> JSONArray().put(s.tMs).put(JSONArray(s.boxes.map { box(it) })) }))
    writeAtomic(file.toString(), outPath)
    return Pair(mainRects != null, mainRects ?: emptyList())
  }

  private fun box(b: FocusBox) = JSONArray(listOf(r4(b.x), r4(b.y), r4(b.width), r4(b.height)))

  private fun rows(rects: List<FocusRect>?): JSONArray =
    JSONArray((rects ?: emptyList()).map { JSONArray(listOf(r4(it.x), r4(it.y), r4(it.width), r4(it.height))) })

  /** Swift's `.rounded()` (half away from zero) to 4 decimals. */
  private fun r4(v: Double) = (if (v >= 0) Math.floor(v * 10000 + 0.5) else -Math.floor(-v * 10000 + 0.5)) / 10000

  private fun readJSON(path: String): JSONObject? {
    if (path.isEmpty()) return null
    return try { JSONObject(File(path).readText()) } catch (e: Exception) { null }
  }

  /** Never a half-written file to read. */
  private fun writeAtomic(text: String, path: String) {
    val tmp = File("$path.tmp")
    tmp.writeText(text)
    if (!tmp.renameTo(File(path))) { tmp.delete(); throw ClipScan.Unreadable("cannot write $path") }
  }
}
