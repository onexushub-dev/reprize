package expo.modules.replaycamera.focus

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The Jogadores file as the iPhone writes it (`FocusAnalyzer.write` in Swift): people rows and their median height for Bola. */
class FocusFileTest {
  private fun written(frames: List<FocusSample>, startMs: Double, endMs: Double, everyMs: Double): Pair<Boolean, JSONObject> {
    val f = File.createTempFile("clip", ".focus.json")
    val r = FocusAnalyzer.write(frames, startMs, endMs, everyMs, 1920.0, 1080.0, f.path, false)
    return Pair(r.first, JSONObject(f.readText())).also { f.delete() }
  }

  private fun box(x: Double, h: Double) = FocusBox(x, 0.3, 0.05, h)

  @Test fun theFileHasPeopleRowsAndTheMedianHeight() {
    val frames = listOf(FocusSample(0.0, listOf(box(0.2, 0.2))), FocusSample(100.0, listOf(box(0.4, 0.3))),
      FocusSample(200.0, listOf(box(0.6, 0.4))))
    val (_, f) = written(frames, 0.0, 300.0, 100.0)
    assertEquals(0.3, f.getDouble("playersHeight"), 0.0)
    val people = f.getJSONArray("people")
    assertEquals(3, people.length())
    assertEquals(0.4, people.getJSONArray(1).getJSONArray(0).getDouble(0), 0.0)
  }

  @Test fun theBoxesAreRoundedTo4Decimals() {
    val (_, f) = written(listOf(FocusSample(0.0, listOf(FocusBox(0.123456, 0.3, 0.05, 0.2)))), 0.0, 100.0, 100.0)
    assertEquals(0.1235, f.getJSONArray("people").getJSONArray(0).getJSONArray(0).getDouble(0), 0.0)
  }

  @Test fun at200MsTheLastPeopleAreHeldToTheEnd() {
    val frames = listOf(FocusSample(0.0, listOf(box(0.2, 0.3))), FocusSample(200.0, listOf(box(0.3, 0.3))),
      FocusSample(400.0, listOf(box(0.4, 0.3))))
    val (_, f) = written(frames, 0.0, 600.0, 200.0)
    val people = f.getJSONArray("people")
    assertEquals(6, people.length())
    assertEquals(people.getJSONArray(4).toString(), people.getJSONArray(5).toString())
  }

  @Test fun rulesAndStepAreTheIPhones() {
    val (_, f) = written(listOf(FocusSample(0.0, emptyList())), 0.0, 100.0, 100.0)
    assertEquals("v15-acao-zoom110", f.getString("rules"))
    assertEquals(100.0, f.getDouble("stepMs"), 0.0)
    assertEquals(1, f.getInt("v"))
  }

  @Test fun tooFewPeopleGivesEmptyTracksAndNotReady() {
    val (ready, f) = written((0 until 10).map { FocusSample(it * 100.0, emptyList()) }, 0.0, 1000.0, 100.0)
    assertFalse(ready)
    assertEquals(0, f.getJSONArray("landscape").length())
    assertEquals(0, f.getJSONArray("portrait").length())
    assertTrue(f.has("people"))
    assertFalse(f.has("playersHeight"))
  }

  @Test fun inRangeKeepsTheRangesPictures() {
    val frames = listOf(100.0, 499.6, 500.0, 900.0).map { FocusSample(it, emptyList()) }
    assertEquals(listOf(499.6, 500.0), FocusAnalyzer.inRange(frames, 500.0, 900.0).map { it.tMs })
  }
}
