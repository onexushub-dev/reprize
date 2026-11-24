import AVFoundation

/// Cuts a clip for sharing (multi-recording share design, "what is sent": the sender's cut and silence travel in the
/// file). Passthrough only, never re-encoded: the samples are copied, so it takes a fraction of a second and loses no
/// quality. The recordings are made of 1 s segments that each start on a key frame, so the cut keeps up to a second
/// before `startMs` in the file; the export marks it with an edit list and every player (and the app) starts exactly at
/// `startMs`. A muted clip leaves without its sound track at all. A cut iOS stops (the app left the front) throws, and the
/// app cuts again when it is back (`sharePrep.ts`).
enum ClipCut {
  enum Failure: Error { case noVideo, export(Error?) }

  static func cut(inPath: String, outPath: String, startMs: Double, endMs: Double, muted: Bool) async throws
    -> (path: String, durationMs: Int)
  {
    let asset = AVURLAsset(url: URL(fileURLWithPath: inPath))
    guard let video = try await asset.loadTracks(withMediaType: .video).first else { throw Failure.noVideo }
    let sound = muted ? nil : try await asset.loadTracks(withMediaType: .audio).first
    let length = try await asset.load(.duration)
    let start = CMTime(value: Int64(max(0, startMs) * 1000), timescale: 1_000_000)
    var end = CMTime(value: Int64(max(startMs, endMs) * 1000), timescale: 1_000_000)
    if CMTimeCompare(end, length) > 0 { end = length }
    let range = CMTimeRange(start: start, end: end)

    let composition = AVMutableComposition()
    guard let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
    else { throw Failure.noVideo }
    videoTrack.preferredTransform = try await video.load(.preferredTransform)
    try videoTrack.insertTimeRange(range, of: video, at: .zero)
    if let sound = sound {
      let soundRange = try await sound.load(.timeRange)
      let overlap = CMTimeRangeGetIntersection(range, otherRange: soundRange)
      if !overlap.isEmpty, let soundTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
        try soundTrack.insertTimeRange(overlap, of: sound, at: CMTimeSubtract(overlap.start, start))
      }
    }

    let out = URL(fileURLWithPath: outPath)
    try FileManager.default.createDirectory(at: out.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? FileManager.default.removeItem(at: out)
    guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough) else {
      throw Failure.export(nil)
    }
    session.outputURL = out
    session.outputFileType = .mp4
    session.shouldOptimizeForNetworkUse = true
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
      session.exportAsynchronously { done.resume() }
    }
    guard session.status == .completed else {
      try? FileManager.default.removeItem(at: out) // never leave a partial file behind
      throw Failure.export(session.error)
    }
    withExtendedLifetime(asset) {}
    return (out.path, Int((CMTimeGetSeconds(range.duration) * 1000).rounded()))
  }
}
