package expo.modules.replaycamera.ball

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BallDetectTest {
  @Test fun fixturesAreOnTheClasspath() {
    assertEquals(5, fixture("ball-parity.json").getJSONArray("cases").length())
  }

  @Test fun fullHdHasNineteenRegions() {
    val r = BallDetect.regions(1920, 1080, 416, 416)
    assertEquals(19, r.size)
    assertEquals(BallDetect.Region(0, 0, 416.0 / 1920.0), r[0])
    assertEquals(listOf(0, 301, 602, 902, 1203, 1504), BallDetect.starts(1920, 416))
    assertEquals(listOf(0, 332, 664), BallDetect.starts(1080, 416))
    // row by row: the second tile is the next one to the right on the top row
    assertEquals(BallDetect.Region(301, 0, 1.0), r[2])
    assertEquals(BallDetect.Region(0, 332, 1.0), r[7])
  }

  @Test fun aFrameSmallerThanATileHasOneStart() {
    assertEquals(listOf(0), BallDetect.starts(400, 416))
  }

  @Test fun anchorsAre3549InStrideOrder() {
    val a = BallDetect.anchors(416)
    assertEquals(3549, a.size)
    assertEquals(listOf(0f, 0f, 8f), a[0].toList())
    assertEquals(listOf(1f, 0f, 8f), a[1].toList())
    assertEquals(listOf(0f, 0f, 16f), a[52 * 52].toList())
    assertEquals(listOf(12f, 12f, 32f), a[3548].toList())
  }

  @Test fun decodeKeepsObjTimesClassAtOrOverConf() {
    val anchors = listOf(floatArrayOf(1f, 2f, 8f))
    val row = floatArrayOf(0.5f, 0.5f, 0f, 0f, 0.5f, 0.2f)
    val got = BallDetect.decode(1, 0, anchors, BallDetect.Region(0, 0, 1.0)) { _, c -> row[c] }
    assertEquals(1, got.size)
    assertEquals(12.0, got[0].cx, 1e-6)
    assertEquals(20.0, got[0].cy, 1e-6)
    assertEquals(8.0, got[0].w, 1e-6)
    assertEquals(8.0, got[0].h, 1e-6)
    assertEquals(0.1, got[0].score, 1e-6)
    val low = floatArrayOf(0.5f, 0.5f, 0f, 0f, 0.5f, 0.09f)
    assertTrue(BallDetect.decode(1, 0, anchors, BallDetect.Region(0, 0, 1.0)) { _, c -> low[c] }.isEmpty())
  }

  @Test fun decodeMapsATileBackToTheFrame() {
    val anchors = listOf(floatArrayOf(1f, 2f, 8f))
    val row = floatArrayOf(0.5f, 0.5f, 0f, 0f, 0.5f, 0.2f)
    val got = BallDetect.decode(1, 0, anchors, BallDetect.Region(301, 332, 0.5)) { _, c -> row[c] }
    assertEquals(301 + 24.0, got[0].cx, 1e-6)
    assertEquals(332 + 40.0, got[0].cy, 1e-6)
    assertEquals(16.0, got[0].w, 1e-6)
  }

  @Test fun nmsDropsTheOverlappingLowerScore() {
    val a = BallDetect.Box(100.0, 100.0, 20.0, 20.0, 0.5)
    val b = BallDetect.Box(102.0, 100.0, 20.0, 20.0, 0.8)
    val far = BallDetect.Box(300.0, 100.0, 20.0, 20.0, 0.3)
    assertEquals(listOf(b, far), BallDetect.nms(listOf(a, b, far)))
    val c = BallDetect.Box(102.0, 100.0, 20.0, 20.0, 0.5)
    assertEquals(listOf(a), BallDetect.nms(listOf(a, c)))
  }

  @Test fun frameCandidatesRoundTo4And3() {
    val got = BallDetect.frameCandidates(listOf(BallDetect.Box(960.123456, 540.0, 20.0, 20.0, 0.123456)), 1920, 1080)
    assertEquals(listOf(BallCandidate(0.5001, 0.5, 0.0104, 0.0185, 0.123)), got)
  }
}
