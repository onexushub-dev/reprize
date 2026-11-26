package expo.modules.replaycamera.core.voice

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The "salvar" detector's math on Android matches the voice lab and the iPhone (VoiceKeywordTests.swift, the same
 * cases). Fixture: `voice-golden.json` and the model it was made with, `voice-salvar-v1/` (read from the iOS fixtures,
 * which the unit tests take as resources); the app's model is `assets/voice/salvar-v2-rc4`.
 */
class VoiceKeywordTest {
  private class Golden(val pcm: FloatArray, val mel: List<DoubleArray>, val embeddings: List<FloatArray>, val scores: DoubleArray, val fires: DoubleArray)

  private val golden: Golden by lazy {
    val json = JSONObject(resource("voice-golden.json").toString(Charsets.UTF_8))
    val bytes = Base64.getDecoder().decode(json.getString("pcm16k"))
    val shorts = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
    val pcm = FloatArray(shorts.remaining()) { shorts.get(it) / 32767f }
    fun rows(key: String) = json.getJSONArray(key).let { a -> (0 until a.length()).map { i -> a.getJSONArray(i).let { r -> DoubleArray(r.length()) { r.getDouble(it) } } } }
    fun list(key: String) = json.getJSONArray(key).let { a -> DoubleArray(a.length()) { a.getDouble(it) } }
    Golden(pcm, rows("mel"), rows("embeddings").map { r -> FloatArray(r.size) { r[it].toFloat() } }, list("scores"), list("fires"))
  }

  private fun resource(name: String): ByteArray =
    javaClass.classLoader!!.getResourceAsStream(name)?.readBytes() ?: error("missing test resource $name")

  /** salvar-v1, the model the golden fixture was made with. */
  private val v1: (String) -> ByteArray? = { name -> javaClass.classLoader!!.getResourceAsStream("voice-salvar-v1/$name")?.readBytes() }

  /** The app's model, as shipped in the Android assets. */
  private val rc4Dir = File("src/main/assets/voice/salvar-v2-rc4")
  private fun folder(dir: File): (String) -> ByteArray? = { name -> File(dir, name).takeIf { it.exists() }?.readBytes() }

  private fun makeMel() = MelFrontend(KeywordConfig.load(v1).filterbank, nFft = 512, winLength = 400, hop = 160, nMels = 32)

  private fun mel(samples: FloatArray, chunk: Int): List<FloatArray> {
    val frontend = makeMel()
    val frames = mutableListOf<FloatArray>()
    var i = 0
    while (i < samples.size) {
      frames += frontend.push(samples.copyOfRange(i, minOf(samples.size, i + chunk)))
      i += chunk
    }
    return frames
  }

  private fun rms(x: FloatArray, from: Int, to: Int): Double = sqrt((from until to).sumOf { x[it].toDouble() * x[it] } / (to - from))

  private fun through(r: Resampler, x: FloatArray, chunk: Int): FloatArray {
    val out = ArrayList<Float>()
    var i = 0
    while (i < x.size) {
      out += r.process(x.copyOfRange(i, minOf(x.size, i + chunk))).toList()
      i += chunk
    }
    return out.toFloatArray()
  }

  // Resampler and mel

  @Test fun melMatchesGolden() {
    val frames = mel(golden.pcm, 1600)
    assertTrue(frames.size >= golden.mel.size)
    var worst = 0.0
    golden.mel.forEachIndexed { f, ref -> ref.forEachIndexed { m, b -> worst = maxOf(worst, abs(frames[f][m] - b)) } }
    assertTrue("worst mel difference $worst", worst < 1e-3)
  }

  @Test fun melDoesNotDependOnChunking() {
    val pcm = golden.pcm.copyOf(32000)
    val a = mel(pcm, 1600)
    val b = mel(pcm, 333)
    assertEquals(a.size, b.size)
    a.indices.forEach { assertArrayEquals(a[it], b[it], 0f) }
  }

  @Test fun resamplerBlocksAliasing() {
    fun ratio(hz: Double): Double {
      val x = FloatArray(48000) { sin(2 * Math.PI * hz * it / 48000).toFloat() }
      val y = through(Resampler(fromRate = 48000.0, channels = 1), x, 1024)
      return rms(y, 1600, y.size - 1600) / rms(x, 0, x.size)
    }
    assertTrue(ratio(12000.0) < 0.01)
    assertTrue(ratio(1000.0) > 0.95)
  }

