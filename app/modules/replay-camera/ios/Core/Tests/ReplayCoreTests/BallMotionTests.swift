import XCTest
@testable import ReplayCore

final class BallMotionTests: XCTestCase {
  private func flat(_ v: UInt8, _ w: Int, _ h: Int) -> [UInt8] { [UInt8](repeating: v, count: w * h) }

  private func with(_ base: [UInt8], _ w: Int, blob v: UInt8, x: Int, y: Int, side: Int = 3) -> [UInt8] {
    var out = base
    for dy in 0..<side { for dx in 0..<side { out[(y + dy) * w + x + dx] = v } }
    return out
  }

  func testAPixelChangedWhenItDiffersFromBothNeighbours() {
    let w = 12, h = 8
    let still = flat(60, w, h)
    let ball = with(still, w, blob: 250, x: 5, y: 3)
    let m = BallMotion.changed(ball, before: still, after: still, width: w, height: h)
    XCTAssertTrue(m[4 * w + 6]) // the blob's centre
    XCTAssertFalse(m[0])
    XCTAssertFalse(BallMotion.changed(still, before: still, after: still, width: w, height: h).contains(true))
  }

  func testSomethingThatAppearsAndStaysIsNotMotion() {
    let w = 12, h = 8
    let still = flat(60, w, h)
    let lamp = with(still, w, blob: 250, x: 5, y: 3)
    // differs from the frame before, equal to the one after
    XCTAssertFalse(BallMotion.changed(lamp, before: still, after: lamp, width: w, height: h).contains(true))
  }

  func testTheFirstAndLastFramesCompareWithTheOneNeighbourTheyHave() {
    let w = 12, h = 8
    let still = flat(60, w, h)
    let ball = with(still, w, blob: 250, x: 5, y: 3)
    XCTAssertTrue(BallMotion.changed(ball, before: nil, after: still, width: w, height: h).contains(true))
    XCTAssertTrue(BallMotion.changed(ball, before: still, after: nil, width: w, height: h).contains(true))
    XCTAssertFalse(BallMotion.changed(ball, before: nil, after: nil, width: w, height: h).contains(true))
  }

  func testNoiseUnderTheThresholdIsNotMotion() {
    let w = 12, h = 8
    let a = flat(60, w, h), b = flat(78, w, h) // 18 grey levels everywhere: under 20
    XCTAssertFalse(BallMotion.changed(a, before: b, after: b, width: w, height: h).contains(true))
  }

  func testTheTilesThatRunAreTheLabsOnItsOwnThumbnails() throws {
    // motion_parity.py: the same thumbnails through motion_tiles.py's own functions
    let url = try XCTUnwrap(Bundle.module.url(forResource: "ball-motion", withExtension: "json", subdirectory: "Fixtures"))
    let f = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    let frame = try XCTUnwrap(f["frame"] as? [Int]), thumb = try XCTUnwrap(f["thumb"] as? [Int])
    let tile = try XCTUnwrap(f["tile"] as? Int)
    let thumbs = try XCTUnwrap(f["thumbs"] as? [[Int]]).map { $0.map { UInt8($0) } }
    let rows = try XCTUnwrap(f["rows"] as? [[String: Any]])
    let regions = BallDetect.regions(width: frame[0], height: frame[1], side: 416, tile: tile)
    var gate = BallMotion.Gate(regions: regions, frameWidth: frame[0], frameHeight: frame[1], tile: tile)
    XCTAssertEqual(rows.count, thumbs.count)
    for k in 0..<thumbs.count {
      let m = BallMotion.changed(thumbs[k], before: k > 0 ? thumbs[k - 1] : nil,
                                 after: k + 1 < thumbs.count ? thumbs[k + 1] : nil, width: thumb[0], height: thumb[1])
      XCTAssertEqual(m.filter { $0 }.count, rows[k]["changed"] as? Int, "changed pixels, frame \(k)")
      let now = BallMotion.tiles(changed: m, width: thumb[0], height: thumb[1], frameWidth: frame[0],
                                 frameHeight: frame[1], regions: regions, tile: tile)
      // the fixture counts tiles from 0; here they are the regions after the whole frame (1...)
      XCTAssertEqual(now.map { $0 - 1 }.sorted(), rows[k]["now"] as? [Int], "tiles that changed, frame \(k)")
      XCTAssertEqual(gate.run(changed: now).map { $0 - 1 }.sorted(), rows[k]["run"] as? [Int], "tiles that run, frame \(k)")
    }
  }

  func testATileAlsoRunsOnTheAnalysedFrameAfterItMoved() {
    let regions = BallDetect.regions(width: 1920, height: 1080, side: 416, tile: 416)
    var gate = BallMotion.Gate(regions: regions, frameWidth: 1920, frameHeight: 1080, tile: 416)
    XCTAssertEqual(gate.run(changed: [3]), [3])
    XCTAssertEqual(gate.run(changed: [7]), [3, 7])
    XCTAssertEqual(gate.run(changed: []), [7])
    XCTAssertEqual(gate.run(changed: []), [])
  }

