package expo.modules.replaycamera.focus

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Kotlin Modo Foco rules against the Swift core's own runs (focus-vectors.json): the same clip is framed the same. */
class FocusCoreTest {
  private val v = JSONObject(javaClass.classLoader!!.getResource("focus-vectors.json")!!.readText())

  private fun nums(a: JSONArray) = (0 until a.length()).map { a.getDouble(it) }
  private fun samples(a: JSONArray) = (0 until a.length()).map { i ->
    val o = a.getJSONObject(i)
    val boxes = o.getJSONArray("boxes")
    FocusSample(o.getDouble("t"), (0 until boxes.length()).map { nums(boxes.getJSONArray(it)).let { b -> FocusBox(b[0], b[1], b[2], b[3]) } })
  }

  @Test fun pathsMatchTheSwiftCore() {
    val cases = v.getJSONArray("cases")
    var compared = 0
    for (c in 0 until cases.length()) {
      val case = cases.getJSONObject(c)
      val scene = samples(case.getJSONArray("samples"))
      val runs = case.getJSONArray("runs")
      for (r in 0 until runs.length()) {
        val run = runs.getJSONObject(r)
        val tuning = if (run.getString("tuning") == "action") FocusTuning.ACTION else FocusTuning.STANDARD
        val aspect = if (run.getString("aspect") == "landscape") FocusAspect.LANDSCAPE else FocusAspect.PORTRAIT
        val got = FocusPath.compute(scene, 1920.0, 1080.0, aspect, run.getBoolean("zoom"), t = tuning)
        val label = "${case.getString("name")}/${run.getString("tuning")}/${run.getString("aspect")}/${run.getBoolean("zoom")}"
        if (run.isNull("rects")) { assertNull(label, got); continue }
        val want = run.getJSONArray("rects")
        assertEquals(label, want.length(), got!!.size)
        for (i in 0 until want.length()) {
          val w = nums(want.getJSONArray(i))
          val g = got[i]
          for ((k, value) in listOf(g.x, g.y, g.width, g.height).withIndex()) assertEquals("$label[$i][$k]", w[k], value, 1e-9)
        }
        compared += 1
      }
    }
    assertTrue("at least some framings were produced", compared >= 6)
  }

  @Test fun gridMatches() {
    val frames = listOf(
      FocusSample(130.0, listOf(FocusBox(0.1, 0.1, 0.1, 0.3))), FocusSample(230.0, emptyList()),
      FocusSample(640.0, listOf(FocusBox(0.5, 0.2, 0.1, 0.3))), FocusSample(745.0, listOf(FocusBox(0.6, 0.2, 0.1, 0.3))))
    val got = FocusGrid.samples(frames, 100.0, Double.POSITIVE_INFINITY, 100.0)
    val want = samples(v.getJSONArray("grid"))
    assertEquals(want, got)
  }

  @Test fun mergeMatches() {
    val input = v.getJSONObject("merge").getJSONArray("in")
    // Swift used the bottom-left origin for these; the rules only compare boxes, so the origin does not matter.
    val boxes = (0 until input.length()).map { nums(input.getJSONArray(it)).let { b -> Pair(FocusBox(b[0], b[1], b[2], b[3]), b[4]) } }
    val want = v.getJSONObject("merge").getJSONArray("out")
    val got = PersonBoxes.merge(boxes)
    assertEquals(want.length(), got.size)
    for (i in got.indices) {
      val w = nums(want.getJSONArray(i))
      assertEquals(w[0], got[i].x, 1e-12); assertEquals(w[1], got[i].y, 1e-12)
      assertEquals(w[2], got[i].width, 1e-12); assertEquals(w[3], got[i].height, 1e-12)
    }
  }

  @Test fun plausibleMatches() {
    val a = v.getJSONArray("plausible")
    for (i in 0 until a.length()) {
      val o = a.getJSONObject(i)
      val got = ScanTiles.plausible(FocusBox(0.0, 0.0, o.getDouble("w"), o.getDouble("h")), o.getDouble("c"), 1920.0, 1080.0)
      assertEquals("case $i", o.getBoolean("ok"), got)
    }
  }

  @Test fun rampMatches() {
    val ramp = v.getJSONObject("ramp")
    val rects = ramp.getJSONArray("rects").let { a -> (0 until a.length()).map { nums(a.getJSONArray(it)).let { r -> FocusRect(r[0], r[1], r[2], r[3]) } } }
    val at = nums(ramp.getJSONArray("at"))
    val out = ramp.getJSONArray("out")
    for (i in at.indices) {
      val w = nums(out.getJSONArray(i))
      val g = FocusRamp.rect(at[i], rects, 0.0, 100.0)
      assertEquals(w[0], g.x, 1e-12); assertEquals(w[1], g.y, 1e-12); assertEquals(w[2], g.width, 1e-12); assertEquals(w[3], g.height, 1e-12)
    }
  }
}
