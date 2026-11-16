package expo.modules.replaycamera

import android.content.Context
import android.os.PowerManager
import android.util.Log
import expo.modules.replaycamera.ball.BallAnalyzer
import expo.modules.replaycamera.ball.BallSport
import expo.modules.replaycamera.focus.ClipScan
import expo.modules.replaycamera.focus.FocusAnalyzer
import org.json.JSONObject
import java.io.File

/**
 * TEMP(lab-android, plan 2026-11-16 task 12): Modo Foco's evaluation on an Android phone. The clips of Victor's handoff
 * are pushed to `<external files>/eval/` with their `clips.txt` (`docs/focus-refs/tools/lab/android_eval.py push`);
 * each clip gets Jogadores alone, then Bola from nothing (people and ball in one pass), and for the first clip of each
 * sport a Bola stopped half way and run again, which must frame exactly as the uninterrupted one. What each run gave
 * goes to `<name>.result.json`, its files to `<name>.eval.*.json`; `android_eval.py pull` / `report` read them.
 * Goes with the Diagnóstico screen.
 */
object LabEval {
  private const val TAG = "ReprizeEval"

  fun dir(context: Context): File = File(context.getExternalFilesDir(null), "eval")

  private fun side(clip: File, ext: String) = File(clip.path.replace(Regex("\\.[^./]+$"), "") + ext)

  private fun clean(clip: File) {
    for (ext in listOf(".focus.json", ".people.json", ".ball.json", ".balldet.json")) side(clip, ext).delete()
  }

  private fun thermal(context: Context) = (context.getSystemService(Context.POWER_SERVICE) as PowerManager).currentThermalStatus

  /** Runs every clip of `clips.txt`; one logcat line per step (tag ReprizeEval). Returns the summary line. */
  fun run(context: Context): String {
    val say = { m: String -> Log.i(TAG, m); Unit }
    val d = dir(context)
    val list = File(d, "clips.txt")
    if (!list.exists()) return "sem ${list.path}"
    val resumed = HashSet<String>()
    var n = 0
    for (line in list.readLines()) {
      if (line.isBlank() || line.startsWith("#")) continue
      val parts = line.trim().split("|")
      if (parts.size < 5) continue
      val name = parts[0]
      val clip = File(d, parts[1])
      if (!clip.exists()) { say("$name: vídeo não encontrado"); continue }
      val startMs = parts[2].toDouble()
      val endMs = startMs + parts[3].toDouble()
      val sport = BallSport.of(parts[4]) ?: continue
      val out = JSONObject().put("name", name).put("sport", sport.id).put("thermalBefore", thermal(context))

      // Jogadores alone, as the Jogadores card runs it (5 fps, kept people)
      clean(clip)
      val f = FocusAnalyzer.analyze(context, clip.path, startMs, endMs, side(clip, ".focus.json").path,
        side(clip, ".people.json").path, false, 200.0)
      out.put("focus", JSONObject().put("ready", f.ready).put("frames", f.frames).put("meanPeople", f.meanPeople)
        .put("elapsedMs", f.elapsedMs).put("stages", JSONObject(f.stages.json())))
      side(clip, ".focus.json").copyTo(side(clip, ".eval.jog.focus.json"), overwrite = true)
      say("$name: Jogadores ${"%.1f".format(f.elapsedMs / 1000)} s, ${f.frames} quadros, ${"%.1f".format(f.meanPeople)} pessoas")

      // Bola from nothing: the people and the ball in one pass, as when Bola is tapped first
      clean(clip)
      val b = bola(context, clip, startMs, endMs, sport)
      out.put("ball", outcome(b))
      for (ext in listOf(".ball.json", ".focus.json", ".balldet.json", ".people.json")) {
        side(clip, ext).copyTo(side(clip, ".eval${ext}"), overwrite = true)
      }
      say("$name: Bola ${"%.1f".format(b.elapsedMs / 1000)} s, bola em ${"%.0f".format(b.ballShare * 100)}%, zoom ${b.zoom}" +
        if (b.verdict.isNotEmpty()) ", sem aplicar: ${b.verdict}" else "")

      // stopped half way and run again: the same framing
      if (resumed.add(sport.id)) {
        clean(clip)
        val half = Thread {
          // cancel once half of the pictures are seen
          while (true) {
            Thread.sleep(200)
            val seen = progress
            if (seen != null && seen.first * 2 >= seen.second && seen.second > 0) { BallAnalyzer.cancel(clip.path); break }
          }
        }
        progress = null
        val previous = BallAnalyzer.emit
        BallAnalyzer.emit = { p, done, total, state -> if (state == "running") progress = Pair(done, total); previous?.invoke(p, done, total, state) }
        half.start()
        var stopped = false
        try {
          bola(context, clip, startMs, endMs, sport)
        } catch (e: ClipScan.Cancelled) {
          stopped = true
        } finally {
          BallAnalyzer.emit = previous
          half.interrupt()
        }
        val again = bola(context, clip, startMs, endMs, sport)
        val same = JSONObject(side(clip, ".ball.json").readText()).getJSONArray("portrait").toString() ==
          JSONObject(side(clip, ".eval.ball.json").readText()).getJSONArray("portrait").toString()
        out.put("resume", JSONObject().put("stopped", stopped).put("reused", again.reused).put("sameFraming", same))
        say("$name: parado no meio ($stopped) e retomado com ${again.reused} quadros guardados: enquadramento igual = $same")
      }
      out.put("thermalAfter", thermal(context))
      File(d, "$name.result.json").writeText(out.toString(2))
      n += 1
    }
    return "avaliação Android: $n clipes em ${d.path}"
  }

