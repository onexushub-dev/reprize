package expo.modules.replaycamera.focus

import android.content.Context
import android.media.MediaMetadataRetriever
import android.util.Log
import expo.modules.replaycamera.ball.BallDetect
import expo.modules.replaycamera.ball.BallDetector
import expo.modules.replaycamera.ball.BallFraming
import expo.modules.replaycamera.ball.BallScreen
import expo.modules.replaycamera.core.ScanTicks
import java.util.concurrent.Executors
import java.util.concurrent.Future

/**
 * The one pass over a clip's frames that Jogadores and Bola share (the Android side of `ClipScan.swift`): the clip is
 * decoded once, and each kept frame goes to the people detector, to the ball detector, or to both at the same time.
 * What each mode does with what is found stays in `FocusAnalyzer` and `BallAnalyzer`. One analysis at a time,
 * whichever mode asked (`lock`).
 */
object ClipScan {
  private const val TAG = "ReprizeScan"

  /** Held for the whole of an analysis, Jogadores or Bola. */
  val lock = Any()

  class Cancelled : Exception()
  class Unreadable(message: String) : Exception(message)
  /** Stopped at `critical` (Bola only). */
  class Hot : Exception()
  /** The decoder or a detector kept failing. */
  class Interrupted(message: String) : Exception(message)

  /** Milliseconds per stage of one analysis, for the Diagnóstico line. */
  class Stages {
    var decode = 0.0
    var people = 0.0
    var prep = 0.0
    var model = 0.0
    var path = 0.0
    var regions = 0
    var ballFrames = 0

    fun json(): Map<String, Any> {
      fun r(v: Double) = Math.round(v * 10) / 10.0
      return mapOf("decodeMs" to r(decode), "peopleMs" to r(people), "prepMs" to r(prep), "modelMs" to r(model),
        "pathMs" to r(path), "regions" to if (ballFrames > 0) r(regions.toDouble() / ballFrames) else 0.0)
    }
  }

  /** The clip's video: its upright size, its rotation tag and its length. */
  class Video(val path: String, val width: Int, val height: Int, val rotation: Int, val durationMs: Double) {
    companion object {
      fun load(clipPath: String): Video {
        val r = MediaMetadataRetriever()
        try {
          r.setDataSource(clipPath)
          val rotation = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
          val w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
          val h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
          val d = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0
          if (w <= 0 || h <= 0 || d <= 0) throw Unreadable("no video")
          val quarter = rotation == 90 || rotation == 270
          return Video(clipPath, if (quarter) h else w, if (quarter) w else h, rotation, d)
        } finally {
          r.release()
        }
      }
    }
  }

  /** What Bola wants from the pass: its ticks, the model, and the size the tiles are cut from. */
  class BallJob(val ticks: List<Double>, val detector: BallDetector, val width: Int, val height: Int, val thumbnails: Boolean)

  /** What one kept frame gave. */
  class Found(val people: FocusSample? = null, val ball: BallFraming.Detection? = null, val thumbnail: Pixels.Grey? = null)

  /** The size the ball search reads a frame at: wider than `maxWidth` scaled down, even sides (0 = native). */
  fun ballSize(width: Int, height: Int, maxWidth: Int): Pair<Int, Int> {
    if (!(maxWidth > 0 && maxOf(width, height) > maxWidth)) return Pair(width, height)
    val s = maxWidth.toDouble() / maxOf(width, height)
    fun even(v: Int) = (Math.floor(v * s / 2 + 0.5) * 2).toInt()
    return Pair(even(width), even(height))
  }

