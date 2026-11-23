package expo.modules.replaycamera.focus

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * A decoder hands 1080p back in a 1088-row buffer (a multiple of 16) with a 1080-row crop window: only the window is the
 * picture. Reading the whole buffer squeezed 1088 rows into 1080 and moved the ball by up to 8 px (2026-11-16: the
 * phone's ball scores drifted by a median of 0.07 from the Mac's on the same frames).
 */
class FrameCropTest {
  @Test fun theLastRowOfTheWindowIsTheLastRowOfThePicture() {
    assertEquals(1079, FrameDecoder.sourceIndex(1079, 1080, 0, 1080))
    assertEquals(0, FrameDecoder.sourceIndex(0, 1080, 0, 1080))
  }

  @Test fun aWindowOffsetIsAdded() {
    assertEquals(8 + 100, FrameDecoder.sourceIndex(100, 1080, 8, 1080))
  }

  @Test fun halvingSamplesEveryOtherRowOfTheWindow() {
    assertEquals(1078, FrameDecoder.sourceIndex(539, 540, 0, 1080))
  }
}
