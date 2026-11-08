import Foundation
import XCTest
@testable import ReplayCore

private func pt(_ x: Double, _ y: Double, _ c: Double = 0.9) -> Point { Point(x: x, y: y, confidence: c) }

/// How the person stands toward the camera.
private enum Stance { case facing, back, side }

/// Shoulders at x 40/60 (shifted by dx) and y=50, nose at y=35, eyes at y=32; the wrists swing sideways above the head
/// like a wave. `.back`: no face joints. `.side`: shoulders 4 apart and one eye.
private func wavePose(_ t: Double, freq: Double = 2.0, amplitude: Double = 8.0, left: Bool = true, right: Bool = true,
                      wristY: Double = 12.0, jitter: Double = 0.0, dx: Double = 0.0, stance: Stance = .facing) -> Pose {
  let swing = amplitude * sin(2 * Double.pi * freq * t)
  let lx = 60 + (left ? swing : 0.0) + dx
  let rx = 40 + (right ? swing : 0.0) + dx
  let j = jitter * sin(37.0 * t) // deterministic stand-in for detector noise
  let (ls, rs) = stance == .side ? (52.0, 48.0) : (60.0, 40.0)
  let face = stance != .back
  return Pose(leftWrist: pt(lx + j, wristY), rightWrist: pt(rx - j, wristY), leftElbow: pt(lx, 30), rightElbow: pt(rx, 30),
              leftShoulder: pt(ls + dx, 50), rightShoulder: pt(rs + dx, 50), nose: face ? pt(50 + dx, 35) : nil,
              leftEye: face ? pt(53 + dx, 32) : nil, rightEye: stance == .facing ? pt(47 + dx, 32) : nil)
}

private func runWave(_ tracker: WaveTracker, from start: Double, to stop: Double, step: Double,
                     _ make: (Double) -> [Sighting]) -> [Double] {
  var fired: [Double] = []
  var i = 0
  while true {
    let t = start + Double(i) * step
    if t > stop + 1e-9 { break }
    if tracker.update(make(t), at: t) { fired.append(t) }
    i += 1
  }
  return fired
}

private func one(_ pose: Pose) -> [Sighting] { [Sighting(pose: pose, x: 0.5, y: 0.5)] }

final class WaveTrackerTests: XCTestCase {
  func test_wavingBothArms_firesOnce() {
    let fired = runWave(WaveTracker(), from: 0.0, to: 4.0, step: 0.125) { one(wavePose($0)) }
    XCTAssertEqual(fired.count, 1)
    XCTAssertLessThan(fired.first ?? 99, 2.0)
  }

  func test_wavingWithTheBackToTheCamera_doesNotFire() { // a rebound or a contested shot (2026-11-07)
    let fired = runWave(WaveTracker(), from: 0.0, to: 5.0, step: 0.125) { one(wavePose($0, stance: .back)) }
    XCTAssertEqual(fired, [])
  }

  func test_wavingSideOn_doesNotFire() { // shoulders overlapping made any hand movement look huge
    let fired = runWave(WaveTracker(), from: 0.0, to: 5.0, step: 0.125) { one(wavePose($0, stance: .side)) }
    XCTAssertEqual(fired, [])
  }

  func test_armsRaisedAwayFromTheCamera_doNotSpeedUpSampling() {
    XCTAssertTrue(WaveTracker.armsRaised(wavePose(0.1)))
    XCTAssertFalse(WaveTracker.armsRaised(wavePose(0.1, stance: .back)))
    XCTAssertFalse(WaveTracker.armsRaised(wavePose(0.1, stance: .side)))
  }

  func test_waving_isFoundAtTheNormal4fpsRateToo() {
    let fired = runWave(WaveTracker(), from: 0.0, to: 4.0, step: 0.25) { one(wavePose($0, freq: 1.3)) }
    XCTAssertEqual(fired.count, 1)
  }

  func test_armsHeldStill_doNotWave() {
    let fired = runWave(WaveTracker(), from: 0.0, to: 5.0, step: 0.125) { one(wavePose($0, amplitude: 0.0, jitter: 0.6)) }
    XCTAssertEqual(fired, [])
  }

  func test_wavingWithTheHandsLow_doesNotFire() {
    let fired = runWave(WaveTracker(), from: 0.0, to: 5.0, step: 0.125) { one(wavePose($0, wristY: 70.0)) }
    XCTAssertEqual(fired, [])
  }

  func test_wavingWithOneArmOnly_doesNotFire() {
    let fired = runWave(WaveTracker(), from: 0.0, to: 5.0, step: 0.125) { one(wavePose($0, left: false)) }
    XCTAssertEqual(fired, [])
  }

  func test_aShortFlurry_doesNotFire() {
    let w = WaveTracker()
    let waving = runWave(w, from: 0.0, to: 0.6, step: 0.125) { one(wavePose($0)) }
    let calm = runWave(w, from: 0.75, to: 4.0, step: 0.125) { one(wavePose($0, wristY: 70.0)) }
    XCTAssertEqual(waving + calm, [])
  }

  func test_wavingOnAfterFiring_doesNotFireAgain() {
    let fired = runWave(WaveTracker(), from: 0.0, to: 9.0, step: 0.125) { one(wavePose($0)) }
    XCTAssertEqual(fired.count, 1)
  }

