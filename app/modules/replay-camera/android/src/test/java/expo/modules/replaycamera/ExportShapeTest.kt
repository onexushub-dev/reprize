package expo.modules.replaycamera

import expo.modules.replaycamera.focus.FocusRect
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The picture a followed track leaves (crop to the rect's shape, then fit to the output): a 9:16 track of a 16:9 video is a
 * 9:16 picture, so it fills a 9:16 frame (the iPhone's `fill`); a track in the video's own shape keeps the video's spot.
 */
class ExportShapeTest {
  @Test fun aNineBySixteenTrackFillsANineBySixteenFrame() {
    val shape = ClipExporter.trackShape(FocusRect(0.3, 0.0, 0.31640625, 1.0), 1920, 1080)
    assertEquals(9.0 / 16.0, shape, 1e-6)
  }

  @Test fun aLandscapeTrackKeepsTheVideosShape() {
    val shape = ClipExporter.trackShape(FocusRect(0.1, 0.1, 0.6, 0.6), 1920, 1080)
    assertEquals(16.0 / 9.0, shape, 1e-6)
  }
}
