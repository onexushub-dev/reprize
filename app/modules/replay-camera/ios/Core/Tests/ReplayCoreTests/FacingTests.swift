import XCTest
@testable import ReplayCore

private func pt(_ x: Double, _ y: Double, _ c: Double = 0.9) -> Point { Point(x: x, y: y, confidence: c) }

/// Image coordinates, y down. Facing the camera: shoulders 20 apart at y=50, nose at y=35, eyes at y=32, hips at y=85.
private func person(shoulders: (Double, Double) = (60, 40), nose: Point? = pt(50, 35), leftEye: Point? = pt(53, 32),
                  rightEye: Point? = pt(47, 32), hips: (Point, Point)? = (pt(56, 85), pt(44, 85))) -> Pose {
  Pose(leftWrist: pt(62, 5), rightWrist: pt(38, 5), leftElbow: pt(61, 28), rightElbow: pt(39, 28),
       leftShoulder: pt(shoulders.0, 50), rightShoulder: pt(shoulders.1, 50), nose: nose,
       leftEye: leftEye, rightEye: rightEye, leftHip: hips.map { $0.0 }, rightHip: hips.map { $0.1 })
}

final class FacingTests: XCTestCase {
  func test_facingTheCamera_withHips() { // 20 / 35 = 0.57 of the torso
    XCTAssertTrue(Facing.towardCamera(person()))
  }

  func test_facingTheCamera_hipsHidden_usesTheHead() { // 20 / 15 = 1.33 of the head
    XCTAssertTrue(Facing.towardCamera(person(hips: nil)))
  }

  func test_backToTheCamera_noFace() {
    XCTAssertFalse(Facing.towardCamera(person(nose: nil, leftEye: nil, rightEye: nil)))
  }

  func test_backToTheCamera_faintFaceGuesses() { // Vision may still place a face, without confidence
    XCTAssertFalse(Facing.towardCamera(person(nose: pt(50, 35, 0.2), leftEye: pt(53, 32, 0.05), rightEye: pt(47, 32, 0.1))))
  }

  func test_sideOn_oneEyeMissing() {
    XCTAssertFalse(Facing.towardCamera(person(rightEye: nil)))
  }

  func test_sideOn_shouldersOverlap_evenWithBothEyes() { // 6 / 35 = 0.17 of the torso
    XCTAssertFalse(Facing.towardCamera(person(shoulders: (53, 47))))
  }

  func test_sideOn_shouldersOverlap_hipsHidden() { // 6 / 15 = 0.4 of the head
    XCTAssertFalse(Facing.towardCamera(person(shoulders: (53, 47), hips: nil)))
  }

  func test_faintHips_fallBackToTheHead() {
    XCTAssertTrue(Facing.towardCamera(person(hips: (pt(56, 85, 0.1), pt(44, 85, 0.1)))))
  }

  func test_noShoulders_isNotFacing() {
    let p = Pose(leftWrist: pt(62, 5), rightWrist: pt(38, 5), leftElbow: nil, rightElbow: nil, leftShoulder: nil,
                 rightShoulder: pt(40, 50), nose: pt(50, 35), leftEye: pt(53, 32), rightEye: pt(47, 32))
    XCTAssertFalse(Facing.towardCamera(p))
  }
}
