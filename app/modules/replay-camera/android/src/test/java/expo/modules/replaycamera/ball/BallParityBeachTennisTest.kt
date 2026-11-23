package expo.modules.replaycamera.ball

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Seguir a Bola for beach tennis: the Kotlin port against `BallParityBeachTennisTests.swift` (`ball-parity-bt.json`). */
class BallParityBeachTennisTest {
  private val cases: List<JSONObject> = fixture("ball-parity-bt.json").getJSONArray("cases").let { a -> (0 until a.length()).map { a.getJSONObject(it) } }

  private fun size(c: JSONObject, key: String) = c.getJSONArray(key).doubles()
  private fun sport(c: JSONObject): BallSport = BallSport.of(c.getString("sport"))!!
  private fun exp(c: JSONObject) = c.getJSONObject("expect")
  private fun people(c: JSONObject) = boxRows(c.getJSONArray("people"))
  private fun screens(c: JSONObject) = rows(c.getJSONArray("screens"))
  private fun playersHeight(c: JSONObject): Double? = if (c.isNull("playersHeight")) null else c.getDouble("playersHeight")
  private fun grid(c: JSONObject) = candidateFrames(c.getJSONArray("frames"))
  private fun xy(key: String, c: JSONObject): List<BallXY?> = optRows(exp(c).getJSONArray(key)).map { it?.let { p -> BallXY(p[0], p[1]) } }

  private fun path(c: JSONObject): List<BallPoint?> {
    val s = sport(c)
    val det = size(c, "detSize")
    return BallPath.track(grid(c), det[0], det[1], c.getInt("step"), s.path, if (s.screens) screens(c) else emptyList(), people(c))
  }

  private fun assertPoints(got: List<BallXY?>, want: List<List<Double>?>, what: String) {
    assertEquals(what, want.size, got.size)
    for (i in want.indices) {
      val g = got[i]
      val e = want[i]
      assertEquals("$what frame $i", e == null, g == null)
      if (g == null || e == null) continue
      assertEquals("$what frame $i", e[0], g.x, 1e-6)
      assertEquals("$what frame $i", e[1], g.y, 1e-6)
    }
  }

  @Test fun profiles() {
    assertEquals(BallSport.basketball, BallSport.of("basquete"))
    assertEquals(BallSport.beachTennis, BallSport.of("beachTennis"))
    assertNull(BallSport.of("futevolei"))
    assertEquals(BallPathParams.basketball, BallSport.basketball.path)
    assertEquals(BallZoomParams(), BallSport.basketball.zoom)
    assertEquals("ball_tiny_gym", BallSport.basketball.modelId)
    assertEquals(0, BallSport.basketball.minRun)
    assertFalse(BallSport.basketball.screens)
    assertNull(BallSport.basketball.verdict)
    assertEquals(BallCameraParams.basketball, BallSport.basketball.camera)
    assertEquals(1.0, BallSport.basketball.camera.smoothA, 0.0)
    assertEquals(100.0, BallSport.basketball.camera.smoothB, 0.0)
    assertEquals("ball-t50", BallSport.basketball.rules)
    assertEquals(0.3, BallSport.basketball.path.personRatio, 0.0)
    assertEquals(0.0, BallSport.beachTennis.path.personRatio, 0.0)
    assertNull(BallSport.basketball.follow)
    assertEquals(0.3, BallSport.beachTennis.camera.smoothA, 0.0)
    assertEquals(30.0, BallSport.beachTennis.camera.smoothB, 0.0)
    assertEquals("ball-bt-t60", BallSport.beachTennis.rules)
    assertEquals("ball_tiny_btpl", BallSport.beachTennis.modelId)
    assertEquals(8, BallSport.beachTennis.path.flat)
    assertEquals(0, BallSport.basketball.path.flat)
    assertEquals(0.15, BallSport.beachTennis.path.headTop, 0.0)
    assertEquals(0.0, BallSport.basketball.path.headTop, 0.0)
    assertEquals(BallFollowParams(mainShare = 0.6, courtMargin = 0.2, blend = 0.4, near = 0.25, ballCourtMargin = 0.25,
      keepPair = true, pairPad = 0.0, exitTop = 0.05, exitBack = 0.2, exitDx = 0.25, ownMinScore = 0.5, ownStep = 0.08,
      ownLost = 4, pairNear = 0.25, glide = 6, hitBox = 2, hitHorizon = 10, hitPad = 0.02, nearGap = 10,
      playSpeed = 0.007, playOnPerson = 0.6), BallSport.beachTennis.follow)
    assertEquals(2.0, BallSport.beachTennis.verdict!!.playMin, 0.0)
  }

