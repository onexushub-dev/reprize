package expo.modules.replaycamera.ball

import kotlin.math.min

/**
 * Seguir a Bola from the stored detections to the 9:16 framing (port of `BallFraming.swift`): the cut's 100 ms grid,
 * which grid frames are analysed (every `step`-th, 5 fps), then path → trusted points → zoom → camera.
 */
object BallFraming {
  const val stepMs = 100.0
  /** Analyse every 2nd 100 ms frame (5 fps). */
  const val step = 2

  data class Result(
    val rects: List<List<Double>>,
    val zoom: BallZoomResult,
    val ballFrames: Int,
    val trustedFrames: Int,
    val verdict: BallVerdict? = null,
  )

  /** Path → trusted → zoom → camera C (see `BallFraming.compute` in Swift for each argument). */
  fun compute(grid: List<List<BallCandidate>?>, width: Double, height: Double, today: List<List<Double>>,
              native: List<List<Double>>, sport: BallSport = BallSport.basketball, screens: List<List<Double>> = emptyList(),
              players: Double? = null, people: List<List<List<Double>>> = emptyList(),
              stale: List<List<BallCandidate>?> = emptyList()): Result {
    val w = width
    val h = height
    val n = grid.size
    val sp = sport.path
    val path = BallPath.track(grid, w, h, step, sp, if (sport.screens) screens else emptyList(),
      if (sp.personRatio > 0 || sp.headTop > 0 || sp.flat > 0) people else emptyList(), stale)
    val trusted = BallTrust.trusted(path, w, h)
    var followed = BallRuns.keep(trusted, sport.minRun, sport.runGap)
    var main: List<List<List<Double>>> = emptyList()
    val rowsN = (0 until n).map { if (it < people.size) people[it] else emptyList() }
    val f = sport.follow
    if (f != null) {
      followed = BallRuns.courtLock(followed, f.ballCourtMargin, sport.runGap)
      if (people.any { it.isNotEmpty() }) {
        main = BallPlayers.main(rowsN, f.mainShare)
        followed = BallPlayers.courtLock(followed, main, f.courtMargin)
      }
      val cands = if (f.ownMinScore > 0) BallRuns.movingCandidates(grid, if (sport.screens) screens else emptyList(), f.ownMinScore) else null
      followed = BallRuns.keepExits(followed, f.exitTop, f.exitBack, f.exitDx, cands, f.ownStep, f.ownLost, h / w)
      followed = BallPlayers.keepPlay(followed, rowsN, w, h, f.playSpeed, f.playOnPerson, sport.runGap)
    }
    val todayRows = aligned(today, n, w, h)
    val nativeRows = if (native.isEmpty()) listOf(listOf(0.0, 0.0, 1.0, 1.0)) else native
    val zoom = BallZoom.zoom(trusted, todayRows, nativeRows, w, h, sport.zoom, cameraBall = if (sport.minRun > 0) followed else null)
    var aim: List<Double?>? = null
    if (f != null) {
      val crop = min(1.0, (9.0 / 16.0) * h / w) / zoom.zoom
      var a = BallPlayers.aim(followed, main, w, h, f.blend, f.near)
      if (f.keepPair) a = BallPlayers.keepPair(a, followed, main, crop, f.pairPad, f.pairNear, w, h)
      a = BallPlayers.glide(a, followed, main, f.glide, f.courtMargin)
      if (f.hitBox > 0) {
        val boxes = BallPlayers.hitBoxes(followed, main, w, h, f.near, f.hitHorizon)
        a = BallPlayers.keepBox(a, followed, boxes, crop, f.hitPad, f.hitBox < 2)
      }
      a = BallPlayers.nearFallback(a, main, f.nearGap, crop)
      aim = a
    }
    val rects = if (n == 0) emptyList() else BallCamera.rects(followed, todayRows, w, h, zoom.zoom, sport.camera, aim)
    var verdict: BallVerdict? = null
    val v = sport.verdict
    if (v != null) {
      val early = BallVerdicts.before(players, w, h, sport)
      verdict = if (early != null) BallVerdict(early, players, 0.0, 0.0, 0.0)
      else BallVerdicts.after(followed, path, rects, w, h, players, v)
    }
    return Result(rects, zoom, path.count { it != null }, trusted.count { it != null }, verdict)
  }

  internal fun aligned(rows: List<List<Double>>, n: Int, width: Double, height: Double): List<List<Double>> {
    val good = rows.filter { it.size == 4 }
    if (good.isEmpty()) {
      val w = min(1.0, (9.0 / 16.0) * height / width)
      val h = min(1.0, (16.0 / 9.0) * width / height)
      return List(n) { listOf((1 - w) / 2, (1 - h) / 2, w, h) }
    }
    return (0 until n).map { good[min(it, good.size - 1)] }
  }
}
