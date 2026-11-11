import XCTest
@testable import ReplayCore

/// Seguir a Bola for beach tennis (Modo Foco lab, tests 46–49): the Swift port gives the lab's results on the same
/// inputs. Fixtures: docs/focus-refs/tools/lab/ball_parity.py --out-bt — the beach tennis detector's candidates, the
/// video screens found, today's framing, the players' height and today's person boxes for seven clips (Victor's two
/// arenas, a vertical web clip, a tournament stream with an LED screen, a clip recorded at 0.5x, two clips where the
/// next court's ball joins the rally, one where the rally's ball leaves the picture and the next court's volleyball is
/// found), with the lab's path, trusted points, runs of 1 s, the points inside the rally's court (by the ball), the
/// points the camera follows (also inside the main players' court), its aim (toward the hitter, the near pair kept
/// whole where the ball allows), zoom, 9:16 rects and verdict. Basketball's fixtures and tests are apart and
/// unchanged (BallParityTests).
final class BallParityBeachTennisTests: XCTestCase {
  private struct Fixture: Decodable { let cases: [Case] }
  private struct Case: Decodable {
    let clip: String
    let sport: String
    let detSize: [Double]
    let step: Int
    let labelSize: [Double]
    let videoSize: [Double]
    let frames: [[[Double]]?]
    let screens: [[Double]]
    let playersHeight: Double?
    let people: [[[Double]]]
    let todayPortrait: [[Double]]
    let todayNative: [[Double]]
    let expect: Expect
  }
  private struct Expect: Decodable {
    let track: [[Double]?]
    let trusted: [[Double]?]
    let runs: [[Double]?]
    let ballCourt: [[Double]?]
    let playersCourt: [[Double]?]
    let followed: [[Double]?]
    let aim: [Double?]
    let zoom: Double
    let rects: [[Double]]
    let verdict: Verdict
  }
  private struct Verdict: Decodable {
    let reason: String?
    let players: Double?
    let share: Double
    let ballPx: Double
    let pan: Double
  }

