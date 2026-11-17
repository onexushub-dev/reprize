package expo.modules.replaycamera.focus

import android.content.Context
import org.tensorflow.lite.Interpreter
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/**
 * People in one frame, as Jogadores finds them (the Android side of `ClipScan.PeopleDetector`): EfficientDet-Lite0
 * ("person" only) on the whole frame and on `tilesPerSample` of the 9 half-frame tiles (`ScanTiles`, round-robin; 9 = all
 * of them, as on the iPhone), merged.
 *
 * LiteRT on the CPU (XNNPACK; 4 threads alone, 2 beside the ball detector so its region preparation keeps its cores), decoded as MediaPipe did it (`PersonDecode`, `PersonInput`). 2026-11-16, POCO X3:
 * the model alone takes 23 ms on the CPU and 48 ms on the GPU (an int8 model), and MediaPipe took 85 ms a call around it.
 */
class PeopleDetector(context: Context, private val tilesPerSample: Int = 9, threads: Int = 4) : Closeable {
  private val interpreter: Interpreter
  private val anchors = PersonDecode.anchors(context.assets.open(ANCHORS).use { it.readBytes() })
  private val input = ByteBuffer.allocateDirect(PersonInput.SIDE * PersonInput.SIDE * 3).order(ByteOrder.nativeOrder())
  private val boxesOut = ByteBuffer.allocateDirect(PersonDecode.ANCHORS * 4 * 4).order(ByteOrder.nativeOrder())
  private val classesOut = ByteBuffer.allocateDirect(PersonDecode.ANCHORS * CLASSES * 4).order(ByteOrder.nativeOrder())
  private val boxes = FloatArray(PersonDecode.ANCHORS * 4)
  private val scores = FloatArray(PersonDecode.ANCHORS)
  private val boxesIndex: Int
  private val classesIndex: Int

  init {
    val model = context.assets.open(MODEL).use { s ->
      val bytes = s.readBytes()
      ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply { put(bytes); rewind() }
    }
    interpreter = Interpreter(model, Interpreter.Options().setNumThreads(threads))
    boxesIndex = (0 until interpreter.outputTensorCount).first { interpreter.getOutputTensor(it).shape().last() == 4 }
    classesIndex = (0 until interpreter.outputTensorCount).first { interpreter.getOutputTensor(it).shape().last() == CLASSES }
  }

  /** The people in `frame` (upright, long side `FRAME_LONG_SIDE`), 0..1 of the frame, origin top-left. */
  fun detect(frame: Pixels, index: Int): List<FocusBox> {
    val w = frame.width
    val h = frame.height
    val found = ArrayList<Pair<FocusBox, Double>>()
    fun run(x0: Int, y0: Int, cw: Int, ch: Int, tile: Boolean) {
      val sx0 = x0.toDouble() / w
      val sy0 = y0.toDouble() / h
      val sw = cw.toDouble() / w
      val sh = ch.toDouble() / h
      for (p in people(frame, x0, y0, cw, ch)) {
        val score = p[4].toDouble()
        val box = FocusBox(sx0 + p[0] * sw, sy0 + p[1] * sh, p[2] * sw, p[3] * sh)
        if (box.width <= 0 || box.height <= 0) continue
        if (!tile) { found.add(Pair(box, score)); continue }
        val midX = box.x + box.width / 2
        val midY = box.y + box.height / 2
        val inside = midX >= sx0 - 0.02 && midX <= sx0 + sw + 0.02 && midY >= sy0 - 0.02 && midY <= sy0 + sh + 0.02
        if (inside && ScanTiles.plausible(box, score, w.toDouble(), h.toDouble())) found.add(Pair(box, score))
      }
    }
    run(0, 0, w, h, false)
    for (r in ScanTiles.tiles(index, tilesPerSample)) {
      val top = 1 - r.yBottom - r.height // the regions are given with the origin at the bottom-left
      run((r.x * w).toInt(), (top * h).toInt(), (r.width * w).toInt(), (r.height * h).toInt(), true)
    }
    return PersonBoxes.merge(found)
  }

  /** One region through the model: people as x, y, width, height, score, 0..1 of the region. */
  private fun people(frame: Pixels, x0: Int, y0: Int, cw: Int, ch: Int): List<FloatArray> {
    PersonInput.fill(frame.argb, frame.width, frame.height, x0, y0, cw, ch, input)
    input.rewind()
    boxesOut.rewind()
    classesOut.rewind()
    interpreter.runForMultipleInputsOutputs(arrayOf<Any>(input), mapOf<Int, Any>(boxesIndex to boxesOut, classesIndex to classesOut))
    boxesOut.rewind()
    boxesOut.asFloatBuffer().get(boxes)
    val classes: FloatBuffer = classesOut.rewind().let { classesOut.asFloatBuffer() }
    for (k in 0 until PersonDecode.ANCHORS) scores[k] = classes.get(k * CLASSES) // "person" is the first label
    return PersonDecode.people(boxes, scores, anchors, MIN_CONFIDENCE, MAX_RESULTS)
  }

  override fun close() = interpreter.close()

  companion object {
    private const val MODEL = "efficientdet_lite0_int8.tflite"
    private const val ANCHORS = "efficientdet_lite0_anchors.bin"
    private const val CLASSES = 90
    private const val MIN_CONFIDENCE = 0.3f
    private const val MAX_RESULTS = 30
    /** The longest side of the frame given to the detector; a half-frame tile of it is what the detector sees up close. */
    const val FRAME_LONG_SIDE = 1280
  }
}
