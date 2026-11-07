package expo.modules.replaycamera

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.media.ImageReader
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.os.StatFs
import android.view.Surface
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.replaycamera.core.BufferPlan
import expo.modules.replaycamera.core.LowStorageException
import expo.modules.replaycamera.core.Segment
import expo.modules.replaycamera.core.SegmentRing
import expo.modules.replaycamera.core.StorageGuard
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

class ReplayException(code: String, message: String) : CodedException(code, message, null)

/**
 * Ties capture, segment encoding, the ring, gesture and thermal handling together.
 * One per process; the preview view hands it a surface and a bitmap source.
 *
 * Threading: every state change runs on the engine thread ([post]); camera, encoder, thermal and
 * lifecycle callbacks hop onto it. Clip copies run on [saveExecutor], so a save never stalls capture.
 */
object ReplayEngine {
  const val WINDOW_SECONDS = 60.0
  /** A save that hasn't seen its segment close by then is failed instead of hanging. */
  private const val SAVE_TIMEOUT_MS = 5_000L

  var emit: ((String, Map<String, Any?>) -> Unit)? = null
  /** Set by the mounted ReplayCameraView. Mount the view before starting a session. */
  @Volatile var previewSurface: Surface? = null
  @Volatile var previewBitmap: (() -> Bitmap?)? = null

  private val engineThread = HandlerThread("replay-engine").apply { start() }
  private val engine = Handler(engineThread.looper)
  private val saveExecutor = Executors.newSingleThreadExecutor { Thread(it, "replay-save") }
  private val feedback = ReplayFeedback()
  private const val SEGMENT_SECONDS = SegmentEncoder.SEGMENT_US / 1_000_000.0
  /** The rolling window of the current session (60s court, 120s gym). Engine thread. */
  private var windowSeconds = WINDOW_SECONDS
  private var ring = SegmentRing(BufferPlan.segments(WINDOW_SECONDS, SEGMENT_SECONDS), LocalFileOps)

  private class PendingSave(val id: String, val run: () -> Unit, val fail: (CodedException) -> Unit)

  // Engine-thread state.
  private var context: Context? = null
  private var capture: CaptureController? = null
  private var gesture: GestureDetector? = null
  private var encoder: SegmentEncoder? = null
  private var reader: ImageReader? = null
  private var pendingSaves = mutableListOf<PendingSave>()
  private var thermalListener: PowerManager.OnThermalStatusChangedListener? = null
  private var lens = "ultraWide"
  private var quality = "1080p60"
  private var degraded = false
  /** The user's intent: a session is wanted (it may be paused while the app is in the background). */
  private var wanted = false
  private var starting = false

  private fun post(block: () -> Unit) { engine.post(block) }

  fun setGestureEnabled(enabled: Boolean) = post { gesture?.enabled = enabled }

  fun signalSaved(sound: Boolean, flash: Boolean) = post {
    val cap = capture
    feedback.saved(sound, flash, if (encoder != null && cap != null) cap::setTorch else null)
  }

  fun signalSaveFailed(sound: Boolean) = post { feedback.failed(sound) }

  /** Resolves right away when a session is already running or starting. */
  fun start(
    context: Context,
    lens: String,
    maxQuality: String,
    bufferSeconds: Double,
    onReady: () -> Unit,
    onError: (CodedException) -> Unit,
  ) = post {
    if (wanted) return@post onReady()
    val granted = listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO).all {
      ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }
    if (!granted) return@post onError(ReplayException("CAMERA_PERMISSION", "Camera or microphone permission not granted"))
    try {
      StorageGuard.check(StatFs(context.cacheDir.path).availableBytes)
    } catch (e: LowStorageException) {
      return@post onError(ReplayException("LOW_STORAGE", e.message ?: "Less than 500 MB free"))
    }
    ring.clear()
    windowSeconds = if (bufferSeconds > 0) bufferSeconds else WINDOW_SECONDS
    ring = SegmentRing(BufferPlan.segments(windowSeconds, SEGMENT_SECONDS), LocalFileOps)
    SegmentRing.purgeOrphans(ReplayPaths.buffer(context), LocalFileOps)

