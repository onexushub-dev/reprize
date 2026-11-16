package expo.modules.replaycamera.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** `ScanTicksTests.swift` and `FramingMotionTests`. */
class ScanTicksTest {
  @Test fun ticksStartAtTheRangeStartAndStopBeforeItsEnd() {
    assertEquals(listOf(2001.0, 2201.0, 2401.0), ScanTicks.ticks(2001.0, 2601.0, 200.0))
    assertEquals(listOf(0.0, 200.0), ScanTicks.ticks(0.0, 400.0, 200.0))
    assertEquals(emptyList<Double>(), ScanTicks.ticks(500.0, 500.0, 200.0))
  }

  @Test fun aTickWithAKeptFrameInItsWindowIsNotMissing() {
    assertEquals(listOf(2201.0), ScanTicks.missing(listOf(2001.0, 2201.0, 2401.0), listOf(2450.0, 2003.0), 200.0))
  }

  @Test fun aFrameJustBeforeATickStandsForTheTickBeforeIt() {
    assertEquals(listOf(1200.0), ScanTicks.missing(listOf(1000.0, 1200.0), listOf(1199.0), 200.0))
    assertEquals(listOf(1000.0), ScanTicks.missing(listOf(1000.0, 1200.0), listOf(1199.6), 200.0))
  }

  @Test fun theCursorTakesTheFirstFrameAtOrAfterEachTick() {
    val c = ScanTicks.Cursor(listOf(0.0, 200.0, 400.0), 200.0)
    val frames = listOf(0.0, 33.0, 67.0, 100.0, 133.0, 167.0, 200.0, 233.0, 400.2, 433.0)
    assertEquals(listOf(0.0, 200.0, 400.2), frames.filter { c.take(it) })
    assertTrue(c.done)
  }

  @Test fun theCursorPassesOverATickWithNoFrameInItsWindow() {
    val c = ScanTicks.Cursor(listOf(1000.0, 1200.0, 1400.0), 100.0)
    assertEquals(listOf(1210.0, 1399.6), listOf(990.0, 1120.0, 1210.0, 1390.0, 1399.6).filter { c.take(it) })
  }

  @Test fun anEmptyCursorIsDoneAndTakesNothing() {
    val c = ScanTicks.Cursor(emptyList(), 100.0)
    assertTrue(c.done)
    assertFalse(c.take(50.0))
  }

  @Test fun theSpanCoversEveryTickWithItsWindow() {
    val s = ScanTicks.span(listOf(2001.0, 2201.0), 200.0, listOf(1800.0, 2600.0), 100.0)!!
    assertEquals(1800.0, s.first, 0.0)
    assertEquals(2700.0, s.second, 0.0)
    assertNull(ScanTicks.span(emptyList(), 200.0, emptyList(), 100.0))
  }

  private fun rects(centres: List<Double>, width: Double = 0.5) = centres.map { listOf(it - width / 2, 0.0, width, 1.0) }

  @Test fun aStillCameraHasNoPanAndNoTurns() {
    val m = FramingMotion.stats(rects(List(50) { 0.5 }), 100.0)
    assertEquals(0.0, m.first, 0.0)
    assertEquals(0.0, m.second, 0.0)
  }

  @Test fun panIsTheCentresSpeedInFrameWidthsPerSecond() {
    val m = FramingMotion.stats(rects((0 until 40).map { 0.3 + 0.01 * it }), 100.0)
    assertEquals(0.1, m.first, 1e-9)
    assertEquals(0.0, m.second, 0.0)
  }

  @Test fun aTurnIsAReversalBetweenPointsAtLeastTwoPercentApart() {
    val c = ArrayList<Double>()
    for (i in 0 until 34) c.add(0.30 + 0.10 * i / 33)
    for (i in 0 until 33) c.add(0.40 - 0.10 * (i + 1) / 33)
    for (i in 0 until 33) c.add(0.30 + 0.10 * (i + 1) / 33)
    assertEquals(2.0, FramingMotion.stats(rects(c), 100.0).second, 1e-9)
  }

  @Test fun aWobbleUnderTwoPercentIsNotATurn() {
    val c = (0 until 100).map { 0.5 + if (it % 2 == 0) 0.005 else -0.005 }
    assertEquals(0.0, FramingMotion.stats(rects(c), 100.0).second, 0.0)
  }

  @Test fun anAxisTheCropFillsDoesNotCount() {
    assertEquals(0.0, FramingMotion.stats(List(50) { listOf(0.25, 0.0, 0.5, 1.0) }, 100.0).second, 0.0)
    assertEquals(0.0, FramingMotion.stats(emptyList(), 100.0).first, 0.0)
  }
}