  @Volatile private var progress: Pair<Int, Int>? = null

  private fun bola(context: Context, clip: File, startMs: Double, endMs: Double, sport: BallSport) =
    BallAnalyzer.analyze(context, clip.path, startMs, endMs, side(clip, ".balldet.json").path, side(clip, ".ball.json").path,
      side(clip, ".focus.json").path, sport, 1920, BallAnalyzer.Players(startMs, endMs, 200.0, side(clip, ".people.json").path), true)

  private fun outcome(b: BallAnalyzer.Outcome) = JSONObject().put("analysed", b.analysed).put("reused", b.reused)
    .put("ballFrames", b.ballFrames).put("trustedFrames", b.trustedFrames).put("ballShare", b.ballShare).put("zoom", b.zoom)
    .put("elapsedMs", b.elapsedMs).put("verdict", b.verdict).put("focus", b.focus).put("stages", JSONObject(b.stages.json()))
    .put("panP95", b.panP95).put("turnsPer10s", b.turnsPer10s).put("playSeconds", b.playSeconds)

  /** The reference: Bola again on each clip with the Mac's ONNX detections (`<name>.ref.balldet.json`) in place of the phone's. */
  fun reference(context: Context): String {
    val say = { m: String -> Log.i(TAG, m); Unit }
    val d = dir(context)
    var n = 0
    for (line in File(d, "clips.txt").readLines()) {
      if (line.isBlank() || line.startsWith("#")) continue
      val parts = line.trim().split("|")
      val clip = File(d, parts[1])
      val ref = side(clip, ".ref.balldet.json")
      val sport = BallSport.of(parts[4]) ?: continue
      if (!ref.exists()) continue
      val startMs = parts[2].toDouble()
      val endMs = startMs + parts[3].toDouble()
      // the phone's people (Jogadores file of the Bola pass), the Mac's ball
      side(clip, ".eval.focus.json").copyTo(side(clip, ".focus.json"), overwrite = true)
      side(clip, ".eval.people.json").copyTo(side(clip, ".people.json"), overwrite = true)
      ref.copyTo(side(clip, ".balldet.json"), overwrite = true)
      val b = bola(context, clip, startMs, endMs, sport)
      side(clip, ".ball.json").copyTo(side(clip, ".ref.ball.json"), overwrite = true)
      say("${parts[0]}: referência com ${b.reused} de ${b.analysed} quadros do Mac, bola em ${"%.0f".format(b.ballShare * 100)}%")
      n += 1
    }
    return "referência: $n clipes"
  }
}
