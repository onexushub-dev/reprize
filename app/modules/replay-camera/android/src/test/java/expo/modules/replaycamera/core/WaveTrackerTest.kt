package expo.modules.replaycamera.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin

/** Same cases as the iOS WaveTrackerTests: the two platforms must fire on the same waves. */
class WaveTrackerTest {
  private fun pt(x: Double, y: Double, c: Double = 0.9) = Point(x, y, c)

  /** Shoulders at x 40/60 (shifted by dx) and y=50, nose at y=35; the wrists swing sideways above the head. */
  private fun wavePose(
    t: Double, freq: Double = 2.0, amplitude: Double = 8.0, left: Boolean = true, right: Boolean = true,
    wristY: Double = 12.0, jitter: Double = 0.0, dx: Double = 0.0,
  ): Pose {
    val swing = amplitude * sin(2 * PI * freq * t)
    val lx = 60 + (if (left) swing else 0.0) + dx
    val rx = 40 + (if (right) swing else 0.0) + dx
    val j = jitter * sin(37.0 * t)
    return Pose(
      leftWrist = pt(lx + j, wristY), rightWrist = pt(rx - j, wristY), leftElbow = pt(lx, 30.0), rightElbow = pt(rx, 30.0),
      leftShoulder = pt(60 + dx, 50.0), rightShoulder = pt(40 + dx, 50.0), nose = pt(50 + dx, 35.0),
    )
  }

  private fun run(tracker: WaveTracker, from: Double, to: Double, step: Double, make: (Double) -> List<Sighting>): List<Double> {
    val fired = mutableListOf<Double>()
    var i = 0
    while (true) {
      val t = from + i * step
      if (t > to + 1e-9) break
      if (tracker.update(make(t), t)) fired += t
      i++
    }
    return fired
  }

  private fun one(pose: Pose) = listOf(Sighting(pose, 0.5, 0.5))

  @Test fun wavingBothArms_firesOnce() {
    val fired = run(WaveTracker(), 0.0, 4.0, 0.125) { one(wavePose(it)) }
    assertEquals(1, fired.size)
    assertTrue(fired.first() < 2.0)
  }

  @Test fun waving_isFoundAtTheAndroidSampleRate() {
    val fired = run(WaveTracker(), 0.0, 4.0, 0.2) { one(wavePose(it, freq = 1.3)) }
    assertEquals(1, fired.size)
  }

  @Test fun armsHeldStill_doNotWave() {
    assertEquals(emptyList<Double>(), run(WaveTracker(), 0.0, 5.0, 0.125) { one(wavePose(it, amplitude = 0.0, jitter = 0.6)) })
  }

  @Test fun wavingWithTheHandsLow_doesNotFire() {
    assertEquals(emptyList<Double>(), run(WaveTracker(), 0.0, 5.0, 0.125) { one(wavePose(it, wristY = 70.0)) })
  }

  @Test fun wavingWithOneArmOnly_doesNotFire() {
    assertEquals(emptyList<Double>(), run(WaveTracker(), 0.0, 5.0, 0.125) { one(wavePose(it, left = false)) })
  }

  @Test fun keepWaving_firesAgainOnlyAfterTheArmsComeDown() {
    val fired = run(WaveTracker(), 0.0, 8.0, 0.125) { one(wavePose(it)) }
    assertEquals(1, fired.size)
  }

  @Test fun twoPlayersEachWavingOneArm_doNotAddUp() {
    val fired = run(WaveTracker(), 0.0, 5.0, 0.125) {
      listOf(
        Sighting(wavePose(it, left = false), 0.2, 0.5),
        Sighting(wavePose(it, right = false, dx = 100.0), 0.8, 0.5),
      )
    }
    assertEquals(emptyList<Double>(), fired)
  }

  @Test fun armsRaised_readsTheWristsAboveTheHead() {
    assertTrue(WaveTracker.armsRaised(wavePose(0.0)))
    assertEquals(false, WaveTracker.armsRaised(wavePose(0.0, wristY = 70.0)))
  }
}
