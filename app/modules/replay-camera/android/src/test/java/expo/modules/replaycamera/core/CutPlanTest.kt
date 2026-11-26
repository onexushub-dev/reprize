package expo.modules.replaycamera.core

import org.junit.Assert.assertEquals
import org.junit.Test

/** Where each sample of a clip lands in its shared cut (`ClipCut`), without re-encoding: the iPhone's ClipCut.swift. */
class CutPlanTest {
  // 10 frames a second, a key frame every second (the recordings' 1 s segments).
  private val frames = (0 until 30).map { CutPlan.Sample(it * 100_000L, key = it % 10 == 0) }

  @Test fun theCutStartsExactlyAtItsStartTheFramesBeforeSqueezedIntoItsFirstMicroseconds() {
    val out = CutPlan.video(frames, startUs = 1_300_000, endUs = 2_000_000)
    // Nothing before the key frame at 1.0 s; 1.0, 1.1, 1.2 s squeezed into 0, 1, 2 µs; 1.3 s lands at 0 + 3 µs.
    assertEquals(List(10) { null }, out.subList(0, 10))
    assertEquals(listOf<Long?>(0, 1, 2, 3, 100_003, 200_003, 300_003, 400_003, 500_003, 600_003), out.subList(10, 20))
    assertEquals(List(10) { null }, out.subList(20, 30))
  }

  @Test fun aCutOnAKeyFrameHasNothingSqueezed() {
    val out = CutPlan.video(frames, startUs = 1_000_000, endUs = 1_300_000)
    assertEquals(listOf<Long?>(0, 100_000, 200_000), out.subList(10, 13))
    assertEquals(null, out[13])
  }

  @Test fun theLeadIsHowManyFramesAreSqueezed() {
    assertEquals(0, CutPlan.lead(frames, 1_000_000))
    assertEquals(3, CutPlan.lead(frames, 1_300_000))
    assertEquals(0, CutPlan.lead(frames, 0))
  }

  @Test fun soundKeepsOnlyTheCutAndLinesUpWithThePicture() {
    assertEquals(null, CutPlan.audio(1_299_999, startUs = 1_300_000, endUs = 2_000_000, lead = 3))
    assertEquals(3L, CutPlan.audio(1_300_000, startUs = 1_300_000, endUs = 2_000_000, lead = 3))
    assertEquals(500_003L, CutPlan.audio(1_800_000, startUs = 1_300_000, endUs = 2_000_000, lead = 3))
    assertEquals(null, CutPlan.audio(2_000_000, startUs = 1_300_000, endUs = 2_000_000, lead = 3))
  }

  @Test fun theWholeClipIsCopiedAsItIs() {
    val out = CutPlan.video(frames, startUs = 0, endUs = 3_000_000)
    assertEquals(frames.map { it.timeUs }, out)
  }
}