  @Test fun pathMatchesLab() {
    for (c in cases) {
      val clip = c.getString("clip")
      val got = path(c)
      val want = optRows(exp(c).getJSONArray("track"))
      assertEquals(clip, want.size, got.size)
      for (i in want.indices) {
        val g = got[i]
        val e = want[i]
        assertEquals("$clip frame $i", e == null, g == null)
        if (g == null || e == null) continue
        val v = listOf(g.cx, g.cy, g.width, g.height, g.score)
        for (j in 0 until 5) assertEquals("$clip frame $i [$j]", e[j], v[j], 1e-6)
      }
    }
  }

  @Test fun trustedAndRunsMatchLab() {
    for (c in cases) {
      val clip = c.getString("clip")
      val s = sport(c)
      val e = exp(c)
      val label = size(c, "labelSize")
      assertPoints(BallTrust.trusted(path(c), label[0], label[1]), optRows(e.getJSONArray("trusted")), "$clip trusted")
      assertPoints(BallRuns.keep(xy("trusted", c), s.minRun, s.runGap), optRows(e.getJSONArray("runs")), "$clip runs")
      val f = s.follow!!
      assertPoints(BallRuns.courtLock(xy("runs", c), f.ballCourtMargin, s.runGap), optRows(e.getJSONArray("ballCourt")), "$clip ballCourt")
      val main = BallPlayers.main(people(c), f.mainShare)
      assertPoints(BallPlayers.courtLock(xy("ballCourt", c), main, f.courtMargin), optRows(e.getJSONArray("playersCourt")), "$clip playersCourt")
      val v = size(c, "videoSize")
      val w = v[0]
      val h = v[1]
      val cands = BallRuns.movingCandidates(grid(c), if (s.screens) screens(c) else emptyList(), f.ownMinScore)
      val followed = BallRuns.keepExits(xy("playersCourt", c), f.exitTop, f.exitBack, f.exitDx, cands, f.ownStep, f.ownLost, h / w)
      assertPoints(followed, optRows(e.getJSONArray("followed")), "$clip followed")
      val played = BallPlayers.keepPlay(xy("followed", c), people(c), w, h, f.playSpeed, f.playOnPerson, s.runGap)
      assertPoints(played, optRows(e.getJSONArray("played")), "$clip played")
      val zoom = e.getDouble("zoom")
      val crop = minOf(1.0, (9.0 / 16.0) * h / w) / zoom
      val pl = xy("played", c)
      var aim = BallPlayers.aim(pl, main, w, h, f.blend, f.near)
      aim = BallPlayers.keepPair(aim, pl, main, crop, f.pairPad, f.pairNear, w, h)
      aim = BallPlayers.glide(aim, pl, main, f.glide, f.courtMargin)
      val boxes = BallPlayers.hitBoxes(pl, main, w, h, f.near, f.hitHorizon)
      aim = BallPlayers.keepBox(aim, pl, boxes, crop, f.hitPad, f.hitBox < 2)
      aim = BallPlayers.nearFallback(aim, main, f.nearGap, crop)
      val wantAim = e.getJSONArray("aim").let { a -> (0 until a.length()).map { if (a.isNull(it)) null else a.getDouble(it) } }
      assertEquals(clip, wantAim.size, aim.size)
      for (i in wantAim.indices) {
        assertEquals("$clip aim frame $i", wantAim[i] == null, aim[i] == null)
        if (aim[i] != null && wantAim[i] != null) assertEquals("$clip aim frame $i", wantAim[i]!!, aim[i]!!, 1e-6)
      }
    }
  }

  @Test fun courtLockDrops() {
    val want = mapOf("bt-own-a-10" to 10, "bt-own-f-01" to 12, "bt-own-b-04" to 10, "bt-app-1110-f" to 17,
      "yt-bt-stream-1110" to 8, "bt-campo-1112-b" to 1)
    val found = mapOf("bt-app-1110-f" to 2, "yt-bt-stream-1110" to 2)
    for (c in cases) {
      val clip = c.getString("clip")
      val e = exp(c)
      val runs = optRows(e.getJSONArray("runs"))
      val followed = optRows(e.getJSONArray("followed"))
      val pc = optRows(e.getJSONArray("playersCourt"))
      assertEquals(clip, want[clip] ?: 0, runs.indices.count { runs[it] != null && followed[it] == null })
      assertEquals(clip, found[clip] ?: 0, pc.indices.count { pc[it] == null && followed[it] != null })
    }
  }

