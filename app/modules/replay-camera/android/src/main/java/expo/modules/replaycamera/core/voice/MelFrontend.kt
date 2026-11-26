package expo.modules.replaycamera.core.voice

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sin

/**
 * 16 kHz mono samples to the voice detector's mel frames, as the iPhone's MelFrontend.swift and the lab's
 * `export_detector.py`: samples ×32767, frames of `nFft` every `hop` (no padding), periodic Hann(`winLength`) centred in
 * the frame, real FFT, power, the `mel_filterbank.bin` filterbank, then `log10(max(p, 1e-10)) + 2`. No top-dB floor,
 * so the frames do not depend on how the audio is split into [push] calls.
 */
class MelFrontend(filterbank: FloatArray, val nFft: Int, winLength: Int, val hop: Int, val nMels: Int) {
  private val bins = nFft / 2 + 1
  private val filterbank = DoubleArray(filterbank.size) { filterbank[it].toDouble() } // bins × nMels, row-major
  private val window = DoubleArray(nFft)
  private val fft = RealFFT(nFft)
  private val re = DoubleArray(nFft)
  private val power = DoubleArray(bins)
  private var pending = FloatArray(8192)
  private var pendingSize = 0
  private var pendingStart = 0

  init {
    require(nFft > 0 && nFft and (nFft - 1) == 0) { "nFft must be a power of two" }
    require(filterbank.size == bins * nMels) { "filterbank must be $bins×$nMels" }
    val offset = (nFft - winLength) / 2
    for (n in 0 until winLength) window[offset + n] = 0.5 - 0.5 * cos(2 * PI * n / winLength)
  }

  /** Drops buffered samples (a new session). */
  fun reset() {
    pendingSize = 0
    pendingStart = 0
  }

  /** Samples in [-1, 1]. Returns the mel frames (each [nMels] values) completed by this push, oldest first. */
  fun push(samples16k: FloatArray): List<FloatArray> {
    if (pendingSize + samples16k.size > pending.size) pending = pending.copyOf(max(pending.size * 2, pendingSize + samples16k.size))
    samples16k.copyInto(pending, pendingSize)
    pendingSize += samples16k.size
    val frames = ArrayList<FloatArray>()
    while (pendingSize - pendingStart >= nFft) {
      for (n in 0 until nFft) re[n] = pending[pendingStart + n] * 32767.0 * window[n]
      fft.power(re, power)
      val frame = FloatArray(nMels)
      for (m in 0 until nMels) {
        var e = 0.0
        for (k in 0 until bins) e += power[k] * filterbank[k * nMels + m]
        frame[m] = (log10(max(e, 1e-10)) + 2).toFloat()
      }
      frames += frame
      pendingStart += hop
    }
    if (pendingStart > 4096) {
      pending.copyInto(pending, 0, pendingStart, pendingSize)
      pendingSize -= pendingStart
      pendingStart = 0
    }
    return frames
  }
}

/** Power spectrum (bins 0…n/2) of a real signal of power-of-two length, by an iterative radix-2 complex FFT. */
internal class RealFFT(private val size: Int) {
  private val bitReverse: IntArray
  private val cosTable = DoubleArray(size / 2) { cos(2 * PI * it / size) }
  private val sinTable = DoubleArray(size / 2) { -sin(2 * PI * it / size) }
  private val re = DoubleArray(size)
  private val im = DoubleArray(size)

  init {
    var levels = 0
    while ((1 shl levels) < size) levels++
    bitReverse = IntArray(size) { i ->
      var r = 0
      var x = i
      repeat(levels) {
        r = (r shl 1) or (x and 1)
        x = x shr 1
      }
      r
    }
  }

  fun power(input: DoubleArray, out: DoubleArray) {
    for (i in 0 until size) {
      re[bitReverse[i]] = input[i]
      im[i] = 0.0
    }
    var len = 2
    while (len <= size) {
      val halfLen = len / 2
      val step = size / len
      var start = 0
      while (start < size) {
        for (j in 0 until halfLen) {
          val wr = cosTable[j * step]
          val wi = sinTable[j * step]
          val a = start + j
          val b = a + halfLen
          val tr = re[b] * wr - im[b] * wi
          val ti = re[b] * wi + im[b] * wr
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
        }
        start += len
      }
      len = len shl 1
    }
    for (k in 0..size / 2) out[k] = re[k] * re[k] + im[k] * im[k]
  }
}
