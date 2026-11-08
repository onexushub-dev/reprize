import CoreGraphics
import Foundation
import XCTest
@testable import ReplayCore

/// Fixed scenes run through the Modo Foco rules, written as JSON for the Android port to replay (its tests read
/// `android/src/test/resources/focus-vectors.json`). Regenerate after a rules change:
///
///     FOCUS_VECTORS_OUT=../../android/src/test/resources/focus-vectors.json swift test --filter FocusVectorsTests
final class FocusVectorsTests: XCTestCase {
  private struct Lcg {
    var state: UInt64
    mutating func next() -> Double {
      state = state &* 6364136223846793005 &+ 1442695040888963407
      return Double(state >> 33) / Double(1 << 31)
    }
  }

  private func box(_ b: FocusBox) -> [Double] { [b.x, b.y, b.width, b.height] }
  private func rect(_ r: FocusRect) -> [Double] { [r.x, r.y, r.width, r.height] }

  /// 12 s at 100 ms: four players moving across the court, a bench of two that never move, a far small one, and a few
  /// frames where nobody is found.
  private func scene(seed: UInt64, players: Int) -> [FocusSample] {
    var rng = Lcg(state: seed)
    return (0..<120).map { i in
      let t = Double(i) * 100
      var boxes: [FocusBox] = []
      for p in 0..<players {
        if (i >= 40 && i < 43) && p == 1 { continue } // a player the detector misses for 300 ms
        let phase = Double(p) * 1.3
        let x = 0.5 + 0.25 * sin(t / 1800 + phase) + (rng.next() - 0.5) * 0.004
        let y = 0.45 + 0.1 * cos(t / 2300 + phase) + (rng.next() - 0.5) * 0.004
        let h = 0.22 + 0.04 * y
        boxes.append(FocusBox(x: x - 0.04, y: y - h / 2, width: 0.08, height: h))
      }
      boxes.append(FocusBox(x: 0.06 + (rng.next() - 0.5) * 0.003, y: 0.62, width: 0.07, height: 0.3)) // bench
      boxes.append(FocusBox(x: 0.88 + (rng.next() - 0.5) * 0.003, y: 0.60, width: 0.07, height: 0.3)) // bench
      boxes.append(FocusBox(x: 0.5, y: 0.3, width: 0.02, height: 0.06)) // far away
      if i >= 70 && i < 74 { return FocusSample(tMs: t, boxes: []) }
      return FocusSample(tMs: t, boxes: boxes)
    }
  }

  func testWritesFocusVectors() throws {
    var cases: [[String: Any]] = []
    for (name, seed, players) in [("four", UInt64(11), 4), ("two", UInt64(29), 2), ("one", UInt64(5), 1)] {
      let samples = scene(seed: seed, players: players)
      var runs: [[String: Any]] = []
      for (tuningName, tuning) in [("action", FocusTuning.action), ("standard", FocusTuning.standard)] {
        for (aspectName, aspect, zoom) in [("landscape", FocusAspect.landscape, true), ("portrait", FocusAspect.portrait, false),
                                           ("portraitZoom", FocusAspect.portrait, true)] {
          let rects = FocusPath.compute(samples: samples, videoWidth: 1920, videoHeight: 1080, aspect: aspect, zoom: zoom,
                                        tuning: tuning)
          runs.append(["tuning": tuningName, "aspect": aspectName, "zoom": zoom,
                       "rects": rects.map { $0.map(rect) } as Any? ?? NSNull()])
        }
      }
      cases.append(["name": name, "samples": samples.map { ["t": $0.tMs, "boxes": $0.boxes.map(box)] }, "runs": runs])
    }

    // The grid: frames with a gap and a late start.
    let frames = [FocusSample(tMs: 130, boxes: [FocusBox(x: 0.1, y: 0.1, width: 0.1, height: 0.3)]),
                  FocusSample(tMs: 230, boxes: []), FocusSample(tMs: 640, boxes: [FocusBox(x: 0.5, y: 0.2, width: 0.1, height: 0.3)]),
                  FocusSample(tMs: 745, boxes: [FocusBox(x: 0.6, y: 0.2, width: 0.1, height: 0.3)])]
    let grid = FocusGrid.samples(from: frames, startMs: 100, endMs: .infinity, stepMs: 100)

    // Merge: overlapping and contained boxes (CGRect with the bottom-left origin, as Vision gives them).
    let mergeIn: [(CGRect, Double)] = [
      (CGRect(x: 0.1, y: 0.1, width: 0.1, height: 0.3), 0.9), (CGRect(x: 0.11, y: 0.12, width: 0.1, height: 0.3), 0.6),
      (CGRect(x: 0.12, y: 0.12, width: 0.04, height: 0.1), 0.8), (CGRect(x: 0.6, y: 0.4, width: 0.1, height: 0.25), 0.7),
      (CGRect(x: 0.58, y: 0.3, width: 0.12, height: 0.5), 0.55),
    ]
    let merged = PersonBoxes.merge(mergeIn.map { (box: $0.0, confidence: $0.1) })

    let plaus = [(0.05, 0.2, 0.6), (0.05, 0.2, 0.4), (0.01, 0.2, 0.9), (0.05, 0.05, 0.9), (0.2, 0.1, 0.9)].map { (w, h, c) -> [String: Any] in
      ["w": w, "h": h, "c": c, "ok": ScanTiles.plausible(CGRect(x: 0, y: 0, width: w, height: h), confidence: c, frame: CGSize(width: 1920, height: 1080))]
    }

    let rects = (0..<30).map { FocusRect(x: Double($0) * 0.01, y: 0.1, width: 0.5 + Double($0) * 0.005, height: 0.5) }
    let ramp = [-50.0, 0, 130, 1000, 2900, 5000].map { rect(FocusRamp.rect(at: $0, rects: rects, startMs: 0, stepMs: 100)) }

    let out: [String: Any] = [
      "cases": cases, "grid": grid.map { ["t": $0.tMs, "boxes": $0.boxes.map(box)] },
      "merge": ["in": mergeIn.map { [$0.0.minX, $0.0.minY, $0.0.width, $0.0.height, $0.1] },
                "out": merged.map { [$0.minX, $0.minY, $0.width, $0.height] }],
      "plausible": plaus, "ramp": ["rects": rects.map(rect), "at": [-50.0, 0, 130, 1000, 2900, 5000], "out": ramp],
    ]
    if let path = ProcessInfo.processInfo.environment["FOCUS_VECTORS_OUT"] {
      try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]).write(to: URL(fileURLWithPath: path))
    }
    XCTAssertFalse(cases.isEmpty)
  }
}
