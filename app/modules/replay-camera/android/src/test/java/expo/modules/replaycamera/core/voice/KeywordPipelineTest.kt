package expo.modules.replaycamera.core.voice

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64

/**
 * The whole "salvar" pipeline on Android (KeywordDetector.swift's process/step): audio in any format → mel → an embedding
 * every 8 frames from the last 76 → a score from the last 16 → the firing rule. The embedding model is stood in by the
 * lab's own embeddings (the real one runs on the phone, in the device test), so this checks the steps' order and
 * timing against `voice-golden.json`.
 */
class KeywordPipelineTest {
  private val json by lazy { JSONObject(javaClass.classLoader!!.getResourceAsStream("voice-golden.json")!!.readBytes().toString(Charsets.UTF_8)) }
  private val pcm16: ShortArray by lazy {
    val b = ByteBuffer.wrap(Base64.getDecoder().decode(json.getString("pcm16k"))).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
    ShortArray(b.remaining()).also { b.get(it) }
  }
  private val goldenEmbeddings: List<FloatArray> by lazy {
    val a = json.getJSONArray("embeddings")
    (0 until a.length()).map { i -> a.getJSONArray(i).let { r -> FloatArray(r.length()) { r.getDouble(it).toFloat() } } }
  }
  private val goldenFires by lazy { json.getJSONArray("fires").let { a -> DoubleArray(a.length()) { a.getDouble(it) } } }
  private val model by lazy { KeywordConfig.load { name -> javaClass.classLoader!!.getResourceAsStream("voice-salvar-v1/$name")?.readBytes() } }

  /** Hands out the lab's embeddings in order, and keeps each mel window it was given. */
  private inner class LabEmbedder : KeywordPipeline.Embedder {
    val windows = mutableListOf<FloatArray>()
    override fun embed(mel: FloatArray): FloatArray {
      windows += mel.copyOf()
      return goldenEmbeddings[windows.size - 1]
    }
  }

  private fun run(pipeline: KeywordPipeline, samples: FloatArray, rate: Double, channels: Int, chunk: Int): List<Double> {
    val fires = mutableListOf<Double>()
    var i = 0
    while (i < samples.size) {
      pipeline.process(samples.copyOfRange(i, minOf(samples.size, i + chunk)), rate, channels).filter { it.fired }.forEach { fires += it.seconds }
      i += chunk
    }
    return fires
  }

  @Test fun golden16kFiresWhereTheLabDid() {
    val embedder = LabEmbedder()
    val pipeline = KeywordPipeline(model, embedder)
    val fires = run(pipeline, FloatArray(pcm16.size) { pcm16[it] / 32767f }, 16000.0, 1, 1600)
    assertEquals(goldenEmbeddings.size, embedder.windows.size)
    assertEquals(goldenFires.size, fires.size)
    goldenFires.indices.forEach { assertEquals(goldenFires[it], fires[it], 0.001) }
  }

  @Test fun eachEmbeddingSeesTheLast76MelFramesInOrder() {
    val embedder = LabEmbedder()
    val samples = FloatArray(pcm16.size) { pcm16[it] / 32767f }
    run(KeywordPipeline(model, embedder), samples, 16000.0, 1, 777)
    val mel = MelFrontend(model.filterbank, 512, 400, 160, 32).push(samples)
    // Embedding 0 is frames 0..75, embedding 1 frames 8..83: row-major, frame by frame.
    for (e in listOf(0, 1, 40)) {
      val expected = FloatArray(76 * 32) { mel[e * 8 + it / 32][it % 32] }
      assertArrayEquals(expected, embedder.windows[e], 0f)
    }
  }

  @Test fun a48kMicrophoneIsResampledFirst() {
    val up = Resampler(16000.0, 1, toRate = 48000.0)
    val samples48 = up.process(FloatArray(pcm16.size) { pcm16[it] / 32767f })
    val embedder = LabEmbedder()
    run(KeywordPipeline(model, embedder), samples48, 48000.0, 1, 4800)
    // As many embedding steps as at 16 kHz, give or take the filters' edge.
    assertTrue(embedder.windows.size in goldenEmbeddings.size - 2..goldenEmbeddings.size)
  }

  @Test fun resetForgetsTheAudioSoFar() {
    val embedder = LabEmbedder()
    val pipeline = KeywordPipeline(model, embedder)
    val samples = FloatArray(pcm16.size) { pcm16[it] / 32767f }
    pipeline.process(samples.copyOfRange(0, 30000), 16000.0, 1)
    pipeline.reset()
    embedder.windows.clear()
    pipeline.process(samples.copyOfRange(0, 16000), 16000.0, 1)
    // 16000 samples make 97 mel frames: one embedding (frames 0..75) and two more (8.., 16..).
    assertEquals(3, embedder.windows.size)
  }

  @Test fun theVetoStopsAFireAndSaysSo() {
    val vetoAll = KeywordScorer(FloatArray(KeywordScorer.weightCount(16 * 96, 8)).also { it[it.size - 1] = -10f }, 16 * 96, 8)
    val weights = KeywordConfig.floats(javaClass.classLoader!!.getResourceAsStream("voice-salvar-v1/classifier.bin")!!.readBytes())
    val vetoed = KeywordConfig.Loaded(model.config, model.filterbank, KeywordScorer(weights, 16 * 96, 128, vetoAll, 0.05))
    val pipeline = KeywordPipeline(vetoed, LabEmbedder())
    val events = mutableListOf<KeywordPipeline.Event>()
    val samples = FloatArray(pcm16.size) { pcm16[it] / 32767f }
    var i = 0
    while (i < samples.size) {
      events += pipeline.process(samples.copyOfRange(i, minOf(samples.size, i + 1600)), 16000.0, 1)
      i += 1600
    }
    assertTrue(events.none { it.fired })
    assertEquals(goldenFires.size, events.count { !it.fired && it.vetoed })
  }
}