  func test_loweringTheArmsThenWavingAgain_firesAgain() {
    let w = WaveTracker()
    let first = runWave(w, from: 0.0, to: 2.5, step: 0.125) { one(wavePose($0)) }
    let down = runWave(w, from: 2.625, to: 4.0, step: 0.125) { one(wavePose($0, wristY: 70.0)) }
    let second = runWave(w, from: 4.125, to: 8.0, step: 0.125) { one(wavePose($0)) }
    XCTAssertEqual(first.count, 1)
    XCTAssertEqual(down, [])
    XCTAssertEqual(second.count, 1)
  }

  func test_oneDropoutInTheMiddleOfAWave_doesNotMatter() {
    let fired = runWave(WaveTracker(), from: 0.0, to: 3.0, step: 0.125) { t in
      abs(t - 0.875) < 1e-9 ? [] : one(wavePose(t))
    }
    XCTAssertEqual(fired.count, 1)
  }

  func test_theWaveIsFoundAmongOtherPlayers() {
    let still = wavePose(0.0, amplitude: 0.0)
    let fired = runWave(WaveTracker(), from: 0.0, to: 4.0, step: 0.125) { t in
      let people = [Sighting(pose: wavePose(t), x: 0.30, y: 0.5), Sighting(pose: still, x: 0.70, y: 0.5)]
      return Int(t / 0.125) % 2 == 0 ? people : Array(people.reversed()) // the order is not stable
    }
    XCTAssertEqual(fired.count, 1)
  }

  func test_twoPlayersEachDoingHalfAWave_doNotAddUp() {
    let fired = runWave(WaveTracker(), from: 0.0, to: 5.0, step: 0.125) { t in
      [Sighting(pose: wavePose(t, right: false), x: 0.30, y: 0.5), // only its left arm swings
       Sighting(pose: wavePose(t, left: false), x: 0.70, y: 0.5)]  // only its right arm swings
    }
    XCTAssertEqual(fired, [])
  }
}

final class WaveTrackerIdTests: XCTestCase {
  func test_trackedPlayersStandingCloseKeepTheirOwnSamples() { // gesture v2: ids, not positions, when known
    let still = wavePose(0, amplitude: 0.0)
    let fired = runWave(WaveTracker(), from: 0.0, to: 4.0, step: 0.125) { t in
      // Two players 0.05 apart (within matchDistance): only player 2 waves.
      [Sighting(pose: still, x: 0.50, y: 0.5, id: 1), Sighting(pose: wavePose(t), x: 0.55, y: 0.5, id: 2)]
    }
    XCTAssertEqual(fired.count, 1)
  }

  func test_halfAWaveEachByTwoTrackedPlayersDoesNotFire() {
    let fired = runWave(WaveTracker(), from: 0.0, to: 5.0, step: 0.125) { t in
      [Sighting(pose: wavePose(t, right: false), x: 0.50, y: 0.5, id: 1),
       Sighting(pose: wavePose(t, left: false), x: 0.52, y: 0.5, id: 2)]
    }
    XCTAssertEqual(fired, [])
  }
}

/// 2026-11-02, indoor volleyball: a set (both hands above the head, still, ~1.2 s), then a block jump at the net half a
/// second later, by the same tracked player. The hold rule fired on it (3 hits over 1.5 s, gaps under 1.2 s); since then
/// the app fires on the wave only, which must stay quiet here: the hands never swing from side to side.
final class WaveVolleyballTests: XCTestCase {
  private func player(_ up: Bool, dx: Double = 0.0, jitter: Double = 0.0) -> [Sighting] {
    let wy = up ? 10.0 : 70.0
    let ey = up ? 28.0 : 60.0
    let pose = Pose(leftWrist: pt(56 + dx + jitter, wy), rightWrist: pt(44 + dx - jitter, wy),
                    leftElbow: pt(62 + dx, ey), rightElbow: pt(38 + dx, ey),
                    leftShoulder: pt(60 + dx, 50), rightShoulder: pt(40 + dx, 50), nose: pt(50 + dx, 35),
                    leftEye: pt(53 + dx, 32), rightEye: pt(47 + dx, 32)) // facing: the motion rule decides
    return [Sighting(pose: pose, x: 0.5, y: 0.5, id: 7)]
  }

  func test_aSetThenABlockDoNotWave() {
    let fired = runWave(WaveTracker(), from: 0.0, to: 8.0, step: 0.125) { t in
      if t >= 3.7 && t < 4.9 { return self.player(true, jitter: 0.6 * sin(37.0 * t)) } // the set
      if t >= 5.4 && t < 5.9 { return self.player(true, dx: 3.0 * sin(9.0 * t)) }      // the block jump
      return self.player(false)
    }
    XCTAssertEqual(fired, [])
  }

  func test_theSamePlayerWavingAfterTheBlockStillFires() {
    let w = WaveTracker()
    _ = runWave(w, from: 0.0, to: 6.0, step: 0.125) { t in self.player(t >= 5.4 && t < 5.9) }
    let fired = runWave(w, from: 7.0, to: 10.0, step: 0.125) { t in
      [Sighting(pose: wavePose(t), x: 0.5, y: 0.5, id: 7)]
    }
    XCTAssertEqual(fired.count, 1)
  }
}
