package expo.modules.replaycamera.core.voice

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * Any capture format to the voice detector's 16 kHz mono, as the iPhone's Resampler.swift (plan 2026-11-24 voice keyword
 * detector). Channels are averaged, then a windowed-sinc low-pass (cutoff 7.2 kHz, Hann window) is evaluated at each
 * output instant, so court noise above 8 kHz is removed before decimation instead of folding into the voice band. State
 * carries across calls, so the result does not depend on how the audio is split. At 16 kHz mono, samples pass through.
 */
class Resampler(
  val fromRate: Double,
  channels: Int,
  val toRate: Double = 16000.0,
  cutoffHz: Double = 7200.0,
  halfWidthOut: Int = 16,
) {
  val channels = max(1, channels)
  private val ratio = fromRate / toRate
  private val half = max(1, ceil(halfWidthOut * max(1.0, fromRate / toRate)).toInt())
  private val cutoff = min(cutoffHz, toRate / 2) / fromRate
  private val passThrough = fromRate == toRate && this.channels == 1
  private val table = DoubleArray(half * TABLE_STEPS + 2) { exactKernel(it.toDouble() / TABLE_STEPS, half, cutoff) }
  /** Integer ratio (48 kHz → 16 kHz): every output sits on an input sample, so the taps are fixed. null otherwise. */
  private val fixedTaps: FloatArray?
  private val fixedWeight: Double

  // Mono input still needed: absolute index bufferStart + i, i < size.
  private var buffer = FloatArray(4096)
  private var size = 0
  private var bufferStart = 0L
  private var nextOut = 0L

  init {
    if (!passThrough && ratio == floor(ratio)) {
      val taps = DoubleArray(2 * half) { i ->
        val d = abs(half - 1 - i) * TABLE_STEPS
        if (d < table.size - 1) table[d] else 0.0
      }
      fixedTaps = FloatArray(taps.size) { taps[it].toFloat() }
      fixedWeight = taps.sum()
    } else {
      fixedTaps = null
      fixedWeight = 0.0
    }
  }

  /** Interleaved samples in [-1, 1] (whole frames of [channels]). Returns the 16 kHz mono samples now computable. */
  fun process(interleaved: FloatArray): FloatArray {
    if (passThrough) return interleaved
    val frames = interleaved.size / channels
    ensure(size + frames)
    if (channels == 1) {
      interleaved.copyInto(buffer, size, 0, frames)
    } else {
      val scale = 1f / channels
      for (f in 0 until frames) {
        var sum = 0f
        for (c in 0 until channels) sum += interleaved[f * channels + c]
        buffer[size + f] = sum * scale
      }
    }
    size += frames
    var out = FloatArray((frames / ratio).toInt() + 2)
    var n = 0
    val available = bufferStart + size
    while (true) {
      val p = nextOut * ratio
      val centre = floor(p).toLong()
      if (centre + half >= available) break
      val first = centre - half + 1
      val taps = fixedTaps
      val value = if (taps != null && fixedWeight != 0.0 && first >= bufferStart) {
        val start = (first - bufferStart).toInt()
        var dot = 0f
        for (i in taps.indices) dot += buffer[start + i] * taps[i]
        (dot / fixedWeight).toFloat()
      } else {
        var acc = 0.0
        var weight = 0.0
        var k = centre - half + 1
        while (k <= centre + half) {
          val h = kernel(p - k)
          if (k >= 0) acc += h * buffer[(k - bufferStart).toInt()]
          weight += h
          k++
        }
        (if (weight != 0.0) acc / weight else 0.0).toFloat()
      }
      if (n == out.size) out = out.copyOf(out.size * 2 + 4)
      out[n++] = value
      nextOut++
    }
    trim()
    return out.copyOf(n)
  }

  /** Keep only what the next output still reaches back to. */
  private fun trim() {
    val keepFrom = floor(nextOut * ratio).toLong() - half + 1
    val drop = min(size.toLong(), max(0L, keepFrom - bufferStart)).toInt()
    if (drop > 0) {
      buffer.copyInto(buffer, 0, drop, size)
      size -= drop
      bufferStart += drop
    }
  }

  private fun ensure(capacity: Int) {
    if (capacity > buffer.size) buffer = buffer.copyOf(max(capacity, buffer.size * 2))
  }

  /** Windowed sinc at distance [x] input samples from the output instant, from the table (linear interpolation). */
  private fun kernel(x: Double): Double {
    val pos = abs(x) * TABLE_STEPS
    val i = pos.toInt()
    if (i >= table.size - 1) return 0.0
    val frac = pos - i
    return table[i] + (table[i + 1] - table[i]) * frac
  }

  companion object {
    private const val TABLE_STEPS = 512

    fun exactKernel(x: Double, half: Int, cutoff: Double): Double {
      if (abs(x) >= half) return 0.0
      val window = 0.5 * (1 + cos(PI * x / half))
      val arg = 2 * cutoff * x
      val sinc = if (arg == 0.0) 1.0 else sin(PI * arg) / (PI * arg)
      return 2 * cutoff * sinc * window
    }
  }
}
