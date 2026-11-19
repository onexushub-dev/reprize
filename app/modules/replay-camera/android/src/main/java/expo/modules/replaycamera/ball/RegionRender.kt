package expo.modules.replaycamera.ball

import java.nio.FloatBuffer
import kotlin.math.floor
import kotlin.math.min

/**
 * One region of a frame as the ball model takes it (as `BallAnalyzer.Detector.detect` renders it on the iPhone): a
 * `side` × `side` square, B, G, R as floats 0–255, row by row, grey 114 where the picture does not reach. Region 0 is the
 * whole frame scaled by `region.scale` into the top-left corner; a tile is `tile` × `tile` px from (x0, y0) scaled by
 * `region.scale`. Scaling is bilinear with pixel centres at +0.5 and the border repeated (OpenCV's INTER_LINEAR, as the
 * lab's `ball_detect.py`); at scale 1 the pixels are copied.
 */
object RegionRender {
  private const val GREY = 114f

  /** One scratch array per thread: the square is built here and copied to the model's buffer in one call. */
  private val scratch = ThreadLocal<FloatArray>()

  /** `frame`: the upright frame's ARGB pixels, `width` × `height`, row by row. */
  fun fill(frame: IntArray, width: Int, height: Int, region: BallDetect.Region, tile: Int, side: Int, out: FloatBuffer) {
    val n = side * side * 3
    val a = scratch.get()?.takeIf { it.size == n } ?: FloatArray(n).also { scratch.set(it) }
    val s = region.scale
    // the source rectangle: the whole frame (region 0) or the tile, cut at the frame's edges
    val srcW = if (isWhole(region, width, height, side)) width else min(tile, width - region.x0)
    val srcH = if (isWhole(region, width, height, side)) height else min(tile, height - region.y0)
    java.util.Arrays.fill(a, GREY)
    if (s == 1.0) {
      for (v in 0 until min(side, srcH)) {
        var o = v * side * 3
        var i = (region.y0 + v) * width + region.x0
        for (u in 0 until min(side, srcW)) {
          val p = frame[i++]
          a[o] = (p and 0xFF).toFloat(); a[o + 1] = ((p shr 8) and 0xFF).toFloat(); a[o + 2] = ((p shr 16) and 0xFF).toFloat()
          o += 3
        }
      }
    } else {
      // how far the scaled picture reaches in the square
      val reachX = srcW * s
      val reachY = srcH * s
      // pixel u is picture while u + 0.5 <= reach
      val maxU = min(side, if (reachX < 0.5) 0 else floor(reachX - 0.5).toInt() + 1)
      val maxV = min(side, if (reachY < 0.5) 0 else floor(reachY - 0.5).toInt() + 1)
      val x0s = IntArray(maxU)
      val x1s = IntArray(maxU)
      val fxs = FloatArray(maxU)
      for (u in 0 until maxU) {
        val sx = ((u + 0.5) / s - 0.5).coerceIn(0.0, (srcW - 1).toDouble())
        val x0 = floor(sx).toInt()
        x0s[u] = region.x0 + x0; x1s[u] = region.x0 + min(x0 + 1, srcW - 1); fxs[u] = (sx - x0).toFloat()
      }
      for (v in 0 until maxV) {
        val sy = ((v + 0.5) / s - 0.5).coerceIn(0.0, (srcH - 1).toDouble())
        val y0 = floor(sy).toInt()
        val r0 = (region.y0 + y0) * width
        val r1 = (region.y0 + min(y0 + 1, srcH - 1)) * width
        val fy = (sy - y0).toFloat()
        var o = v * side * 3
        for (u in 0 until maxU) {
          val p00 = frame[r0 + x0s[u]]; val p01 = frame[r0 + x1s[u]]; val p10 = frame[r1 + x0s[u]]; val p11 = frame[r1 + x1s[u]]
          val fx = fxs[u]
          var shift = 0
          while (shift <= 16) { // B, G, R
            val q00 = ((p00 shr shift) and 0xFF).toFloat(); val q01 = ((p01 shr shift) and 0xFF).toFloat()
            val q10 = ((p10 shr shift) and 0xFF).toFloat(); val q11 = ((p11 shr shift) and 0xFF).toFloat()
            val top = q00 + (q01 - q00) * fx
            val bottom = q10 + (q11 - q10) * fx
            a[o++] = top + (bottom - top) * fy
            shift += 8
          }
        }
      }
    }
    out.rewind()
    out.put(a)
  }

  /**
   * Region 0 (the whole frame letterboxed) is the one at the origin whose scale fits the whole frame into the square. A
   * tile at the origin with the same scale exists only when the frame is no bigger than a tile, and then both are the
   * same pixels.
   */
  private fun isWhole(region: BallDetect.Region, width: Int, height: Int, side: Int): Boolean =
    region.x0 == 0 && region.y0 == 0 && region.scale == min(side.toDouble() / width, side.toDouble() / height)


}
