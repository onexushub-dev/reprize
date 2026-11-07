package expo.modules.replaycamera

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.WindowManager

/**
 * Screen economy while recording (same role as the iOS ScreenEconomy): the window's brightness goes down while the JS
 * side covers the screen in black; turning it off gives the system brightness back. Only this app's window changes,
 * so leaving the app restores the screen by itself. Capture, triggers and saves are not touched (the gesture detector
 * may read preview frames, so the preview keeps running).
 */
object ScreenEconomy {
  /** Brightness while dark (0..1). The black cover does the rest, so this only has to be low. */
  private const val DIM_BRIGHTNESS = 0.02f

  fun set(activity: Activity?, on: Boolean) {
    val a = activity ?: return
    Handler(Looper.getMainLooper()).post {
      val window = a.window ?: return@post
      val attrs = window.attributes
      attrs.screenBrightness = if (on) DIM_BRIGHTNESS else WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
      window.attributes = attrs
    }
  }
}
