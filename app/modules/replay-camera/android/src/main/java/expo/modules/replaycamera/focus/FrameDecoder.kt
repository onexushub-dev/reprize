package expo.modules.replaycamera.focus

import android.graphics.Bitmap
import android.graphics.Matrix
import android.media.Image
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat

/**
 * Frames of a clip, one per analysis step, decoded in sequence with MediaCodec. Asking MediaMetadataRetriever for each
 * frame costs ~380 ms on a 1080p/60 clip (it decodes from the nearest key frame every time); decoding straight through
 * costs a few ms a frame, and only the frames the analysis wants are turned into a bitmap.
 */
internal class FrameDecoder(
  private val path: String,
  private val startMs: Double,
  private val stopMs: Double,
  private val stepMs: Double,
  private val rotation: Int,
  private val longSide: Int,
) {
  /** Calls `onFrame(ptsMs, upright ARGB_8888 bitmap)` for the first frame at or after each step tick; stops when it returns false. */
  fun run(cancelled: () -> Boolean, onFrame: (Double, Bitmap) -> Boolean) {
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
      if (startMs > 0) extractor.seekTo((startMs * 1000).toLong(), MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      val decoder = MediaCodec.createDecoderByType(mime)
      codec = decoder
      decoder.configure(format, null, null, 0)
      decoder.start()

      val info = MediaCodec.BufferInfo()
      var inputDone = false
      var next = startMs
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
        // The first frame at or after each tick (as on the iPhone), none before the start or past the end.
        if (info.size > 0 && ptsMs + 0.5 >= next && ptsMs < stopMs) {
          while (next <= ptsMs + 0.5) next += stepMs
          val image = decoder.getOutputImage(out)
          if (image != null) {
            try { keepGoing = onFrame(ptsMs, toBitmap(image)) } finally { image.close() }
          }
        }
        decoder.releaseOutputBuffer(out, false)
        if (end || !keepGoing || ptsMs >= stopMs) break
      }
    } finally {
      runCatching { codec?.stop() }
      runCatching { codec?.release() }
      extractor.release()
    }
  }

  /** YUV_420_888 to an upright ARGB_8888 bitmap no longer than `longSide`, sampling instead of averaging (it is only for detection). */
  private fun toBitmap(image: Image): Bitmap {
    val w = image.width
    val h = image.height
    val scale = minOf(1.0, longSide.toDouble() / maxOf(w, h))
    val outW = maxOf(2, (w * scale).toInt() / 2 * 2)
    val outH = maxOf(2, (h * scale).toInt() / 2 * 2)
    val yPlane = image.planes[0]
    val uPlane = image.planes[1]
    val vPlane = image.planes[2]
    val yBuf = yPlane.buffer
    val uBuf = uPlane.buffer
    val vBuf = vPlane.buffer
    val yRow = yPlane.rowStride
    val uvRow = uPlane.rowStride
    val uvPixel = uPlane.pixelStride
    val pixels = IntArray(outW * outH)
    val srcX = IntArray(outW) { minOf(w - 1, (it * w.toLong() / outW).toInt()) }
    var o = 0
    for (y in 0 until outH) {
      val sy = minOf(h - 1, (y * h.toLong() / outH).toInt())
      val yBase = sy * yRow
      val uvBase = (sy shr 1) * uvRow
      for (x in 0 until outW) {
        val sx = srcX[x]
        val yy = (yBuf.get(yBase + sx).toInt() and 0xFF) - 16
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
    val bitmap = Bitmap.createBitmap(pixels, outW, outH, Bitmap.Config.ARGB_8888)
    if (rotation == 0) return bitmap
    return Bitmap.createBitmap(bitmap, 0, 0, outW, outH, Matrix().apply { postRotate(rotation.toFloat()) }, true).also { bitmap.recycle() }
  }
}
