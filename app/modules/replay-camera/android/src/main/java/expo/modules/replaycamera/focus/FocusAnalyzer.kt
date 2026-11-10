package expo.modules.replaycamera.focus

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.media.MediaMetadataRetriever
import android.os.Build
import android.os.Process
import android.util.Log
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.objectdetector.ObjectDetector
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Collections

/**
 * Modo Foco analysis, the Android port of FocusAnalyzer.swift: one frame every 100 ms between `startMs` and `endMs`,
 * people found with an on-device detector (EfficientDet-Lite0 through MediaPipe, "person" only), the framing computed by
 * the same rules as the iPhone (`FocusPath`) and written next to the clip (<clip>.focus.json, same format).
 * One analysis at a time, at background priority. Every step logs to logcat (tag `ReprizeFocus`).
 */
object FocusAnalyzer {
  private const val TAG = "ReprizeFocus"
  /** Below the UI and playback, but not THREAD_PRIORITY_BACKGROUND (10), which pins the work to the little cores (3x slower). */
  private const val ANALYSIS_PRIORITY = 5
  private const val MODEL = "efficientdet_lite0_int8.tflite"
  /**
   * One frame every 200 ms (the iPhone: 100 ms). The framing is smoothed over 0.6-1.2 s, so analysing half the frames moves the
   * framing by 1-4% of the width and 0.2 of zoom at most on the test clips, less than the two detectors differ, in half the time.
   */
  const val STEP_MS = 200.0
  private const val MIN_CONFIDENCE = 0.3f
  /** The longest side of the frame given to the detector; a half-frame tile of it is what the detector sees up close. */
  private const val FRAME_LONG_SIDE = 1280
  /** Tiles scanned per sample, round-robin over the nine (the iPhone scans all nine; on a phone CPU that is ~1 s a frame). */
  private const val TILES_PER_SAMPLE = 1
  private val lock = Any()
  private val cancelled: MutableSet<String> = Collections.synchronizedSet(HashSet())

  class Cancelled : Exception()
  class Unreadable(message: String) : Exception(message)

  data class Outcome(val ready: Boolean, val frames: Int, val framesWithPeople: Int, val meanPeople: Double, val elapsedMs: Double)

  /** Stops the analysis of this clip if it is waiting or running; it then fails with `Cancelled`. */
  fun cancel(clipPath: String) { cancelled.add(clipPath) }

  private fun isCancelled(clipPath: String) = cancelled.contains(clipPath)

  fun analyze(context: Context, clipPath: String, startMs: Double, endMs: Double, outPath: String, debug: Boolean): Outcome =
    synchronized(lock) {
      try {
        Process.setThreadPriority(ANALYSIS_PRIORITY)
        run(context, clipPath, startMs, endMs, outPath, debug)
      } finally {
        cancelled.remove(clipPath)
      }
    }