  @Test fun resamplerStereo48kMatches16kMono() {
    val pcm = golden.pcm
    val mono48 = through(Resampler(fromRate = 16000.0, channels = 1, toRate = 48000.0), pcm, 1600)
    val stereo = FloatArray(mono48.size * 2) { mono48[it / 2] }
    val back = through(Resampler(fromRate = 48000.0, channels = 2), stereo, 2048)
    val ref = mel(pcm, 1600)
    val got = mel(back, 1600)
    val n = minOf(ref.size, got.size)
    assertTrue(n > 1000)
    var close = 0
    var total = 0
    for (f in 10 until n - 10) for (m in 0 until 32) {
      total++
      if (abs(ref[f][m] - got[f][m]) < 0.05) close++
    }
    assertTrue(close.toDouble() / total > 0.95)
  }

  @Test fun silenceAndClippingAreFinite() {
    val silence = FloatArray(16000)
    val square = FloatArray(16000) { if ((it / 20) % 2 == 0) 1f else -1f }
    for (signal in listOf(silence, square)) {
      val frames = mel(signal, 1600)
      assertFalse(frames.isEmpty())
      assertTrue(frames.all { f -> f.all { it.isFinite() } })
    }
  }

  @Test fun resamplerPassesThrough16kMono() {
    val x = floatArrayOf(0.1f, -0.2f, 0.3f)
    assertArrayEquals(x, Resampler(fromRate = 16000.0, channels = 1).process(x), 0f)
  }

  @Test fun melResetStartsOver() {
    val samples = golden.pcm
    val fresh = makeMel().push(samples.copyOfRange(0, 16000))
    val used = makeMel()
    used.push(samples.copyOfRange(20000, 20777))
    used.reset()
    val again = used.push(samples.copyOfRange(0, 16000))
    assertEquals(fresh.size, again.size)
    fresh.indices.forEach { assertArrayEquals(fresh[it], again[it], 0f) }
  }

  // Config, scorer, firing rule

  @Test fun loadsGoldenModel() {
    val m = KeywordConfig.load(v1)
    assertEquals("salvar-v1", m.config.version)
    assertEquals(0.95, m.config.threshold, 0.0)
    assertEquals(2, m.config.consecutive)
    assertEquals(1.5, m.config.refractorySec, 0.0)
    assertEquals(257 * 32, m.filterbank.size)
    assertEquals(16 * 96, m.scorer.inputSize)
    assertEquals(128, m.scorer.hidden)
  }

  private fun goldenScores(scorer: KeywordScorer, config: KeywordConfig): DoubleArray {
    val emb = golden.embeddings
    return DoubleArray(emb.size - config.windows + 1) { j ->
      scorer.score(FloatArray(config.classifierInput) { k -> emb[j + k / config.embedSize][k % config.embedSize] })
    }
  }

  @Test fun scoresMatchGolden() {
    val m = KeywordConfig.load(v1)
    val scores = goldenScores(m.scorer, m.config)
    assertEquals(golden.scores.size, scores.size)
    scores.indices.forEach { assertEquals(golden.scores[it], scores[it], 1e-4) }
  }

  @Test fun firesMatchGolden() {
    val config = KeywordConfig.load(v1).config
    val rule = FiringRule(config)
    val fires = golden.scores.indices.mapNotNull { j -> config.scoreTime(j).takeIf { rule.feed(golden.scores[j], it) } }
    assertEquals(golden.fires.size, fires.size)
    fires.indices.forEach { assertEquals(golden.fires[it], fires[it], 0.001) }
  }

  @Test fun ruleNeedsTwoInARowAndRefractory() {
    val rule = FiringRule(threshold = 0.95, consecutive = 2, refractorySec = 1.5)
    val fires = mutableListOf<Double>()
    listOf(0.96, 0.5, 0.96, 0.97, 0.99, 0.99).forEachIndexed { i, s -> val t = i * 0.08; if (rule.feed(s, t)) fires += t }
    listOf(1.24 to 0.99, 1.32 to 0.99, 1.84 to 0.99, 1.92 to 0.99).forEach { (t, s) -> if (rule.feed(s, t)) fires += t }
    assertEquals(2, fires.size)
    assertEquals(0.24, fires[0], 1e-9)
    assertEquals(1.84, fires[1], 1e-9)
  }

  @Test fun brokenModelFolderThrows() {
    val short: (String) -> ByteArray? = { name -> v1(name)?.let { if (name == "classifier.bin") it.copyOf(it.size - 4) else it } }
    try {
      KeywordConfig.load(short)
      fail("expected corrupt")
    } catch (e: KeywordModelException) {
      assertTrue(e.message!!.startsWith("corrupt"))
    }
    val noConfig: (String) -> ByteArray? = { name -> if (name == "detector.json") null else v1(name) }
    try {
      KeywordConfig.load(noConfig)
      fail("expected missing")
    } catch (e: KeywordModelException) {
      assertEquals("missing detector.json", e.message)
    }
  }