  /**
   * Reads the stretch of the clip the ticks need, once, and hands `each` what every kept frame gave. `people`: Jogadores'
   * ticks still to analyse (each stands for `peopleWindowMs`); `ball`: Bola's. `sideBySide`: on a frame both want, the
   * two detectors run at the same time. `critical`: asked before each ball frame (stop for heat).
   */
  fun run(context: Context, video: Video, people: List<Double>, peopleWindowMs: Double, ball: BallJob?, sideBySide: Boolean,
          stages: Stages, cancelled: () -> Boolean, critical: () -> Boolean, each: (Found) -> Unit) {
    val ballTicks = ball?.ticks ?: emptyList()
    val span = ScanTicks.span(people, peopleWindowMs, ballTicks, BallFraming.stepMs) ?: return
    if (cancelled()) throw Cancelled()
    val peopleCursor = ScanTicks.Cursor(people, peopleWindowMs)
    val ballCursor = ScanTicks.Cursor(ballTicks, BallFraming.stepMs)
    // beside the ball detector the people take one core (one lane), so the ball keeps the others
    val peopleDetector = if (people.isEmpty()) null else PeopleDetector(context, lanes = if (ball != null && sideBySide) 1 else 4)
    val side = if (peopleDetector != null && ball != null && sideBySide) Executors.newSingleThreadExecutor { r ->
      Thread(r, "scan-people").apply { priority = Thread.currentThread().priority }
    } else null
    val regions = ball?.let { BallDetect.regions(it.width, it.height, BallDetector.SIDE, BallDetector.TILE) } ?: emptyList()
    var peopleFound = 0
    var peopleFailed = 0
    var ballFound = 0
    var ballFailed = 0
    var peopleIndex = 0
    var wantPeople = false
    var wantBall = false
    var waited = System.nanoTime()

    fun findPeople(frame: Pixels, index: Int): List<FocusBox>? = try {
      peopleDetector!!.detect(frame.shrunk(PeopleDetector.FRAME_LONG_SIDE), index)
    } catch (e: Exception) {
      Log.w(TAG, "people detector failed: $e")
      null
    }

    try {
      FrameDecoder(video.path, maxOf(0.0, span.first - 50), span.second + 50, video.rotation).run(cancelled, { t ->
        wantPeople = peopleCursor.take(t)
        wantBall = ballCursor.take(t)
        wantPeople || wantBall
      }) { t, decoded ->
        stages.decode += (System.nanoTime() - waited) / 1e6
        if (cancelled()) throw Cancelled()
        var found = Found()
        if (wantBall && ball != null) {
          if (critical()) throw Hot()
          val t0 = System.nanoTime()
          val frame = decoded.pixels(ball.width, ball.height)
          stages.decode += (System.nanoTime() - t0) / 1e6
          // the people detector on this frame meanwhile, on its own thread
          var pending: Future<Pair<List<FocusBox>?, Double>>? = null
          var peopleBoxes: List<FocusBox>? = null
          var peopleTried = false
          if (wantPeople && peopleDetector != null) {
            val index = peopleIndex++
            if (side != null) {
              pending = side.submit<Pair<List<FocusBox>?, Double>> {
                val p0 = System.nanoTime()
                Pair(findPeople(frame, index), (System.nanoTime() - p0) / 1e6)
              }
            } else {
              val p0 = System.nanoTime()
              peopleBoxes = findPeople(frame, index)
              stages.people += (System.nanoTime() - p0) / 1e6
              peopleTried = true
            }
          }
          val thumb = if (ball.thumbnails) frame.grey(BallScreen.thumbWidth) else null
          val detection = try {
            val boxes = ball.detector.detect(frame.argb, frame.width, frame.height, regions)
            BallFraming.Detection(t, BallDetect.frameCandidates(boxes, ball.width, ball.height))
          } catch (e: Exception) {
            Log.w(TAG, "ball detector failed: $e")
            null
          }
          stages.prep += ball.detector.lastPrepMs
          stages.model += ball.detector.lastModelMs
          if (detection != null) {
            ballFound += 1
            stages.regions += regions.size
            stages.ballFrames += 1
          } else {
            ballFailed += 1
          }
          pending?.let {
            val (b, ms) = it.get()
            peopleBoxes = b
            stages.people += ms
            peopleTried = true
          }
          var sample: FocusSample? = null
          if (peopleTried) {
            val b = peopleBoxes
            if (b != null) { peopleFound += 1; sample = FocusSample(t, b) } else peopleFailed += 1
          }
          found = Found(sample, detection, if (detection != null) thumb else null)
          if (ballFailed >= 5 && ballFailed * 10 > ballFound + ballFailed) throw Interrupted("the ball detector kept failing")
        } else if (wantPeople && peopleDetector != null) {
          val t0 = System.nanoTime()
          val frame = decoded.pixels(PeopleDetector.FRAME_LONG_SIDE)
          stages.decode += (System.nanoTime() - t0) / 1e6
          val p0 = System.nanoTime()
          val b = findPeople(frame, peopleIndex++)
          stages.people += (System.nanoTime() - p0) / 1e6
          if (b != null) { peopleFound += 1; found = Found(people = FocusSample(t, b)) } else peopleFailed += 1
        }
        if (found.people != null || found.ball != null) each(found)
        waited = System.nanoTime()
        !(peopleCursor.done && ballCursor.done)
      }
    } finally {
      side?.shutdownNow()
      peopleDetector?.close()
    }
    if (cancelled()) throw Cancelled()
    // A few lost frames are covered by the grid; many mean a detector could not run.
    if (peopleFailed * 10 > peopleFound + peopleFailed) throw Interrupted("the people detector kept failing")
  }
}
