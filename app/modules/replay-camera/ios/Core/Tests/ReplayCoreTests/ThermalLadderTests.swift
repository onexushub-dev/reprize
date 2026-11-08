import XCTest
@testable import ReplayCore

final class ThermalLadderTests: XCTestCase {
  private let hold = ThermalLadder.holdBeforeNextStep

  func test_coolPhoneKeepsTheRequestedQuality() {
    var ladder = ThermalLadder(requested: "1080p60", state: .nominal, now: 0)
    XCTAssertEqual(ladder.quality, "1080p60")
    XCTAssertEqual(ladder.update(state: .fair, now: 10), .none)
    XCTAssertEqual(ladder.quality, "1080p60")
    XCTAssertFalse(ladder.degraded)
  }

  func test_aShortSeriousSpellKeepsTheQuality() {
    var ladder = ThermalLadder(requested: "1080p60", state: .nominal, now: 0)
    XCTAssertEqual(ladder.update(state: .serious, now: 100), .none)
    XCTAssertEqual(ladder.update(state: .serious, now: 100 + hold - 1), .none)
    XCTAssertEqual(ladder.quality, "1080p60")
    XCTAssertFalse(ladder.degraded)
  }

  func test_seriousForTwoMinutesHalvesTheFrameRateAndKeepsFullHD() {
    var ladder = ThermalLadder(requested: "1080p60", state: .nominal, now: 0)
    _ = ladder.update(state: .serious, now: 100)
    XCTAssertEqual(ladder.update(state: .serious, now: 100 + hold), .reconfigure("1080p30"))
    XCTAssertEqual(ladder.quality, "1080p30")
    XCTAssertTrue(ladder.degraded)
  }

  func test_coolingDownBeforeTheWaitEndsStartsItAgain() {
    var ladder = ThermalLadder(requested: "1080p60", state: .nominal, now: 0)
    _ = ladder.update(state: .serious, now: 100)
    XCTAssertEqual(ladder.update(state: .fair, now: 150), .none)
    XCTAssertEqual(ladder.update(state: .serious, now: 200), .none)
    XCTAssertEqual(ladder.update(state: .serious, now: 100 + hold), .none) // the first stretch no longer counts
    XCTAssertEqual(ladder.update(state: .serious, now: 200 + hold), .reconfigure("1080p30"))
  }

  func test_neverBelowFullHDHoweverLongItStaysSerious() {
    var ladder = ThermalLadder(requested: "1080p60", state: .nominal, now: 0)
    _ = ladder.update(state: .serious, now: 100)
    _ = ladder.update(state: .serious, now: 100 + hold)
    XCTAssertEqual(ladder.update(state: .serious, now: 100 + 2 * hold), .none)
    XCTAssertEqual(ladder.update(state: .serious, now: 10_000), .none)
    XCTAssertEqual(ladder.quality, "1080p30")
  }

  func test_coolingDownNeverStepsBackUp() {
    var ladder = ThermalLadder(requested: "1080p60", state: .nominal, now: 0)
    _ = ladder.update(state: .serious, now: 100)
    _ = ladder.update(state: .serious, now: 100 + hold)
    XCTAssertEqual(ladder.update(state: .nominal, now: 1_000), .none)
    XCTAssertEqual(ladder.quality, "1080p30") // a step up would restart the writer again
  }

  func test_4KStepsDownToFullHD30() {
    var ladder = ThermalLadder(requested: "2160p30", state: .nominal, now: 0)
    _ = ladder.update(state: .serious, now: 100)
    XCTAssertEqual(ladder.update(state: .serious, now: 100 + hold), .reconfigure("1080p30"))
    XCTAssertEqual(ladder.quality, "1080p30")
  }

  func test_criticalGoesTo720p30AtOnceAndNeverStops() {
    var ladder = ThermalLadder(requested: "1080p60", state: .nominal, now: 0)
    XCTAssertEqual(ladder.update(state: .critical, now: 5), .reconfigure("720p30"))
    XCTAssertEqual(ladder.quality, "720p30")
    XCTAssertTrue(ladder.degraded)
    XCTAssertEqual(ladder.update(state: .critical, now: 500), .none)
  }

