package expo.modules.replaycamera.voice

import android.content.Context
import android.os.SystemClock
import expo.modules.replaycamera.core.voice.DropCounter
import expo.modules.replaycamera.core.voice.KeywordConfig
import expo.modules.replaycamera.core.voice.KeywordPipeline
import org.tensorflow.lite.Interpreter
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The "salvar" detector on Android (KeywordDetector.swift; spec docs/superpowers/specs/2026-11-24-voice-keyword-
 * detector-design.md). The recorder's PCM → [KeywordPipeline] on its own thread, the speech embedding on LiteRT (CPU).
 * Audio that would push the backlog past 2 s is dropped and counted ([DropCounter]): the recorder never waits.
 */
class KeywordDetector(model: KeywordConfig.Loaded, embedder: KeywordPipeline.Embedder, private val closeEmbedder: () -> Unit = {}) : Closeable {
  /** A "salvar" and its score (on the detector's thread). */
  @Volatile var onCommand: ((Double) -> Unit)? = null
  /** Diagnostic lines, never anything that was said. */
  @Volatile var log: ((String) -> Unit)? = null

  val config = model.config
  private val pipeline = KeywordPipeline(model, embedder)
  private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "voice-keyword").apply { priority = Thread.NORM_PRIORITY + 1 } }
  private val lock = Any()
  private val backlog = DropCounter(capacitySeconds = 2.0)
  private var fireLagMs = 0.0

  /** Seconds of audio dropped so far for falling behind. */
  val droppedSeconds: Double get() = synchronized(lock) { backlog.droppedSeconds }

  /** How far behind real time the detector was at its last "salvar" (ms). */
  val lastFireLagMs: Double get() = synchronized(lock) { fireLagMs }

  /** Forget the audio so far (a new session or listening turned back on). */
  fun reset() {
    worker.execute { pipeline.reset() }
  }

  /** 16-bit mono little-endian PCM at [rate] Hz, [bytes] long from index 0 of [buf] (the recorder's chunk). */
  fun consider(buf: ByteBuffer, bytes: Int, rate: Int) {
    if (bytes <= 0 || rate <= 0) return
    val shorts = buf.duplicate().order(ByteOrder.LITTLE_ENDIAN).apply { position(0); limit(bytes) }.asShortBuffer()
    val samples = FloatArray(shorts.remaining()) { shorts.get(it) / 32768f }
    submit(samples, rate.toDouble(), 1)
  }

  /** Interleaved float samples in [-1, 1] (tests, other sources). */
  fun submit(samples: FloatArray, rate: Double, channels: Int) {
    val seconds = samples.size / channels / rate
    val arrived = SystemClock.elapsedRealtime()
    if (!synchronized(lock) { backlog.offer(seconds) }) return
    worker.execute {
      try {
        for (event in pipeline.process(samples, rate, channels)) {
          if (event.fired) {
            synchronized(lock) { fireLagMs = (SystemClock.elapsedRealtime() - arrived).toDouble() }
            onCommand?.invoke(event.score)
          } else if (event.vetoed) {
            log?.invoke(String.format(java.util.Locale.ROOT, "voz: vetado (nota %.2f, veto %.2f)", event.main, event.veto ?: 0.0))
          }
        }
        if (pipeline.formatChanged) log?.invoke("voz: áudio ${rate.toInt()} Hz × $channels")
      } catch (e: Exception) {
        log?.invoke("voz: detector falhou ($e)")
      } finally {
        synchronized(lock) { backlog.release(seconds) }
      }
    }
  }

  override fun close() {
    worker.shutdown()
    runCatching { worker.awaitTermination(1, TimeUnit.SECONDS) }
    closeEmbedder()
  }

  companion object {
    private const val EMBEDDING = "voice_embedding.tflite"
    private const val MODELS = "voice"

    /**
     * The model shipped in the assets (`voice/<version>/` and `voice_embedding.tflite`). null, with a `voz:` line, when
     * something is missing or broken: the caller stays on dictation.
     */
    fun loadBundled(context: Context, log: ((String) -> Unit)?): KeywordDetector? = try {
      val assets = context.assets
      val folder = assets.list(MODELS)?.firstOrNull { name -> assets.list("$MODELS/$name")?.contains("detector.json") == true }
        ?: throw IllegalStateException("arquivos não encontrados")
      val model = KeywordConfig.load { name -> runCatching { assets.open("$MODELS/$folder/$name").use { it.readBytes() } }.getOrNull() }
      val bytes = assets.open(EMBEDDING).use { it.readBytes() }
      val embedder = TfliteEmbedder(ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply { put(bytes); rewind() })
      KeywordDetector(model, embedder) { embedder.close() }
    } catch (e: Exception) {
      log?.invoke("voz: modelo indisponível ($e) — usando ditado")
      null
    }
  }
}

/** The speech embedding on LiteRT, CPU, one thread: a mel window in, `embedSize` numbers out. */
class TfliteEmbedder(model: ByteBuffer) : KeywordPipeline.Embedder, Closeable {
  private val interpreter = Interpreter(model, Interpreter.Options().setNumThreads(1))
  private val inputSize = interpreter.getInputTensor(0).shape().fold(1) { a, b -> a * b }
  private val outputSize = interpreter.getOutputTensor(0).shape().fold(1) { a, b -> a * b }
  private val input: ByteBuffer = ByteBuffer.allocateDirect(inputSize * 4).order(ByteOrder.nativeOrder())
  private val output: ByteBuffer = ByteBuffer.allocateDirect(outputSize * 4).order(ByteOrder.nativeOrder())

  override fun embed(mel: FloatArray): FloatArray {
    require(mel.size == inputSize) { "mel window of ${mel.size}, the model takes $inputSize" }
    input.rewind()
    input.asFloatBuffer().put(mel)
    output.rewind()
    interpreter.run(input, output)
    output.rewind()
    return FloatArray(outputSize).also { output.asFloatBuffer().get(it) }
  }

  override fun close() = interpreter.close()
}
