package expo.modules.replaycamera.core

import android.content.Context
import android.os.PowerManager

/**
 * The iPhone's heat rule for Seguir a Bola on Android's thermal status: `THERMAL_STATUS_SEVERE` stands for the iPhone's
 * `serious`, `CRITICAL` and above for `critical`. An analysis waits to start while serious or worse (a short cut only
 * while critical), and stops at critical.
 */
object Heat {
  enum class Level { NOMINAL, SERIOUS, CRITICAL }

  fun level(thermalStatus: Int): Level = when {
    thermalStatus >= PowerManager.THERMAL_STATUS_CRITICAL -> Level.CRITICAL
    thermalStatus >= PowerManager.THERMAL_STATUS_SEVERE -> Level.SERIOUS
    else -> Level.NOMINAL
  }

  fun mustWait(level: Level, shortCut: Boolean): Boolean =
    if (shortCut) level == Level.CRITICAL else level != Level.NOMINAL

  fun now(context: Context): Level {
    val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    return level(pm.currentThermalStatus)
  }
}
