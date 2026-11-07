package expo.modules.replaycamera

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTimestamp
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.os.Bundle
import android.view.Surface
import expo.modules.replaycamera.core.AudioClock
import expo.modules.replaycamera.core.Segment
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Encodes camera frames (through [inputSurface]) and microphone audio, writing one MP4 per segment.
 * A segment closes on the first keyframe after [SEGMENT_US], or right away when [requestCut] is called.
 * [clockNanos] must be the camera's timestamp clock ([clockIsBoottime] says which one), so audio
 * and video share one time base.
 */
class SegmentEncoder(
  width: Int,
  height: Int,
  fps: Int,
  private val bufferDir: File,
  private val clockNanos: () -> Long,
  private val clockIsBoottime: Boolean,
  /** Read when each segment opens: the rotation players apply to the video. */
  private val rotationDegrees: () -> Int,
  private val onSegment: (Segment) -> Unit,
  private val onFailure: (Throwable) -> Unit,
  /** Each PCM chunk the microphone gave (16-bit mono at [SAMPLE_RATE]), before it is encoded: the voice command. */
  private val onPcm: ((java.nio.ByteBuffer, Int, Int) -> Unit)? = null,
) {
  companion object {
    const val SEGMENT_US = 2_000_000L
    private const val SAMPLE_RATE = 44_100
  }

  private val videoCodec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
  private val audioCodec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
  val inputSurface: Surface

  private val running = AtomicBoolean(false)
  private val cutRequested = AtomicBoolean(false)
  private val lock = Any()
  private var muxer: MediaMuxer? = null
  private var segmentFile: File? = null
  private var videoTrack = -1
  private var audioTrack = -1
  private var videoFormat: MediaFormat? = null
  private var audioFormat: MediaFormat? = null
  private var segmentStartUs = 0L
  private var sessionStartUs = -1L
  private var index = 0
  private var audioRecord: AudioRecord? = null
  private val threads = mutableListOf<Thread>()

  init {
    val video = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      setInteger(MediaFormat.KEY_BIT_RATE, if (fps >= 60) 10_000_000 else 6_000_000)
      setInteger(MediaFormat.KEY_FRAME_RATE, fps)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
    }
    videoCodec.configure(video, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    inputSurface = videoCodec.createInputSurface()

    val audio = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, SAMPLE_RATE, 1).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, 96_000)
    }
    audioCodec.configure(audio, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
  }

  @SuppressLint("MissingPermission") // checked by ReplayEngine before start
  fun start() {
    running.set(true)
    videoCodec.start()
    audioCodec.start()
    val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    audioRecord = AudioRecord(
      MediaRecorder.AudioSource.CAMCORDER, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT, minBuf * 4,
    ).also { it.startRecording() }
    threads += Thread(::videoLoop, "replay-video").apply { start() }
    threads += Thread(::audioLoop, "replay-audio").apply { start() }
  }

  /** Close the current segment at the next frame (forced keyframe), so a saved clip ends at the trigger. */
  fun requestCut() {
    cutRequested.set(true)
    videoCodec.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
  }

  /** Stops encoding. The open, unfinished segment is discarded. */
  fun stop() {
    running.set(false)
    threads.forEach { it.join(1_000) }
    threads.clear()
    runCatching { audioRecord?.stop() }
    audioRecord?.release()
    runCatching { videoCodec.stop() }
    runCatching { audioCodec.stop() }
    videoCodec.release()
    audioCodec.release()
    inputSurface.release()
    synchronized(lock) {
      runCatching { muxer?.stop() }
      muxer?.release()
      muxer = null
      segmentFile?.delete()
    }
  }

  private fun videoLoop() = guarded {
    val info = MediaCodec.BufferInfo()
    while (running.get()) {
      val idx = videoCodec.dequeueOutputBuffer(info, 10_000)
      when {
        idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> videoFormat = videoCodec.outputFormat
        idx >= 0 -> {
          val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
          if (!isConfig && info.size > 0) {
            val key = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
            val buf = videoCodec.getOutputBuffer(idx)!!
            synchronized(lock) {
              val due = muxer == null || cutRequested.get() || info.presentationTimeUs - segmentStartUs >= SEGMENT_US
              if (key && due) rotate(info.presentationTimeUs)
              muxer?.writeSampleData(videoTrack, buf, info)
            }
          }
          videoCodec.releaseOutputBuffer(idx, false)
        }
      }
    }
  }

  /**
   * Audio is stamped by frame count from an anchor on the camera clock: the hardware timestamp when
   * the device offers one, else the moment of the first read. Stamping each chunk with "now" after a
   * blocking read would put the sound ~100ms behind the picture.
   */
  private fun audioLoop() = guarded {
    val record = audioRecord!!
    val info = MediaCodec.BufferInfo()
    val stamp = AudioTimestamp()
    val timebase = if (clockIsBoottime) AudioTimestamp.TIMEBASE_BOOTTIME else AudioTimestamp.TIMEBASE_MONOTONIC
    var framesRead = 0L
    var anchorNanos = -1L
    var anchorFrame = 0L
    while (running.get()) {
      val inIdx = audioCodec.dequeueInputBuffer(10_000)
      if (inIdx >= 0) {
        val buf = audioCodec.getInputBuffer(inIdx)!!
        val read = record.read(buf, buf.capacity()).coerceAtLeast(0)
        if (read > 0) onPcm?.invoke(buf, read, SAMPLE_RATE)
        val frames = read / 2L // 16-bit mono
        if (record.getTimestamp(stamp, timebase) == AudioRecord.SUCCESS) {
          anchorNanos = stamp.nanoTime
          anchorFrame = stamp.framePosition
        } else if (anchorNanos < 0) {
          anchorNanos = clockNanos() - frames * 1_000_000_000L / SAMPLE_RATE
          anchorFrame = framesRead
        }
        val pts = AudioClock.ptsUs(anchorNanos, anchorFrame, framesRead, SAMPLE_RATE)
        framesRead += frames
        audioCodec.queueInputBuffer(inIdx, 0, read, pts, 0)
      }
      while (true) {
        val outIdx = audioCodec.dequeueOutputBuffer(info, 0)
        if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) { audioFormat = audioCodec.outputFormat; continue }
        if (outIdx < 0) break
        val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
        if (!isConfig && info.size > 0) {
          val buf = audioCodec.getOutputBuffer(outIdx)!!
          synchronized(lock) {
            // Audio older than the open segment's first frame belongs to a closed segment: drop it.
            if (muxer != null && info.presentationTimeUs >= segmentStartUs) muxer?.writeSampleData(audioTrack, buf, info)
          }
        }
        audioCodec.releaseOutputBuffer(outIdx, false)
      }
    }
  }

  /** Closes the open segment (if any) and opens the next one starting at [ptsUs]. Holds [lock]. */
  private fun rotate(ptsUs: Long) {
    muxer?.let { m ->
      m.stop()
      m.release()
      val start = (segmentStartUs - sessionStartUs) / 1e6
      onSegment(Segment(segmentFile!!, start, (ptsUs - segmentStartUs) / 1e6))
    }
    muxer = null
    cutRequested.set(false)
    val vf = videoFormat ?: return
    val af = audioFormat ?: return // wait for the audio encoder so every segment has both tracks
    val file = File(bufferDir, "${index++}.mp4")
    muxer = MediaMuxer(file.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4).apply {
      setOrientationHint(rotationDegrees())
      videoTrack = addTrack(vf)
      audioTrack = addTrack(af)
      start()
    }
    segmentFile = file
    segmentStartUs = ptsUs
    if (sessionStartUs < 0) sessionStartUs = ptsUs
  }

  private inline fun guarded(block: () -> Unit) {
    try { block() } catch (t: Throwable) { if (running.get()) onFailure(t) }
  }
}
