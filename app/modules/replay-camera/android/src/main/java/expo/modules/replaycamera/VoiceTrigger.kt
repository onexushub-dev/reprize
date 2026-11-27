package expo.modules.replaycamera

import android.content.Context
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.audio.AudioSource
import com.google.mlkit.genai.speechrecognition.SpeechRecognition
import com.google.mlkit.genai.speechrecognition.SpeechRecognizer
import com.google.mlkit.genai.speechrecognition.SpeechRecognizerOptions
import com.google.mlkit.genai.speechrecognition.SpeechRecognizerResponse
import com.google.mlkit.genai.speechrecognition.speechRecognizerOptions
import com.google.mlkit.genai.speechrecognition.speechRecognizerRequest
import expo.modules.replaycamera.core.voice.VoiceEngine
import expo.modules.replaycamera.voice.KeywordDetector
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.text.Normalizer
import java.util.Locale
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Listens for the save command ("salvar" in Portuguese, "save" in English) in the recorder's own microphone audio, on
 * the device; court audio never goes to a server. Two engines, one live at a time (VoiceTrigger.swift, plan 2026-11-24
 * voice keyword detector):
 * - Portuguese: the "salvar" detector ([KeywordDetector], model `salvar-v2-rc4` in the assets), on every Android.
 * - English, or Portuguese when the model fails to load: ML Kit GenAI speech recognition (Basic mode, Android 12+).
 *   Android silences one of two captures of the microphone, so the recognizer never opens it: [consider] hands it the
 *   PCM the recorder already read, turned into the 16 kHz mono the recognizer takes, through a pipe.
 *
 * Each step goes to [log] (logcat tag `ReprizeVoice` and the Diagnóstico screen); what was said never does.
 */
