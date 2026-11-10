package expo.modules.replaycamera

import android.app.Activity
import android.os.SystemClock
import android.view.KeyEvent
import android.view.Window

/**
 * Android twin of the iOS CaptureButtons: while on, the volume keys (the phone's own, or a Bluetooth selfie remote,
 * which presses "volume up") reach the app as `onCaptureButton` (`began`, then `ended` with its length in ms) instead
 * of changing the volume. The JS side tells a press from a 2 s hold, which starts or ends a recording.
 *
 * It sits on the window's callback, so the keys never reach the system volume (no HUD, no parking needed). A remote that
 * does not send keys (media-session volume) still goes through the volume path in JS, which stays as the fallback.
 */
object CaptureKeys {
  var emit: ((String, Map<String, Any?>) -> Unit)? = null

  private var hooked: Pair<Window, Window.Callback>? = null
  private var downAt = 0L

  fun set(activity: Activity?, on: Boolean) {
    activity ?: return
    activity.runOnUiThread { if (on) attach(activity.window) else detach() }
  }

  private fun attach(window: Window) {
    val current = window.callback
    if (current is Hook) return
    detach()
    hooked = window to current
    window.callback = Hook(current)
  }

  private fun detach() {
    val (window, original) = hooked ?: return
    if (window.callback is Hook) window.callback = original
    hooked = null
    downAt = 0L
  }

  private class Hook(private val inner: Window.Callback) : Window.Callback by inner {
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
      val code = event.keyCode
      if (code != KeyEvent.KEYCODE_VOLUME_UP && code != KeyEvent.KEYCODE_VOLUME_DOWN) return inner.dispatchKeyEvent(event)
      val button = if (code == KeyEvent.KEYCODE_VOLUME_UP) "secondary" else "primary"
      when (event.action) {
        KeyEvent.ACTION_DOWN -> if (event.repeatCount == 0 && downAt == 0L) {
          downAt = SystemClock.elapsedRealtime()
          emit?.invoke("onCaptureButton", mapOf("button" to button, "phase" to "began"))
        }
        KeyEvent.ACTION_UP -> if (downAt != 0L) {
          val ms = (SystemClock.elapsedRealtime() - downAt).toInt()
          downAt = 0L
          emit?.invoke("onCaptureButton", mapOf("button" to button, "phase" to "ended", "ms" to ms))
        }
      }
      return true // held repeats and releases are consumed too: the volume never moves
    }
  }
}