  private fun run(context: Context, clipPath: String, startMs: Double, endMs: Double, outPath: String, debug: Boolean): Outcome {
    val started = System.nanoTime()
    if (isCancelled(clipPath)) throw Cancelled()
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(clipPath)
      val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      val storedW = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
      val storedH = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
      val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0
      if (storedW <= 0 || storedH <= 0 || durationMs <= 0) throw Unreadable("no video")
      val quarter = rotation == 90 || rotation == 270
      val width = (if (quarter) storedH else storedW).toDouble()
      val height = (if (quarter) storedW else storedH).toDouble()
      val stop = if (endMs > startMs) minOf(endMs, durationMs) else durationMs

      val detector = createDetector(context)
      val frames = ArrayList<FocusSample>()
      var detectNs = 0L
      var people = 0
      // One thread fetches the frames while this one finds the people in the previous one: about half the time.
      val queue = java.util.concurrent.ArrayBlockingQueue<Pair<Double, Bitmap?>>(2)
      val end = Pair(-1.0, null as Bitmap?)
      val stopFetching = java.util.concurrent.atomic.AtomicBoolean(false)
      val fetchFailure = java.util.concurrent.atomic.AtomicReference<Throwable?>(null)
      val fetcher = Thread({
        Process.setThreadPriority(ANALYSIS_PRIORITY)
        var delivered = 0
        fun put(item: Pair<Double, Bitmap?>): Boolean {
          while (!queue.offer(item, 200, java.util.concurrent.TimeUnit.MILLISECONDS)) if (stopFetching.get()) return false
          return true
        }
        try {
          try {
            FrameDecoder(clipPath, startMs, stop, STEP_MS, rotation, FRAME_LONG_SIDE).run({ stopFetching.get() }) { pts, bitmap ->
              delivered += 1
              put(Pair(pts, bitmap))
            }
          } catch (e: Throwable) {
            // A phone whose decoder does not give frames this way: ask for them one by one (slow, but it works).
            if (delivered > 0) throw e
            Log.w(TAG, "sequential decoding failed (${e.message}), using the frame by frame fallback")
            var tick = startMs
            while (tick < stop && !stopFetching.get()) {
              if (!put(Pair(tick, frameAt(retriever, tick, rotation, storedW, storedH)))) break
              tick += STEP_MS
            }
          }
        } catch (e: Throwable) {
          fetchFailure.set(e)
        } finally {
          while (!stopFetching.get() && !queue.offer(end, 200, java.util.concurrent.TimeUnit.MILLISECONDS)) Unit
        }
      }, "focus-frames")
      try {
        fetcher.start()
        var index = 0
        while (true) {
          if (isCancelled(clipPath)) throw Cancelled()
          val (tick, bitmap) = queue.poll(200, java.util.concurrent.TimeUnit.MILLISECONDS) ?: continue
          if (tick < 0) break
          if (bitmap != null) {
            val t1 = System.nanoTime()
            val found = detect(detector, bitmap, index)
            detectNs += System.nanoTime() - t1
            if (bitmap.isRecycled.not()) bitmap.recycle()
            people += found.size
            frames.add(FocusSample(tick, found))
          }
          index += 1
        }
        fetchFailure.get()?.let { throw Unreadable("frames: $it") }
      } finally {
        stopFetching.set(true)
        fetcher.join(2000)
        queue.forEach { it.second?.recycle() }
        detector.close()
      }
      if (frames.isEmpty()) throw Unreadable("no frames")

      val samples = FocusGrid.samples(frames, startMs, if (endMs > startMs) endMs else Double.POSITIVE_INFINITY, STEP_MS)
      val landscape = width >= height
      val main = if (landscape) FocusAspect.LANDSCAPE else FocusAspect.PORTRAIT
      val other = if (landscape) FocusAspect.PORTRAIT else FocusAspect.LANDSCAPE
      val mainRects = FocusPath.compute(samples, width, height, main, zoom = true, t = FocusTuning.ACTION)
      val otherRects = if (mainRects == null) null else FocusPath.compute(samples, width, height, other, zoom = false, t = FocusTuning.ACTION)

      val file = JSONObject()
        .put("v", 1).put("rules", "v15-acao-zoom110").put("stepMs", STEP_MS).put("startMs", startMs)
        .put("size", JSONArray().put(width).put(height))
        .put("landscape", rows(if (landscape) mainRects else otherRects))
        .put("portrait", rows(if (landscape) otherRects else mainRects))
      if (debug) {
        file.put("samples", JSONArray(samples.map { s ->
          JSONArray().put(s.tMs).put(JSONArray(s.boxes.map { JSONArray(listOf(r4(it.x), r4(it.y), r4(it.width), r4(it.height))) }))
        }))
      }
      val tmp = File("$outPath.tmp")
      tmp.writeText(file.toString())
      if (!tmp.renameTo(File(outPath))) { tmp.delete(); throw Unreadable("cannot write $outPath") } // never a half-written file to read

      val elapsed = (System.nanoTime() - started) / 1e6
      val withPeople = frames.count { it.boxes.isNotEmpty() }
      Log.i(TAG, "timing: detection ${detectNs / 1_000_000 / frames.size} ms a frame")
      Log.i(TAG, "${File(clipPath).name}: ${frames.size} frames, $withPeople with people, ${"%.1f".format(people.toDouble() / frames.size)} per frame, " +
        "${"%.1f".format(elapsed / 1000)} s, ready=${mainRects != null}")
      return Outcome(mainRects != null, frames.size, withPeople, people.toDouble() / frames.size, elapsed)
    } finally {
      retriever.release()
    }
  }

  /**
   * CPU only: the GPU delegate (MediaPipe's own GL thread) crashed the whole app on the test phone, and a native crash
   * cannot be caught. Speed comes from fewer tiles per frame instead.
   */
  private fun createDetector(context: Context): ObjectDetector =
    ObjectDetector.createFromOptions(context, ObjectDetector.ObjectDetectorOptions.builder()
      .setBaseOptions(BaseOptions.builder().setModelAssetPath(MODEL).setDelegate(Delegate.CPU).build())
      .setRunningMode(RunningMode.IMAGE)
      .setScoreThreshold(MIN_CONFIDENCE)
      .setCategoryAllowlist(listOf("person"))
      .setMaxResults(30)
      .build())

  private fun rows(rects: List<FocusRect>?): JSONArray =
    JSONArray((rects ?: emptyList()).map { JSONArray(listOf(r4(it.x), r4(it.y), r4(it.width), r4(it.height))) })

  private fun r4(v: Double) = Math.round(v * 10000.0) / 10000.0

  /** The upright frame at `tMs`, scaled down. Turned like ClipThumbnail: only when the device did not already do it. */
  private fun frameAt(retriever: MediaMetadataRetriever, tMs: Double, rotation: Int, storedW: Int, storedH: Int): Bitmap? {
    val timeUs = (tMs * 1000).toLong()
    val frame = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1)
      retriever.getScaledFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST, FRAME_LONG_SIDE, FRAME_LONG_SIDE)
    else retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST)) ?: return null
    val quarter = rotation == 90 || rotation == 270
    val alreadyTurned = quarter && storedW != storedH && (frame.width > frame.height) == (storedH > storedW)
    val upright = if (rotation == 0 || alreadyTurned) frame else
      Bitmap.createBitmap(frame, 0, 0, frame.width, frame.height, Matrix().apply { postRotate(rotation.toFloat()) }, true)
    // The detector only takes ARGB_8888; the retriever may hand back RGB_565 or a hardware bitmap.
    if (upright.config == Bitmap.Config.ARGB_8888) return upright
    return upright.copy(Bitmap.Config.ARGB_8888, false).also { if (upright !== frame) upright.recycle(); frame.recycle() }
  }

  /** The whole frame plus the nine half-frame tiles (so far players are found), merged into one box per person. */
  private fun detect(detector: ObjectDetector, frame: Bitmap, index: Int): List<FocusBox> {
    val w = frame.width
    val h = frame.height
    val found = ArrayList<Pair<FocusBox, Double>>()
    fun run(bitmap: Bitmap, x0: Double, y0: Double, sw: Double, sh: Double, tile: Boolean) {
      val result = detector.detect(BitmapImageBuilder(bitmap).build())
      for (d in result.detections()) {
        val score = d.categories().firstOrNull()?.score()?.toDouble() ?: continue
        if (score < MIN_CONFIDENCE) continue
        val b = d.boundingBox()
        // Back to 0..1 of the whole frame, origin top-left.
        val box = FocusBox(x0 + b.left / bitmap.width * sw, y0 + b.top / bitmap.height * sh,
          (b.right - b.left) / bitmap.width * sw, (b.bottom - b.top) / bitmap.height * sh)
        if (box.width <= 0 || box.height <= 0) continue
        if (!tile) { found.add(Pair(box, score)); continue }
        val midX = box.x + box.width / 2
        val midY = box.y + box.height / 2
        val inside = midX >= x0 - 0.02 && midX <= x0 + sw + 0.02 && midY >= y0 - 0.02 && midY <= y0 + sh + 0.02
        if (inside && ScanTiles.plausible(box, score, w.toDouble(), h.toDouble())) found.add(Pair(box, score))
      }
    }
    run(frame, 0.0, 0.0, 1.0, 1.0, false)
    for (r in ScanTiles.tiles(index, TILES_PER_SAMPLE)) {
      val top = 1 - r.yBottom - r.height // the regions are given with the origin at the bottom-left
      val tile = Bitmap.createBitmap(frame, (r.x * w).toInt(), (top * h).toInt(), (r.width * w).toInt(), (r.height * h).toInt())
      run(tile, r.x, top, r.width, r.height, true)
      tile.recycle()
    }
    return PersonBoxes.merge(found)
  }
}
