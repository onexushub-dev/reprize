package expo.modules.replaycamera.focus

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NextCourtTest {
  /** A person by centre x and height. */
  private fun p(cx: Double, h: Double) = FocusBox(cx - 0.02, 0.4, 0.04, h)

  /** A clip of `n` pictures with the same people in each. */
  private fun clip(n: Int, vararg people: FocusBox) = List(n) { people.toList() }

  // The clip that showed it (Marcus, 2026-11-17): two near players at 0.2 and 0.55, the far pair between them, someone
  // on the court to the right.
  private val near1 = p(0.20, 0.30)
  private val near2 = p(0.55, 0.31)
  private val far1 = p(0.46, 0.13)
  private val far2 = p(0.50, 0.12)
  private val next = p(0.93, 0.13)

  @Test
  fun `the main court is where the tall people stand over the whole clip`() {
    val court = NextCourt.court(clip(30, near1, near2, far1, far2, next))!!
    assertEquals(0.20, court.from, 0.02)
    assertEquals(0.55, court.to, 0.02)
  }

  @Test
  fun `leaves out a small person beyond the main court and keeps everyone on it`() {
    val rows = clip(30, near1, near2, far1, far2, next)
    assertEquals(clip(30, near1, near2, far1, far2), NextCourt.keep(rows))
  }

  @Test
  fun `keeps two people side by side on the next court out too`() {
    val rows = clip(30, near1, near2, far1, p(0.91, 0.13), p(0.97, 0.15))
    assertEquals(clip(30, near1, near2, far1), NextCourt.keep(rows))
  }

  @Test
  fun `keeps a player found short for a moment inside the court (the box of a crouching player)`() {
    val rows = clip(29, near1, near2, far1, far2) + listOf(listOf(p(0.19, 0.16), near2, far1, far2))
    assertEquals(rows, NextCourt.keep(rows))
  }

  @Test
  fun `keeps a small person within the margin of the court`() {
    val rows = clip(30, near1, near2, far1, p(0.55 + NextCourt.MARGIN - 0.01, 0.12))
    assertEquals(rows, NextCourt.keep(rows))
  }

  @Test
  fun `keeps a tall person anywhere`() {
    val rows = clip(30, near1, near2, far1) + clip(5, near1, near2, p(0.95, 0.30))
    assertEquals(rows, NextCourt.keep(rows))
  }

  @Test
  fun `changes nothing when there are too few people to tell the court`() {
    val rows = clip(3, near1, far1, next)
    assertNull(NextCourt.court(rows))
    assertEquals(rows, NextCourt.keep(rows))
  }
}
