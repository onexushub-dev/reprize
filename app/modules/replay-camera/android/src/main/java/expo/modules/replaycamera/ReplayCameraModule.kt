package expo.modules.replaycamera

import android.Manifest
import expo.modules.replaycamera.focus.FocusAnalyzer
import expo.modules.replaycamera.remote.DeviceIdentity
import expo.modules.replaycamera.remote.RemoteBle
import expo.modules.replaycamera.remote.RemoteController
import expo.modules.replaycamera.remote.RemoteHost
import expo.modules.replaycamera.remote.RemoteVoice
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class SessionOptions : Record {
  @Field val lens: String = "ultraWide"
  @Field val maxQuality: String = "1080p60"
  @Field val bufferSeconds: Double = 60.0
}

class SaveClipOptions : Record {
  @Field val source: String = "screen"
  @Field val at: Double = 0.0
  /** How much of the buffer the file keeps, from its end; 0 = the whole buffer (older callers). */
  @Field val keepMs: Double = 0.0
}

class ExportCrop : Record {
  @Field val x: Double = 0.0
  @Field val y: Double = 0.0
  @Field val width: Double = 1.0
  @Field val height: Double = 1.0
}

class ExportFocus : Record {
  @Field val path: String = ""
  @Field val aspect: String = "landscape"
}

class AnalyzeFocusOptions : Record {
  @Field val clipPath: String = ""
  @Field val startMs: Double = 0.0
  @Field val endMs: Double = 0.0
  @Field val outPath: String = ""
  @Field val debug: Boolean = false
}

class ExportClipOptions : Record {
  @Field val clipPath: String = ""
  @Field val startMs: Double = 0.0
  @Field val endMs: Double = 0.0
  @Field val speed: Double = 1.0
  @Field val muted: Boolean = false
  @Field val rotation: Int = 0
  @Field val crop: ExportCrop? = null
  @Field val focus: ExportFocus? = null
  @Field val width: Int = 1080
  @Field val height: Int = 1920
  @Field val overlayPngPath: String? = null
  @Field val background: String = "#0A0A0A"
}

class ReplayCameraModule : Module() {
  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun remote() = RemoteController.shared(context)
  private fun host() = RemoteHost.shared(context)

  /** Runs `work` once the Bluetooth permissions are there, asking for them first if needed (the screen hears the
   * answer through `onRemoteStatus`: `denied`/`unauthorized` when refused). */
  private fun withHostBluetooth(work: () -> Unit) {
    if (RemoteBle.hostGranted(context)) return work()
    val permissions = appContext.permissions ?: return work()
    permissions.askForPermissions({ _ -> work(); host().permissionsChanged() }, *RemoteBle.hostPermissions())
  }

  /** Pairing needs the advertise permission first; without it the screen gets null and the status says why. */
  private fun withHostPairing(): Map<String, Any?>? {
    if (!RemoteBle.hostGranted(context)) {
      withHostBluetooth { }
      return null
    }
    return host().beginPairing()
  }

  private fun withBluetooth(work: () -> Unit) {
    if (RemoteBle.granted(context)) return work()
    val permissions = appContext.permissions ?: return work()
    permissions.askForPermissions({ _ -> work(); remote().permissionsChanged() }, *RemoteBle.permissions())
  }

