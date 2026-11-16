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

  /** `frame`: the upright frame's ARGB pixels, `width` × `height`, row by row. */
  fun fill(frame: IntArray, width: Int, height: Int, region: BallDetect.Region, tile: Int, side: Int, out: FloatBuffer) {
    val s = region.scale
    // the source rectangle: the whole frame (region 0) or the tile, cut at the frame's edges
    val srcW = if (isWhole(region, width, height, side)) width else min(tile, width - region.x0)
    val srcH = if (isWhole(region, width, height, side)) height else min(tile, height - region.y0)
    // how far the scaled picture reaches in the square
    val reachX = srcW * s
    val reachY = srcH * s
    out.rewind()
    if (s == 1.0) {
      for (v in 0 until side) for (u in 0 until side) {
        if (u < srcW && v < srcH) put(out, frame[(region.y0 + v) * width + region.x0 + u]) else grey(out)
      }
      return
    }
    for (v in 0 until side) {
      val inY = v + 0.5 <= reachY
      val sy = ((v + 0.5) / s - 0.5).coerceIn(0.0, (srcH - 1).toDouble())
      val y0 = floor(sy).toInt()
      val y1 = min(y0 + 1, srcH - 1)
      val fy = (sy - y0).toFloat()
      for (u in 0 until side) {
        if (!inY || u + 0.5 > reachX) { grey(out); continue }
        val sx = ((u + 0.5) / s - 0.5).coerceIn(0.0, (srcW - 1).toDouble())
        val x0 = floor(sx).toInt()
        val x1 = min(x0 + 1, srcW - 1)
        val fx = (sx - x0).toFloat()
        val p00 = frame[(region.y0 + y0) * width + region.x0 + x0]
        val p01 = frame[(region.y0 + y0) * width + region.x0 + x1]
        val p10 = frame[(region.y0 + y1) * width + region.x0 + x0]
        val p11 = frame[(region.y0 + y1) * width + region.x0 + x1]
        for (shift in intArrayOf(0, 8, 16)) { // B, G, R
          val a = ((p00 shr shift) and 0xFF).toFloat()
          val b = ((p01 shr shift) and 0xFF).toFloat()
          val c = ((p10 shr shift) and 0xFF).toFloat()
          val d = ((p11 shr shift) and 0xFF).toFloat()
          val top = a + (b - a) * fx
          val bottom = c + (d - c) * fx
          out.put(top + (bottom - top) * fy)
        }
      }
    }
  }

  /**
   * Region 0 (the whole frame letterboxed) is the one at the origin whose scale fits the whole frame into the square. A
   * tile at the origin with the same scale exists only when the frame is no bigger than a tile, and then both are the
   * same pixels.
   */
  private fun isWhole(region: BallDetect.Region, width: Int, height: Int, side: Int): Boolean =
    region.x0 == 0 && region.y0 == 0 && region.scale == min(side.toDouble() / width, side.toDouble() / height)

  private fun put(out: FloatBuffer, p: Int) {
    out.put((p and 0xFF).toFloat())
    out.put(((p shr 8) and 0xFF).toFloat())
    out.put(((p shr 16) and 0xFF).toFloat())
  }

  private fun grey(out: FloatBuffer) {
    out.put(GREY); out.put(GREY); out.put(GREY)
  }
}