  private func load() throws -> [Case] {
    let url = try XCTUnwrap(Bundle.module.url(forResource: "ball-parity-bt", withExtension: "json",
                                              subdirectory: "Fixtures"))
    return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url)).cases
  }

  private func sport(_ c: Case) throws -> BallSport { try XCTUnwrap(BallSport.of(c.sport), c.sport) }

  private func path(_ c: Case) throws -> [BallPoint?] {
    let frames = c.frames.map { f in
      f.map { $0.map { BallCandidate(cx: $0[0], cy: $0[1], width: $0[2], height: $0[3], score: $0[4]) } }
    }
    let s = try sport(c)
    return BallPath.track(frames: frames, width: c.detSize[0], height: c.detSize[1], step: c.step, params: s.path,
                          screens: s.screens ? c.screens : [])
  }

  private func xy(_ v: [[Double]?]) -> [BallXY?] { v.map { $0.map { BallXY(x: $0[0], y: $0[1]) } } }

  private func assertPoints(_ got: [BallXY?], _ want: [[Double]?], _ what: String) {
    XCTAssertEqual(got.count, want.count, what)
    for (i, (g, e)) in zip(got, want).enumerated() {
      XCTAssertEqual(g == nil, e == nil, "\(what) frame \(i)")
      guard let g = g, let e = e else { continue }
      XCTAssertEqual(g.x, e[0], accuracy: 1e-6, "\(what) frame \(i)")
      XCTAssertEqual(g.y, e[1], accuracy: 1e-6, "\(what) frame \(i)")
    }
  }

  func testProfiles() {
    XCTAssertEqual(BallSport.of("basquete"), BallSport.basketball)
    XCTAssertEqual(BallSport.of("beachTennis"), BallSport.beachTennis)
    XCTAssertNil(BallSport.of("futevolei"))
    // basketball keeps the values it had before beach tennis
    XCTAssertEqual(BallSport.basketball.path, BallPathParams.basketball)
    XCTAssertEqual(BallSport.basketball.zoom, BallZoomParams())
    XCTAssertEqual(BallSport.basketball.modelId, "ball_tiny_gym")
    XCTAssertEqual(BallSport.basketball.minRun, 0)
    XCTAssertFalse(BallSport.basketball.screens)
    XCTAssertNil(BallSport.basketball.verdict)
    XCTAssertEqual(BallSport.basketball.camera, BallCameraParams.basketball)
    XCTAssertEqual(BallSport.basketball.camera.smoothA, 1)
    XCTAssertEqual(BallSport.basketball.camera.smoothB, 100)
    XCTAssertEqual(BallSport.basketball.rules, "ball-t50")
    XCTAssertEqual(BallSport.basketball.path.personRatio, 0.3)
    XCTAssertEqual(BallSport.beachTennis.path.personRatio, 0)
    XCTAssertNil(BallSport.basketball.follow)
    XCTAssertEqual(BallSport.beachTennis.camera.smoothA, 1)
    XCTAssertEqual(BallSport.beachTennis.camera.smoothB, 100)
    XCTAssertEqual(BallSport.beachTennis.follow,
                   BallFollowParams(mainShare: 0.6, courtMargin: 0.2, blend: 0.4, near: 0.25, ballCourtMargin: 0.25,
                                    keepPair: true, pairPad: 0, exitTop: 0.05, exitBack: 0.2, exitDx: 0.25,
                                    ownMinScore: 0.5, ownStep: 0.08, ownLost: 4, pairNear: 0.25, glide: 6))
  }

  func testPathMatchesLab() throws {
    for c in try load() {
      let got = try path(c)
      XCTAssertEqual(got.count, c.expect.track.count, c.clip)
      for (i, (g, e)) in zip(got, c.expect.track).enumerated() {
        XCTAssertEqual(g == nil, e == nil, "\(c.clip) frame \(i)")
        guard let g = g, let e = e else { continue }
        let v = [g.cx, g.cy, g.width, g.height, g.score]
        for j in 0..<5 { XCTAssertEqual(v[j], e[j], accuracy: 1e-6, "\(c.clip) frame \(i) [\(j)]") }
      }
    }
  }

  func testTrustedAndRunsMatchLab() throws {
    for c in try load() {
      let s = try sport(c)
      let pts = try path(c)
      let trusted = BallTrust.trusted(pts, width: c.labelSize[0], height: c.labelSize[1])
      assertPoints(trusted, c.expect.trusted, "\(c.clip) trusted")
      let runs = BallRuns.keep(xy(c.expect.trusted), minRun: s.minRun, gap: s.runGap)
      assertPoints(runs, c.expect.runs, "\(c.clip) runs")
      // test 49: the rally's court by the ball, the court of the main players, the aim toward the hitter with the near
      // pair kept whole where the ball allows
      let f = try XCTUnwrap(s.follow)
      let ballCourt = BallRuns.courtLock(xy(c.expect.runs), margin: f.ballCourtMargin, gap: s.runGap)
      assertPoints(ballCourt, c.expect.ballCourt, "\(c.clip) ballCourt")
      let main = BallPlayers.main(c.people, share: f.mainShare)
      let playersCourt = BallPlayers.courtLock(xy(c.expect.ballCourt), main: main, margin: f.courtMargin)
      assertPoints(playersCourt, c.expect.playersCourt, "\(c.clip) playersCourt")
      let W = c.videoSize[0], H = c.videoSize[1]
      let grid = c.frames.map { fr in
        fr.map { $0.map { BallCandidate(cx: $0[0], cy: $0[1], width: $0[2], height: $0[3], score: $0[4]) } }
      }
      let cands = BallRuns.movingCandidates(grid, screens: s.screens ? c.screens : [], minScore: f.ownMinScore)
      let followed = BallRuns.keepExits(xy(c.expect.playersCourt), top: f.exitTop, back: f.exitBack, dx: f.exitDx,
                                        cands: cands, step: f.ownStep, lost: f.ownLost, aspect: H / W)
      assertPoints(followed, c.expect.followed, "\(c.clip) followed")
      var aim = BallPlayers.aim(xy(c.expect.followed), main: main, width: W, height: H, blend: f.blend, near: f.near)
      aim = BallPlayers.keepPair(aim, tr: xy(c.expect.followed), main: main,
                                 cropWidth: min(1.0, (9.0 / 16.0) * H / W) / c.expect.zoom, pad: f.pairPad,
                                 nearOnly: f.pairNear, width: W, height: H)
      aim = BallPlayers.glide(aim, tr: xy(c.expect.followed), main: main, frames: f.glide, margin: f.courtMargin)
      XCTAssertEqual(aim.count, c.expect.aim.count, c.clip)
      for (i, (g, e)) in zip(aim, c.expect.aim).enumerated() {
        XCTAssertEqual(g == nil, e == nil, "\(c.clip) aim frame \(i)")
        if let g = g, let e = e { XCTAssertEqual(g, e, accuracy: 1e-6, "\(c.clip) aim frame \(i)") }
      }
    }
  }

  /// The court locks and the top exit drop the next court's ball where the lab does (a-10: 10 points, f-01: 12,
  /// b-04: 12, bt-app-1110-f: 20; the stream: 8 after a ball out at the top), and nowhere else; our ball found among
  /// the candidates meanwhile (b-04: 1, bt-app-1110-f: 3, the stream: 2).
  func testCourtLockDrops() throws {
    let want = ["bt-own-a-10": 10, "bt-own-f-01": 12, "bt-own-b-04": 12, "bt-app-1110-f": 20, "yt-bt-stream-1110": 8]
    let found = ["bt-own-b-04": 1, "bt-app-1110-f": 3, "yt-bt-stream-1110": 2]
    for c in try load() {
      let dropped = zip(c.expect.runs, c.expect.followed).filter { $0.0 != nil && $0.1 == nil }.count
      XCTAssertEqual(dropped, want[c.clip] ?? 0, c.clip)
      let own = zip(c.expect.playersCourt, c.expect.followed).filter { $0.0 == nil && $0.1 != nil }.count
      XCTAssertEqual(own, found[c.clip] ?? 0, c.clip)
    }
  }

  func testGlide() {
    // the ball moving right 0.02 per frame, then lost: the target goes on for 3 frames, then holds (nil)
    let tr: [BallXY?] = [BallXY(x: 0.40, y: 0.5), BallXY(x: 0.42, y: 0.5), nil, nil, nil, nil, nil]
    let xs: [Double?] = tr.map { $0.map { $0.x } }
    let g = BallPlayers.glide(xs, tr: tr, main: [], frames: 3, margin: 0.2)
    XCTAssertEqual(g[2]!, 0.44, accuracy: 1e-12)
    XCTAssertEqual(g[4]!, 0.48, accuracy: 1e-12)
    XCTAssertNil(g[5])
    XCTAssertEqual(BallPlayers.glide(xs, tr: tr, main: [], frames: 0, margin: 0.2), xs)
  }

  func testMovingCandidates() {
    let lamp = BallCandidate(cx: 0.68, cy: 0.40, width: 0.01, height: 0.01, score: 0.75)
    let ball = { (x: Double) in BallCandidate(cx: x, cy: 0.2, width: 0.01, height: 0.01, score: 0.7) }
    let weak = BallCandidate(cx: 0.3, cy: 0.3, width: 0.01, height: 0.01, score: 0.3)
    let grid: [[BallCandidate]?] = [[lamp, ball(0.40)], nil, [lamp, ball(0.45), weak], nil, [lamp, ball(0.50)]]
    let m = BallRuns.movingCandidates(grid, screens: [], minScore: 0.5)
    XCTAssertEqual(m[2], [BallXY(x: 0.45, y: 0.2)]) // the lamp is still, the weak one under the score
    XCTAssertTrue(m[1].isEmpty)
    XCTAssertTrue(BallRuns.movingCandidates(grid, screens: [[0.3, 0.1, 0.6, 0.3]], minScore: 0.5)[2].isEmpty)
  }

  func testHitterAndAim() {
    let ball = BallXY(x: 0.5, y: 0.5)
    let near = [0.52, 0.3, 0.06, 0.25] // centre 0.55, 0.425
    let far = [0.9, 0.1, 0.03, 0.1]
    XCTAssertEqual(BallPlayers.hitter(ball, boxes: [far, near], width: 1920, height: 1080, near: 0.25), near)
    XCTAssertNil(BallPlayers.hitter(ball, boxes: [far], width: 1920, height: 1080, near: 0.25))
    let aim = BallPlayers.aim([ball, nil], main: [[near], [near]], width: 1920, height: 1080, blend: 0.4, near: 0.25)
    XCTAssertEqual(aim[0]!, 0.6 * 0.5 + 0.4 * 0.55, accuracy: 1e-12)
    XCTAssertNil(aim[1])
    XCTAssertEqual(BallPlayers.percentile([1, 2, 3, 4], 80), 3.4, accuracy: 1e-12)
    // the pair 0.40..0.60 fits a 0.3 crop with the ball at 0.45 (centres 0.45..0.55): a target of 0.30 moves to 0.45
    let pair = [[0.40, 0.3, 0.05, 0.3], [0.55, 0.3, 0.05, 0.3]]
    let kept = BallPlayers.keepPair([0.30, 0.30], tr: [BallXY(x: 0.45, y: 0.5), BallXY(x: 0.20, y: 0.5)],
                                    main: [pair, pair], cropWidth: 0.3, pad: 0)
    XCTAssertEqual(kept[0]!, 0.45, accuracy: 1e-12)
    XCTAssertEqual(kept[1]!, 0.30, accuracy: 1e-12) // the ball at 0.20 cannot share a crop with the pair
  }

  func testTopExit() {
    // rising out at the top at x 0.5, a ball mid-frame elsewhere (dropped), then ours back at the top (kept)
    var tr = [BallXY?](repeating: nil, count: 12)
    tr[0] = BallXY(x: 0.5, y: 0.30); tr[1] = BallXY(x: 0.5, y: 0.20); tr[2] = BallXY(x: 0.5, y: 0.10)
    tr[4] = BallXY(x: 0.2, y: 0.40); tr[5] = BallXY(x: 0.2, y: 0.38)
    tr[8] = BallXY(x: 0.45, y: 0.05); tr[9] = BallXY(x: 0.44, y: 0.12)
    let out = BallRuns.keepExits(tr, top: 0.05, back: 0.2, dx: 0.25)
    XCTAssertNotNil(out[2])
    XCTAssertNil(out[4]); XCTAssertNil(out[5])
    XCTAssertNotNil(out[8]); XCTAssertNotNil(out[9])
    // a ball that tops out inside the picture is untouched
    let apex: [BallXY?] = [BallXY(x: 0.5, y: 0.3), BallXY(x: 0.5, y: 0.25), BallXY(x: 0.5, y: 0.23), BallXY(x: 0.5, y: 0.3)]
    XCTAssertEqual(BallRuns.keepExits(apex, top: 0.05, back: 0.2, dx: 0.25), apex)
    XCTAssertEqual(BallRuns.keepExits(tr, top: 0, back: 0.2, dx: 0.25), tr)
  }

  func testBallCourtLock() {
    var tr = [BallXY?](repeating: nil, count: 40)
    for k in 0..<20 { tr[k] = BallXY(x: 0.5 + 0.005 * Double(k % 5), y: 0.5) } // the rally
    for k in 26..<36 { tr[k] = BallXY(x: 0.1, y: 0.4) } // another court, a separate run
    let out = BallRuns.courtLock(tr, margin: 0.25, gap: 4)
    XCTAssertEqual(out[0..<20].filter { $0 != nil }.count, 20)
    XCTAssertTrue(out[26..<36].allSatisfy { $0 == nil })
    XCTAssertEqual(BallRuns.courtLock(tr, margin: 0, gap: 4), tr)
  }

  func testZoomCameraAndVerdictMatchLab() throws {
    for c in try load() {
      let s = try sport(c)
      let trusted = xy(c.expect.trusted), followed = xy(c.expect.followed)
      let W = c.videoSize[0], H = c.videoSize[1]
      let z = BallZoom.zoom(ball: trusted, today: c.todayPortrait, native: c.todayNative, width: W, height: H,
                            params: s.zoom, cameraBall: followed)
      XCTAssertEqual(z.zoom, c.expect.zoom, accuracy: 1e-9, c.clip)
      let rects = BallCamera.rects(ball: followed, today: c.todayPortrait, width: W, height: H, zoom: c.expect.zoom,
                                   params: s.camera, aim: c.expect.aim)
      XCTAssertEqual(rects.count, c.expect.rects.count, c.clip)
      var worst = 0.0
      for (g, e) in zip(rects, c.expect.rects) {
        for j in 0..<4 { worst = max(worst, abs(g[j] - e[j])) }
      }
      XCTAssertLessThan(worst, 1e-5, "\(c.clip) rect max diff \(worst)")

      // the verdict on the Swift rects (equal to the lab's above; the fixture's are rounded to 7 decimals, which moves
      // the crop width's rounding to px: 607.5 -> 607 instead of 608)
      let v = try XCTUnwrap(s.verdict)
      let before = BallVerdicts.before(playersHeight: c.playersHeight, width: W, height: H, sport: s)
      let pathPts = try path(c)
      let after = BallVerdicts.after(followed: followed, path: pathPts, rects: rects, width: W, height: H,
                                     players: c.playersHeight, params: v)
      let reason = before ?? after.reason
      XCTAssertEqual(reason?.rawValue, c.expect.verdict.reason, c.clip)
      XCTAssertEqual(after.share, c.expect.verdict.share, accuracy: 1e-6, c.clip)
      XCTAssertEqual(after.ballPx, c.expect.verdict.ballPx, accuracy: 1e-4, c.clip)
      XCTAssertEqual(after.pan, c.expect.verdict.pan, accuracy: 1e-3, c.clip)
      if let p = c.expect.verdict.players, let h = c.playersHeight {
        XCTAssertEqual(h * BallVerdicts.maxZoom(width: W, height: H, zoom: s.zoom), p, accuracy: 1e-6, c.clip)
      }
    }
  }

  /// The whole of `BallFraming.compute` with the beach tennis profile gives the same zoom, rects and verdict.
  func testFramingWithProfile() throws {
    for c in try load() where c.detSize == c.videoSize {
      let s = try sport(c)
      let grid = c.frames.map { f in
        f.map { $0.map { BallCandidate(cx: $0[0], cy: $0[1], width: $0[2], height: $0[3], score: $0[4]) } }
      }
      let r = BallFraming.compute(grid: grid, width: c.videoSize[0], height: c.videoSize[1], today: c.todayPortrait,
                                  native: c.todayNative, sport: s, screens: c.screens, players: c.playersHeight,
                                  people: c.people)
      XCTAssertEqual(r.zoom.zoom, c.expect.zoom, accuracy: 1e-9, c.clip)
      XCTAssertEqual(r.verdict?.reason?.rawValue, c.expect.verdict.reason, c.clip)
      var worst = 0.0
      for (g, e) in zip(r.rects, c.expect.rects) {
        for j in 0..<4 { worst = max(worst, abs(g[j] - e[j])) }
      }
      XCTAssertLessThan(worst, 1e-5, "\(c.clip) rect max diff \(worst)")
    }
  }

  /// A region whose picture changes all at once (a screen) is found; a blob that moves across the frame (a player) and
  /// a static picture are not.
  func testScreenBoxes() {
    let W = 160, H = 90
    var frames: [[UInt8]] = []
    var seed: UInt32 = 7
    func rnd() -> UInt8 { seed = seed &* 1_103_515_245 &+ 12345; return UInt8((seed >> 16) & 0xFF) }
    for t in 0..<30 {
      var f = [UInt8](repeating: 120, count: W * H)
      // a screen at x 20..<50, y 5..<25 showing a new random picture every frame
      for y in 5..<25 { for x in 20..<50 { f[y * W + x] = rnd() } }
      // a dark "player" 10 x 20 px walking right, 3 px per frame
      let px = 60 + 3 * t
      for y in 50..<70 { for x in px..<min(W, px + 10) { f[y * W + x] = 20 } }
      frames.append(f)
    }
    let boxes = BallScreen.boxes(frames: frames, width: W, height: H)
    XCTAssertEqual(boxes.count, 1)
    if let b = boxes.first {
      XCTAssertEqual(b[0], 20.0 / 160.0, accuracy: 0.02)
      XCTAssertEqual(b[1], 5.0 / 90.0, accuracy: 0.03)
      XCTAssertEqual(b[2], 50.0 / 160.0, accuracy: 0.02)
      XCTAssertEqual(b[3], 25.0 / 90.0, accuracy: 0.03)
    }
    XCTAssertTrue(BallScreen.boxes(frames: [[UInt8]](repeating: [UInt8](repeating: 80, count: W * H), count: 10),
                                   width: W, height: H).isEmpty)
  }

  func testRunsKeep() {
    let p = BallXY(x: 0.5, y: 0.5)
    // a run of 3 frames, a gap of 6, a run of 12 with a 2-frame hole
    var tr = [BallXY?](repeating: nil, count: 30)
    for i in 0..<3 { tr[i] = p }
    for i in 9..<21 where i != 14 && i != 15 { tr[i] = p }
    let kept = BallRuns.keep(tr, minRun: 10, gap: 4)
    XCTAssertTrue(kept[0..<3].allSatisfy { $0 == nil })
    XCTAssertEqual(kept[9..<21].filter { $0 != nil }.count, 10)
    XCTAssertEqual(BallRuns.keep(tr, minRun: 0, gap: 4), tr)
  }
}
