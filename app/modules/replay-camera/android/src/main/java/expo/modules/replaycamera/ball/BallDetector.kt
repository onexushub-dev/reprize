package expo.modules.replaycamera.ball

import android.content.Context
import android.util.Log
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.gpu.GpuDelegate
import java.io.Closeable
import java.io.FileNotFoundException
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The ball model on the phone (the Android side of `BallAnalyzer.Detector`): `assets/<modelId>.tflite` through LiteRT,
 * every region of a frame rendered into the model's 416 square (`RegionRender`) and decoded (`BallDetect`).
 *
 * GPU first, in fp16. A native crash inside the GPU driver cannot be caught, and MediaPipe's GPU delegate once took the
 * whole app down on a test phone: `gpuTrying` is written before the first GPU inference of the process and cleared once
 * it returns; found set at the next start, the app died there, and this phone uses the CPU from then on (`gpuBad`).
 */
class BallDetector(context: Context, val modelId: String, private val force: Backend? = null) : Closeable {
  /** How the model runs: the GPU in fp16 (precision loss allowed), the GPU in fp32, or the CPU (XNNPACK, 4 threads). */
  enum class Backend { GPU16, GPU32, CPU }

  class NoModel(modelId: String) : Exception("no model $modelId")

  /** "gpu16", "gpu32" or "cpu". */
  val backend: String
  /** Milliseconds the last `detect` spent preparing the regions and in the model. */
  var lastPrepMs = 0.0
    private set
  var lastModelMs = 0.0
    private set

  private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  private val interpreter: Interpreter
  private var gpu: GpuDelegate? = null
  private var gpuChecked = false
  // two of each: the helper fills one region's input (and decodes the other's output) while the model runs
  private val inputs = List(2) { ByteBuffer.allocateDirect(SIDE * SIDE * 3 * 4).order(ByteOrder.nativeOrder()) }
  private val floats = inputs.map { it.asFloatBuffer() }
  private val output = ByteBuffer.allocateDirect(ROWS * 6 * 4).order(ByteOrder.nativeOrder())
  private val raws = List(2) { FloatArray(ROWS * 6) }
  private val helper = java.util.concurrent.Executors.newSingleThreadExecutor { r ->
    Thread(r, "ball-prep").apply { priority = Thread.currentThread().priority }
  }
  private val anchors = BallDetect.anchors(SIDE)

  init {
    val model = try {
      context.assets.open("$modelId.tflite").use { s ->
        val bytes = s.readBytes()
        ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply { put(bytes); rewind() }
      }
    } catch (e: FileNotFoundException) {
      throw NoModel(modelId)
    }
    if (prefs.getBoolean(GPU_TRYING, false)) {
      Log.w(TAG, "the app stopped inside a GPU run before: the CPU from now on")
      prefs.edit().putBoolean(GPU_BAD, true).putBoolean(GPU_TRYING, false).commit()
    }
    var made: Interpreter? = null
    val wanted = force ?: DEFAULT
    if (wanted != Backend.CPU && !prefs.getBoolean(GPU_BAD, false)) {
      try {
        val d = GpuDelegate(GpuDelegate.Options().setPrecisionLossAllowed(wanted == Backend.GPU16))
        made = Interpreter(model, Interpreter.Options().addDelegate(d))
        gpu = d
      } catch (e: Throwable) {
        Log.w(TAG, "GPU delegate unavailable ($e): CPU")
        gpu?.close()
        gpu = null
      }
    }
    interpreter = made ?: Interpreter(model, Interpreter.Options().setNumThreads(4))
    backend = if (gpu == null) "cpu" else if (wanted == Backend.GPU16) "gpu16" else "gpu32"
    Log.i(TAG, "$modelId on the $backend")
  }

  /**
   * One upright frame (ARGB, `width` × `height`): all `regions`, the candidates in frame px, before NMS.
   *
   * The model runs on this thread (the GPU delegate wants the thread that made it); a helper thread prepares the next
   * region and decodes the last one meanwhile, into two alternating buffers. The candidates come out in region order, as
   * they did one region at a time. `lastPrepMs` is the time this thread waited for the helper.
   */
  fun detect(frame: IntArray, width: Int, height: Int, regions: List<BallDetect.Region>): List<BallDetect.Box> {
    var waitNs = 0L
    var modelNs = 0L
    val found = arrayOfNulls<List<BallDetect.Box>>(regions.size)
    // the helper runs in submission order: fill(i + 1), decode(i), fill(i + 2), ... so fill(i + 2) (which reuses the
    // buffers of region i) starts only after decode(i) is done
    fun fill(i: Int) = helper.submit {
      RegionRender.fill(frame, width, height, regions[i], TILE, SIDE, floats[i % 2])
    }
    var next = if (regions.isNotEmpty()) fill(0) else null
    for (i in regions.indices) {
      val t0 = System.nanoTime()
      next!!.get()
      waitNs += System.nanoTime() - t0
      next = if (i + 1 < regions.size) fill(i + 1) else null
      val buf = inputs[i % 2]
      buf.rewind()
      output.rewind()
      val t1 = System.nanoTime()
      run(buf)
      modelNs += System.nanoTime() - t1
      output.rewind()
      val raw = raws[i % 2]
      output.asFloatBuffer().get(raw)
      val region = regions[i]
      // [1, 6, 3549]: column c of anchor i at c × 3549 + i
      helper.submit { found[i] = BallDetect.decode(ROWS, 0, anchors, region, CONF) { a, c -> raw[c * ROWS + a] } }
    }
    val t0 = System.nanoTime()
    helper.submit {}.get() // the last decode
    waitNs += System.nanoTime() - t0
    lastPrepMs = waitNs / 1e6
    lastModelMs = modelNs / 1e6
    val boxes = ArrayList<BallDetect.Box>()
    for (f in found) boxes += f!!
    return boxes
  }

  private fun run(input: ByteBuffer) {
    if (gpu != null && !gpuChecked) {
      prefs.edit().putBoolean(GPU_TRYING, true).commit()
      interpreter.run(input, output)
      prefs.edit().putBoolean(GPU_TRYING, false).commit()
      gpuChecked = true
      return
    }
    interpreter.run(input, output)
  }

  override fun close() {
    helper.shutdownNow()
    interpreter.close()
    gpu?.close()
  }

  companion object {
    const val TAG = "ReprizeBall"
    /** What runs when nothing is forced. */
    val DEFAULT = Backend.GPU16
    const val SIDE = 416
    const val TILE = 416
    const val CONF = 0.05f
    private const val ROWS = 3549
    private const val PREFS = "reprize.ball"
    private const val GPU_TRYING = "gpuTrying"
    private const val GPU_BAD = "gpuBad"

    /** First use (spec §4.7): one grey 1920 × 1080 frame, 19 regions, a warm-up, then the median of 3 runs in ms. */
    fun probe(context: Context, modelId: String): Double {
      BallDetector(context, modelId).use { d ->
        val frame = IntArray(1920 * 1080) { (0xFF shl 24) or (102 shl 16) or (115 shl 8) or 128 }
        val regions = BallDetect.regions(1920, 1080, SIDE, TILE)
        d.detect(frame, 1920, 1080, regions)
        val ms = (0 until 3).map {
          val t0 = System.nanoTime()
          d.detect(frame, 1920, 1080, regions)
          (System.nanoTime() - t0) / 1e6
        }.sorted()
        Log.i(TAG, "probe: ${"%.0f".format(ms[1])} ms a 19-region frame on the ${d.backend}")
        return ms[1]
      }
    }
  }
}
