package expo.modules.replaycamera.focus

import org.junit.Assert.assertEquals
import org.junit.Test

class NextCourtTest {
  /** A person by centre x, height and top y. */
  private fun p(cx: Double, h: Double, y: Double = 0.4) = FocusBox(cx - 0.02, y, 0.04, h)

  @Test
  fun `leaves out a small person far right of everyone (the court next door, Marcus 2026-11-17)`() {
    // the clip that showed it: four players, someone on the court to the right
    val players = listOf(p(0.27, 0.33), p(0.38, 0.14), p(0.56, 0.11), p(0.59, 0.22))
    assertEquals(players, NextCourt.keep(players + p(0.83, 0.15)))
  }

  @Test
  fun `leaves out a small person far left of everyone too`() {
    val players = listOf(p(0.40, 0.30), p(0.55, 0.15), p(0.62, 0.14))
    assertEquals(players, NextCourt.keep(listOf(p(0.12, 0.10)) + players))
  }

  @Test
  fun `keeps a near player however far from the others (60 percent of the tallest or more)`() {
    val boxes = listOf(p(0.40, 0.30), p(0.55, 0.15), p(0.62, 0.14), p(0.90, 0.18))
    assertEquals(boxes, NextCourt.keep(boxes))
  }

  @Test
  fun `keeps a small person within 0_2 of the frame width of the next one`() {
    val boxes = listOf(p(0.30, 0.30), p(0.45, 0.15), p(0.60, 0.14), p(0.79, 0.12))
    assertEquals(boxes, NextCourt.keep(boxes))
  }

  @Test
  fun `leaves frames with fewer than three people as they are`() {
    val boxes = listOf(p(0.20, 0.30), p(0.90, 0.10))
    assertEquals(boxes, NextCourt.keep(boxes))
  }

  @Test
  fun `keeps the order of the boxes it keeps`() {
    val a = p(0.59, 0.22); val b = p(0.27, 0.33); val c = p(0.38, 0.14)
    assertEquals(listOf(a, b, c), NextCourt.keep(listOf(a, p(0.95, 0.12), b, c)))
  }
}
