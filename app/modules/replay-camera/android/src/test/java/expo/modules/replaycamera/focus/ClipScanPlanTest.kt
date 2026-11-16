package expo.modules.replaycamera.focus

import org.junit.Assert.assertEquals
import org.junit.Test

/** What size the ball search reads the frames at (as `BallAnalyzer.swift`: 4K scaled to 1920, even sides). */
class ClipScanPlanTest {
  @Test fun fullHdIsNotScaled() { assertEquals(Pair(1920, 1080), ClipScan.ballSize(1920, 1080, 1920)) }
  @Test fun fourKIsScaledTo1920() { assertEquals(Pair(1920, 1080), ClipScan.ballSize(3840, 2160, 1920)) }
  @Test fun aPortrait4KClipKeepsItsShape() { assertEquals(Pair(1080, 1920), ClipScan.ballSize(2160, 3840, 1920)) }
  @Test fun zeroMeansNative() { assertEquals(Pair(3840, 2160), ClipScan.ballSize(3840, 2160, 0)) }
  @Test fun oddSidesRoundToEven() { assertEquals(Pair(1920, 1082), ClipScan.ballSize(2560, 1443, 1920)) }

  @Test fun pixelsTurnUpright() {
    // 3 × 2, values 0..5 row by row; turned 90° clockwise it is 2 × 3: first row 3, 0
    val p = Pixels(IntArray(6) { it }, 3, 2)
    val r = p.rotated(90)
    assertEquals(2, r.width); assertEquals(3, r.height)
    assertEquals(listOf(3, 0, 4, 1, 5, 2), r.argb.toList())
    assertEquals(listOf(5, 4, 3, 2, 1, 0), p.rotated(180).argb.toList())
    assertEquals(listOf(2, 5, 1, 4, 0, 3), p.rotated(270).argb.toList())
    assertEquals(p.argb.toList(), p.rotated(0).argb.toList())
  }

  @Test fun theThumbnailIsTheMeanGreyOfEachBlock() {
    // 320 × 2 frame: left half white, right half black → 160 wide, 1 row: 80 white-ish then black
    val px = IntArray(320 * 2) { i -> if (i % 320 < 160) -1 else (0xFF shl 24) }
    val t = Pixels(px, 320, 2).grey(160)
    assertEquals(160, t.width); assertEquals(1, t.height)
    assertEquals(255, t.pixels[0].toInt() and 0xFF)
    assertEquals(0, t.pixels[159].toInt() and 0xFF)
  }
}
