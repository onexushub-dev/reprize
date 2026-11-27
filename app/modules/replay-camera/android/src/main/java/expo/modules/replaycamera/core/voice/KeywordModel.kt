package expo.modules.replaycamera.core.voice

import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.exp

/** A model folder that is missing a file ("missing <name>") or has a broken one ("corrupt <name>: …"). */
class KeywordModelException(message: String) : Exception(message)

/**
 * The "salvar" detector's numbers, read from `detector.json` (KeywordModel.swift). Field names match the file exactly;
 * nothing here is a code constant.
 */
data class KeywordConfig(
  val version: String,
  val sampleRate: Int,
  val nFft: Int,
  val winLength: Int,
  val hop: Int,
  val nMels: Int,
  val embedEvery: Int,
  val embedFrames: Int,
  val embedSize: Int,
  val windows: Int,
  val hidden: Int,
  val threshold: Double,
  val consecutive: Int,
  val refractorySec: Double,
  /** Optional second classifier that can only remove fires (salvar-v2-rc4). Absent in older model folders. */
  val veto: Veto?,
) {
  data class Veto(val file: String, val hidden: Int, val minScore: Double)

  /** A loaded model folder: its config, filterbank and scorer. */
  class Loaded(val config: KeywordConfig, val filterbank: FloatArray, val scorer: KeywordScorer)

  /** Seconds of audio at which score [index] exists (end of its last embedding's last mel frame). */
  fun scoreTime(index: Int): Double {
    val lastFrame = (index + windows - 1) * embedEvery + embedFrames - 1
    return (lastFrame * hop + nFft).toDouble() / sampleRate
  }

  /** Size of one classifier input: [windows] embeddings of [embedSize]. */
  val classifierInput: Int get() = windows * embedSize

  companion object {
    /**
     * A model folder through [read] (a file's bytes by name, null when missing): `detector.json`, `mel_filterbank.bin`,
     * `classifier.bin`, and the veto's file when the config names one.
     */
    fun load(read: (String) -> ByteArray?): Loaded {
      fun file(name: String) = read(name) ?: throw KeywordModelException("missing $name")
      val config = try {
        parse(file("detector.json").toString(Charsets.UTF_8))
      } catch (e: KeywordModelException) {
        throw e
      } catch (e: Exception) {
        throw KeywordModelException("corrupt detector.json: $e")
      }
      val filterbank = floats(file("mel_filterbank.bin"), "mel_filterbank.bin", (config.nFft / 2 + 1) * config.nMels)
      val veto = config.veto?.let { v ->
        KeywordScorer(floats(file(v.file), v.file, KeywordScorer.weightCount(config.classifierInput, v.hidden)), config.classifierInput, v.hidden)
      }
      val scorer = KeywordScorer(
        floats(file("classifier.bin"), "classifier.bin", KeywordScorer.weightCount(config.classifierInput, config.hidden)),
        config.classifierInput, config.hidden, veto, config.veto?.minScore ?: 0.0,
      )
      return Loaded(config, filterbank, scorer)
    }

    private fun parse(text: String): KeywordConfig {
      val j = JSONObject(text)
      val v = j.optJSONObject("veto")
      return KeywordConfig(
        version = j.getString("version"),
        sampleRate = j.getInt("sampleRate"),
        nFft = j.getInt("nFft"),
        winLength = j.getInt("winLength"),
        hop = j.getInt("hop"),
        nMels = j.getInt("nMels"),
        embedEvery = j.getInt("embedEvery"),
        embedFrames = j.getInt("embedFrames"),
        embedSize = j.getInt("embedSize"),
        windows = j.getInt("windows"),
        hidden = j.getInt("hidden"),
        threshold = j.getDouble("threshold"),
        consecutive = j.getInt("consecutive"),
        refractorySec = j.getDouble("refractorySec"),
        veto = v?.let { Veto(it.getString("file"), it.getInt("hidden"), it.getDouble("minScore")) },
      )
    }

    /** Little-endian float32 values. */
    fun floats(bytes: ByteArray): FloatArray {
      val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
      return FloatArray(buffer.remaining()).also { buffer.get(it) }
    }

    private fun floats(bytes: ByteArray, name: String, count: Int): FloatArray {
      if (bytes.size != count * 4) throw KeywordModelException("corrupt $name: ${bytes.size} bytes, expected ${count * 4}")
      return floats(bytes)
    }
  }
}

/** What one window scored: the main classifier, the veto (null without one) and what the firing rule sees. */
data class KeywordScores(val main: Double, val veto: Double?, val combined: Double)

/**
 * The classifier: [KeywordConfig.windows] embeddings in a row → 1 hidden layer (ReLU) → sigmoid score in 0…1. Weights,
 * float32 little-endian, in this order: W1 (input × hidden, row-major), b1 (hidden), W2 (hidden), b2 (1). With a veto
 * (another classifier of the same shape), a window counts only where the veto gives >= [vetoMinScore].
 */
