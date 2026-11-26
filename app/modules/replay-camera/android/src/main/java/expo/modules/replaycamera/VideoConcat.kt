package expo.modules.replaycamera

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import expo.modules.replaycamera.core.AudioPlacement
import expo.modules.replaycamera.core.ConcatPart
import expo.modules.replaycamera.core.ConcatPlan
import java.io.File
import java.nio.ByteBuffer

/**
 * Joins exported clips (same size and codec: they all come from `ClipExporter` with one frame) into one video without
 * re-encoding. `ConcatPlan` decides where each part and its sound land; a part without sound leaves a silent stretch.
 */
object VideoConcat {
  class MismatchException(message: String) : Exception(message)

  private class Probe(
    val path: String,
    val videoTrack: Int,
    val videoFormat: MediaFormat,
    val audioTrack: Int,
    val audioFormat: MediaFormat?,
    val videoUs: Long,
    val audioUs: Long?,
  )

  /** Returns the joined file's path and its length in ms. */
  fun concat(paths: List<String>, outPath: String): Pair<String, Long> {
    require(paths.isNotEmpty()) { "nothing to join" }
    val probes = paths.map { probe(it) }
    val first = probes.first()
    probes.forEach {
      val a = it.videoFormat
      val b = first.videoFormat
      if (a.getString(MediaFormat.KEY_MIME) != b.getString(MediaFormat.KEY_MIME) ||
        a.getInteger(MediaFormat.KEY_WIDTH) != b.getInteger(MediaFormat.KEY_WIDTH) ||
        a.getInteger(MediaFormat.KEY_HEIGHT) != b.getInteger(MediaFormat.KEY_HEIGHT)
      ) throw MismatchException("parts differ in size or codec")
    }
    val soundFormat = probes.firstNotNullOfOrNull { it.audioFormat }
    val placements = ConcatPlan.layout(probes.map { ConcatPart(it.videoUs, it.audioUs) })

    File(outPath).parentFile?.mkdirs()
    File(outPath).delete()
    val muxer = MediaMuxer(outPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    try {
      rotationOf(first.path)?.let { muxer.setOrientationHint(it) }
      val videoOut = muxer.addTrack(first.videoFormat)
      val soundOut = if (soundFormat != null) muxer.addTrack(soundFormat) else -1
      muxer.start()
      probes.forEachIndexed { index, probe ->
        val placed = placements[index]
        copy(probe.path, probe.videoTrack, muxer, videoOut, placed.startUs, Long.MAX_VALUE)
        val sound = placed.audio
        if (sound is AudioPlacement.Track && soundOut >= 0) {
          copy(probe.path, probe.audioTrack, muxer, soundOut, sound.startUs, sound.durationUs)
        }
      }
      muxer.stop()
    } catch (e: Exception) {
      File(outPath).delete() // never leave a partial file behind
      throw e
    } finally {
      muxer.release()
    }
    return outPath to ConcatPlan.totalUs(probes.map { ConcatPart(it.videoUs, it.audioUs) }) / 1000
  }

  private fun probe(path: String): Probe {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(path)
      var video = -1
      var audio = -1
      for (i in 0 until extractor.trackCount) {
        val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
        if (video < 0 && mime.startsWith("video/")) video = i
        if (audio < 0 && mime.startsWith("audio/")) audio = i
      }
      if (video < 0) throw MismatchException("no picture in $path")
      return Probe(
        path, video, extractor.getTrackFormat(video), audio, if (audio >= 0) extractor.getTrackFormat(audio) else null,
        lengthUs(path, video), if (audio >= 0) lengthUs(path, audio) else null,
      )
    } finally {
      extractor.release()
    }
  }

  /** The track's length: the last sample's time (a format's duration is not always there). */
  private fun lengthUs(path: String, track: Int): Long {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(path)
      extractor.selectTrack(track)
      var last = 0L
      while (extractor.sampleTime >= 0) {
        last = maxOf(last, extractor.sampleTime)
        if (!extractor.advance()) break
      }
      val format = extractor.getTrackFormat(track)
      return if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else last
    } finally {
      extractor.release()
    }
  }

  internal fun rotationOf(path: String): Int? {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(path)
      retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull()
    } catch (e: Exception) {
      null
    } finally {
      retriever.release()
    }
  }

  /** Copies one track's samples, shifted to start at [startUs] on the joined timeline; none later than [maxUs] into the part. */
  private fun copy(path: String, track: Int, muxer: MediaMuxer, outTrack: Int, startUs: Long, maxUs: Long) {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(path)
      extractor.selectTrack(track)
      val buffer = ByteBuffer.allocate(1 shl 20)
      val info = MediaCodec.BufferInfo()
      while (true) {
        val time = extractor.sampleTime
        if (time < 0 || time > maxUs) break
        buffer.clear()
        val size = extractor.readSampleData(buffer, 0)
        if (size < 0) break
        info.set(0, size, startUs + time, extractor.sampleFlags)
        muxer.writeSampleData(outTrack, buffer, info)
        if (!extractor.advance()) break
      }
    } finally {
      extractor.release()
    }
  }
}
