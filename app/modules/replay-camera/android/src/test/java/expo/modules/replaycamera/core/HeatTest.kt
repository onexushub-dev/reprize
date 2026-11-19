package expo.modules.replaycamera.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The iPhone's heat rule on Android's thermal status (PowerManager.THERMAL_STATUS_*: 0 none … 3 severe, 4 critical, 5 emergency, 6 shutdown). */
class HeatTest {
  @Test fun severeIsSeriousAndCriticalIsCritical() {
    assertEquals(Heat.Level.NOMINAL, Heat.level(0))
    assertEquals(Heat.Level.NOMINAL, Heat.level(2))
    assertEquals(Heat.Level.SERIOUS, Heat.level(3))
    assertEquals(Heat.Level.CRITICAL, Heat.level(4))
    assertEquals(Heat.Level.CRITICAL, Heat.level(6))
  }

  @Test fun aShortCutStartsWhileSerious() {
    assertFalse(Heat.mustWait(Heat.Level.SERIOUS, shortCut = true))
    assertTrue(Heat.mustWait(Heat.Level.SERIOUS, shortCut = false))
    assertTrue(Heat.mustWait(Heat.Level.CRITICAL, shortCut = true))
    assertFalse(Heat.mustWait(Heat.Level.NOMINAL, shortCut = false))
  }
}
