package expo.modules.replaycamera.focus

import android.content.Context
import android.graphics.Bitmap
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.objectdetector.ObjectDetector
import java.io.Closeable

/**
 * People in one frame, as Jogadores finds them (the Android side of `ClipScan.PeopleDetector`): EfficientDet-Lite0
 * ("person" only, through MediaPipe, CPU) on the whole frame and on `tilesPerSample` of the 9 half-frame tiles
 * (`ScanTiles`, round-robin; 9 = all of them, as on the iPhone), merged. The GPU delegate is not used: MediaPipe's
 * own GL thread crashed the whole app on a test phone.
 */
class PeopleDetector(context: Context, private val tilesPerSample: Int = 9) : Closeable {
  private val detector: ObjectDetector = ObjectDetector.createFromOptions(context, ObjectDetector.ObjectDetectorOptions.builder()
    .setBaseOptions(BaseOptions.builder().setModelAssetPath(MODEL).setDelegate(Delegate.CPU).build())
    .setRunningMode(RunningMode.IMAGE)
    .setScoreThreshold(MIN_CONFIDENCE)
    .setCategoryAllowlist(listOf("person"))
    .setMaxResults(30)
    .build())

  /** The people in `frame` (upright, long side `FRAME_LONG_SIDE`), 0..1 of the frame, origin top-left. */
  fun detect(frame: Bitmap, index: Int): List<FocusBox> {
    val w = frame.width
    val h = frame.height
    val found = ArrayList<Pair<FocusBox, Double>>()
    fun run(bitmap: Bitmap, x0: Double, y0: Double, sw: Double, sh: Double, tile: Boolean) {
      val result = detector.detect(BitmapImageBuilder(bitmap).build())
      for (d in result.detections()) {
        val score = d.categories().firstOrNull()?.score()?.toDouble() ?: continue
        if (score < MIN_CONFIDENCE) continue
        val b = d.boundingBox()
        val box = FocusBox(x0 + b.left / bitmap.width * sw, y0 + b.top / bitmap.height * sh,
          (b.right - b.left) / bitmap.width * sw, (b.bottom - b.top) / bitmap.height * sh)
        if (box.width <= 0 || box.height <= 0) continue
        if (!tile) { found.add(Pair(box, score)); continue }
        val midX = box.x + box.width / 2
        val midY = box.y + box.height / 2
        val inside = midX >= x0 - 0.02 && midX <= x0 + sw + 0.02 && midY >= y0 - 0.02 && midY <= y0 + sh + 0.02
        if (inside && ScanTiles.plausible(box, score, w.toDouble(), h.toDouble())) found.add(Pair(box, score))
      }
    }
    run(frame, 0.0, 0.0, 1.0, 1.0, false)
    for (r in ScanTiles.tiles(index, tilesPerSample)) {
      val top = 1 - r.yBottom - r.height // the regions are given with the origin at the bottom-left
      val tile = Bitmap.createBitmap(frame, (r.x * w).toInt(), (top * h).toInt(), (r.width * w).toInt(), (r.height * h).toInt())
      run(tile, r.x, top, r.width, r.height, true)
      tile.recycle()
    }
    return PersonBoxes.merge(found)
  }

  override fun close() = detector.close()

  companion object {
    private const val MODEL = "efficientdet_lite0_int8.tflite"
    private const val MIN_CONFIDENCE = 0.3f
    /** The longest side of the frame given to the detector; a half-frame tile of it is what the detector sees up close. */
    const val FRAME_LONG_SIDE = 1280
  }
}
