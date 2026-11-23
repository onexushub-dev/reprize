package expo.modules.replaycamera.ball

import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/** The regions as the model takes them: 416 × 416 × 3 floats, B, G, R, 0–255, grey 114 where the picture does not reach. */
class RegionRenderTest {
  private fun out(): FloatBuffer = ByteBuffer.allocateDirect(416 * 416 * 3 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
  private fun argb(r: Int, g: Int, b: Int) = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
  private fun at(f: FloatBuffer, x: Int, y: Int) = (0 until 3).map { f.get((y * 416 + x) * 3 + it) }

  @Test fun aTileIsCopiedPixelForPixelAsBgr() {
    val w = 832
    val h = 416
    val px = IntArray(w * h) { i -> argb((i % w) % 256, (i / w) % 256, 7) }
    val f = out()
    RegionRender.fill(px, w, h, BallDetect.Region(416, 0, 1.0), 416, 416, f)
    assertEquals(listOf(7f, 0f, (416 % 256).toFloat()), at(f, 0, 0))
    assertEquals(listOf(7f, 10f, ((416 + 5) % 256).toFloat()), at(f, 5, 10))
  }

  @Test fun theWholeFrameSitsTopLeftOverGrey() {
    val w = 1920
    val h = 1080
    val px = IntArray(w * h) { argb(200, 100, 50) }
    val f = out()
    RegionRender.fill(px, w, h, BallDetect.regions(w, h, 416, 416)[0], 416, 416, f)
    assertEquals(listOf(50f, 100f, 200f), at(f, 0, 0))
    assertEquals(listOf(50f, 100f, 200f), at(f, 415, 233))
    assertEquals(listOf(114f, 114f, 114f), at(f, 0, 234))
    assertEquals(listOf(114f, 114f, 114f), at(f, 415, 415))
  }

  @Test fun aTileAtTheEdgeOfASmallFrameIsPaddedWithGrey() {
    val px = IntArray(300 * 300) { argb(1, 2, 3) }
    val f = out()
    RegionRender.fill(px, 300, 300, BallDetect.Region(0, 0, 1.0), 416, 416, f)
    assertEquals(listOf(3f, 2f, 1f), at(f, 299, 299))
    assertEquals(listOf(114f, 114f, 114f), at(f, 300, 0))
    assertEquals(listOf(114f, 114f, 114f), at(f, 0, 300))
  }

  @Test fun aScaledTileInterpolates() {
    // a 2 × 1 frame, black then white, scaled ×2 into the top-left: the middle columns blend
    val px = intArrayOf(argb(0, 0, 0), argb(200, 200, 200))
    val f = out()
    RegionRender.fill(px, 2, 1, BallDetect.Region(0, 0, 2.0), 2, 416, f)
    assertEquals(0f, at(f, 0, 0)[0], 1e-4f)
    assertEquals(50f, at(f, 1, 0)[0], 1e-4f)
    assertEquals(150f, at(f, 2, 0)[0], 1e-4f)
    assertEquals(200f, at(f, 3, 0)[0], 1e-4f)
    assertEquals(114f, at(f, 4, 0)[0], 1e-4f)
  }

  @Test fun aPictureReachingHalfAPixelKeepsThatPixel() {
    // 11 × 1 at scale 0.5 reaches 5.5 px: pixels 0..5 are picture (5 + 0.5 <= 5.5), pixel 6 is grey
    val px = IntArray(11) { argb(10, 20, 30) }
    val f = out()
    RegionRender.fill(px, 11, 1, BallDetect.Region(0, 0, 0.5), 11, 416, f)
    assertEquals(30f, at(f, 5, 0)[0], 1e-4f)
    assertEquals(114f, at(f, 6, 0)[0], 1e-4f)
  }
}
