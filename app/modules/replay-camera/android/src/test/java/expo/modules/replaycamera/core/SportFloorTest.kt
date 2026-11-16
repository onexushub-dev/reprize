package expo.modules.replaycamera.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** `SportFloorTests.swift`: the same pictures from the same generator. */
class SportFloorTest {
  private fun picture(r: Int, g: Int, b: Int, noise: Int): ByteArray {
    val px = ByteArray(320 * 180 * 4)
    var seed = 12345
    for (y in 0 until 180) for (x in 0 until 320) {
      val i = (y * 320 + x) * 4
      if (y < 81) { px[i] = 20; px[i + 1] = 30; px[i + 2] = 40; px[i + 3] = 255.toByte(); continue }
      seed = seed * 1_103_515_245 + 12345
      val n = if (noise == 0) 0 else (seed ushr 16) % (2 * noise + 1) - noise
      fun c(v: Int) = maxOf(0, minOf(255, v + n)).toByte()
      px[i] = c(r); px[i + 1] = c(g); px[i + 2] = c(b); px[i + 3] = 255.toByte()
    }
    return px
  }

  @Test fun sandIsSandColouredAndGrainy() {
    val m = SportFloor.measure(picture(205, 180, 140, 20), 320, 180)!!
    assertTrue(m.sand > 0.9)
    assertTrue(m.texture > 4.5)
  }

  @Test fun woodIsSandColouredButSmooth() {
    val m = SportFloor.measure(picture(205, 170, 120, 0), 320, 180)!!
    assertTrue(m.sand > 0.9)
    assertTrue(m.texture < 0.5)
  }

  @Test fun paintedCourtIsNotSand() {
    val m = SportFloor.measure(picture(40, 80, 170, 20), 320, 180)!!
    assertTrue(m.sand < 0.05)
    assertEquals(0.0, m.texture, 0.0)
  }

  @Test fun hueAsOpenCV() {
    assertTrue(SportFloor.isSand(205.0, 180.0, 140.0))
    assertFalse(SportFloor.isSand(255.0, 128.0, 0.0))
    assertFalse(SportFloor.isSand(60.0, 50.0, 40.0))
  }
}
