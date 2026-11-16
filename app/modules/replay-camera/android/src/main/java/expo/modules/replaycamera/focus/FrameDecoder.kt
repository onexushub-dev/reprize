package expo.modules.replaycamera.focus

import android.media.Image
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat

/**
 * A clip's frames between `fromMs` and `toMs`, decoded in sequence with MediaCodec (asking MediaMetadataRetriever for
 * each frame costs ~380 ms on a 1080p/60 clip; straight through it is a few ms a frame). Only the frames `want` accepts
 * are turned into pixels, upright (`rotation`: the clip's rotation tag, clockwise).
 */
internal class FrameDecoder(
  private val path: String,
  private val fromMs: Double,
  private val toMs: Double,
  private val rotation: Int,
) {
  /** One decoded frame, valid only inside `onFrame`. */
  inner class DecodedFrame internal constructor(private val image: Image) {
    /** The upright frame at `outW` × `outH` (its upright size or smaller; 2 × 2 blocks averaged when exactly half). */
    fun pixels(outW: Int, outH: Int): Pixels {
      val quarter = rotation == 90 || rotation == 270
      // the stored frame's size for that upright size
      val sw = if (quarter) outH else outW
      val sh = if (quarter) outW else outH
      return convert(image, sw, sh).rotated(rotation)
    }

    /** The upright frame no longer than `longSide` (0 = its own size). */
    fun pixels(longSide: Int): Pixels {
      val w = image.width
      val h = image.height
      val s = if (longSide <= 0) 1.0 else minOf(1.0, longSide.toDouble() / maxOf(w, h))
      val ow = maxOf(2, (w * s).toInt() / 2 * 2)
      val oh = maxOf(2, (h * s).toInt() / 2 * 2)
      return convert(image, ow, oh).rotated(rotation)
    }
  }

  /** Calls `onFrame` for each frame `want` accepts, in time order; stops when it returns false or at `toMs`. */
  fun run(cancelled: () -> Boolean, want: (Double) -> Boolean, onFrame: (Double, DecodedFrame) -> Boolean) {
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      extractor.setDataSource(path)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true
      } ?: throw IllegalStateException("no video track")
      extractor.selectTrack(track)
      val format = extractor.getTrackFormat(track)
      val mime = format.getString(MediaFormat.KEY_MIME)!!
      if (fromMs > 0) extractor.seekTo((fromMs * 1000).toLong(), MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      val decoder = MediaCodec.createDecoderByType(mime)
      codec = decoder
      decoder.configure(format, null, null, 0)
      decoder.start()
      val info = MediaCodec.BufferInfo()
      var inputDone = false
      while (!cancelled()) {
        if (!inputDone) {
          val index = decoder.dequeueInputBuffer(0)
          if (index >= 0) {
            val size = extractor.readSampleData(decoder.getInputBuffer(index)!!, 0)
            if (size < 0) {
              decoder.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              decoder.queueInputBuffer(index, 0, size, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }
        val out = decoder.dequeueOutputBuffer(info, 10_000)
        if (out < 0) continue // try again, format/buffers changed
        val ptsMs = info.presentationTimeUs / 1000.0
        val end = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
        var keepGoing = true
        if (info.size > 0 && ptsMs >= fromMs - 0.5 && ptsMs < toMs && want(ptsMs)) {
          val image = decoder.getOutputImage(out)
          if (image != null) {
            try { keepGoing = onFrame(ptsMs, DecodedFrame(image)) } finally { image.close() }
          }
        }
        decoder.releaseOutputBuffer(out, false)
        if (end || !keepGoing || ptsMs >= toMs) break
      }
    } finally {
      runCatching { codec?.stop() }
      runCatching { codec?.release() }
      extractor.release()
    }
  }

  companion object {
    /**
     * YUV_420_888 (video range, BT.601) to ARGB at `outW` × `outH` of the stored frame: each output pixel the mean of
     * the 2 × 2 block when the frame is exactly halved (4K → 1920, so a small ball is not lost to sampling), else the
     * nearest pixel.
     */
    fun convert(image: Image, outW: Int, outH: Int): Pixels {
      val w = image.width
      val h = image.height
      val yPlane = image.planes[0]
      val uPlane = image.planes[1]
      val vPlane = image.planes[2]
      val yBuf = yPlane.buffer
      val uBuf = uPlane.buffer
      val vBuf = vPlane.buffer
      val yRow = yPlane.rowStride
      val yPix = yPlane.pixelStride
      val uvRow = uPlane.rowStride
      val uvPixel = uPlane.pixelStride
      val half = outW * 2 == w && outH * 2 == h
      val pixels = IntArray(outW * outH)
      val srcX = IntArray(outW) { minOf(w - 1, (it * w.toLong() / outW).toInt()) }
      fun luma(x: Int, y: Int) = yBuf.get(y * yRow + x * yPix).toInt() and 0xFF
      var o = 0
      for (y in 0 until outH) {
        val sy = if (half) y * 2 else minOf(h - 1, (y * h.toLong() / outH).toInt())
        val uvBase = (sy shr 1) * uvRow
        for (x in 0 until outW) {
          val sx = if (half) x * 2 else srcX[x]
          val l = if (half) (luma(sx, sy) + luma(sx + 1, sy) + luma(sx, sy + 1) + luma(sx + 1, sy + 1) + 2) / 4 else luma(sx, sy)
          val yy = l - 16
          val uvIndex = uvBase + (sx shr 1) * uvPixel
          val u = (uBuf.get(uvIndex).toInt() and 0xFF) - 128
          val v = (vBuf.get(uvIndex).toInt() and 0xFF) - 128
          val c = 1192 * (if (yy < 0) 0 else yy)
          var r = (c + 1634 * v) shr 10
          var g = (c - 832 * v - 401 * u) shr 10
          var b = (c + 2066 * u) shr 10
          r = if (r < 0) 0 else if (r > 255) 255 else r
          g = if (g < 0) 0 else if (g > 255) 255 else g
          b = if (b < 0) 0 else if (b > 255) 255 else b
          pixels[o++] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
        }
      }
      return Pixels(pixels, outW, outH)
    }
  }
}
