package expo.modules.replaycamera

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import expo.modules.replaycamera.core.voice.KeywordConfig
import expo.modules.replaycamera.core.voice.MelFrontend
import expo.modules.replaycamera.voice.KeywordDetector
import expo.modules.replaycamera.voice.TfliteEmbedder
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/**
 * The "salvar" detector on a real phone (spec: "Conversion check (golden test)"): the LiteRT speech embedding gives the
 * lab's embeddings, and the whole detector with the app's model (assets, salvar-v2-rc4) fires on Victor's golden
 * "salvar"s where the lab did. Fixture: `voice-golden.json` (the iOS fixtures, added to this test's assets).
 */
@RunWith(AndroidJUnit4::class)
class VoiceDetectorDeviceTest {
  private val context = InstrumentationRegistry.getInstrumentation().context
  private val json by lazy { JSONObject(context.assets.open("voice-golden.json").use { it.readBytes() }.toString(Charsets.UTF_8)) }
  private val pcm16 by lazy {
    val b = ByteBuffer.wrap(android.util.Base64.decode(json.getString("pcm16k"), android.util.Base64.DEFAULT)).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
    ShortArray(b.remaining()).also { b.get(it) }
  }

  private fun embedder(): TfliteEmbedder {
    val bytes = context.assets.open("voice_embedding.tflite").use { it.readBytes() }
    return TfliteEmbedder(ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply { put(bytes); rewind() })
  }

  @Test fun theEmbeddingMatchesTheLab() {
    val model = KeywordConfig.load { name -> runCatching { context.assets.open("voice-salvar-v1/$name").use { it.readBytes() } }.getOrNull() }
    val mel = MelFrontend(model.filterbank, 512, 400, 160, 32).push(FloatArray(pcm16.size) { pcm16[it] / 32767f })
    val lab = json.getJSONArray("embeddings")
    val e = embedder()
    var worst = 0.0
    for (k in listOf(0, 1, 20, 40, 80, lab.length() - 1)) {
      val got = e.embed(FloatArray(76 * 32) { mel[k * 8 + it / 32][it % 32] })
      val ref = lab.getJSONArray(k)
      assertEquals(ref.length(), got.size)
      for (i in got.indices) worst = maxOf(worst, abs(got[i] - ref.getDouble(i)))
    }
    e.close()
    assertTrue("worst embedding difference $worst", worst < 0.01)
  }

  @Test fun theAppsDetectorFiresOnTheGoldenSalvars() {
    val detector = KeywordDetector.loadBundled(context) { android.util.Log.i("ReprizeVoiceTest", it) }
    assertNotNull("the bundled model loads", detector)
    assertEquals("salvar-v2-rc4", detector!!.config.version)
    val fires = java.util.Collections.synchronizedList(mutableListOf<Double>())
    val two = CountDownLatch(2)
    detector.onCommand = { score -> fires += score; two.countDown() }
    // As the recorder hands it over: 16-bit mono at 48 kHz, 20 ms chunks (the 16 kHz golden, upsampled).
    val up = expo.modules.replaycamera.core.voice.Resampler(16000.0, 1, toRate = 48000.0)
    val at48 = up.process(FloatArray(pcm16.size) { pcm16[it] / 32767f })
    val chunk = ByteBuffer.allocateDirect(960 * 2).order(ByteOrder.LITTLE_ENDIAN)
    var i = 0
    while (i < at48.size) {
      val n = minOf(960, at48.size - i)
      chunk.clear()
      for (k in 0 until n) chunk.putShort((at48[i + k].coerceIn(-1f, 1f) * 32767).toInt().toShort())
      detector.consider(chunk, n * 2, 48000)
      i += n
      Thread.sleep(10) // twice real time: fast, and well inside the 2 s backlog
    }
    assertTrue("two salvars heard (got ${fires.size})", two.await(20, TimeUnit.SECONDS))
    assertEquals(0.0, detector.droppedSeconds, 0.0)
    assertTrue(fires.all { it >= 0.95 })
    detector.close()
  }
}
