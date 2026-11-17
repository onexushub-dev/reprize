package expo.modules.replaycamera.focus

import android.content.Context
import org.tensorflow.lite.Interpreter
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.Callable
import java.util.concurrent.Executors

/**
 * People in one frame, as Jogadores finds them (the Android side of `ClipScan.PeopleDetector`): EfficientDet-Lite0
 * ("person" only) on the whole frame and on `tilesPerSample` of the 9 half-frame tiles (`ScanTiles`, round-robin; 9 = all
 * of them, as on the iPhone), merged.
 *
 * LiteRT on the CPU, decoded as MediaPipe did it (`PersonDecode`, `PersonInput`). The model (uint8) runs on one core
 * whatever the thread count (2026-11-17, POCO X3: 431 ms a sample on 1 thread, 436 on 2, 438 on 4), so the regions of a
 * sample are shared between `lanes` copies of the model running side by side. The result does not depend on `lanes`:
 * each region's people are merged in the same order. 4 lanes (2026-11-17, Test Lab and the POCO X3): faster than 3 on 5
 * of 6 phones (POCO 196 against 237 ms a sample, Galaxy A06 400/474, moto g05 389/530, S24 95/122), 10% slower on the A56.
 */
class PeopleDetector(context: Context, private val tilesPerSample: Int = 9, lanes: Int = 4) : Closeable {
  private val anchors = PersonDecode.anchors(context.assets.open(ANCHORS).use { it.readBytes() })
  private val lanes: List<Lane>
  private val pool = if (lanes > 1) Executors.newFixedThreadPool(lanes - 1) { r ->
    Thread(r, "people-lane").apply { priority = Thread.currentThread().priority }
  } else null

  /** One copy of the model with its own buffers. */
  private inner class Lane(model: ByteBuffer) {
    val interpreter = Interpreter(model, Interpreter.Options().setNumThreads(1))
    val input: ByteBuffer = ByteBuffer.allocateDirect(PersonInput.SIDE * PersonInput.SIDE * 3).order(ByteOrder.nativeOrder())
    val boxesOut: ByteBuffer = ByteBuffer.allocateDirect(PersonDecode.ANCHORS * 4 * 4).order(ByteOrder.nativeOrder())
    val boxes = FloatArray(PersonDecode.ANCHORS * 4)
    val scores = FloatArray(PersonDecode.ANCHORS)
    val boxesIndex = (0 until interpreter.outputTensorCount).first { interpreter.getOutputTensor(it).shape().last() == 4 }
    val classesIndex = (0 until interpreter.outputTensorCount).first { interpreter.getOutputTensor(it).shape().last() == CLASSES }
    var fillNs = 0L
    var modelNs = 0L
    var decodeNs = 0L

    /** One region through the model: people as x, y, width, height, score, 0..1 of the region. */
    fun people(frame: Pixels, x0: Int, y0: Int, cw: Int, ch: Int): List<FloatArray> {
      val t0 = System.nanoTime()
      PersonInput.fill(frame.argb, frame.width, frame.height, x0, y0, cw, ch, input)
      input.rewind()
      boxesOut.rewind()
      val t1 = System.nanoTime()
      // only the boxes are copied out; the 90 classes (6.9 MB, "person" is the one used) are read where the model left them
      interpreter.runForMultipleInputsOutputs(arrayOf<Any>(input), mapOf<Int, Any>(boxesIndex to boxesOut))
      val t2 = System.nanoTime()
      boxesOut.rewind()
      boxesOut.asFloatBuffer().get(boxes)
      val classes: FloatBuffer = interpreter.getOutputTensor(classesIndex).asReadOnlyBuffer().order(ByteOrder.nativeOrder()).asFloatBuffer()
      for (k in 0 until PersonDecode.ANCHORS) scores[k] = classes.get(k * CLASSES) // "person" is the first label
      val found = PersonDecode.people(boxes, scores, anchors, MIN_CONFIDENCE, MAX_RESULTS)
      val t3 = System.nanoTime()
      fillNs += t1 - t0; modelNs += t2 - t1; decodeNs += t3 - t2
      return found
    }
  }

  init {
    val model = context.assets.open(MODEL).use { s ->
      val bytes = s.readBytes()
      ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply { put(bytes); rewind() }
    }
    this.lanes = (0 until maxOf(1, lanes)).map { Lane(model.duplicate()) }
  }

  /** Nanoseconds spent so far, all lanes together, preparing the input, in the model and decoding. */
  val fillNs get() = lanes.sumOf { it.fillNs }
  val modelNs get() = lanes.sumOf { it.modelNs }
  val decodeNs get() = lanes.sumOf { it.decodeNs }

  /** A region of the frame in pixels; `tile` = one of the half-frame tiles (its people are checked against it). */
  private class Region(val x0: Int, val y0: Int, val cw: Int, val ch: Int, val tile: Boolean)

  /** The people in `frame` (upright, long side `FRAME_LONG_SIDE`), 0..1 of the frame, origin top-left. */
  fun detect(frame: Pixels, index: Int): List<FocusBox> {
    val w = frame.width
    val h = frame.height
    val regions = ArrayList<Region>()
    regions.add(Region(0, 0, w, h, false))
    for (r in ScanTiles.tiles(index, tilesPerSample)) {
      val top = 1 - r.yBottom - r.height // the regions are given with the origin at the bottom-left
      regions.add(Region((r.x * w).toInt(), (top * h).toInt(), (r.width * w).toInt(), (r.height * h).toInt(), true))
    }
    // lane k takes regions k, k + lanes, ...; each region's people keep their slot
    val perRegion = arrayOfNulls<List<FloatArray>>(regions.size)
    fun work(k: Int) {
      var i = k
      while (i < regions.size) {
        val g = regions[i]
        perRegion[i] = lanes[k].people(frame, g.x0, g.y0, g.cw, g.ch)
        i += lanes.size
      }
    }
    val others = (1 until lanes.size).map { k -> pool!!.submit(Callable { work(k) }) }
    work(0)
    others.forEach { it.get() }

    val found = ArrayList<Pair<FocusBox, Double>>()
    for ((i, g) in regions.withIndex()) {
      val sx0 = g.x0.toDouble() / w
      val sy0 = g.y0.toDouble() / h
      val sw = g.cw.toDouble() / w
      val sh = g.ch.toDouble() / h
      for (p in perRegion[i]!!) {
        val score = p[4].toDouble()
        val box = FocusBox(sx0 + p[0] * sw, sy0 + p[1] * sh, p[2] * sw, p[3] * sh)
        if (box.width <= 0 || box.height <= 0) continue
        if (!g.tile) { found.add(Pair(box, score)); continue }
        val midX = box.x + box.width / 2
        val midY = box.y + box.height / 2
        val inside = midX >= sx0 - 0.02 && midX <= sx0 + sw + 0.02 && midY >= sy0 - 0.02 && midY <= sy0 + sh + 0.02
        if (inside && ScanTiles.plausible(box, score, w.toDouble(), h.toDouble())) found.add(Pair(box, score))
      }
    }
    return PersonBoxes.merge(found)
  }

  override fun close() {
    pool?.shutdownNow()
    lanes.forEach { it.interpreter.close() }
  }

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