  override fun definition() = ModuleDefinition {
    Name("ReplayCamera")

    Events("onTrigger", "onThermalChange", "onInterrupted", "onResumed", "onError", "onGestureDebug", "onWatchStatus", "onDiag",
      "onRemoteStatus", "onRemoteState", "onRemoteResult", "onRemotePairing", "onRemoteVoice", "onRemoteStop", "onRemoteStart", "onRemoteCheck", "onCaptureButton")

    OnCreate {
      ReplayEngine.emit = { name, body -> sendEvent(name, body) }
      remote().emit = { name, body -> sendEvent(name, body) }
      host().emit = { name, body -> sendEvent(name, body) }
      RemoteVoice.emit = { name, body -> sendEvent(name, body) }
      CaptureKeys.emit = { name, body -> sendEvent(name, body) }
    }

    // ---- This phone as the remote of a camera phone (an iPhone or an Android), over Bluetooth LE. The camera side
    // (remoteHost*) is not on Android yet, so the app offers only "use as remote" here (isRemoteSupported is false).
    // This phone as the camera phone of a remote (RemoteHost).
    Function("remoteHostStart") { withHostBluetooth { host().start() } }
    Function("remoteHostStop") { host().stop() }
    Function("remoteHostBeginPairing") { withHostPairing() }
    Function("remoteHostEndPairing") { host().endPairing() }
    Function("remoteHostPeers") { host().peers.map { mapOf("id" to it.id, "name" to it.name, "connected" to host().isConnected(it.id)) } }
    Function("remoteHostCheck") { id: String -> host().check(id) }
    Function("remoteHostRemove") { id: String -> host().remove(id) }
    Function("remoteHostControllers") { host().controllers }
    Function("remoteSync") { recording: Boolean, clipCount: Int, startedAt: Double? -> host().sync(recording, clipCount, startedAt) }
    Function("remoteSignal") { saved: Boolean -> host().signal(saved) }

    Function("remoteControllerStart") { withBluetooth { remote().start() } }

    Function("remoteControllerStop") { remote().stop() }

    Function("remoteControllerHost") {
      remote().host?.let { mapOf("id" to it.id, "name" to it.name) }
    }

    Function("remoteControllerForget") { remote().forget() }

    Function("remoteControllerPairWithLink") { _: String, secret: String, _: String -> withBluetooth { remote().pairWithLink(secret) } }

    Function("remoteControllerPairWithCode") { code: String -> withBluetooth { remote().pairWithCode(code) } }

    Function("remoteControllerSave") { remote().save() }

    Function("remoteControllerEndRecording") { remote().endRecording() }

    Function("remoteControllerStartRecording") { remote().startRecording() }

    // No camera preview over Bluetooth (the iPhone sends it over Apple-only peer-to-peer Wi-Fi): nothing to ask for.
    Function("remoteControllerPreview") { _: Boolean -> }

    Function("remoteVoiceSetEnabled") { on: Boolean, locale: String -> RemoteVoice.set(on, locale) }

    Function("getMicrophonePermission") {
      val ctx = appContext.reactContext ?: return@Function "undetermined"
      if (androidx.core.content.ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) ==
        android.content.pm.PackageManager.PERMISSION_GRANTED) "granted" else "undetermined"
    }

    AsyncFunction("requestMicrophonePermission") { promise: Promise ->
      val permissions = appContext.permissions ?: return@AsyncFunction promise.resolve(false)
      permissions.askForPermissions(
        { results -> promise.resolve(results.values.all { it.status == PermissionsStatus.GRANTED }) },
        Manifest.permission.RECORD_AUDIO,
      )
    }

    Function("remoteDeviceName") { DeviceIdentity.name(context) }

    Function("remoteSetDeviceName") { name: String -> DeviceIdentity.setCustomName(context, name) }

    // Screen economy on the remote phone: brightness down to a level that can still be read; false gives it back.
    Function("setRemoteScreenDim") { on: Boolean ->
      ScreenEconomy.set(appContext.currentActivity, on, ScreenEconomy.REMOTE_BRIGHTNESS)
    }

    AsyncFunction("startSession") { opts: SessionOptions, promise: Promise ->
      ReplayEngine.start(context, opts.lens, opts.maxQuality, opts.bufferSeconds, onReady = { promise.resolve(null) }, onError = promise::reject)
    }

    AsyncFunction("stopSession") { promise: Promise ->
      ReplayEngine.stop { promise.resolve(null) }
    }

    AsyncFunction("saveClip") { o: SaveClipOptions, promise: Promise ->
      ReplayEngine.saveClip(
        keepSeconds = o.keepMs / 1000,
        onDone = { path, ms -> promise.resolve(mapOf("clipPath" to path, "durationMs" to ms)) },
        onError = promise::reject,
      )
    }

    Function("setGestureEnabled") { enabled: Boolean -> ReplayEngine.setGestureEnabled(enabled) }

    // Screen economy while recording: brightness down (the JS side covers the screen in black); false gives it back.
    // Volume keys / Bluetooth remote as capture events (press and hold); true: this phone delivers them.
    Function("setCaptureButtons") { on: Boolean -> CaptureKeys.set(appContext.currentActivity, on); true }
    Function("setScreenEconomy") { on: Boolean -> ScreenEconomy.set(appContext.currentActivity, on) }

    Function("signalSaved") { sound: Boolean, flash: Boolean -> ReplayEngine.signalSaved(sound, flash) }

    AsyncFunction("exportClip") { o: ExportClipOptions, promise: Promise ->
      ClipExporter.export(
        context,
        ClipExporter.Options(
          o.clipPath, o.startMs.toLong(), o.endMs.toLong(), o.speed.toFloat(), o.muted, o.rotation,
          o.crop?.let { ClipExporter.Crop01(it.x, it.y, it.width, it.height) }, o.width, o.height, o.overlayPngPath,
          // Modo Foco follows its track unless the player zoomed by hand.
          focus = if (o.crop == null) o.focus?.let { ClipExporter.FocusTrack.read(it.path, it.aspect) } else null,
        ),
        onDone = { path, ms -> promise.resolve(mapOf("path" to path, "durationMs" to ms)) },
        onError = { promise.reject(ReplayException("ENCODER_FAILED", "$it")) },
      )
    }

