package expo.modules.replaycamera.remote

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import expo.modules.replaycamera.VoiceTrigger
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The save command heard on the remote phone (iOS `RemoteVoice`): this phone records nothing, so it opens the
 * microphone itself and feeds the same on-device recognizer as the camera phone. It listens only while the remote
 * screen asks; each command becomes `onRemoteVoice`, and the screen saves as for a tap.
 */
object RemoteVoice {
  private const val TAG = "ReprizeRemoteVoice"
  private const val RATE = VoiceTrigger.OUT_RATE

  @Volatile var emit: ((String, Map<String, Any?>) -> Unit)? = null

  private val voice = VoiceTrigger { Log.i(TAG, it) }.apply {
    onCommand = { emit?.invoke("onRemoteVoice", mapOf("at" to System.currentTimeMillis().toDouble())) }
  }
  private var record: AudioRecord? = null
  private var thread: Thread? = null

  @Synchronized
  @SuppressLint("MissingPermission")
  fun set(on: Boolean, locale: String) {
    voice.setEnabled(on, locale)
    if (!on) return halt()
    if (record != null || !VoiceTrigger.isSupported()) return
    val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val created = runCatching {
      AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT, maxOf(min, RATE / 5 * 2))
    }.getOrNull()
    if (created == null || created.state != AudioRecord.STATE_INITIALIZED) {
      Log.e(TAG, "no microphone")
      created?.release()
      return
    }
    record = created
    created.startRecording()
    thread = Thread({
      val buffer = ByteBuffer.allocateDirect(RATE / 10 * 2).order(ByteOrder.LITTLE_ENDIAN)
      while (!Thread.currentThread().isInterrupted) {
        val read = created.read(buffer, buffer.capacity())
        if (read < 0) break
        if (read > 0) runCatching { voice.consider(buffer, read, RATE) }.onFailure { Log.e(TAG, "chunk: ${it.message}") }
      }
    }, "remote-voice").apply { start() }
    Log.i(TAG, "listening")
  }

  @Synchronized
  private fun halt() {
    val reading = thread
    thread = null
    reading?.interrupt()
    record?.let { r ->
      runCatching { r.stop() } // the read returns, the loop ends
      runCatching { reading?.join(500) }
      r.release()
    }
    record = null
  }
}
