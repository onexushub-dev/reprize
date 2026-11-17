package expo.modules.replaycamera

import org.junit.Assert.assertEquals
import org.junit.Test

class LensesTest {
  @Test
  fun `offers 0_5x when the app sees a back camera much wider than the main one`() {
    // A phone that shows its ultra-wide to apps: main 5.43 mm first, ultra-wide 1.86 mm.
    assertEquals(0.5, Lenses.zoomMin(listOf(5.43f, 1.86f)), 0.0)
  }

  @Test
  fun `starts at 1x when the ultra-wide is hidden from apps (POCO X3 NFC)`() {
    // Xiaomi hides camera 21 (1.86 mm): apps see only the main back camera.
    assertEquals(1.0, Lenses.zoomMin(listOf(5.43f)), 0.0)
  }

  @Test
  fun `a second back camera of about the same focal length is not an ultra-wide`() {
    // A depth or macro camera the app can see, or a second main sensor.
    assertEquals(1.0, Lenses.zoomMin(listOf(5.43f, 4.9f)), 0.0)
  }

  @Test
  fun `starts at 1x with no back camera`() {
    assertEquals(1.0, Lenses.zoomMin(emptyList()), 0.0)
  }
}
