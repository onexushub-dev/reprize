package expo.modules.replaycamera.ball

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** `BallFramingTests.swift`: decoding, the cut's grid and the detections cache. */
class BallFramingTest {
  @Test fun aVerticalClipAlsoHasNineteenRegions() {
    assertEquals(19, BallDetect.regions(1080, 1920, 416, 416).size)
  }

  @Test fun decodeAndNms() {
    val anchors = BallDetect.anchors(416)
    val table = Array(anchors.size) { FloatArray(6) }
    table[0] = floatArrayOf(0f, 0f, 0f, 0f, 0.04f, 1f)
    table[1] = floatArrayOf(0.5f, 0.5f, 1f, 1f, 0.9f, 0.5f)
    table[2] = floatArrayOf(-0.5f, 0.5f, 1f, 1f, 0.8f, 0.5f)
    val boxes = BallDetect.decode(anchors.size, 0, anchors, BallDetect.Region(100, 50, 1.0)) { i, c -> table[i][c] }
    assertEquals(2, boxes.size)
    assertEquals(112.0, boxes[0].cx, 1e-4)
    assertEquals(54.0, boxes[0].cy, 1e-4)
    assertEquals(8 * Math.exp(1.0), boxes[0].w, 1e-4)
    assertEquals(0.45, boxes[0].score, 1e-6)
    val whole = BallDetect.decode(anchors.size, 0, anchors, BallDetect.Region(0, 0, 416.0 / 1920)) { i, c -> table[i][c] }
    assertEquals(12.0 * 1920 / 416, whole[0].cx, 1e-3)
    val c = BallDetect.frameCandidates(boxes, 1920, 1080)
    assertEquals(listOf(BallCandidate(0.0583, 0.05, 0.0113, 0.0201, 0.45)), c)
    val a = BallDetect.Box(10.0, 10.0, 4.0, 4.0, 0.5)
    val b = BallDetect.Box(11.0, 10.0, 4.0, 4.0, 0.5)
    assertEquals(listOf(a), BallDetect.nms(listOf(a, b)))
    assertEquals(listOf(b), BallDetect.nms(listOf(b, a)))
  }

  @Test fun gridPhaseAndCache() {
    assertEquals(10, BallFraming.rows(2000.0, 3000.0))
    assertEquals(11, BallFraming.rows(2000.0, 3050.0))
    assertEquals(listOf(2000.0, 2200.0, 2400.0, 2600.0, 2800.0), BallFraming.missingTicks(2000.0, 3000.0, 0, emptyList()))
    val dets = listOf(2016.7, 2216.7, 2416.7).map { BallFraming.Detection(it, emptyList()) }
    assertEquals(listOf(2600.0, 2800.0), BallFraming.missingTicks(2000.0, 3000.0, 0, dets))
    assertEquals(1, BallFraming.phase(1900.0, 3000.0, dets))
    assertEquals(listOf(2600.0, 2800.0), BallFraming.missingTicks(1900.0, 3000.0, 1, dets))
    val g = BallFraming.grids(2000.0, 3000.0, 0, dets).first
    assertEquals(10, g.size)
    assertNotNull(g[0]); assertNull(g[1]); assertNotNull(g[4]); assertNull(g[6])
  }

  @Test fun cacheRoundTrip() {
    val dets = listOf(BallFraming.Detection(216.7, listOf(BallCandidate(0.5, 0.25, 0.01, 0.02, 0.9))))
    val back = JSONObject(BallFraming.detectionsJSON(dets, 1920, 1080, "ball_tiny_gym", emptyList()).toString())
    assertEquals(dets, BallFraming.detections(back, 1920, 1080, "ball_tiny_gym"))
    assertEquals(emptyList<BallFraming.Detection>(), BallFraming.detections(back, 1080, 1920, "ball_tiny_gym"))
  }

  @Test fun aCacheForAnotherModelOrSizeIsEmpty() {
    val dets = listOf(BallFraming.Detection(100.0, listOf(BallCandidate(0.5, 0.25, 0.01, 0.02, 0.9))))
    val back = JSONObject(BallFraming.detectionsJSON(dets, 1920, 1080, "ball_tiny_gym", emptyList()).toString())
    assertTrue(BallFraming.detections(back, 1920, 1080, "ball_tiny_btpl").isEmpty())
    assertTrue(BallFraming.detections(back, 1280, 720, "ball_tiny_gym").isEmpty())
    assertTrue(BallFraming.detections(null, 1920, 1080, "ball_tiny_gym").isEmpty())
  }

  @Test fun screensAndStaleAreKept() {
    val c = BallCandidate(0.5, 0.25, 0.01, 0.02, 0.9)
    val dets = listOf(BallFraming.Detection(100.0, listOf(c), listOf(c)))
    val screens = listOf(listOf(0.1, 0.1, 0.3, 0.2))
    val back = JSONObject(BallFraming.detectionsJSON(dets, 1920, 1080, "m", screens).toString())
    assertEquals(screens, BallFraming.screens(back))
    assertEquals(dets, BallFraming.detections(back, 1920, 1080, "m"))
  }

  @Test fun computeMatchesParityFixture() {
    val cases = fixture("ball-parity.json").getJSONArray("cases")
    for (i in 0 until cases.length()) {
      val c = cases.getJSONObject(i)
      val v = c.getJSONArray("videoSize").doubles()
      val r = BallFraming.compute(candidateFrames(c.getJSONArray("frames")), v[0], v[1], rows(c.getJSONArray("todayPortrait")),
        rows(c.getJSONArray("todayNative")), people = boxRows(c.optJSONArray("people")))
      val e = c.getJSONObject("expect")
      assertEquals(e.getDouble("zoom"), r.zoom.zoom, 1e-9)
      val want = rows(e.getJSONArray("rects"))
      var worst = 0.0
      for (k in 0 until minOf(want.size, r.rects.size)) for (j in 0 until 4) worst = maxOf(worst, Math.abs(r.rects[k][j] - want[k][j]))
      assertTrue(worst < 1e-5)
      val file = BallFraming.framingJSON(r, 0.0, v[0], v[1], BallSport.basketball.rules)
      assertEquals(want.size, file.getJSONArray("portrait").length())
      assertEquals("ball-t50", file.getString("rules"))
      assertEquals(1, file.getInt("v"))
      assertEquals(100.0, file.getDouble("stepMs"), 0.0)
      assertEquals(0, file.getJSONArray("landscape").length())
    }
  }

  @Test fun framingFileHasTheVerdict() {
    val r = BallFraming.Result(listOf(listOf(0.123456, 0.0, 0.31640625, 1.0)), BallZoomResult(1.0, 1.0, 1.0, 1.0, 0.25),
      1, 1, BallVerdict(BallVerdictReason.RARELY_FOUND, 0.2, 0.25, 12.34, 0.123))
    val f = BallFraming.framingJSON(r, 500.0, 1920.0, 1080.0, "ball-bt-t60")
    assertEquals(0.1235, f.getJSONArray("portrait").getJSONArray(0).getDouble(0), 0.0)
    val v = f.getJSONObject("verdict")
    assertEquals(false, v.getBoolean("apply"))
    assertEquals("rarelyFound", v.getString("reason"))
    assertEquals(12.3, v.getDouble("ballPx"), 0.0)
    assertEquals(0.12, v.getDouble("pan"), 0.0)
  }
}
