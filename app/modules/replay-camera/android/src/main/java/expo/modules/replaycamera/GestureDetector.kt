package expo.modules.replaycamera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.media.ImageReader
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.OrientationEventListener
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.pose.PoseDetection
import com.google.mlkit.vision.pose.PoseLandmark
import com.google.mlkit.vision.pose.defaults.PoseDetectorOptions
import expo.modules.replaycamera.core.ImageRotation
import expo.modules.replaycamera.core.Point
import expo.modules.replaycamera.core.Pose
import expo.modules.replaycamera.core.Sighting
import expo.modules.replaycamera.core.WaveTracker
import java.util.concurrent.atomic.AtomicBoolean
import com.google.mlkit.vision.pose.Pose as MlPose

/**
 * Runs ML Kit pose detection on ~5 frames per second (8 while the arms are up) and fires [onGesture] on the wave:
 * both hands above the head, swung from side to side (WaveTracker, the same gesture and thresholds as iOS). The old
 * hold (arms up and still) is gone, as on iOS: a volleyball set or block looks the same.
 * Frames come from a small ImageReader on the capture session, or, when the device can't add
 * that third stream, from bitmaps of the preview (see [startBitmapSampling]).
 * Frame rotation follows the phone's physical position (the UI is portrait-locked), read from the accelerometer.
 */
class GestureDetector(context: Context, private val onGesture: () -> Unit) {
  companion object {
    private const val SAMPLE_MS = 200L
    /** Waving is quick: sample faster while somebody has the arms up. */
    private const val RAISED_SAMPLE_MS = 125L
    private const val RAISED_FAST_MS = 1500L
    /** At most this often to JS, unless the arms just went up (the practice screen's cue). */
    private const val DEBUG_EVERY_MS = 500L
  }

  /** What the detector saw, for the practice screen (onGestureDebug); set by the engine. */
  @Volatile var onDebug: ((Map<String, Any>) -> Unit)? = null
  private var lastRaisedMs = 0L
  private var lastDebugMs = 0L
  private var lastDebugRaised = false
  private var samplesSinceDebug = 0

  private fun sampleMs(now: Long) = if (now - lastRaisedMs < RAISED_FAST_MS) RAISED_SAMPLE_MS else SAMPLE_MS

  @Volatile var enabled = true
  private val detector = PoseDetection.getClient(
    PoseDetectorOptions.Builder().setDetectorMode(PoseDetectorOptions.STREAM_MODE).build()
  )
  private val tracker = WaveTracker()
  private val busy = AtomicBoolean(false)
  private var lastSample = 0L
  private val main = Handler(Looper.getMainLooper())
  private var bitmapSampler: Runnable? = null
  /** Clockwise device rotation from its natural (portrait) position; landscape until the sensor says otherwise. */
  @Volatile private var deviceDegrees = 90
  @Volatile private var sensorOrientation = 90
  private val orientation = object : OrientationEventListener(context) {
    override fun onOrientationChanged(degrees: Int) {
      ImageRotation.snap(degrees)?.let { deviceDegrees = it }
    }
  }

  /** Clockwise rotation that makes a camera frame upright right now. */
  val rotation get() = ImageRotation.forBackCamera(sensorOrientation, deviceDegrees)

  fun start(sensorOrientation: Int) {
    this.sensorOrientation = sensorOrientation
    if (orientation.canDetectOrientation()) orientation.enable()
  }

  fun stop() {
    orientation.disable()
    stopBitmapSampling()
  }

  fun createReader(handler: Handler): ImageReader =
    ImageReader.newInstance(640, 360, ImageFormat.YUV_420_888, 2).apply {
      setOnImageAvailableListener({ reader ->
        val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
        val now = SystemClock.elapsedRealtime()
        if (!enabled || now - lastSample < sampleMs(now) || !busy.compareAndSet(false, true)) {
          image.close()
          return@setOnImageAvailableListener
        }
        lastSample = now
        detect(InputImage.fromMediaImage(image, rotation), now) { image.close() }
      }, handler)
    }

  /** Fallback when the camera can't stream to an ImageReader: sample the preview on the main thread. */
  fun startBitmapSampling(grab: () -> Bitmap?) {
    stopBitmapSampling()
    val sampler = object : Runnable {
      override fun run() {
        val bitmap = if (enabled && !busy.get()) grab() else null
        if (bitmap != null && busy.compareAndSet(false, true)) {
          // The preview shows the raw sensor buffer, so it needs the same rotation as camera frames.
          detect(InputImage.fromBitmap(bitmap, rotation), SystemClock.elapsedRealtime()) {}
        }
        main.postDelayed(this, sampleMs(SystemClock.elapsedRealtime()))
      }
    }
    bitmapSampler = sampler
    main.post(sampler)
  }

  fun stopBitmapSampling() {
    bitmapSampler?.let(main::removeCallbacks)
    bitmapSampler = null
  }

  private fun detect(image: InputImage, nowMs: Long, release: () -> Unit) {
    detector.process(image)
      .addOnSuccessListener { mlPose ->
        val pose = toPose(mlPose)
        val seen = pose.leftShoulder != null && pose.rightShoulder != null
        // ML Kit finds one person per frame; where they stand (0..1) tells two players apart between samples.
        val sightings = if (seen) {
          val w = image.width.toDouble().coerceAtLeast(1.0)
          val h = image.height.toDouble().coerceAtLeast(1.0)
          val upright = rotation == 90 || rotation == 270
          val (fw, fh) = if (upright) Pair(h, w) else Pair(w, h)
          listOf(Sighting(pose, (pose.leftShoulder!!.x + pose.rightShoulder!!.x) / 2 / fw, (pose.leftShoulder.y + pose.rightShoulder.y) / 2 / fh))
        } else emptyList()
        val raised = seen && WaveTracker.armsRaised(pose)
        if (raised) lastRaisedMs = nowMs
        val waved = tracker.update(sightings, nowMs / 1000.0)
        report(nowMs, if (seen) 1 else 0, raised, waved)
        if (waved) onGesture()
      }
      .addOnCompleteListener {
        release()
        busy.set(false)
      }
  }

  private fun report(nowMs: Long, people: Int, raised: Boolean, waved: Boolean) {
    val send = onDebug ?: return
    samplesSinceDebug++
    if (!waved && raised == lastDebugRaised && nowMs - lastDebugMs < DEBUG_EVERY_MS) return
    lastDebugMs = nowMs
    lastDebugRaised = raised
    val samples = samplesSinceDebug
    samplesSinceDebug = 0
    send(mapOf("people" to people, "isX" to false, "raised" to raised, "waved" to waved, "orientation" to deviceDegrees, "samples" to samples))
  }

  /** ML Kit positions are pixels in the upright image, y growing downward, as ArmsUp expects. */
  private fun toPose(pose: MlPose): Pose {
    fun point(type: Int): Point? = pose.getPoseLandmark(type)?.let {
      Point(it.position.x.toDouble(), it.position.y.toDouble(), it.inFrameLikelihood.toDouble())
    }
    return Pose(
      leftWrist = point(PoseLandmark.LEFT_WRIST),
      rightWrist = point(PoseLandmark.RIGHT_WRIST),
      leftElbow = point(PoseLandmark.LEFT_ELBOW),
      rightElbow = point(PoseLandmark.RIGHT_ELBOW),
      leftShoulder = point(PoseLandmark.LEFT_SHOULDER),
      rightShoulder = point(PoseLandmark.RIGHT_SHOULDER),
      nose = point(PoseLandmark.NOSE),
    )
  }
}
