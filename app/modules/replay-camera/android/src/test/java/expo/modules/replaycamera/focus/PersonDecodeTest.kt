package expo.modules.replaycamera.focus

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer

/**
 * Jogadores on LiteRT decodes EfficientDet-Lite0 as MediaPipe's ObjectDetector does (fixture `people-decode.json`, from
 * `docs/focus-refs/tools/lab/people_fixture.py`: the model's real outputs on three frames of a clip, and a small picture
 * shrunk the way MediaPipe shrinks it).
 */
class PersonDecodeTest {
  private val fx = JSONObject(javaClass.classLoader!!.getResource("people-decode.json")!!.readText())
  private val anchors = PersonDecode.anchors(File("src/main/assets/efficientdet_lite0_anchors.bin").readBytes())

  @Test fun theAnchorsAreTheModels() {
    assertEquals(19206 * 4, anchors.size)
    // (y_center, x_center, h, w): the first is a 0.075 square at the first cell's centre
    assertEquals(0.0125f, anchors[0], 1e-6f); assertEquals(0.0125f, anchors[1], 1e-6f)
    assertEquals(0.075f, anchors[2], 1e-6f); assertEquals(0.075f, anchors[3], 1e-6f)
  }

  @Test fun thePeopleAreMediaPipes() {
    val cases = fx.getJSONArray("cases")
    for (c in 0 until cases.length()) {
      val case = cases.getJSONObject(c)
      val boxes = FloatArray(19206 * 4)
      val scores = FloatArray(19206)
      val a = case.getJSONArray("anchors")
      for (i in 0 until a.length()) {
        val row = a.getJSONArray(i)
        val k = row.getInt(0)
        for (j in 0 until 4) boxes[k * 4 + j] = row.getDouble(1 + j).toFloat()
        scores[k] = row.getDouble(5).toFloat()
      }
      val got = PersonDecode.people(boxes, scores, anchors, 0.3f, 30)
      val want = case.getJSONArray("people")
      assertEquals("frame ${case.getInt("t")}", want.length(), got.size)
      for (i in 0 until want.length()) {
        val w = want.getJSONArray(i)
        for (j in 0 until 5) assertEquals("frame ${case.getInt("t")} person $i [$j]", w.getDouble(j), got[i][j].toDouble(), 1e-5)
      }
    }
  }

  @Test fun atMostMaxResultsAfterNms() {
    val boxes = FloatArray(19206 * 4)
    val scores = FloatArray(19206)
    // three far-apart anchors of the first level, all over the threshold
    for ((n, k) in listOf(0, 9 * 20, 9 * 39).withIndex()) scores[k] = 0.9f - n * 0.1f
    assertEquals(2, PersonDecode.people(boxes, scores, anchors, 0.3f, 2).size)
    assertEquals(0.9f, PersonDecode.people(boxes, scores, anchors, 0.3f, 2)[0][4], 1e-6f)
  }

  @Test fun theShrinkIsMediaPipes() {
    val s = fx.getJSONObject("shrink")
    val w = s.getInt("w")
    val h = s.getInt("h")
    val px = s.getJSONArray("pixels")
    val argb = IntArray(w * h) { i -> px.getJSONArray(i).let { (0xFF shl 24) or (it.getInt(0) shl 16) or (it.getInt(1) shl 8) or it.getInt(2) } }
    val out = ByteBuffer.allocateDirect(320 * 320 * 3)
    PersonInput.fill(argb, w, h, 0, 0, w, h, out)
    val samples = s.getJSONArray("samples")
    for (i in 0 until samples.length()) {
      val r = samples.getJSONArray(i)
      val u = r.getInt(0)
      val v = r.getInt(1)
      for (ch in 0 until 3) {
        val got = out.get((v * 320 + u) * 3 + ch).toInt() and 0xFF
        // OpenCV's bilinear works in 1/32 px fixed point: a level or two of rounding
        assertTrue("($u,$v)[$ch] got $got want ${r.getInt(2 + ch)}", Math.abs(got - r.getInt(2 + ch)) <= 2)
      }
    }
  }

  @Test fun aTileIsShrunkFromItsOwnPixels() {
    // a 4 × 2 picture, left half black, right half white: the right tile alone is all white
    val argb = IntArray(8) { i -> if (i % 4 >= 2) -1 else (0xFF shl 24) }
    val out = ByteBuffer.allocateDirect(320 * 320 * 3)
    PersonInput.fill(argb, 4, 2, 2, 0, 2, 2, out)
    for (i in 0 until 320 * 320 * 3 step 997) assertEquals(255, out.get(i).toInt() and 0xFF)
  }
}
