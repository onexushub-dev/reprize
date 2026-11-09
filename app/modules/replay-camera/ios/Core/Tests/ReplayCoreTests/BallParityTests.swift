import XCTest
@testable import ReplayCore

/// Seguir a Bola (spec 2026-11-09 §5): the Swift port gives the Modo Foco lab's results on the same inputs.
/// Fixtures: docs/focus-refs/tools/lab/ball_parity.py (tests 35–42) — the detector's candidates and today's framing for
/// four clips (our gym, another court, a web clip), with the lab's ball path, trusted points, zoom and 9:16 rects.
final class BallParityTests: XCTestCase {
  private struct Fixture: Decodable { let cases: [Case] }
  private struct Case: Decodable {
    let clip: String
    let detSize: [Double]
    let step: Int
    let labelSize: [Double]
    let videoSize: [Double]
    let frames: [[[Double]]?]
    let todayPortrait: [[Double]]
    let todayNative: [[Double]]
    let expect: Expect
  }
  private struct Expect: Decodable {
    let track: [[Double]?]
    let trusted: [[Double]?]
    let zoom: Double
    let rects: [[Double]]
  }

  private func load() throws -> [Case] {
    let url = try XCTUnwrap(Bundle.module.url(forResource: "ball-parity", withExtension: "json",
                                              subdirectory: "Fixtures"))
    return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url)).cases
  }

  private func path(_ c: Case) -> [BallPoint?] {
    let frames = c.frames.map { f in
      f.map { $0.map { BallCandidate(cx: $0[0], cy: $0[1], width: $0[2], height: $0[3], score: $0[4]) } }
    }
    return BallPath.track(frames: frames, width: c.detSize[0], height: c.detSize[1], step: c.step)
  }

  func testPathMatchesLab() throws {
    for c in try load() {
      let got = path(c)
      XCTAssertEqual(got.count, c.expect.track.count, c.clip)
      for (i, (g, e)) in zip(got, c.expect.track).enumerated() {
        XCTAssertEqual(g == nil, e == nil, "\(c.clip) frame \(i)")
        guard let g = g, let e = e else { continue }
        let v = [g.cx, g.cy, g.width, g.height, g.score]
        for j in 0..<5 { XCTAssertEqual(v[j], e[j], accuracy: 1e-6, "\(c.clip) frame \(i) [\(j)]") }
      }
    }
  }

  func testTrustedMatchesLab() throws {
    for c in try load() {
      let got = BallTrust.trusted(path(c), width: c.labelSize[0], height: c.labelSize[1])
      XCTAssertEqual(got.count, c.expect.trusted.count, c.clip)
      for (i, (g, e)) in zip(got, c.expect.trusted).enumerated() {
        XCTAssertEqual(g == nil, e == nil, "\(c.clip) frame \(i)")
        guard let g = g, let e = e else { continue }
        XCTAssertEqual(g.x, e[0], accuracy: 1e-6, "\(c.clip) frame \(i)")
        XCTAssertEqual(g.y, e[1], accuracy: 1e-6, "\(c.clip) frame \(i)")
      }
    }
  }

  func testZoomAndCameraMatchLab() throws {
    for c in try load() {
      let ball = c.expect.trusted.map { $0.map { BallXY(x: $0[0], y: $0[1]) } }
      let W = c.videoSize[0], H = c.videoSize[1]
      let z = BallZoom.zoom(ball: ball, today: c.todayPortrait, native: c.todayNative, width: W, height: H)
      XCTAssertEqual(z.zoom, c.expect.zoom, accuracy: 1e-9, c.clip)
      let rects = BallCamera.rects(ball: ball, today: c.todayPortrait, width: W, height: H, zoom: c.expect.zoom)
      XCTAssertEqual(rects.count, c.expect.rects.count, c.clip)
      var worst = 0.0
      for (g, e) in zip(rects, c.expect.rects) {
        for j in 0..<4 { worst = max(worst, abs(g[j] - e[j])) }
      }
      XCTAssertLessThan(worst, 1e-5, "\(c.clip) rect max diff \(worst)")
    }
  }

  /// End to end: candidates → path → trusted → zoom → rects, as the app will run it.
  func testEndToEnd() throws {
    for c in try load() {
      let tr = BallTrust.trusted(path(c), width: c.labelSize[0], height: c.labelSize[1])
      let W = c.videoSize[0], H = c.videoSize[1]
      let z = BallZoom.zoom(ball: tr, today: c.todayPortrait, native: c.todayNative, width: W, height: H).zoom
      XCTAssertEqual(z, c.expect.zoom, accuracy: 1e-9, c.clip)
      let rects = BallCamera.rects(ball: tr, today: c.todayPortrait, width: W, height: H, zoom: z)
      let worst = zip(rects, c.expect.rects).map { g, e in (0..<4).map { abs(g[$0] - e[$0]) }.max()! }.max() ?? 0
      XCTAssertLessThan(worst, 1e-5, "\(c.clip) rect max diff \(worst)")
    }
  }

  func testPentaSolveMatchesDense() {
    // a small system checked by hand against R·x = rhs
    let n = 7
    var d0 = [Double](repeating: 0, count: n), d1 = [Double](repeating: 0, count: n - 1)
    var d2 = [Double](repeating: 0, count: n - 2)
    for i in 0..<n { d0[i] = 10 + Double(i) }
    for i in 0..<(n - 1) { d1[i] = -2 - 0.1 * Double(i) }
    for i in 0..<(n - 2) { d2[i] = 0.5 + 0.05 * Double(i) }
    let rhs = (0..<n).map { sin(Double($0)) }
    let x = BallCamera.solvePenta(diag: d0, off1: d1, off2: d2, rhs: rhs)
    for i in 0..<n {
      var s = d0[i] * x[i]
      if i >= 1 { s += d1[i - 1] * x[i - 1] }
      if i + 1 < n { s += d1[i] * x[i + 1] }
      if i >= 2 { s += d2[i - 2] * x[i - 2] }
      if i + 2 < n { s += d2[i] * x[i + 2] }
      XCTAssertEqual(s, rhs[i], accuracy: 1e-12)
    }
  }
}
