import Foundation

/// Sharing transfers in the clips' order (2026-11-21, 90-clip test): with every file queued at once, a few at a time
/// went in any order (clip 5 arrived while clip 2 waited), on the sender's side and so on the receiver's too. Each task
/// gets a priority from its clip's place, first clips first, and fewer files go at once, so the clips come in order as
/// far as iOS follows (it treats priority as a hint).
enum TransferOrder {
  /// Files of one host at a time. 2026-11-21 tests (90 clips): iOS barely follows the priorities, so fewer files at
  /// once did not keep the order much better (a clip or two still swap) and cost speed: ~2.6 s a clip with iOS's
  /// default, 4.3 s with 2, 3.7 s with 3. 4 sits near the default's speed; the receiver's grid keeps each clip in its
  /// place, so a swap does not show.
  static let connections = 4

  /// The cover's still 1, then 0.99 for the first clip down to near 0 for the last (a clip's still just above its video);
  /// files without a clip number in the middle.
  static func priority(for id: String) -> Float {
    // The cover's still first (the link's page). A clip's still goes with its clip, just before its video: sending
    // all 90 stills first held the first video back half a minute (2026-11-21 test).
    if id.hasSuffix("cover.jpg") { return 1 }
    guard let position = position(in: id) else { return URLSessionTask.defaultPriority }
    let clip = max(0.01, 0.99 - Float(min(position, 980)) / 1000)
    return id.hasSuffix("thumb.jpg") ? min(0.995, clip + 0.0005) : clip
  }

  /// The clip's place in an id like "recv/<share>/12/video" or "<share>/clips/12/video.mp4".
  private static func position(in id: String) -> Int? {
    for part in id.split(separator: "/") {
      if let value = Int(part), value > 0 { return value }
    }
    return nil
  }
}