  @Test fun glide() {
    val tr = listOf(BallXY(0.40, 0.5), BallXY(0.42, 0.5), null, null, null, null, null)
    val xs = tr.map { it?.x }
    val g = BallPlayers.glide(xs, tr, emptyList(), 3, 0.2)
    assertEquals(0.44, g[2]!!, 1e-12)
    assertEquals(0.48, g[4]!!, 1e-12)
    assertNull(g[5])
    assertEquals(xs, BallPlayers.glide(xs, tr, emptyList(), 0, 0.2))
  }

  @Test fun movingCandidates() {
    val lamp = BallCandidate(0.68, 0.40, 0.01, 0.01, 0.75)
    fun ball(x: Double) = BallCandidate(x, 0.2, 0.01, 0.01, 0.7)
    val weak = BallCandidate(0.3, 0.3, 0.01, 0.01, 0.3)
    val grid = listOf(listOf(lamp, ball(0.40)), null, listOf(lamp, ball(0.45), weak), null, listOf(lamp, ball(0.50)))
    val m = BallRuns.movingCandidates(grid, emptyList(), 0.5)
    assertEquals(listOf(BallXY(0.45, 0.2)), m[2])
    assertTrue(m[1].isEmpty())
    assertTrue(BallRuns.movingCandidates(grid, listOf(listOf(0.3, 0.1, 0.6, 0.3)), 0.5)[2].isEmpty())
  }

  @Test fun hitterAndAim() {
    val ball = BallXY(0.5, 0.5)
    val near = listOf(0.52, 0.3, 0.06, 0.25)
    val far = listOf(0.9, 0.1, 0.03, 0.1)
    assertEquals(near, BallPlayers.hitter(ball, listOf(far, near), 1920.0, 1080.0, 0.25))
    assertNull(BallPlayers.hitter(ball, listOf(far), 1920.0, 1080.0, 0.25))
    val aim = BallPlayers.aim(listOf(ball, null), listOf(listOf(near), listOf(near)), 1920.0, 1080.0, 0.4, 0.25)
    assertEquals(0.6 * 0.5 + 0.4 * 0.55, aim[0]!!, 1e-12)
    assertNull(aim[1])
    assertEquals(3.4, BallPlayers.percentile(listOf(1.0, 2.0, 3.0, 4.0), 80.0), 1e-12)
    val pair = listOf(listOf(0.40, 0.3, 0.05, 0.3), listOf(0.55, 0.3, 0.05, 0.3))
    val kept = BallPlayers.keepPair(listOf(0.30, 0.30), listOf(BallXY(0.45, 0.5), BallXY(0.20, 0.5)), listOf(pair, pair), 0.3, 0.0)
    assertEquals(0.45, kept[0]!!, 1e-12)
    assertEquals(0.30, kept[1]!!, 1e-12)
  }

  @Test fun topExit() {
    val tr = MutableList<BallXY?>(12) { null }
    tr[0] = BallXY(0.5, 0.30); tr[1] = BallXY(0.5, 0.20); tr[2] = BallXY(0.5, 0.10)
    tr[4] = BallXY(0.2, 0.40); tr[5] = BallXY(0.2, 0.38)
    tr[8] = BallXY(0.45, 0.05); tr[9] = BallXY(0.44, 0.12)
    val out = BallRuns.keepExits(tr, 0.05, 0.2, 0.25)
    assertNotNull(out[2])
    assertNull(out[4]); assertNull(out[5])
    assertNotNull(out[8]); assertNotNull(out[9])
    val apex = listOf(BallXY(0.5, 0.3), BallXY(0.5, 0.25), BallXY(0.5, 0.23), BallXY(0.5, 0.3))
    assertEquals(apex, BallRuns.keepExits(apex, 0.05, 0.2, 0.25))
    assertEquals(tr, BallRuns.keepExits(tr, 0.0, 0.2, 0.25))
  }

