import XCTest
@testable import ReplayCore

/// Seguir a Bola: the detector's regions and decoding (as the lab's ball_detect.py), the cut's grid and the cache.
final class BallFramingTests: XCTestCase {
  func testRegionsMatchTheLab() {
    // ball_detect.tiles(1920, 1080, 416): x 0,…,1504 in 6 steps, y 0,332,664 → 18 tiles + the whole frame = 19
    XCTAssertEqual(BallDetect.starts(1920, tile: 416), [0, 301, 602, 902, 1203, 1504])
    XCTAssertEqual(BallDetect.starts(1080, tile: 416), [0, 332, 664])
    XCTAssertEqual(BallDetect.starts(400, tile: 416), [0])
    let r = BallDetect.regions(width: 1920, height: 1080, side: 416, tile: 416)
    XCTAssertEqual(r.count, 19)
    XCTAssertEqual(r[0], BallDetect.Region(x0: 0, y0: 0, scale: 416.0 / 1920))
    XCTAssertEqual(r[1], BallDetect.Region(x0: 0, y0: 0, scale: 1))
    XCTAssertEqual(r[2], BallDetect.Region(x0: 301, y0: 0, scale: 1)) // row by row
    XCTAssertEqual(r[7], BallDetect.Region(x0: 0, y0: 332, scale: 1))
    // a vertical 1080x1920 clip: also 19
    XCTAssertEqual(BallDetect.regions(width: 1080, height: 1920, side: 416, tile: 416).count, 19)
    XCTAssertEqual(BallDetect.anchors(side: 416).count, 52 * 52 + 26 * 26 + 13 * 13)
  }

  func testDecodeAndNms() {
    let anchors = BallDetect.anchors(side: 416)
    // anchor 1 (stride 8, gx 1): offsets 0.5/0.5, wh e^1·8; objectness 0.9 × class 0.5; anchor 0 below conf
    var table = [[Float]](repeating: [0, 0, 0, 0, 0, 0], count: anchors.count)
    table[0] = [0, 0, 0, 0, 0.04, 1]
    table[1] = [0.5, 0.5, 1, 1, 0.9, 0.5]
    table[2] = [-0.5, 0.5, 1, 1, 0.8, 0.5] // gx 2 − 0.5: the same box as anchor 1
    let tile = BallDetect.Region(x0: 100, y0: 50, scale: 1)
    let boxes = BallDetect.decode(rows: anchors.count, cls: 0, anchors: anchors, region: tile) { table[$0][$1] }
    XCTAssertEqual(boxes.count, 2)
    XCTAssertEqual(boxes[0].cx, 112, accuracy: 1e-4) // (0.5 + 1) × 8 + 100
    XCTAssertEqual(boxes[0].cy, 54, accuracy: 1e-4)
    XCTAssertEqual(boxes[0].w, 8 * exp(1.0), accuracy: 1e-4)
    XCTAssertEqual(boxes[0].score, 0.45, accuracy: 1e-6)
    // whole frame at 416/1920: back to frame px
    let whole = BallDetect.Region(x0: 0, y0: 0, scale: 416.0 / 1920)
    let w = BallDetect.decode(rows: anchors.count, cls: 0, anchors: anchors, region: whole) { table[$0][$1] }
    XCTAssertEqual(w[0].cx, 12 * 1920 / 416, accuracy: 1e-3)
    // NMS: the weaker overlapping box goes; 4/3 decimals
    let c = BallDetect.frameCandidates(boxes, width: 1920, height: 1080)
    XCTAssertEqual(c.count, 1)
    XCTAssertEqual(c[0], BallCandidate(cx: 0.0583, cy: 0.05, width: 0.0113, height: 0.0201, score: 0.45))
    // ties keep the given order (Python's stable sort)
    let a = BallDetect.Box(cx: 10, cy: 10, w: 4, h: 4, score: 0.5), b = BallDetect.Box(cx: 11, cy: 10, w: 4, h: 4, score: 0.5)
    XCTAssertEqual(BallDetect.nms([a, b]), [a])
    XCTAssertEqual(BallDetect.nms([b, a]), [b])
  }

