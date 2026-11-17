package expo.modules.replaycamera

import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import expo.modules.replaycamera.ball.BallDetect
import expo.modules.replaycamera.ball.BallDetector
import expo.modules.replaycamera.ball.BallSport
import expo.modules.replaycamera.focus.PeopleDetector
import expo.modules.replaycamera.focus.Pixels
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Modo Foco speed on a phone (run on Firebase Test Lab to compare models): the ball model on one 19-region Full HD
 * frame, per backend and as the app's probe picks it, and the people detector on one Jogadores sample. One
 * `ReprizeBench` logcat line with the JSON. Timing only: the frames are flat grey, which costs the models the same.
 */
@RunWith(AndroidJUnit4::class)
class FocusBench {
  private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext

  private fun median(runs: Int, f: () -> Unit): Double {
    f()
    return (0 until runs).map { val t0 = System.nanoTime(); f(); (System.nanoTime() - t0) / 1e6 }.sorted()[runs / 2]
  }

  private fun r(v: Double) = Math.round(v * 10) / 10.0

  @Test
  fun measure() {
    val out = JSONObject()
    out.put("model", Build.MODEL).put("brand", Build.BRAND).put("sdk", Build.VERSION.SDK_INT)
      .put("soc", if (Build.VERSION.SDK_INT >= 31) "${Build.SOC_MANUFACTURER} ${Build.SOC_MODEL}" else Build.HARDWARE)
      .put("cores", Runtime.getRuntime().availableProcessors())
    val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    out.put("thermalStart", pm.currentThermalStatus)

    // the ball: the app's probe (the 400 ms gate), then each backend with its stages
    out.put("probeMs", r(BallDetector.probe(context, BallSport.basketball.modelId)))
    val frame = IntArray(1920 * 1080) { (0xFF shl 24) or (102 shl 16) or (115 shl 8) or 128 }
    val regions = BallDetect.regions(1920, 1080, BallDetector.SIDE, BallDetector.TILE)
    for (b in BallDetector.Backend.values()) {
      try {
        BallDetector(context, BallSport.basketball.modelId, b).use { d ->
          val ms = median(3) { d.detect(frame, 1920, 1080, regions) }
          out.put("ball_${b.name.lowercase()}", JSONObject().put("ran", d.backend).put("frameMs", r(ms))
            .put("prepMs", r(d.lastPrepMs)).put("modelMs", r(d.lastModelMs)))
        }
      } catch (e: Throwable) {
        out.put("ball_${b.name.lowercase()}", JSONObject().put("error", e.toString()))
      }
    }

    // the people: one Jogadores sample (9 tiles of a 1280 frame), on 1 to 4 lanes (peopleNMs = N lanes)
    val people = Pixels(IntArray(1280 * 720) { (0xFF shl 24) or (102 shl 16) or (115 shl 8) or 128 }, 1280, 720)
    for (threads in listOf(1, 2, 3, 4)) {
      PeopleDetector(context, lanes = threads).use { d ->
        var i = 0
        out.put("people${threads}Ms", r(median(5) { d.detect(people, i++) }))
        val n = 6.0 // the warm-up and the 5 runs
        out.put("people${threads}Parts", JSONObject().put("fillMs", r(d.fillNs / 1e6 / n)).put("modelMs", r(d.modelNs / 1e6 / n))
          .put("decodeMs", r(d.decodeNs / 1e6 / n)))
      }
    }
    out.put("thermalEnd", pm.currentThermalStatus)
    // seconds of waiting per second of cut: Jogadores samples 5 a second, Bola reads 5 frames a second
    out.put("jogadoresSecPerSec", r(out.getDouble("people3Ms") * 5 / 1000))
    out.put("bolaSecPerSec", r(out.getDouble("probeMs") * 5 / 1000))
    out.put("bolaShown", out.getDouble("probeMs") <= 400)
    Log.i("ReprizeBench", out.toString())
    InstrumentationRegistry.getInstrumentation().sendStatus(0, android.os.Bundle().apply { putString("bench", out.toString()) })
  }
}