  @Test fun ballCourtLock() {
    val tr = MutableList<BallXY?>(40) { null }
    for (k in 0 until 20) tr[k] = BallXY(0.5 + 0.005 * (k % 5), 0.5)
    for (k in 26 until 36) tr[k] = BallXY(0.1, 0.4)
    val out = BallRuns.courtLock(tr, 0.25, 4)
    assertEquals(20, out.subList(0, 20).count { it != null })
    assertTrue(out.subList(26, 36).all { it == null })
    assertEquals(tr, BallRuns.courtLock(tr, 0.0, 4))
  }

  @Test fun zoomCameraAndVerdictMatchLab() {
    for (c in cases) {
      val clip = c.getString("clip")
      val s = sport(c)
      val e = exp(c)
      val trusted = xy("trusted", c)
      val followed = xy("played", c)
      val v = size(c, "videoSize")
      val w = v[0]
      val h = v[1]
      val today = rows(c.getJSONArray("todayPortrait"))
      val z = BallZoom.zoom(trusted, today, rows(c.getJSONArray("todayNative")), w, h, s.zoom, cameraBall = followed)
      assertEquals(clip, e.getDouble("zoom"), z.zoom, 1e-9)
      val wantAim = e.getJSONArray("aim").let { a -> (0 until a.length()).map { if (a.isNull(it)) null else a.getDouble(it) } }
      val rects = BallCamera.rects(followed, today, w, h, e.getDouble("zoom"), s.camera, wantAim)
      val want = rows(e.getJSONArray("rects"))
      assertEquals(clip, want.size, rects.size)
      var worst = 0.0
      for (i in want.indices) for (j in 0 until 4) worst = maxOf(worst, Math.abs(rects[i][j] - want[i][j]))
      assertTrue("$clip rect max diff $worst", worst < 1e-5)
      val vp = s.verdict!!
      val before = BallVerdicts.before(playersHeight(c), w, h, s)
      val after = BallVerdicts.after(followed, path(c), rects, w, h, playersHeight(c), vp)
      val reason = before ?: after.reason
      val ev = e.getJSONObject("verdict")
      assertEquals(clip, if (ev.isNull("reason")) null else ev.getString("reason"), reason?.raw)
      assertEquals(clip, ev.getDouble("share"), after.share, 1e-6)
      assertEquals(clip, ev.getDouble("ballPx"), after.ballPx, 1e-4)
      assertEquals(clip, ev.getDouble("pan"), after.pan, 1e-3)
      val ph = playersHeight(c)
      if (!ev.isNull("players") && ph != null) assertEquals(clip, ev.getDouble("players"), ph * BallVerdicts.maxZoom(w, h, s.zoom), 1e-6)
    }
  }

  /** The whole of `BallFraming.compute` with the beach tennis profile gives the same zoom, rects and verdict. */
  @Test fun framingWithProfile() {
    var compared = 0
    for (c in cases) {
      if (size(c, "detSize") != size(c, "videoSize")) continue
      val clip = c.getString("clip")
      val e = exp(c)
      val v = size(c, "videoSize")
      val r = BallFraming.compute(grid(c), v[0], v[1], rows(c.getJSONArray("todayPortrait")), rows(c.getJSONArray("todayNative")),
        sport(c), screens(c), playersHeight(c), people(c))
      assertEquals(clip, e.getDouble("zoom"), r.zoom.zoom, 1e-9)
      val ev = e.getJSONObject("verdict")
      assertEquals(clip, if (ev.isNull("reason")) null else ev.getString("reason"), r.verdict?.reason?.raw)
      val want = rows(e.getJSONArray("rects"))
      var worst = 0.0
      for (i in 0 until minOf(want.size, r.rects.size)) for (j in 0 until 4) worst = maxOf(worst, Math.abs(r.rects[i][j] - want[i][j]))
      assertTrue("$clip rect max diff $worst", worst < 1e-5)
      compared += 1
    }
    assertTrue(compared > 0)
  }

