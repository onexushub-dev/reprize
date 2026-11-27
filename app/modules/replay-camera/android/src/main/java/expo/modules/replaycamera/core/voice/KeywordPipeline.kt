package expo.modules.replaycamera.core.voice

/**
 * The "salvar" pipeline, single-threaded (KeywordDetector.swift's `process` and `step`): audio in any rate and channel
 * count → [Resampler] (16 kHz mono) → [MelFrontend] → every `embedEvery` mel frames, the [Embedder] on the last
 * `embedFrames` → the scorer on the last `windows` embeddings → the [FiringRule]. The caller owns the thread.
 */
class KeywordPipeline(model: KeywordConfig.Loaded, private val embedder: Embedder) {
  /** The speech embedding: `embedFrames` × `nMels` mel values, frame by frame → `embedSize` numbers. */
  fun interface Embedder {
    fun embed(mel: FloatArray): FloatArray
  }

  /**
   * A score that fired: [fired] when the rule fired on the combined score (a "salvar"); otherwise the main classifier
   * alone would have fired and the veto stopped it ([vetoed]).
   */
  data class Event(val seconds: Double, val score: Double, val main: Double, val veto: Double?, val fired: Boolean, val vetoed: Boolean)

  val config = model.config
  private val scorer = model.scorer
  private val mel = MelFrontend(model.filterbank, config.nFft, config.winLength, config.hop, config.nMels)
  private var resampler: Resampler? = null
  private var formatRate = 0.0
  private var formatChannels = 0
  private val melWindow = ArrayDeque<FloatArray>()
  private var melCount = 0
  private val embeddings = ArrayDeque<FloatArray>()
  private var embedCount = 0
  private val rule = FiringRule(config)
  /** The rule on the main score alone, only to tell when the veto stopped a "salvar". */
  private val mainRule = FiringRule(config)
  private val melInput = FloatArray(config.embedFrames * config.nMels)
  private val window = FloatArray(config.classifierInput)

  /** True when the last [process] call met a new format (a route change): the owner logs it. */
  var formatChanged = false
    private set

  /** Forget the audio so far (a new session or listening turned back on). */
  fun reset() {
    resampler = null
    formatRate = 0.0
    formatChannels = 0
    melWindow.clear()
    melCount = 0
    embeddings.clear()
    embedCount = 0
    rule.reset()
    mainRule.reset()
    mel.reset()
  }

  /** Interleaved samples in [-1, 1] at [rate] Hz. Returns what fired (or was vetoed) in them, oldest first. */
  fun process(samples: FloatArray, rate: Double, channels: Int): List<Event> {
    formatChanged = false
    if (resampler == null || rate != formatRate || channels != formatChannels) {
      // A route change mid-recording changes the format: keep the mel and the embeddings going.
      resampler = Resampler(rate, channels, config.sampleRate.toDouble())
      formatRate = rate
      formatChannels = channels
      formatChanged = true
    }
    val events = ArrayList<Event>(0)
    for (frame in mel.push(resampler!!.process(samples))) {
      melWindow.addLast(frame)
      while (melWindow.size > config.embedFrames) melWindow.removeFirst()
      melCount++
      if (melCount >= config.embedFrames && (melCount - config.embedFrames) % config.embedEvery == 0) step()?.let { events += it }
    }
    return events
  }

  /** One embedding and, once there are enough, one score and the firing rules. */
  private fun step(): Event? {
    melWindow.forEachIndexed { f, frame -> frame.copyInto(melInput, f * config.nMels) }
    val vector = embedder.embed(melInput)
    require(vector.size == config.embedSize) { "embedding of ${vector.size}, expected ${config.embedSize}" }
    embeddings.addLast(vector)
    while (embeddings.size > config.windows) embeddings.removeFirst()
    val index = embedCount++
    if (embeddings.size < config.windows) return null
    embeddings.forEachIndexed { e, emb -> emb.copyInto(window, e * config.embedSize) }
    val scores = scorer.scores(window)
    val seconds = config.scoreTime(index - (config.windows - 1))
    val mainFired = mainRule.feed(scores.main, seconds)
    val fired = rule.feed(scores.combined, seconds)
    val vetoed = mainFired && !fired && scores.veto != null && scores.veto < scorer.vetoMinScore
    if (!fired && !vetoed) return null
    return Event(seconds, scores.combined, scores.main, scores.veto, fired, vetoed)
  }
}
