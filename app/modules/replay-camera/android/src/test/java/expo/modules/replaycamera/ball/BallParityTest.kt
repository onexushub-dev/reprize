package expo.modules.replaycamera.ball

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Seguir a Bola: the Kotlin port gives the Swift core's (and the Modo Foco lab's) results on the same inputs
 * (`BallParityTests.swift`, fixture `ball-parity.json`: five basketball clips).
 */
class BallParityTest {
  private val cases: List<JSONObject> = fixture("ball-parity.json").getJSONArray("cases").let { a -> (0 until a.length()).map { a.getJSONObject(it) } }

  private fun size(c: JSONObject, key: String) = c.getJSONArray(key).doubles()

  private fun path(c: JSONObject): List<BallPoint?> {
    val det = size(c, "detSize")
    return BallPath.track(candidateFrames(c.getJSONArray("frames")), det[0], det[1], c.getInt("step"),
      people = boxRows(c.optJSONArray("people")))
  }

  @Test fun pathMatchesLab() {
    for (c in cases) {
      val clip = c.getString("clip")
      val got = path(c)
      val want = optRows(c.getJSONObject("expect").getJSONArray("track"))
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

  @Test fun trustedMatchesLab() {
    for (c in cases) {
      val clip = c.getString("clip")
      val label = size(c, "labelSize")
      val got = BallTrust.trusted(path(c), label[0], label[1])
      val want = optRows(c.getJSONObject("expect").getJSONArray("trusted"))
      assertEquals(clip, want.size, got.size)
      for (i in want.indices) {
        val g = got[i]
        val e = want[i]
        assertEquals("$clip frame $i", e == null, g == null)
        if (g == null || e == null) continue
        assertEquals("$clip frame $i", e[0], g.x, 1e-6)
        assertEquals("$clip frame $i", e[1], g.y, 1e-6)
      }
    }
  }

  /** Test 50: on the long pass the passer's shirt (0.64) no longer holds the path; the ball is followed to the receiver. */
  @Test fun longPassReachesTheReceiver() {
    val c = cases.first { it.getString("clip") == "basket-app-1110-a" }
    val label = size(c, "labelSize")
    val tr = BallTrust.trusted(path(c), label[0], label[1])
    for (k in listOf(46, 47, 48)) assertTrue("frame $k", tr[k]!!.x > 0.45)
    val det = size(c, "detSize")
    val old = BallTrust.trusted(BallPath.track(candidateFrames(c.getJSONArray("frames")), det[0], det[1], c.getInt("step")),
      label[0], label[1])
    assertTrue(old[46]!!.x < 0.25)
  }

  @Test fun shirtRule() {
    val p = BallPathParams.basketball
    val h = 1080.0
    val person = listOf(listOf(0.40, 0.30, 0.05, 0.20))
    val shirt = BallCandidate(0.425, 0.38, 0.03, 0.08, 0.64)
    val ball = BallCandidate(0.425, 0.38, 0.014, 0.025, 0.64)
    assertTrue(BallPath.isShirt(shirt, 0.08 * h, person, h, p))
    assertFalse(BallPath.isShirt(ball, 0.025 * h, person, h, p))
    val low = BallCandidate(0.425, 0.92, 0.03, 0.08, 0.64)
    assertFalse(BallPath.isShirt(low, 0.08 * h, listOf(listOf(0.40, 0.84, 0.05, 0.16)), h, p))
    assertTrue(BallPath.isShirt(low, 0.08 * h, listOf(listOf(0.40, 0.80, 0.05, 0.18)), h, p))
    val frames = ArrayList<List<BallCandidate>?>()
    val people = ArrayList<List<List<Double>>>()
    for (k in 0 until 4) {
      val x = 0.30 + 0.05 * k
      frames.add(listOf(BallCandidate(x, 0.38, 0.03, 0.08, 0.64), BallCandidate(x + 0.30, 0.38, 0.014, 0.025, 0.5)))
      people.add(listOf(listOf(x - 0.025, 0.30, 0.05, 0.20)))
    }
    val without = BallPath.track(frames, 1920.0, h, 1, p)
    val filtered = BallPath.track(frames, 1920.0, h, 1, p, people = people)
    for (k in 0 until 4) {
      assertEquals(0.30 + 0.05 * k, without[k]!!.cx, 1e-9)
      assertEquals(0.60 + 0.05 * k, filtered[k]!!.cx, 1e-9)
    }
    p.personRatio = 0.0
    val off = BallPath.track(frames, 1920.0, h, 1, p, people = people)
    assertNotNull(off[0])
    assertEquals(0.30, off[0]!!.cx, 1e-9)
  }
}
