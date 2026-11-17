package expo.modules.replaycamera.focus

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * EfficientDet-Lite0's raw outputs to people, as MediaPipe's ObjectDetector decodes them (its source, read 2026-11-16):
 * the model's own fixed anchors (y_center, x_center, h, w), boxes in YXHW, centre = raw × anchor size + anchor centre,
 * size = exp(raw) × anchor size, the person score as given, the threshold before NMS, hard NMS dropping a box whose
 * IoU with a kept one is over 0.3, at most `maxResults` after it. Boxes 0..1 of the model's square.
 */
object PersonDecode {
  const val ANCHORS = 19206
  const val NMS_IOU = 0.3f

  /** The anchors asset (`efficientdet_lite0_anchors.bin`, float32 little-endian, 4 per anchor). */
  fun anchors(bytes: ByteArray): FloatArray {
    val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
    return FloatArray(b.remaining()).also { b.get(it) }
  }

  /** `boxes`: 4 raw values per anchor; `scores`: the person score per anchor. Each person as x, y, width, height, score. */
  fun people(boxes: FloatArray, scores: FloatArray, anchors: FloatArray, threshold: Float, maxResults: Int): List<FloatArray> {
    val found = ArrayList<FloatArray>()
    for (k in 0 until ANCHORS) {
      val s = scores[k]
      if (s < threshold) continue
      val ay = anchors[k * 4]
      val ax = anchors[k * 4 + 1]
      val ah = anchors[k * 4 + 2]
      val aw = anchors[k * 4 + 3]
      val cy = boxes[k * 4] * ah + ay
      val cx = boxes[k * 4 + 1] * aw + ax
      val h = exp(boxes[k * 4 + 2]) * ah
      val w = exp(boxes[k * 4 + 3]) * aw
      found.add(floatArrayOf(cx - w / 2, cy - h / 2, w, h, s))
    }
    // highest score first, ties in anchor order
    val order = found.sortedWith { a, b -> b[4].compareTo(a[4]) }
    val kept = ArrayList<FloatArray>()
    for (d in order) {
      if (kept.size >= maxResults) break
      if (kept.all { iou(d, it) <= NMS_IOU }) kept.add(d)
    }
    return kept
  }

  private fun iou(a: FloatArray, b: FloatArray): Float {
    val ix = max(0f, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    val iy = max(0f, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    val u = a[2] * a[3] + b[2] * b[3] - ix * iy
    return if (u > 0) ix * iy / u else 0f
  }
}

/**
 * The detector's input as MediaPipe makes it: the region (`x0`, `y0`, `cw` × `ch` of an ARGB picture) stretched to
 * 320 × 320, bilinear with no half-pixel offset (OpenCV's warpAffine), the region's edge repeated; R, G, B as uint8.
 */
object PersonInput {
  const val SIDE = 320

  private val scratch = ThreadLocal<ByteArray>()

  fun fill(argb: IntArray, width: Int, height: Int, x0: Int, y0: Int, cw: Int, ch: Int, out: ByteBuffer) {
    val a = scratch.get() ?: ByteArray(SIDE * SIDE * 3).also { scratch.set(it) }
    val sx = cw.toDouble() / SIDE
    val sy = ch.toDouble() / SIDE
    val c0s = IntArray(SIDE)
    val c1s = IntArray(SIDE)
    val txs = FloatArray(SIDE)
    for (u in 0 until SIDE) {
      val fx = u * sx
      val ix = floor(fx).toInt()
      c0s[u] = x0 + min(ix, cw - 1); c1s[u] = x0 + min(ix + 1, cw - 1); txs[u] = (fx - ix).toFloat()
    }
    var o = 0
    for (v in 0 until SIDE) {
      val fy = v * sy
      val iy = floor(fy).toInt()
      val ty = (fy - iy).toFloat()
      val r0 = (y0 + min(iy, ch - 1)) * width
      val r1 = (y0 + min(iy + 1, ch - 1)) * width
      for (u in 0 until SIDE) {
        val p00 = argb[r0 + c0s[u]]; val p01 = argb[r0 + c1s[u]]; val p10 = argb[r1 + c0s[u]]; val p11 = argb[r1 + c1s[u]]
        val tx = txs[u]
        var shift = 16
        while (shift >= 0) { // R, G, B
          val q00 = ((p00 shr shift) and 0xFF).toFloat(); val q01 = ((p01 shr shift) and 0xFF).toFloat()
          val q10 = ((p10 shr shift) and 0xFF).toFloat(); val q11 = ((p11 shr shift) and 0xFF).toFloat()
          val top = q00 + (q01 - q00) * tx
          val bottom = q10 + (q11 - q10) * tx
          a[o++] = (top + (bottom - top) * ty + 0.5f).toInt().coerceIn(0, 255).toByte()
          shift -= 8
        }
      }
    }
    out.rewind()
    out.put(a)
  }
}