class VoiceTrigger(private val log: (String) -> Unit) {
  companion object {
    private const val TAG = "ReprizeVoice"
    const val OUT_RATE = 16_000
    private const val COOLDOWN_MS = 2_000L
    private const val FIRST_BACKOFF_MS = 2_000L
    private const val MAX_BACKOFF_MS = 30_000L

    private const val DROP_REPORT_MS = 60_000L

    /** The app's context, for the detector's model in the assets (set when the module is created). */
    @Volatile var context: Context? = null

    /** Dictation's Basic mode needs Android 12 (API 31). */
    private fun dictationSupported(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

    /** Voice in [locale] on this phone: Portuguese on every Android (the detector), English from Android 12. */
    fun isSupported(locale: String): Boolean =
      (VoiceEngine.PORTUGUESE_USES_KEYWORD && locale == "pt-BR") || dictationSupported()

    fun words(locale: String): List<String> = if (locale == "pt-BR") listOf("salvar") else listOf("save")

    /** Whole words, ignoring case and accents, as on iOS (VoiceCommand.swift). */
    fun matches(transcript: String, locale: String): Boolean {
      val text = Normalizer.normalize(transcript, Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").lowercase(Locale.ROOT)
      return words(locale).any { Regex("\\b${Regex.escape(it)}\\b").containsMatchIn(text) }
    }
  }

  var onCommand: (() -> Unit)? = null

  /** The engine listening now (meaningful while [enabled]). */
  @Volatile private var live = VoiceEngine.DICTATION
  /** Loaded on first use; [keywordFailed] stops retrying after a failed load. */
  @Volatile private var keyword: KeywordDetector? = null
  private var keywordFailed = false
  private var reportedDrops = 0.0
  private var lastDropReport = 0L

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private val gate = Mutex()
  @Volatile private var enabled = false
  @Volatile private var locale = "pt-BR"
  private var recognizer: SpeechRecognizer? = null
  private var recognizerLocale: String? = null
  private var session: Job? = null
  @Volatile private var out: OutputStream? = null
  /** Converted audio waiting for the pipe: the recorder's thread never blocks on the recognizer. */
  private val chunks = ArrayBlockingQueue<ByteArray>(64)
  private var writer: Thread? = null
  private var lastCommandAt = 0L
  private var backoff = FIRST_BACKOFF_MS
  /** Fired once per utterance: the partials of "salvar" keep containing it until the utterance ends. */
  @Volatile private var firedThisUtterance = false
  // Resampler state (recorder thread).
  private var resamplePos = 0.0
  private var dropped = 0

  private fun say(message: String) {
    Log.i(TAG, message)
    log("voz: $message")
  }

  fun setEnabled(on: Boolean, locale: String) {
    if (!isSupported(locale)) return
    scope.launch {
      gate.withLock {
        val changed = locale != this@VoiceTrigger.locale
        this@VoiceTrigger.locale = locale
        val running = live == VoiceEngine.KEYWORD || session?.isActive == true
        if (on == enabled && !changed && (!on || running)) return@withLock
        enabled = on
        stopSession()
        if (!on) return@withLock
        if (VoiceEngine.PORTUGUESE_USES_KEYWORD && locale == "pt-BR") loadKeywordIfNeeded()
        val next = VoiceEngine.choose(locale, keyword != null)
        if (next == VoiceEngine.KEYWORD) {
          // The detector forgets audio from before (no stale word fires).
          keyword?.reset()
          live = VoiceEngine.KEYWORD
          say("gatilho modelo ${keyword?.config?.version}")
        } else {
          live = VoiceEngine.DICTATION
          if (!dictationSupported()) return@withLock
          say("gatilho ditado")
          startSession()
        }
      }
    }
  }

  /** Must hold [gate]. */
  private fun loadKeywordIfNeeded() {
    if (keyword != null || keywordFailed) return
    val ctx = context
    val detector = if (ctx == null) null else KeywordDetector.loadBundled(ctx) { line -> Log.i(TAG, line); log(line) }
    if (detector == null) {
      keywordFailed = true
      if (ctx == null) say("modelo indisponível (sem contexto) — usando ditado")
      return
    }
    detector.log = { line -> Log.i(TAG, line); log(line) }
    detector.onCommand = { score -> keywordHeard(score, detector) }
    keyword = detector
    reportedDrops = 0.0
  }

  /** On the detector's thread. */
  private fun keywordHeard(score: Double, detector: KeywordDetector) {
    val now = System.currentTimeMillis()
    if (!enabled || live != VoiceEngine.KEYWORD || now - lastCommandAt <= COOLDOWN_MS) return
    lastCommandAt = now
    say(String.format(Locale.ROOT, "comando (modelo, nota %.2f, atraso %d ms)", score, detector.lastFireLagMs.toLong()))
    onCommand?.invoke()
  }

  private fun reportDrops(detector: KeywordDetector) {
    val now = System.currentTimeMillis()
    if (now - lastDropReport < DROP_REPORT_MS) return
    lastDropReport = now
    val dropped = detector.droppedSeconds
    if (dropped > reportedDrops) {
      say(String.format(Locale.ROOT, "%.1f s de áudio descartados", dropped - reportedDrops))
      reportedDrops = dropped
    }
  }

  fun stop() = setEnabled(false, locale)

  /**
   * Call with each PCM chunk the recorder read: 16-bit mono little endian at [rate] Hz, [bytes] long, from index 0 of
   * [buf]. Cheap and never blocks; does nothing while voice is off.
   */
  fun consider(buf: ByteBuffer, bytes: Int, rate: Int) {
    if (!enabled || bytes <= 0) return
    val detector = keyword
    if (live == VoiceEngine.KEYWORD && detector != null) {
      detector.consider(buf, bytes, rate)
      reportDrops(detector)
      return
    }
    if (out == null) return
    val src = buf.duplicate().order(ByteOrder.LITTLE_ENDIAN)
    val inSamples = bytes / 2
    val step = rate.toDouble() / OUT_RATE
    val outBytes = ByteBuffer.allocate(((inSamples / step) + 2).toInt() * 2).order(ByteOrder.LITTLE_ENDIAN)
    var pos = resamplePos
    while (pos < inSamples - 1) {
      val i = pos.toInt()
      val frac = pos - i
      val a = src.getShort(i * 2).toInt()
      val b = src.getShort((i + 1) * 2).toInt()
      outBytes.putShort((a + (b - a) * frac).toInt().toShort())
      pos += step
    }
    // carry the fraction into the next chunk; never behind the start (at 1:1 the loop ends one sample short)
    resamplePos = maxOf(0.0, pos - inSamples)
    if (!chunks.offer(outBytes.array().copyOf(outBytes.position()))) dropped++
  }

  /** Must hold [gate]. */
  private suspend fun startSession() {
    val rec = ensureRecognizer() ?: return
    val (read, write) = ParcelFileDescriptor.createPipe()
    val stream = ParcelFileDescriptor.AutoCloseOutputStream(write)
    chunks.clear()
    resamplePos = 0.0
    out = stream
    writer = Thread({
      try {
        while (!Thread.currentThread().isInterrupted) {
          val chunk = chunks.poll(200, TimeUnit.MILLISECONDS) ?: continue
          stream.write(chunk)
        }
      } catch (_: Exception) {
        // pipe closed: the session ended
      }
    }, "replay-voice-pipe").apply { start() }
    val source = AudioSource.fromPfd(read, AudioSource.Mode.STREAMING)
    val request = speechRecognizerRequest { audioSource = source }
    firedThisUtterance = false
    say("escutando (${locale})")
    session = scope.launch {
      try {
        rec.startRecognition(request).collect { response ->
          when (response) {
            is SpeechRecognizerResponse.PartialTextResponse -> heard(response.text, final = false)
            is SpeechRecognizerResponse.FinalTextResponse -> heard(response.text, final = true)
            is SpeechRecognizerResponse.ErrorResponse -> {
              say("erro ${response.e.errorCode}: ${response.e.message}")
              retryLater()
            }
            is SpeechRecognizerResponse.CompletedResponse -> say("sessão encerrada")
            else -> {}
          }
        }
      } catch (e: Exception) {
        say("falhou: $e")
        retryLater()
      } finally {
        runCatching { source.close() }
      }
    }
  }

  private fun heard(text: String, final: Boolean) {
    if (text.isBlank()) return
    backoff = FIRST_BACKOFF_MS
    val now = System.currentTimeMillis()
    if (!firedThisUtterance && matches(text, locale) && now - lastCommandAt > COOLDOWN_MS) {
      firedThisUtterance = true
      lastCommandAt = now
      say("comando ouvido (${if (final) "final" else "parcial"})")
      onCommand?.invoke()
    }
    if (final) firedThisUtterance = false
  }

  private fun retryLater() {
    val wait = backoff
    backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
    scope.launch {
      gate.withLock { stopSession() }
      delay(wait)
      gate.withLock { if (enabled && session?.isActive != true) startSession() }
    }
  }

  /** Must hold [gate]. Stops dictation's session (the detector just stops being fed). */
  private suspend fun stopSession() {
    val running = session
    session = null
    writer?.interrupt()
    writer = null
    runCatching { out?.close() }
    out = null
    if (running != null) {
      runCatching { recognizer?.stopRecognition() }
      running.cancel()
      if (dropped > 0) say("$dropped trechos de áudio descartados (fila cheia)")
      dropped = 0
    }
  }

  /** Must hold [gate]. The recognizer for [locale], its language pack downloaded; null when it can't be had. */
  private suspend fun ensureRecognizer(): SpeechRecognizer? {
    if (recognizer != null && recognizerLocale == locale) return recognizer
    recognizer?.close()
    recognizer = null
    val rec = SpeechRecognition.getClient(speechRecognizerOptions {
      this.locale = Locale.forLanguageTag(this@VoiceTrigger.locale)
      preferredMode = SpeechRecognizerOptions.Mode.MODE_BASIC
    })
    val status = runCatching { rec.checkStatus() }.getOrElse { say("checkStatus falhou: $it"); rec.close(); return null }
    say("status do modelo ${locale}: ${statusName(status)}")
    when (status) {
      FeatureStatus.AVAILABLE -> {}
      FeatureStatus.DOWNLOADABLE, FeatureStatus.DOWNLOADING -> {
        var ok = false
        val started = System.currentTimeMillis()
        rec.download().collect { d ->
          when (d) {
            is DownloadStatus.DownloadStarted -> say("baixando o modelo…")
            is DownloadStatus.DownloadProgress -> Log.d(TAG, "baixado ${d.totalBytesDownloaded / 1024} KB")
            is DownloadStatus.DownloadCompleted -> {
              ok = true
              say("modelo baixado em ${(System.currentTimeMillis() - started) / 1000}s")
            }
            is DownloadStatus.DownloadFailed -> say("download falhou: ${d.e.errorCode} ${d.e.message}")
            else -> {}
          }
        }
        if (!ok) { rec.close(); return null }
      }
      else -> { rec.close(); return null }
    }
    runCatching { rec.warmup() }
    recognizer = rec
    recognizerLocale = locale
    return rec
  }

  private fun statusName(s: Int) = when (s) {
    FeatureStatus.AVAILABLE -> "disponível"
    FeatureStatus.DOWNLOADABLE -> "para baixar"
    FeatureStatus.DOWNLOADING -> "baixando"
    FeatureStatus.UNAVAILABLE -> "indisponível"
    else -> "$s"
  }
}
