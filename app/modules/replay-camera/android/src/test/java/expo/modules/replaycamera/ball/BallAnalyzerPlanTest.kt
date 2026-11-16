package expo.modules.replaycamera.ball

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** What one Bola run will do, decided before any frame is read (the Android side of `BallAnalyzer.run`'s first half). */
class BallAnalyzerPlanTest {
  private val players = BallAnalyzer.Players(startMs = 0.0, endMs = 12000.0, everyMs = 200.0, peoplePath = "/x.people.json")

  private fun focusFile(rows: Int, people: Boolean): JSONObject {
    val f = JSONObject().put("v", 1).put("rules", "v15-acao-zoom110").put("stepMs", 100.0).put("startMs", 0.0)
      .put("portrait", JSONArray(List(rows) { JSONArray(listOf(0.3, 0.0, 0.3164, 1.0)) }))
    if (people) f.put("people", JSONArray(List(rows) { JSONArray() }))
    return f
  }

  @Test fun aFocusFileWithoutPeopleIsMadeAgain() {
    // the file Android wrote before 2026-11-16: no people, no playersHeight
    val p = BallAnalyzer.plan(focusFile(120, people = false), null, null, 1920, 1080, 2000.0, 8000.0, BallSport.basketball, 1920,
      players, "/x.focus.json")
    assertTrue(p.makeFocus)
    assertFalse(p.hasPeople)
  }

  @Test fun noFocusFileIsMade() {
    assertTrue(BallAnalyzer.plan(null, null, null, 1920, 1080, 2000.0, 8000.0, BallSport.basketball, 1920, players, "/x.focus.json").makeFocus)
  }

  @Test fun aFocusFileForAnotherCutIsMadeAgain() {
    assertFalse(BallAnalyzer.covers(focusFile(50, people = true), 8000.0, 12000.0))
  }

  @Test fun aFocusFileCoveringTheCutIsUsed() {
    assertTrue(BallAnalyzer.covers(focusFile(120, people = true), 2000.0, 8000.0))
    val p = BallAnalyzer.plan(focusFile(120, people = true), null, null, 1920, 1080, 2000.0, 8000.0, BallSport.basketball, 1920,
      players, "/x.focus.json")
    assertFalse(p.makeFocus)
    assertTrue(p.hasPeople)
    assertTrue(p.peopleTicks.isEmpty())
  }

  @Test fun noPlayersRangeNeverMakesTheFocusFile() {
    val p = BallAnalyzer.plan(null, null, null, 1920, 1080, 2000.0, 8000.0, BallSport.basketball, 1920, BallAnalyzer.Players(), "/x.focus.json")
    assertFalse(p.makeFocus)
  }

  @Test fun cachedDetectionsAreNotAnalysedAgain() {
    val cached = (0 until 25).map { BallFraming.Detection(it * 200.0 + 16.7, emptyList()) }
    val det = BallFraming.detectionsJSON(cached, 1920, 1080, "ball_tiny_gym", emptyList())
    val p = BallAnalyzer.plan(focusFile(120, true), JSONObject(det.toString()), null, 1920, 1080, 0.0, 10000.0, BallSport.basketball,
      1920, players, "/x.focus.json")
    assertEquals("ball_tiny_gym", p.detModel)
    assertEquals(50, p.total)
    assertEquals(25, p.reused)
    assertEquals((25 until 50).map { it * 200.0 }, p.missing)
  }

  @Test fun a4KCutKeysTheCacheByItsSize() {
    val p = BallAnalyzer.plan(null, null, null, 3840, 2160, 0.0, 1000.0, BallSport.beachTennis, 1920, players, "/x.focus.json")
    assertEquals("ball_tiny_btpl@1920", p.detModel)
    assertEquals(Pair(1920, 1080), Pair(p.ballWidth, p.ballHeight))
  }

  @Test fun aResumedRunFramesLikeAnUninterruptedOne() {
    val c = fixture("ball-parity.json").getJSONArray("cases").getJSONObject(0)
    val grid = candidateFrames(c.getJSONArray("frames"))
    val v = c.getJSONArray("videoSize").doubles()
    val all = grid.withIndex().filter { it.value != null }.map { BallFraming.Detection(it.index * 100.0, it.value!!) }
    val half = all.size / 2
    val kept = BallFraming.detections(JSONObject(BallFraming.detectionsJSON(all.take(half), v[0].toInt(), v[1].toInt(), "m",
      emptyList()).toString()), v[0].toInt(), v[1].toInt(), "m")
    val endMs = grid.size * 100.0
    fun framing(dets: List<BallFraming.Detection>): List<List<Double>> {
      val phase = BallFraming.phase(0.0, endMs, dets)
      val g = BallFraming.grids(0.0, endMs, phase, dets).first
      return BallFraming.compute(g, v[0], v[1], rows(c.getJSONArray("todayPortrait")), rows(c.getJSONArray("todayNative")),
        people = boxRows(c.optJSONArray("people"))).rects
    }
    assertEquals(framing(all), framing(kept + all.drop(half)))
  }

  @Test fun noBallAtAllIsUnsuitableNotACrash() {
    val c = fixture("ball-parity-bt.json").getJSONArray("cases").getJSONObject(0)
    val grid = candidateFrames(c.getJSONArray("frames")).map { it?.let { emptyList<BallCandidate>() } }
    val v = c.getJSONArray("videoSize").doubles()
    val r = BallFraming.compute(grid, v[0], v[1], rows(c.getJSONArray("todayPortrait")), rows(c.getJSONArray("todayNative")),
      BallSport.beachTennis, emptyList(), null, boxRows(c.getJSONArray("people")))
    assertNotNull(r.verdict?.reason)
    assertTrue(r.rects.isNotEmpty())
  }
}