  @Test fun scorerIsFiniteOnSilenceAndClipping() {
    val m = KeywordConfig.load(v1)
    for (value in floatArrayOf(0f, -8f, 50f)) {
      val s = m.scorer.score(FloatArray(m.scorer.inputSize) { value })
      assertTrue(s.isFinite() && s >= 0 && s <= 1)
    }
  }

  // Backlog guard

  @Test fun dropCounterBoundsBacklog() {
    val c = DropCounter(capacitySeconds = 2.0)
    assertTrue(c.offer(1.5))
    assertFalse(c.offer(0.6))
    assertEquals(0.6, c.droppedSeconds, 1e-9)
    c.release(1.5)
    assertTrue(c.offer(2.0))
    assertEquals(2.0, c.pendingSeconds, 1e-9)
  }

  // Engine choice

  @Test fun engineChoice() {
    assertTrue(VoiceEngine.PORTUGUESE_USES_KEYWORD)
    assertEquals(VoiceEngine.KEYWORD, VoiceEngine.choose("pt-BR", keywordAvailable = true))
    assertEquals(VoiceEngine.DICTATION, VoiceEngine.choose("en-US", keywordAvailable = true))
    assertEquals(VoiceEngine.DICTATION, VoiceEngine.choose("pt-BR", keywordAvailable = false))
  }

  // salvar-v2-rc4: rc1 plus a veto trained on real verbs ending in -ar

  @Test fun rc4LoadsVetoAndFiresLikeRc1OnGolden() {
    val m = KeywordConfig.load(folder(rc4Dir))
    assertEquals("salvar-v2-rc4", m.config.version)
    assertEquals(KeywordConfig.Veto("veto.bin", 256, 0.05), m.config.veto)
    assertEquals(257 * 32, m.filterbank.size)
    assertEquals(256, m.scorer.veto!!.hidden)
    assertEquals(0.05, m.scorer.vetoMinScore, 0.0)
    val rule = FiringRule(m.config)
    val fires = mutableListOf<Double>()
    goldenScores(m.scorer, m.config).forEachIndexed { j, s ->
      assertTrue(s.isFinite())
      val t = m.config.scoreTime(j)
      if (rule.feed(s, t)) fires += t
    }
    assertEquals(2, fires.size)
    listOf(2.702, 4.702).forEachIndexed { i, b -> assertEquals(b, fires[i], 0.08) }
  }

  @Test fun vetoOnlyRemoves() {
    val config = KeywordConfig.load(folder(rc4Dir)).config
    val n = KeywordScorer.weightCount(config.classifierInput, 8)
    fun constant(bias: Float) = KeywordScorer(FloatArray(n).also { it[n - 1] = bias }, config.classifierInput, 8)
    val weights = KeywordConfig.floats(File(rc4Dir, "classifier.bin").readBytes())
    val main = KeywordScorer(weights, config.classifierInput, config.hidden)
    val no = KeywordScorer(weights, config.classifierInput, config.hidden, veto = constant(-10f), vetoMinScore = 0.05)
    val yes = KeywordScorer(weights, config.classifierInput, config.hidden, veto = constant(10f), vetoMinScore = 0.05)
    val plain = goldenScores(main, config)
    assertTrue(plain.any { it >= 0.95 })
    assertArrayEquals(DoubleArray(plain.size), goldenScores(no, config), 0.0)
    assertArrayEquals(plain, goldenScores(yes, config), 0.0)
    val window = FloatArray(config.classifierInput) { 0.5f }
    val s = no.scores(window)
    assertEquals(main.score(window), s.main, 1e-12)
    assertEquals(1 / (1 + exp(10.0)), s.veto!!, 1e-9)
    assertEquals(0.0, s.combined, 0.0)
    try {
      KeywordScorer(weights, config.classifierInput, config.hidden, veto = KeywordScorer(FloatArray(KeywordScorer.weightCount(96, 8)), 96, 8))
      fail("a veto of another input size must be refused")
    } catch (_: KeywordModelException) {
    }
  }

  @Test fun vetoFileIsRequiredWhenNamed() {
    val noVeto: (String) -> ByteArray? = { name -> if (name == "veto.bin") null else folder(rc4Dir)(name) }
    try {
      KeywordConfig.load(noVeto)
      fail("expected missing veto.bin")
    } catch (e: KeywordModelException) {
      assertEquals("missing veto.bin", e.message)
    }
    val m = KeywordConfig.load(v1)
    assertNull(m.config.veto)
    assertNull(m.scorer.veto)
  }
}
