package expo.modules.replaycamera.focus

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** `FocusFramesTests` in `ScanTicksTests.swift`: the people of each analysed picture, kept as found. */
class FocusFramesTest {
  private val frames = listOf(
    FocusSample(2003.25, listOf(FocusBox(0.123456789, 0.2, 0.05, 0.31))),
    FocusSample(2203.0, emptyList()),
  )

  private fun roundTrip(o: JSONObject) = JSONObject(o.toString())

  @Test fun theFileKeepsEveryFrameAsFound() {
    val back = FocusFrames.read(roundTrip(FocusFrames.json(frames, 1920, 1080)), 1920, 1080)
    assertEquals(frames, back)
  }

  @Test fun anotherVideoSizeOrABrokenFileIsAnEmptyCache() {
    val obj = roundTrip(FocusFrames.json(frames, 1920, 1080))
    assertTrue(FocusFrames.read(obj, 3840, 2160).isEmpty())
    assertTrue(FocusFrames.read(null, 1920, 1080).isEmpty())
    assertTrue(FocusFrames.read(JSONObject().put("v", 2), 1920, 1080).isEmpty())
  }

  @Test fun mergedFramesAreInTimeOrderWithTheNewerOfTwoAtTheSameTime() {
    val newer = FocusSample(2203.0, listOf(FocusBox(0.5, 0.5, 0.1, 0.2)))
    val early = FocusSample(1800.0, emptyList())
    val all = FocusFrames.merged(frames, listOf(newer, early))
    assertEquals(listOf(1800.0, 2003.25, 2203.0), all.map { it.tMs })
    assertEquals(newer.boxes, all[2].boxes)
  }
}
