package expo.modules.replaycamera

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import expo.modules.replaycamera.core.CutPlan
import expo.modules.replaycamera.transfer.TransferRules
import java.io.File
import java.nio.ByteBuffer

/**
 * Cuts a clip for sharing (multi-recording share design, "what is sent": the sender's cut and silence travel in the
 * file), as the iPhone's ClipCut.swift. Passthrough only, never re-encoded: the samples are copied, so it takes a
 * fraction of a second and loses no quality. `CutPlan` places them so the file starts exactly at `startMs`. A muted clip
 * leaves without its sound track at all.
 */
object ClipCut {
  class NoVideoException(message: String) : Exception(message)

  /**
   * What `sampleTime` says once the track has no more samples. Only -1: a sound track's first sample is often a little
   * before 0 (the AAC encoder's priming, -21 ms), and stopping on any negative time copied no sound at all (2026-11-25).
   */
  private const val END = -1L

  /** Returns the cut file's path and its length in ms. */
  fun cut(inPath: String, outPath: String, startMs: Double, endMs: Double, muted: Boolean): Pair<String, Long> {
    // Paths may come as file URIs, as for the transfers.
    val source = TransferRules.localPath(inPath)
    val out = TransferRules.localPath(outPath)
    val probe = MediaExtractor()
    var video = -1
    var audio = -1
    val samples = mutableListOf<CutPlan.Sample>()
    val videoFormat: MediaFormat
    val audioFormat: MediaFormat?
    try {
      probe.setDataSource(source)
      for (i in 0 until probe.trackCount) {
        val mime = probe.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
        if (video < 0 && mime.startsWith("video/")) video = i
        if (audio < 0 && mime.startsWith("audio/")) audio = i
      }
      if (video < 0) throw NoVideoException("no picture in $source")
      videoFormat = probe.getTrackFormat(video)
      audioFormat = if (!muted && audio >= 0) probe.getTrackFormat(audio) else null
      probe.selectTrack(video)
      while (probe.sampleTime != END) {
        samples += CutPlan.Sample(probe.sampleTime, probe.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0)
        if (!probe.advance()) break
      }
    } finally {
      probe.release()
    }
    if (samples.isEmpty()) throw NoVideoException("no picture in $source")

    val lengthUs = samples.maxOf { it.timeUs } + frameUs(samples)
    val startUs = (maxOf(0.0, startMs) * 1000).toLong().coerceAtMost(lengthUs)
    val endUs = (maxOf(startMs, endMs) * 1000).toLong().coerceAtMost(lengthUs)
    val times = CutPlan.video(samples, startUs, endUs)
    val lead = CutPlan.lead(samples, startUs)

    File(out).parentFile?.mkdirs()
    File(out).delete()
    val muxer = MediaMuxer(out, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    try {
      VideoConcat.rotationOf(source)?.let { muxer.setOrientationHint(it) }
      val videoOut = muxer.addTrack(videoFormat)
      val soundOut = if (audioFormat != null) muxer.addTrack(audioFormat) else -1
      muxer.start()
      copy(source, video, muxer, videoOut) { index, _ -> times.getOrNull(index) }
      if (soundOut >= 0) copy(source, audio, muxer, soundOut) { _, time -> CutPlan.audio(time, startUs, endUs, lead) }
      muxer.stop()
    } catch (e: Exception) {
      File(out).delete() // never leave a partial file behind
      throw e
    } finally {
      muxer.release()
    }
    return out to (endUs - startUs) / 1000
  }

  /** The usual gap between frames, so the last frame counts in the clip's length. */
  private fun frameUs(samples: List<CutPlan.Sample>): Long {
    if (samples.size < 2) return 0
    val sorted = samples.map { it.timeUs }.sorted()
    return (sorted.last() - sorted.first()) / (sorted.size - 1)
  }

  /** Copies one track's samples to the time [place] gives each (by its index in the file and its time); null skips it. */
  private fun copy(path: String, track: Int, muxer: MediaMuxer, outTrack: Int, place: (Int, Long) -> Long?) {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(path)
      extractor.selectTrack(track)
      val buffer = ByteBuffer.allocate(1 shl 21)
      val info = MediaCodec.BufferInfo()
      var index = 0
      while (true) {
        val time = extractor.sampleTime
        if (time == END) break
        val at = place(index, time)
        if (at != null) {
          buffer.clear()
          val size = extractor.readSampleData(buffer, 0)
          if (size < 0) break
          info.set(0, size, at, extractor.sampleFlags)
          muxer.writeSampleData(outTrack, buffer, info)
        }
        index++
        if (!extractor.advance()) break
      }
    } finally {
      extractor.release()
    }
  }
}