  func testGridPhaseAndCache() {
    // a 1 s cut from 2000 ms: 10 rows; analysed k = 0, 2, 4, 6, 8
    XCTAssertEqual(BallFraming.rows(startMs: 2000, endMs: 3000), 10)
    XCTAssertEqual(BallFraming.rows(startMs: 2000, endMs: 3050), 11)
    let none: [BallFraming.Detection] = []
    XCTAssertEqual(BallFraming.missingTicks(startMs: 2000, endMs: 3000, phase: 0, cached: none),
                   [2000, 2200, 2400, 2600, 2800])
    // pictures at 60 fps land a few ms after the ticks
    let dets = [2016.7, 2216.7, 2416.7].map { BallFraming.Detection(tMs: $0, candidates: []) }
    XCTAssertEqual(BallFraming.missingTicks(startMs: 2000, endMs: 3000, phase: 0, cached: dets), [2600, 2800])
    // the cut moved by 100 ms: the cache sits on the odd frames, so the phase follows it
    XCTAssertEqual(BallFraming.phase(startMs: 1900, endMs: 3000, cached: dets), 1)
    XCTAssertEqual(BallFraming.missingTicks(startMs: 1900, endMs: 3000, phase: 1, cached: dets), [2600, 2800])
    let g = BallFraming.grid(startMs: 2000, endMs: 3000, phase: 0, detections: dets)
    XCTAssertEqual(g.count, 10)
    XCTAssertNotNil(g[0]); XCTAssertNil(g[1]); XCTAssertNotNil(g[4]); XCTAssertNil(g[6])
  }

  func testCacheRoundTrip() throws {
    let dets = [BallFraming.Detection(tMs: 216.7, candidates: [BallCandidate(cx: 0.5, cy: 0.25, width: 0.01,
                                                                                height: 0.02, score: 0.9)])]
    let obj = BallFraming.detectionsJSON(dets, width: 1920, height: 1080)
    let data = try JSONSerialization.data(withJSONObject: obj)
    let back = try JSONSerialization.jsonObject(with: data)
    XCTAssertEqual(BallFraming.detections(fromJSON: back, width: 1920, height: 1080), dets)
    XCTAssertEqual(BallFraming.detections(fromJSON: back, width: 1080, height: 1920), []) // another frame size
  }

  /// The app's path from the lab's stored detections gives the lab's framing (the parity fixture).
  func testComputeMatchesParityFixture() throws {
    struct Fixture: Decodable { let cases: [Case] }
    struct Case: Decodable {
      let clip: String; let detSize: [Double]; let videoSize: [Double]; let frames: [[[Double]]?]
      let todayPortrait: [[Double]]; let todayNative: [[Double]]; let people: [[[Double]]]?; let expect: Expect
    }
    struct Expect: Decodable { let zoom: Double; let rects: [[Double]] }
    let url = try XCTUnwrap(Bundle.module.url(forResource: "ball-parity", withExtension: "json", subdirectory: "Fixtures"))
    for c in try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url)).cases {
      let grid = c.frames.map { f in
        f.map { $0.map { BallCandidate(cx: $0[0], cy: $0[1], width: $0[2], height: $0[3], score: $0[4]) } }
      }
      let r = BallFraming.compute(grid: grid, width: c.videoSize[0], height: c.videoSize[1], today: c.todayPortrait,
                                  native: c.todayNative, people: c.people ?? [])
      XCTAssertEqual(r.zoom.zoom, c.expect.zoom, accuracy: 1e-9, c.clip)
      let worst = zip(r.rects, c.expect.rects).map { g, e in (0..<4).map { abs(g[$0] - e[$0]) }.max()! }.max() ?? 1
      XCTAssertLessThan(worst, 1e-5, c.clip)
      let file = BallFraming.framingJSON(r, startMs: 0, width: c.videoSize[0], height: c.videoSize[1])
      XCTAssertEqual((file["portrait"] as? [[Double]])?.count, c.expect.rects.count)
    }
  }
}
