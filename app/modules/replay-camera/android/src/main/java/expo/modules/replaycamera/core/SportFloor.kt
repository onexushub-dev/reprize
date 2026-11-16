package expo.modules.replaycamera.core

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Test 51 (port of `SportFloor.swift`, the lab's `sport_sand.py`): what the floor of a frame is made of, to tell a sand
 * court from a gym or a hard court. The frame is 320 px wide; in its bottom 55%: `sand`, the share of sand-coloured
 * pixels, and `texture`, their fine grain.
 */
object SportFloor {
  data class Measure(val sand: Double, val texture: Double)

  const val width = 320

  /** Swift's `.rounded()`: half away from zero. */
  private fun round(v: Double) = if (v >= 0) floor(v + 0.5) else -floor(-v + 0.5)

  /** The measure of an RGBA picture (row 0 at the top), already 320 px wide. */
  fun measure(rgba: ByteArray, width: Int, height: Int): Measure? {
    val w = width
    val h = height
    val y0 = (h * 0.45).toInt()
    val rows = h - y0
    if (!(w > 0 && rows > 2 && rgba.size >= w * h * 4)) return null
    val grey = DoubleArray(rows * w)
    val sand = BooleanArray(rows * w)
    var count = 0
    for (y in 0 until rows) for (x in 0 until w) {
      val i = ((y0 + y) * w + x) * 4
      val r = (rgba[i].toInt() and 0xFF).toDouble()
      val g = (rgba[i + 1].toInt() and 0xFF).toDouble()
      val b = (rgba[i + 2].toInt() and 0xFF).toDouble()
      grey[y * w + x] = round(0.299 * r + 0.587 * g + 0.114 * b)
      if (isSand(r, g, b)) { sand[y * w + x] = true; count += 1 }
    }
    val share = count.toDouble() / (rows * w).toDouble()
    if (count <= 50) return Measure(share, 0.0)
    val blur = gaussian(grey, w, rows, 1.5)
    val hp = ArrayList<Double>(count)
    for (i in 0 until rows * w) if (sand[i]) hp.add(abs(grey[i] - blur[i]))
    return Measure(share, median(hp))
  }

  /** OpenCV's 8-bit HSV (hue 0–180, saturation and value 0–255, rounded) inside the sand box. */
  internal fun isSand(r: Double, g: Double, b: Double): Boolean {
    val v = max(r, max(g, b))
    val mn = min(r, min(g, b))
    val d = v - mn
    if (v < 90) return false
    val s = round(if (v > 0) 255 * d / v else 0.0)
    if (s < 25 || s > 140 || d <= 0) return false
    var hue = when (v) {
      r -> 60 * (g - b) / d
      g -> 120 + 60 * (b - r) / d
      else -> 240 + 60 * (r - g) / d
    }
    if (hue < 0) hue += 360
    val hh = round(hue / 2)
    return hh >= 8 && hh <= 28
  }

  /** OpenCV's GaussianBlur with ksize (0, 0): an 11-tap kernel for σ 1.5, border reflected without repeating the edge. */
  internal fun gaussian(src: DoubleArray, w: Int, h: Int, sigma: Double): DoubleArray {
    val radius = 5
    var k = (-radius..radius).map { exp(-(it * it).toDouble() / (2 * sigma * sigma)) }
    var sum = 0.0
    for (x in k) sum += x
    k = k.map { it / sum }
    fun reflect(i: Int, n: Int): Int {
      if (n == 1) return 0
      var j = i
      while (j < 0 || j >= n) j = if (j < 0) -j else 2 * n - 2 - j
      return j
    }
    val tmp = DoubleArray(w * h)
    for (y in 0 until h) for (x in 0 until w) {
      var acc = 0.0
      for (t in -radius..radius) acc += k[t + radius] * src[y * w + reflect(x + t, w)]
      tmp[y * w + x] = acc
    }
    val out = DoubleArray(w * h)
    for (y in 0 until h) for (x in 0 until w) {
      var acc = 0.0
      for (t in -radius..radius) acc += k[t + radius] * tmp[reflect(y + t, h) * w + x]
      out[y * w + x] = acc
    }
    return out
  }

  /** numpy.median; 0 for none. */
  fun median(v: List<Double>): Double {
    if (v.isEmpty()) return 0.0
    val s = v.sorted()
    return if (s.size % 2 == 1) s[s.size / 2] else (s[s.size / 2 - 1] + s[s.size / 2]) / 2
  }
}