  @Test fun flatFilter() {
    for (c in cases) {
      val clip = c.getString("clip")
      if (!clip.startsWith("bt-campo-")) continue
      val s = sport(c)
      val off = s.path.copy(flat = 0)
      val det = size(c, "detSize")
      val sc = if (s.screens) screens(c) else emptyList()
      val on = BallPath.track(grid(c), det[0], det[1], c.getInt("step"), s.path, sc, people(c))
      val without = BallPath.track(grid(c), det[0], det[1], c.getInt("step"), off, sc, people(c))
      assertNotEquals(clip, on, without)
      val noPeople = BallPath.track(grid(c), det[0], det[1], c.getInt("step"), s.path, sc, emptyList())
      val noPeopleOff = BallPath.track(grid(c), det[0], det[1], c.getInt("step"), off, sc, emptyList())
      assertEquals(clip, noPeople, noPeopleOff)
    }
    val slide = (0 until 12).map { BallXY(0.5 + 0.01 * it, 0.45) }
    assertTrue(BallPath.dropFlat(slide, 8, 0.03, 0.04).all { it == null })
    val arc = (0 until 12).map { BallXY(0.5 + 0.01 * it, 0.45 - 0.02 * (it % 6)) }
    assertEquals(arc, BallPath.dropFlat(arc, 8, 0.03, 0.04))
    assertEquals(listOf(listOf(1, 2, 5), listOf(9, 10)), BallPath.segments(listOf(1, 2, 5, 9, 10)))
  }

  @Test fun headRule() {
    val c = cases.first { it.getString("clip") == "bt-app-1111-a" }
    val got = path(c)
    for (k in listOf(102, 104, 108)) assertNull("frame $k", got[k])
    val p = BallPathParams.beachTennis
    val head = BallCandidate(0.5, 0.32, 0.006, 0.01, 0.6)
    assertTrue(BallPath.isHead(head, listOf(listOf(0.47, 0.30, 0.06, 0.27)), p))
    assertFalse(BallPath.isHead(head, listOf(listOf(0.47, 0.25, 0.06, 0.27)), p))
    val q = p.copy(headTop = 0.0)
    assertEquals(1, BallPath.track(listOf(listOf(head)), 1920.0, 1080.0, 1, q, people = listOf(listOf(listOf(0.47, 0.30, 0.06, 0.27)))).size)
  }

  @Test fun hitBoxKeepsThePlayerAboutToHit() {
    val tr = listOf(BallXY(0.40, 0.5), BallXY(0.32, 0.5), BallXY(0.26, 0.5), BallXY(0.24, 0.5), BallXY(0.30, 0.5))
    val player = listOf(0.20, 0.40, 0.05, 0.25)
    val main = List(5) { listOf(player) }
    val boxes = BallPlayers.hitBoxes(tr, main, 1920.0, 1080.0, 0.25, 10)
    assertEquals(player, boxes[0])
    val xs = BallPlayers.keepBox(List(5) { 0.6 }, tr, boxes, 0.316, 0.02, false)
    for (x in xs) assertTrue(x!! <= 0.20 - 0.02 * 0.316 + 0.158 + 1e-9)
  }

  @Test fun screenBoxes() {
    val w = 160
    val h = 90
    val frames = ArrayList<ByteArray>()
    var seed = 7
    fun rnd(): Byte { seed = seed * 1_103_515_245 + 12345; return ((seed ushr 16) and 0xFF).toByte() }
    for (t in 0 until 30) {
      val f = ByteArray(w * h) { 120.toByte() }
      for (y in 5 until 25) for (x in 20 until 50) f[y * w + x] = rnd()
      val px = 60 + 3 * t
      for (y in 50 until 70) for (x in px until minOf(w, px + 10)) f[y * w + x] = 20.toByte()
      frames.add(f)
    }
    val boxes = BallScreen.boxes(frames, w, h)
    assertEquals(1, boxes.size)
    val b = boxes[0]
    assertEquals(20.0 / 160.0, b[0], 0.02)
    assertEquals(5.0 / 90.0, b[1], 0.03)
    assertEquals(50.0 / 160.0, b[2], 0.02)
    assertEquals(25.0 / 90.0, b[3], 0.03)
    assertTrue(BallScreen.boxes(List(10) { ByteArray(w * h) { 80.toByte() } }, w, h).isEmpty())
  }

  @Test fun runsKeep() {
    val p = BallXY(0.5, 0.5)
    val tr = MutableList<BallXY?>(30) { null }
    for (i in 0 until 3) tr[i] = p
    for (i in 9 until 21) if (i != 14 && i != 15) tr[i] = p
    val kept = BallRuns.keep(tr, 10, 4)
    assertTrue(kept.subList(0, 3).all { it == null })
    assertEquals(10, kept.subList(9, 21).count { it != null })
    assertEquals(tr, BallRuns.keep(tr, 0, 4))
  }
}
