import Foundation

/// The people found in each analysed picture of a clip, kept next to it (`<clip>.people.json`; plan 2026-11-12, I1):
/// an analysis that was stopped goes on from here, and Bola's pass leaves them for Jogadores. Boxes are kept exactly as
/// found, so a resumed analysis frames like an uninterrupted one.
public enum FocusFrames {
  public static func json(_ frames: [FocusSample], width: Int, height: Int) -> [String: Any] {
    [
      "v": 1, "size": [width, height],
      "frames": frames.sorted { $0.tMs < $1.tMs }.map { f -> [String: Any] in
        ["t": f.tMs, "b": f.boxes.map { [$0.x, $0.y, $0.width, $0.height] }]
      },
    ]
  }

  /// Anything unreadable, another version or another video size gives an empty cache.
  public static func read(_ obj: Any?, width: Int, height: Int) -> [FocusSample] {
    guard let f = obj as? [String: Any], (f["v"] as? NSNumber)?.intValue == 1,
          let size = f["size"] as? [NSNumber], size.count == 2, size[0].intValue == width, size[1].intValue == height,
          let frames = f["frames"] as? [[String: Any]] else { return [] }
    return frames.compactMap { fr -> FocusSample? in
      guard let t = (fr["t"] as? NSNumber)?.doubleValue, let b = fr["b"] as? [[NSNumber]] else { return nil }
      return FocusSample(tMs: t, boxes: b.filter { $0.count == 4 }.map {
        FocusBox(x: $0[0].doubleValue, y: $0[1].doubleValue, width: $0[2].doubleValue, height: $0[3].doubleValue)
      })
    }
  }

  /// Both lists in time order; of two frames at the same time, the one from `new`.
  public static func merged(_ old: [FocusSample], _ new: [FocusSample]) -> [FocusSample] {
    let times = Set(new.map { $0.tMs })
    return (old.filter { !times.contains($0.tMs) } + new).sorted { $0.tMs < $1.tMs }
  }
}