    AsyncFunction("shareToInstagramStory") { videoPath: String, metaAppId: String ->
      val activity = appContext.currentActivity ?: return@AsyncFunction "unavailable"
      if (runCatching { InstagramStory.share(activity, videoPath, metaAppId) }.getOrDefault(false)) "opened" else "unavailable"
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)

    AsyncFunction("shareFiles") { paths: List<String> ->
      val activity = appContext.currentActivity ?: return@AsyncFunction "dismissed"
      if (runCatching { MultiShare.share(activity, paths) }.getOrDefault(false)) "shared" else "dismissed"
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)

    AsyncFunction("concatVideos") { paths: List<String>, outPath: String ->
      try {
        val (path, ms) = VideoConcat.concat(paths, outPath)
        mapOf("path" to path, "durationMs" to ms)
      } catch (e: VideoConcat.MismatchException) {
        throw ReplayException("CONCAT_MISMATCH", "${e.message}")
      } catch (e: Exception) {
        throw ReplayException("ENCODER_FAILED", "$e")
      }
    }

    // Modo Foco: people found with an on-device detector, the framing written next to the clip (see FocusAnalyzer).
    // On its own thread: an analysis lasts as long as the clip, and on the module's shared queue it held up every other
    // call (the thumbnail that tells the screen the clip's shape waited for it: 8 s, 2026-11-10 field log).
    AsyncFunction("analyzeFocus") { o: AnalyzeFocusOptions, promise: Promise ->
      Thread({
        try {
          val r = FocusAnalyzer.analyze(context, o.clipPath, o.startMs, o.endMs, o.outPath, o.debug)
          promise.resolve(mapOf("status" to if (r.ready) "ready" else "none", "frames" to r.frames, "framesWithPeople" to r.framesWithPeople,
            "meanPeople" to r.meanPeople, "elapsedMs" to r.elapsedMs))
        } catch (e: FocusAnalyzer.Cancelled) {
          promise.reject("CANCELLED", "Focus analysis cancelled", null)
        } catch (e: Throwable) {
          android.util.Log.e("ReprizeFocus", "analysis failed", e)
          promise.reject("FOCUS_FAILED", "${e.cause ?: e}", null)
        }
      }, "focus-analysis").start()
    }

    Function("cancelFocus") { clipPath: String -> FocusAnalyzer.cancel(clipPath) }

    Function("videoShape") { clipPath: String -> ClipThumbnail.shape(clipPath) }

    AsyncFunction("createThumbnail") { clipPath: String, atMs: Double -> ClipThumbnail.make(clipPath, atMs) }

    // The save command by voice: on-device recognition fed with the recorder's own audio (VoiceTrigger).
    Function("setVoiceEnabled") { enabled: Boolean, locale: String -> ReplayEngine.setVoiceEnabled(enabled, locale) }

    // Wear OS arrives with the Android device stage; until then there is never a watch on Android.
    Function("getWatchStatus") { "unsupported" }

    Function("watchSync") { _: Boolean, _: Int, _: Double? -> }
    Function("watchSetSaveAllowed") { _: Boolean -> }

    Function("watchSignal") { _: Boolean -> }

    // Basic-mode recognition exists from Android 12; the language pack downloads the first time voice is turned on.
    Function("isVoiceSupported") { _: String -> VoiceTrigger.isSupported() }

    // No speech permission of its own on Android: the recorder's microphone permission covers it.
    Function("getSpeechPermission") {
      val ctx = appContext.reactContext ?: return@Function "undetermined"
      if (androidx.core.content.ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.RECORD_AUDIO) ==
        android.content.pm.PackageManager.PERMISSION_GRANTED) "granted" else "denied"
    }

    AsyncFunction("requestSpeechPermission") {
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      androidx.core.content.ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.RECORD_AUDIO) ==
        android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    Function("signalSaveFailed") { sound: Boolean -> ReplayEngine.signalSaveFailed(sound) }

    AsyncFunction("requestPermissions") { promise: Promise ->
      val permissions = appContext.permissions ?: return@AsyncFunction promise.resolve(false)
      permissions.askForPermissions(
        { results -> promise.resolve(results.values.all { it.status == PermissionsStatus.GRANTED }) },
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO,
      )
    }

    OnActivityEntersBackground { ReplayEngine.pause() }

    OnActivityEntersForeground { ReplayEngine.resume() }

    View(ReplayCameraView::class) {}
  }
}
