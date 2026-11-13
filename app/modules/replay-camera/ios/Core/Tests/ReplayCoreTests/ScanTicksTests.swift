import XCTest
@testable import ReplayCore

final class ScanTicksTests: XCTestCase {
  func testTicksStartAtTheRangeStartAndStopBeforeItsEnd() {
    XCTAssertEqual(ScanTicks.ticks(startMs: 2001, endMs: 2601, everyMs: 200), [2001, 2201, 2401])
    XCTAssertEqual(ScanTicks.ticks(startMs: 0, endMs: 400, everyMs: 200), [0, 200])
    XCTAssertEqual(ScanTicks.ticks(startMs: 500, endMs: 500, everyMs: 200), [])
  }

  func testATickWithAKeptFrameInItsWindowIsNotMissing() {
    // 2003 stands for tick 2001; 2450 for tick 2401 (its window is 2400.5 ..< 2600.5); nothing for 2201
    XCTAssertEqual(ScanTicks.missing(ticks: [2001, 2201, 2401], have: [2450, 2003], windowMs: 200), [2201])
  }

  func testAFrameJustBeforeATickStandsForTheTickBeforeIt() {
    XCTAssertEqual(ScanTicks.missing(ticks: [1000, 1200], have: [1199], windowMs: 200), [1200])
    XCTAssertEqual(ScanTicks.missing(ticks: [1000, 1200], have: [1199.6], windowMs: 200), [1000])
  }

  func testTheCursorTakesTheFirstFrameAtOrAfterEachTick() {
    var c = ScanTicks.Cursor(ticks: [0, 200, 400], windowMs: 200)
    let frames: [Double] = [0, 33, 67, 100, 133, 167, 200, 233, 400.2, 433]
    XCTAssertEqual(frames.filter { c.take($0) }, [0, 200, 400.2])
    XCTAssertTrue(c.done)
  }

  func testTheCursorPassesOverATickWithNoFrameInItsWindow() {
    // ball ticks are 200 ms apart but each stands for its own 100 ms only
    var c = ScanTicks.Cursor(ticks: [1000, 1200, 1400], windowMs: 100)
    let frames: [Double] = [990, 1120, 1210, 1390, 1399.6]
    XCTAssertEqual(frames.filter { c.take($0) }, [1210, 1399.6])
  }

  func testAnEmptyCursorIsDoneAndTakesNothing() {
    var c = ScanTicks.Cursor(ticks: [], windowMs: 100)
    XCTAssertTrue(c.done)
    XCTAssertFalse(c.take(50))
  }

  func testTheSpanCoversEveryTickWithItsWindow() {
    let s = ScanTicks.span(people: [2001, 2201], peopleWindowMs: 200, ball: [1800, 2600], ballWindowMs: 100)
    XCTAssertEqual(s?.fromMs, 1800)
    XCTAssertEqual(s?.toMs, 2700)
    XCTAssertNil(ScanTicks.span(people: [], peopleWindowMs: 200, ball: [], ballWindowMs: 100))
  }
}

final class FocusFramesTests: XCTestCase {
  let frames = [
    FocusSample(tMs: 2003.25, boxes: [FocusBox(x: 0.123456789, y: 0.2, width: 0.05, height: 0.31)]),
    FocusSample(tMs: 2203, boxes: []),
  ]

  func testTheFileKeepsEveryFrameAsFound() {
    let back = FocusFrames.read(roundTrip(FocusFrames.json(frames, width: 1920, height: 1080)), width: 1920, height: 1080)
    XCTAssertEqual(back.map { $0.tMs }, [2003.25, 2203])
    XCTAssertEqual(back[0].boxes, frames[0].boxes) // not rounded: a resumed analysis frames as an uninterrupted one
    XCTAssertEqual(back[1].boxes, [])
  }

  func testAnotherVideoSizeOrABrokenFileIsAnEmptyCache() {
    let obj = roundTrip(FocusFrames.json(frames, width: 1920, height: 1080))
    XCTAssertTrue(FocusFrames.read(obj, width: 3840, height: 2160).isEmpty)
    XCTAssertTrue(FocusFrames.read(nil, width: 1920, height: 1080).isEmpty)
    XCTAssertTrue(FocusFrames.read(["v": 2], width: 1920, height: 1080).isEmpty)
  }

  func testMergedFramesAreInTimeOrderWithTheNewerOfTwoAtTheSameTime() {
    let newer = FocusSample(tMs: 2203, boxes: [FocusBox(x: 0.5, y: 0.5, width: 0.1, height: 0.2)])
    let early = FocusSample(tMs: 1800, boxes: [])
    let all = FocusFrames.merged(frames, [newer, early])
    XCTAssertEqual(all.map { $0.tMs }, [1800, 2003.25, 2203])
    XCTAssertEqual(all[2].boxes, newer.boxes)
  }

  private func roundTrip(_ obj: [String: Any]) -> Any? {
    guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return nil }
    return try? JSONSerialization.jsonObject(with: data)
  }
}

final class FramingMotionTests: XCTestCase {
  private func rects(_ centres: [Double], width: Double = 0.5) -> [[Double]] {
    centres.map { [$0 - width / 2, 0, width, 1] }
  }

  func testAStillCameraHasNoPanAndNoTurns() {
    let m = FramingMotion.stats(rects: rects([Double](repeating: 0.5, count: 50)), stepMs: 100)
    XCTAssertEqual(m.panP95, 0)
    XCTAssertEqual(m.turnsPer10s, 0)
  }

  func testPanIsTheCentresSpeedInFrameWidthsPerSecond() {
    // 0.01 of the frame per 100 ms row = 0.1 frame widths per second, on every row
    let m = FramingMotion.stats(rects: rects((0..<40).map { 0.3 + 0.01 * Double($0) }), stepMs: 100)
    XCTAssertEqual(m.panP95, 0.1, accuracy: 1e-9)
    XCTAssertEqual(m.turnsPer10s, 0)
  }

  func testATurnIsAReversalBetweenPointsAtLeastTwoPercentApart() {
    // right 0.10, back 0.10, right 0.10 over 100 rows (10 s): two reversals
    var c: [Double] = []
    for i in 0..<34 { c.append(0.30 + 0.10 * Double(i) / 33) }
    for i in 0..<33 { c.append(0.40 - 0.10 * Double(i + 1) / 33) }
    for i in 0..<33 { c.append(0.30 + 0.10 * Double(i + 1) / 33) }
    let m = FramingMotion.stats(rects: rects(c), stepMs: 100)
    XCTAssertEqual(m.turnsPer10s, 2, accuracy: 1e-9)
  }

  func testAWobbleUnderTwoPercentIsNotATurn() {
    let c = (0..<100).map { 0.5 + ($0 % 2 == 0 ? 0.005 : -0.005) }
    XCTAssertEqual(FramingMotion.stats(rects: rects(c), stepMs: 100).turnsPer10s, 0)
  }

  func testAnAxisTheCropFillsDoesNotCount() {
    // the crop is the whole height: its y never counts, whatever the rows say
    let r = (0..<50).map { [0.25, $0 % 2 == 0 ? 0.0 : 0.0, 0.5, 1.0] }
    XCTAssertEqual(FramingMotion.stats(rects: r, stepMs: 100).turnsPer10s, 0)
    XCTAssertEqual(FramingMotion.stats(rects: [], stepMs: 100).panP95, 0)
  }
}
