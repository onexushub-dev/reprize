package expo.modules.replaycamera

import android.content.Context
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.model.UpdateAvailability

/** Asks Google Play whether it has a newer version for this phone. Any failure (not installed from Play, offline): false. */
object PlayUpdate {
  fun check(context: Context, done: (Boolean) -> Unit) {
    try {
      AppUpdateManagerFactory.create(context).appUpdateInfo
        .addOnSuccessListener { done(it.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE) }
        .addOnFailureListener { done(false) }
    } catch (_: Exception) {
      done(false)
    }
  }
}