  func test_criticalAfterTheFullHDStepGoesTo720p30() {
    var ladder = ThermalLadder(requested: "1080p60", state: .nominal, now: 0)
    _ = ladder.update(state: .serious, now: 100)
    _ = ladder.update(state: .serious, now: 100 + hold)
    XCTAssertEqual(ladder.update(state: .critical, now: 400), .reconfigure("720p30"))
  }

  func test_backToSeriousAfterCriticalStaysAt720p30() { // never back up
    var ladder = ThermalLadder(requested: "1080p60", state: .nominal, now: 0)
    _ = ladder.update(state: .critical, now: 5)
    XCTAssertEqual(ladder.update(state: .serious, now: 10), .none)
    XCTAssertEqual(ladder.update(state: .serious, now: 10 + 2 * hold), .none)
    XCTAssertEqual(ladder.quality, "720p30")
  }

  func test_aRequestedFullHD30RecordingStillGoesTo720p30WhenCritical() {
    var ladder = ThermalLadder(requested: "1080p30", state: .nominal, now: 0)
    XCTAssertEqual(ladder.update(state: .critical, now: 5), .reconfigure("720p30"))
  }

  func test_startingHotStartsAtFullHD30() { // 2026-11-07: no two minutes at 60 fps followed by a restart
    var ladder = ThermalLadder(requested: "1080p60", state: .serious, now: 0)
    XCTAssertEqual(ladder.quality, "1080p30")
    XCTAssertTrue(ladder.degraded)
    XCTAssertEqual(ladder.update(state: .serious, now: hold * 3), .none)
  }

  func test_starting4KHotStartsAtFullHD30() {
    let ladder = ThermalLadder(requested: "2160p30", state: .serious, now: 0)
    XCTAssertEqual(ladder.quality, "1080p30")
  }

  func test_startingCriticalStartsAt720p30() {
    var ladder = ThermalLadder(requested: "1080p60", state: .critical, now: 0)
    XCTAssertEqual(ladder.quality, "720p30")
    XCTAssertEqual(ladder.update(state: .critical, now: 1), .none)
  }

  func test_startingFairKeepsTheQuality() {
    let ladder = ThermalLadder(requested: "1080p60", state: .fair, now: 0)
    XCTAssertEqual(ladder.quality, "1080p60")
    XCTAssertFalse(ladder.degraded)
  }

  func test_higherQualitiesStepToFullHD30() {
    XCTAssertEqual(ThermalLadder.step(below: "2160p30"), "1080p30")
    XCTAssertEqual(ThermalLadder.step(below: "1440p30"), "1080p30")
    XCTAssertEqual(ThermalLadder.step(below: "1080p60"), "1080p30")
    XCTAssertNil(ThermalLadder.step(below: "1080p30"))
    XCTAssertNil(ThermalLadder.step(below: "720p30"))
  }

  func test_aRequestedFullHD30RecordingIsNeverReconfigured() {
    var ladder = ThermalLadder(requested: "1080p30", state: .nominal, now: 0)
    XCTAssertEqual(ladder.update(state: .serious, now: 1), .none)
    XCTAssertEqual(ladder.update(state: .serious, now: 10_000), .none)
    XCTAssertEqual(ladder.quality, "1080p30")
    XCTAssertFalse(ladder.degraded)
  }

  func test_theGestureSlowsDownOnlyFromSeriousOn() { // 2026-11-02: `fair` is common in long games and halved the wave
    XCTAssertFalse(ThermalLevel.nominal.slowsGesture)
    XCTAssertFalse(ThermalLevel.fair.slowsGesture)
    XCTAssertTrue(ThermalLevel.serious.slowsGesture)
    XCTAssertTrue(ThermalLevel.critical.slowsGesture)
  }

  func test_stateFromProcessInfoRawValues() {
    XCTAssertEqual(ThermalLevel(rawValue: 0), .nominal)
    XCTAssertEqual(ThermalLevel(rawValue: 3), .critical)
    XCTAssertEqual(ThermalLevel.fair.name, "fair")
  }
}
