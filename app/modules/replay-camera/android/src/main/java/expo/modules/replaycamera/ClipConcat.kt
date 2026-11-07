package expo.modules.replaycamera

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import expo.modules.replaycamera.core.Segment
import expo.modules.replaycamera.core.TimelineRemap
import java.io.File
import java.nio.ByteBuffer

/** Remuxes segment MP4s into one 0-based file, without re-encoding. Timing rules live in [TimelineRemap]. */
object ClipConcat {
  /**
   * [rotationDegrees] is the phone's position when the clip was saved, for the whole clip, as on iOS: the frames are
   * always the sensor's own, only the players' rotation differs, and a phone turned while the window filled must not
   * leave the clip in the position of its oldest segment. Null keeps the first segment's.
   */
  fun concat(segments: List<Segment>, dest: File, rotationDegrees: Int? = null) {
    require(segments.isNotEmpty()) { "no segments to save" }
    val muxer = MediaMuxer(dest.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    val outTracks = mutableMapOf<String, Int>()
    val remap = TimelineRemap()
    val buffer = ByteBuffer.allocate(4 * 1024 * 1024)
    val info = MediaCodec.BufferInfo()
    try {
      segments.forEachIndexed { index, segment ->
        remap.beginSegment(firstVideoTimeUs(segment.file))
        val extractor = MediaExtractor().apply { setDataSource(segment.file.path) }
        try {
          val mimes = (0 until extractor.trackCount).associateWith { i ->
            val format = extractor.getTrackFormat(i)
            val mime = format.getString(MediaFormat.KEY_MIME)!!
            if (index == 0) outTracks[mime] = muxer.addTrack(format)
            extractor.selectTrack(i)
            mime
          }
          if (index == 0) {
            // The segment muxers stored the phone's rotation; without the save's own, carry the first one's to the clip.
            val rotation = rotationDegrees ?: (0 until extractor.trackCount).map(extractor::getTrackFormat)
              .firstOrNull { it.containsKey(MediaFormat.KEY_ROTATION) }?.getInteger(MediaFormat.KEY_ROTATION) ?: 0
            muxer.setOrientationHint(rotation)
            muxer.start()
          }

          while (true) {
            val size = extractor.readSampleData(buffer, 0)
            if (size < 0) break
            val mime = mimes[extractor.sampleTrackIndex]
            val outTrack = outTracks[mime]
            val pts = mime?.let { remap.map(it, extractor.sampleTime) }
            if (outTrack != null && pts != null) {
              info.set(0, size, pts, extractor.sampleFlags)
              muxer.writeSampleData(outTrack, buffer, info)
            }
            extractor.advance()
          }
        } finally {
          extractor.release()
        }
        remap.endSegment((segment.duration * 1_000_000).toLong())
      }
    } finally {
      runCatching { muxer.stop() }
      muxer.release()
    }
  }

  private fun firstVideoTimeUs(file: File): Long {
    val extractor = MediaExtractor().apply { setDataSource(file.path) }
    try {
      val video = (0 until extractor.trackCount).first {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)!!.startsWith("video/")
      }
      extractor.selectTrack(video)
      return extractor.sampleTime.coerceAtLeast(0)
    } finally {
      extractor.release()
    }
  }
}