    this.context = context.applicationContext
    if (capture == null) capture = CaptureController(context.applicationContext)
    if (gesture == null) gesture = GestureDetector(context.applicationContext) {
      emit?.invoke("onTrigger", mapOf("source" to "gesture", "at" to System.currentTimeMillis().toDouble()))
    }
    gesture?.onDebug = { emit?.invoke("onGestureDebug", it) }
    this.lens = lens
    quality = maxQuality
    degraded = false
    wanted = true
    watchThermal()
    startPipeline(onReady) { error ->
      wanted = false
      unwatchThermal()
      onError(error)
    }
  }

  fun stop(onStopped: () -> Unit = {}) = post {
    wanted = false
    unwatchThermal()
    stopPipeline(ReplayException("NO_SESSION", "Session stopped"))
    onStopped()
  }

  /** The activity paused (background, lock screen): the camera is taken away, so drop the buffer. */
  fun pause() = post {
    if (!wanted || encoder == null) return@post
    stopPipeline(ReplayException("NO_SESSION", "Session interrupted"))
    emit?.invoke("onInterrupted", emptyMap())
  }

  fun resume() = post {
    if (!wanted || encoder != null || starting) return@post
    startPipeline(onReady = { emit?.invoke("onResumed", emptyMap()) }) { fail(it) }
  }

  /**
   * Forces a segment cut at the trigger, then copies the last `keepSeconds` of the window once that segment is closed
   * (0 or more than the window = the whole window). Settles exactly once.
   */
  fun saveClip(keepSeconds: Double = 0.0, onDone: (String, Int) -> Unit, onError: (CodedException) -> Unit) = post {
    val enc = encoder
    val ctx = context
    if (!wanted || enc == null || ctx == null) return@post onError(ReplayException("NO_SESSION", "No replay session is running"))
    val id = UUID.randomUUID().toString()
    pendingSaves += PendingSave(id, run = {
      saveExecutor.execute {
        val dest = File(ReplayPaths.clips(ctx), "$id.mp4")
        try {
          val lastSeconds = if (keepSeconds > 0) minOf(keepSeconds, windowSeconds) else windowSeconds
          val seconds = ring.copyClip(lastSeconds, dest, ClipConcat::concat)
          onDone(dest.path, (seconds * 1000).toInt())
        } catch (t: Throwable) {
          dest.delete()
          onError(ReplayException("ENCODER_FAILED", "$t"))
        }
      }
    }, fail = onError)
    engine.postDelayed({
      val late = pendingSaves.firstOrNull { it.id == id } ?: return@postDelayed
      pendingSaves.remove(late)
      late.fail(ReplayException("ENCODER_FAILED", "Timed out waiting for the segment to close"))
    }, SAVE_TIMEOUT_MS)
    enc.requestCut()
  }

  /** Engine thread. */
  private fun startPipeline(onReady: () -> Unit, onError: (CodedException) -> Unit) {
    val ctx = context ?: return
    val cap = capture ?: return
    val gest = gesture ?: return
    starting = true
    val ready = { post { starting = false; onReady() } }
    val openFailed = { message: String ->
      post {
        starting = false
        stopPipeline(ReplayException("NO_SESSION", message))
        onError(ReplayException("CAMERA_UNAVAILABLE", message))
      }
    }
    val runtimeFailed = { message: String -> post { fail(ReplayException("CAMERA_UNAVAILABLE", message)) } }
    try {
      val mode = cap.chooseMode(lens, if (degraded) "720p30" else quality)
      val enc = SegmentEncoder(
        mode.size.width, mode.size.height, mode.fps, ReplayPaths.buffer(ctx), mode.clockNanos, mode.clockIsBoottime,
        rotationDegrees = { gest.rotation },
        onSegment = { segment -> post { onSegment(segment) } },
        onFailure = { error -> post { fail(ReplayException("ENCODER_FAILED", "$error")) } },
      )
      val rdr = gest.createReader(cap.handler)
      encoder = enc
      reader = rdr
      gest.start(mode.sensorOrientation)
      enc.start()
      val base = listOfNotNull(enc.inputSurface, previewSurface)
      cap.open(mode, base + rdr.surface, ready, onOpenError = {
        // Some devices can't add a third stream at this size: retry without it and sample the preview.
        post {
          reader?.close()
          reader = null
          cap.open(mode, base, onReady = {
            previewBitmap?.let { grab -> post { gesture?.startBitmapSampling(grab) } }
            ready()
          }, onOpenError = openFailed, onRuntimeError = runtimeFailed)
        }
      }, onRuntimeError = runtimeFailed)
    } catch (t: Throwable) {
      starting = false
      stopPipeline(ReplayException("NO_SESSION", "$t"))
      onError(ReplayException("CAMERA_UNAVAILABLE", "$t"))
    }
  }

  /** Engine thread. Tears down capture and fails every waiting save with [reason]. */
  private fun stopPipeline(reason: CodedException) {
    gesture?.stop()
    capture?.shutdown()
    encoder?.stop()
    reader?.close()
    encoder = null
    reader = null
    val waiting = pendingSaves
    pendingSaves = mutableListOf()
    waiting.forEach { it.fail(reason) }
    ring.clear()
  }

  /** Engine thread. A runtime failure: tell JS and stop, so the UI never shows a dead session as recording. */
  private fun fail(error: CodedException) {
    if (!wanted) return
    emit?.invoke("onError", mapOf("code" to error.code, "message" to error.message))
    wanted = false
    unwatchThermal()
    stopPipeline(error)
  }

  /** Engine thread. */
  private fun onSegment(segment: Segment) {
    if (encoder == null) return LocalFileOps.delete(segment.file) // late segment of a torn-down pipeline
    ring.append(segment)
    val ready = pendingSaves
    pendingSaves = mutableListOf()
    ready.forEach { it.run() }
  }

  /** Engine thread. */
  private fun watchThermal() {
    val ctx = context ?: return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || thermalListener != null) return
    val power = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
    val listener = PowerManager.OnThermalStatusChangedListener { status -> post { thermalChanged(status) } }
    power.addThermalStatusListener(ContextCompat.getMainExecutor(ctx), listener)
    thermalListener = listener
  }

  /** Engine thread. */
  private fun unwatchThermal() {
    val ctx = context ?: return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    thermalListener?.let { (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).removeThermalStatusListener(it) }
    thermalListener = null
  }

  /** Engine thread. */
  private fun thermalChanged(status: Int) {
    if (!wanted) return
    val level = when {
      status >= PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
      status >= PowerManager.THERMAL_STATUS_SEVERE -> "serious"
      status >= PowerManager.THERMAL_STATUS_MODERATE -> "fair"
      else -> "nominal"
    }
    if (level == "critical") {
      emit?.invoke("onThermalChange", mapOf("level" to level, "degraded" to true))
      return fail(ReplayException("ENCODER_FAILED", "thermal"))
    }
    if (level == "serious" && !degraded) {
      degraded = true
      if (!starting) {
        stopPipeline(ReplayException("NO_SESSION", "Switching to 720p30"))
        startPipeline(onReady = {}) { fail(it) }
      }
    }
    emit?.invoke("onThermalChange", mapOf("level" to level, "degraded" to degraded))
  }
}