  func testATileNotRunKeepsWhatItHeldAsEvidenceOnly() {
    let regions = BallDetect.regions(width: 1920, height: 1080, side: 416, tile: 416)
    var gate = BallMotion.Gate(regions: regions, frameWidth: 1920, frameHeight: 1080, tile: 416)
    // region 1 is the top-left tile (0..<416 px): a lamp at (100, 100) px; region 6 is the top-right one
    let lamp = BallCandidate(cx: 100.0 / 1920, cy: 100.0 / 1080, width: 0.01, height: 0.018, score: 0.4)
    let ball = BallCandidate(cx: 1800.0 / 1920, cy: 100.0 / 1080, width: 0.01, height: 0.018, score: 0.8)
    XCTAssertEqual(gate.stale(ran: [1, 6], candidates: [lamp, ball]), [])
    // the top-left tile does not run now: its lamp is evidence; the ball's tile ran, so the ball is not
    XCTAssertEqual(gate.stale(ran: [6], candidates: [ball]), [lamp])
    // it runs again and the lamp is not found this time: nothing is held for it any more
    XCTAssertEqual(gate.stale(ran: [1, 6], candidates: [ball]), [])
    XCTAssertEqual(gate.stale(ran: [], candidates: []), [ball])
  }

  func testWhatATileNeverRunHeldIsNothing() {
    let regions = BallDetect.regions(width: 1920, height: 1080, side: 416, tile: 416)
    var gate = BallMotion.Gate(regions: regions, frameWidth: 1920, frameHeight: 1080, tile: 416)
    // found by the whole-frame region only, in a tile that never ran: not kept as evidence
    let far = BallCandidate(cx: 0.5, cy: 0.9, width: 0.02, height: 0.03, score: 0.3)
    XCTAssertEqual(gate.stale(ran: [1], candidates: [far]), [])
    XCTAssertEqual(gate.stale(ran: [1], candidates: []), [])
  }
}

final class BallStillEvidenceTests: XCTestCase {
  private func c(_ x: Double, _ y: Double, _ s: Double = 0.5) -> BallCandidate {
    BallCandidate(cx: x, cy: y, width: 0.012, height: 0.02, score: s)
  }

  /// A lamp the detector is shown only on every 4th frame (its tile runs only then), and a ball that moves.
  private func scene(n: Int = 24) -> (frames: [[BallCandidate]?], stale: [[BallCandidate]?]) {
    var frames: [[BallCandidate]?] = [], stale: [[BallCandidate]?] = []
    for k in 0..<n {
      let ball = c(0.2 + 0.02 * Double(k), 0.5, 0.6)
      let seen = k % 4 == 0
      frames.append(seen ? [ball, c(0.8, 0.2, 0.9)] : [ball])
      stale.append(seen || k == 0 ? [] : [c(0.8, 0.2, 0.9)])
    }
    return (frames, stale)
  }

  func testWithoutEvidenceALampSeenNowAndThenLooksLikeSomethingThatMoves() {
    let s = scene()
    let moving = BallPath.moving(frames: s.frames, stale: [], width: 1920, height: 1080, params: .basketball)
    XCTAssertEqual(moving[4]?.count, 2) // seen on 5 of its 23 neighbours: under the still share
  }

  func testEvidenceFromTheFramesThatDidNotLookKeepsTheLampOut() {
    let s = scene()
    let moving = BallPath.moving(frames: s.frames, stale: s.stale, width: 1920, height: 1080, params: .basketball)
    for k in stride(from: 4, to: 24, by: 4) {
      XCTAssertEqual(moving[k]?.map { $0.cx }, [0.2 + 0.02 * Double(k)], "frame \(k)")
    }
  }

  func testEvidenceIsNeverAPointOfThePath() {
    // nothing found on any frame; a lamp held as evidence on all of them
    let frames = [[BallCandidate]?](repeating: [], count: 12)
    let stale = [[BallCandidate]?](repeating: [c(0.8, 0.2, 0.9)], count: 12)
    let path = BallPath.track(frames: frames, width: 1920, height: 1080, step: 1, params: .basketball, stale: stale)
    XCTAssertTrue(path.allSatisfy { $0 == nil })
  }

  func testThePathIsTheSameWithNoEvidenceGiven() {
    let s = scene()
    XCTAssertEqual(BallPath.track(frames: s.frames, width: 1920, height: 1080, step: 1, params: .basketball),
                   BallPath.track(frames: s.frames, width: 1920, height: 1080, step: 1, params: .basketball, stale: []))
  }

  func testTheDetectionsFileKeepsTheEvidenceWithItsFrame() {
    let d = [
      BallFraming.Detection(tMs: 1000, candidates: [c(0.3, 0.5)], stale: [c(0.8, 0.2, 0.9)]),
      BallFraming.Detection(tMs: 1200, candidates: [c(0.32, 0.5)]),
    ]
    let json = BallFraming.detectionsJSON(d, width: 1920, height: 1080, model: "m")
    let data = try? JSONSerialization.data(withJSONObject: json)
    let back = BallFraming.detections(fromJSON: data.flatMap { try? JSONSerialization.jsonObject(with: $0) }, width: 1920,
                                      height: 1080, model: "m")
    XCTAssertEqual(back, d)
    let grids = BallFraming.grids(startMs: 1000, endMs: 1400, phase: 0, detections: back)
    XCTAssertEqual(grids.stale[0], [c(0.8, 0.2, 0.9)])
    XCTAssertEqual(grids.stale[2], [])
    XCTAssertNil(grids.stale[1])
    XCTAssertEqual(grids.candidates, BallFraming.grid(startMs: 1000, endMs: 1400, phase: 0, detections: back))
  }
}
