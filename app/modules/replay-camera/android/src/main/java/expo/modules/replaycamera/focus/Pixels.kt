package expo.modules.replaycamera.focus

import android.graphics.Bitmap

/** An ARGB picture, row by row (plain JVM, so the scan's picture handling is unit-tested). */
class Pixels(val argb: IntArray, val width: Int, val height: Int) {
  /** A small grey picture (BallScreen's thumbnails): `width` wide, the mean of R, G, B over each block of the picture. */
  class Grey(val pixels: ByteArray, val width: Int, val height: Int)

  /** Turned clockwise by `degrees` (0, 90, 180, 270): the stored frame made upright. */
  fun rotated(degrees: Int): Pixels {
    val w = width
    val h = height
    return when (((degrees % 360) + 360) % 360) {
      90 -> Pixels(IntArray(w * h) { i -> val r = i / h; val c = i % h; argb[(h - 1 - c) * w + r] }, h, w)
      180 -> Pixels(IntArray(w * h) { i -> argb[w * h - 1 - i] }, w, h)
      270 -> Pixels(IntArray(w * h) { i -> val r = i / h; val c = i % h; argb[c * w + (w - 1 - r)] }, h, w)
      else -> this
    }
  }

  /** Grey thumbnail `tw` px wide (height in proportion, rounded down), each pixel the mean over its block. */
  fun grey(tw: Int): Grey {
    val th = maxOf(1, (tw.toDouble() * height / maxOf(1, width)).toInt())
    val out = ByteArray(tw * th)
    for (y in 0 until th) {
      val y0 = y * height / th
      val y1 = maxOf(y0 + 1, (y + 1) * height / th)
      for (x in 0 until tw) {
        val x0 = x * width / tw
        val x1 = maxOf(x0 + 1, (x + 1) * width / tw)
        var r = 0L
        var g = 0L
        var b = 0L
        var n = 0
        for (yy in y0 until y1) for (xx in x0 until x1) {
          val p = argb[yy * width + xx]
          r += (p shr 16) and 0xFF; g += (p shr 8) and 0xFF; b += p and 0xFF
          n += 1
        }
        out[y * tw + x] = (((r + g + b) / n) / 3).toInt().toByte()
      }
    }
    return Grey(out, tw, th)
  }

  /** Nearest-pixel copy no longer than `longSide` (people detection only looks at shapes). */
  fun shrunk(longSide: Int): Pixels {
    if (longSide <= 0 || maxOf(width, height) <= longSide) return this
    val s = longSide.toDouble() / maxOf(width, height)
    val w = maxOf(2, (width * s).toInt() / 2 * 2)
    val h = maxOf(2, (height * s).toInt() / 2 * 2)
    return Pixels(IntArray(w * h) { i -> argb[minOf(height - 1, (i / w) * height / h) * width + minOf(width - 1, (i % w) * width / w)] }, w, h)
  }

  fun toBitmap(): Bitmap = Bitmap.createBitmap(argb, width, height, Bitmap.Config.ARGB_8888)
}