class KeywordScorer(
  weights: FloatArray,
  val inputSize: Int,
  val hidden: Int,
  val veto: KeywordScorer? = null,
  val vetoMinScore: Double = 0.0,
) {
  private val w1: FloatArray
  private val b1: FloatArray
  private val w2: FloatArray
  private val b2: Float
  private val acc: DoubleArray

  init {
    if (weights.size != weightCount(inputSize, hidden)) throw KeywordModelException("corrupt classifier: ${weights.size} weights for $inputSize×$hidden")
    if (veto != null && veto.inputSize != inputSize) throw KeywordModelException("corrupt veto: input ${veto.inputSize}, classifier input $inputSize")
    var at = 0
    w1 = weights.copyOfRange(at, at + inputSize * hidden).also { at += inputSize * hidden }
    b1 = weights.copyOfRange(at, at + hidden).also { at += hidden }
    w2 = weights.copyOfRange(at, at + hidden).also { at += hidden }
    b2 = weights[at]
    acc = DoubleArray(hidden)
  }

  /** What the firing rule sees for [window] (the last windows' embeddings, oldest first): main, or 0 where vetoed. */
  fun score(window: FloatArray): Double = scores(window).combined

  fun scores(window: FloatArray): KeywordScores {
    val main = raw(window)
    val v = veto ?: return KeywordScores(main, null, main)
    val vs = v.raw(window)
    return KeywordScores(main, vs, if (vs >= vetoMinScore) main else 0.0)
  }

  /** This classifier alone. Not thread-safe (one scratch array): the detector calls it from its own thread. */
  private fun raw(window: FloatArray): Double {
    require(window.size == inputSize) { "classifier input must be $inputSize values" }
    for (j in 0 until hidden) acc[j] = b1[j].toDouble()
    for (i in 0 until inputSize) {
      val x = window[i]
      if (x == 0f) continue
      val row = i * hidden
      for (j in 0 until hidden) acc[j] += (x * w1[row + j]).toDouble()
    }
    var z = b2.toDouble()
    for (j in 0 until hidden) if (acc[j] > 0) z += acc[j] * w2[j]
    return 1 / (1 + exp(-z))
  }

  companion object {
    fun weightCount(inputSize: Int, hidden: Int) = inputSize * hidden + hidden + hidden + 1
  }
}

/** Fires when [consecutive] scores in a row reach [threshold], then stays quiet for [refractorySec]. */
class FiringRule(val threshold: Double, val consecutive: Int, val refractorySec: Double) {
  constructor(config: KeywordConfig) : this(config.threshold, config.consecutive, config.refractorySec)

  private var run = 0
  private var lastFire = Double.NEGATIVE_INFINITY

  /** One score at [seconds] of audio; true exactly when the rule fires. */
  fun feed(score: Double, seconds: Double): Boolean {
    run = if (score >= threshold) run + 1 else 0
    if (run < consecutive || seconds - lastFire < refractorySec) return false
    lastFire = seconds
    return true
  }

  fun reset() {
    run = 0
    lastFire = Double.NEGATIVE_INFINITY
  }
}

/**
 * The detector's backlog guard: audio waiting to be processed may add up to [capacitySeconds]; past that, new audio is
 * refused (and counted) instead of blocking the recorder. Not thread-safe by itself: the owner locks around it.
 */
class DropCounter(val capacitySeconds: Double = 2.0) {
  var pendingSeconds = 0.0
    private set
  var droppedSeconds = 0.0
    private set

  /** [seconds] of audio arrive. True: queue it (and call [release] once processed). False: it was dropped. */
  fun offer(seconds: Double): Boolean {
    if (pendingSeconds + seconds > capacitySeconds) {
      droppedSeconds += seconds
      return false
    }
    pendingSeconds += seconds
    return true
  }

  fun release(seconds: Double) {
    pendingSeconds = maxOf(0.0, pendingSeconds - seconds)
  }
}

/**
 * Which engine listens for the save command (VoiceEngine.swift): Portuguese uses the "salvar" detector whenever its
 * model loaded; English, and Portuguese when the model is missing or broken, use dictation (ML Kit).
 */
enum class VoiceEngine {
  DICTATION,
  KEYWORD;

  companion object {
    /** true: Portuguese listens with the detector. false: dictation in every language. */
    const val PORTUGUESE_USES_KEYWORD = true

    fun choose(locale: String, keywordAvailable: Boolean): VoiceEngine =
      if (PORTUGUESE_USES_KEYWORD && locale == "pt-BR" && keywordAvailable) KEYWORD else DICTATION
  }
}
