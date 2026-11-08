import XCTest
@testable import ReplayCore

final class TorchPatternTests: XCTestCase {
  func test_startedIsOneSteadyLight() {
    let s = TorchPattern.shape(TorchPattern.started)
    XCTAssertEqual(s.flashes, 1)
    XCTAssertEqual(s.lit, 1.5, accuracy: 0.001)
  }

  func test_aClipIsTwoShortBlinks() {
    let s = TorchPattern.shape(TorchPattern.saved)
    XCTAssertEqual(s.flashes, 2)
    XCTAssertLessThan(s.total, 0.5)
  }

  func test_endedIsThreeSlowPulses() {
    let s = TorchPattern.shape(TorchPattern.ended)
    XCTAssertEqual(s.flashes, 3)
    XCTAssertTrue(TorchPattern.ended.filter(\.on).allSatisfy { $0.seconds >= 0.4 })
  }

  /// The three are told apart by rhythm: the number of flashes, and how long each stays lit.
  func test_theThreeDifferByRhythm() {
    let shapes = [TorchPattern.saved, TorchPattern.started, TorchPattern.ended].map { TorchPattern.shape($0).flashes }
    XCTAssertEqual(Set(shapes).count, 3)
  }
}
