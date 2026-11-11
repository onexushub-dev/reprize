import XCTest
@testable import ReplayCore

/// Test 51: the floor measure (the lab's `sport_sand.py`, checked there against OpenCV on the same pictures).
final class SportFloorTests: XCTestCase {
  /// A 320 x 180 RGBA picture: dark top, the bottom 55% one colour with ± `noise` grey levels of grain.
  private func picture(r: UInt8, g: UInt8, b: UInt8, noise: Int) -> [UInt8] {
    var px = [UInt8](repeating: 0, count: 320 * 180 * 4)
    var seed: UInt32 = 12345
    for y in 0..<180 {
      for x in 0..<320 {
        let i = (y * 320 + x) * 4
        if y < 81 { px[i] = 20; px[i + 1] = 30; px[i + 2] = 40; px[i + 3] = 255; continue }
        seed = seed &* 1_103_515_245 &+ 12345
        let n = noise == 0 ? 0 : Int(seed >> 16) % (2 * noise + 1) - noise
        func c(_ v: UInt8) -> UInt8 { UInt8(max(0, min(255, Int(v) + n))) }
        px[i] = c(r); px[i + 1] = c(g); px[i + 2] = c(b); px[i + 3] = 255
      }
    }
    return px
  }

  func testSandIsSandColouredAndGrainy() throws {
    let m = try XCTUnwrap(SportFloor.measure(rgba: picture(r: 205, g: 180, b: 140, noise: 20), width: 320, height: 180))
    XCTAssertGreaterThan(m.sand, 0.9)
    XCTAssertGreaterThan(m.texture, 4.5)
  }

  func testWoodIsSandColouredButSmooth() throws {
    let m = try XCTUnwrap(SportFloor.measure(rgba: picture(r: 205, g: 170, b: 120, noise: 0), width: 320, height: 180))
    XCTAssertGreaterThan(m.sand, 0.9)
    XCTAssertLessThan(m.texture, 0.5)
  }

  func testPaintedCourtIsNotSand() throws {
    let m = try XCTUnwrap(SportFloor.measure(rgba: picture(r: 40, g: 80, b: 170, noise: 20), width: 320, height: 180))
    XCTAssertLessThan(m.sand, 0.05)
    XCTAssertEqual(m.texture, 0)
  }

  func testHueAsOpenCV() {
    // OpenCV HSV of (205, 180, 140): H 18, S 81, V 205 -> sand; pure orange (255, 128, 0): H 15, S 255 -> not
    XCTAssertTrue(SportFloor.isSand(r: 205, g: 180, b: 140))
    XCTAssertFalse(SportFloor.isSand(r: 255, g: 128, b: 0))
    XCTAssertFalse(SportFloor.isSand(r: 60, g: 50, b: 40)) // too dark
  }
}
