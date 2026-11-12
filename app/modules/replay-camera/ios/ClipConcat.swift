import AVFoundation

/// Builds a saved clip from buffer segments: joins the fMP4 init + media segments, then remuxes
/// (passthrough, no re-encode) to a regular MP4 whose timeline starts at 0. Without the remux, a clip
/// saved minutes into a game keeps the fragments' session-relative times and shows an empty lead-in.
enum ClipConcat {
  static func concat(initSegment: URL, segments: [Segment], to dest: URL) throws {
    FileManager.default.createFile(atPath: dest.path, contents: nil)
    let out = try FileHandle(forWritingTo: dest)
    defer { try? out.close() }
    try out.write(contentsOf: Data(contentsOf: initSegment))
    for segment in segments {
      try out.write(contentsOf: Data(contentsOf: segment.url))
    }
  }

  enum Failure: Error { case noVideo, export(Error?) }

  /// One normalized piece of a save (`normalize` already ran on it) and the short side it was recorded at.
  struct Part {
    let url: URL
    let shortSide: Int
    let seconds: Double
  }

  /// Puts the parts of one save into `dest` as one clip and returns its short side. One part: moved as it is. Parts of
  /// different sizes (a heat step changed the format in the middle; plan 2026-11-12, I3c): the larger ones are
  /// re-encoded down to the smallest size, then all are joined (`VideoConcat`, passthrough first). Blocks the calling
  /// (utility) thread.
  static func join(_ parts: [Part], to dest: URL) throws -> Int {
    guard let first = parts.first else { throw Failure.noVideo }
    if parts.count == 1 {
      try FileManager.default.moveItem(at: first.url, to: dest)
      return first.shortSide
    }
    let target = parts.map(\.shortSide).min() ?? first.shortSide
    var paths: [String] = []
    var scaled: [URL] = []
    defer { scaled.forEach { try? FileManager.default.removeItem(at: $0) } }
    for part in parts {
      if part.shortSide <= target {
        paths.append(part.url.path)
        continue
      }
      let out = FileManager.default.temporaryDirectory.appendingPathComponent("scaled-\(UUID().uuidString).mp4")
      scaled.append(out)
      try scale(part.url, to: out, shortSide: target)
      paths.append(out.path)
    }
    let done = DispatchSemaphore(value: 0)
    let box = JoinResult()
    let inputs = paths
    Task {
      do { _ = try await VideoConcat.concat(paths: inputs, outPath: dest.path) } catch { box.error = error }
      done.signal()
    }
    done.wait()
    if let error = box.error { throw error }
    return target
  }

  /// Re-encodes `source` at `shortSide` (1080 → Full HD, otherwise 720p), keeping its rotation and sound.
  private static func scale(_ source: URL, to dest: URL, shortSide: Int) throws {
    let preset = shortSide >= 1080 ? AVAssetExportPreset1920x1080 : AVAssetExportPreset1280x720
    guard let export = AVAssetExportSession(asset: AVURLAsset(url: source), presetName: preset) else {
      throw Failure.noVideo
    }
    export.outputURL = dest
    export.outputFileType = .mp4
    let done = DispatchSemaphore(value: 0)
    export.exportAsynchronously { done.signal() }
    done.wait()
    guard export.status == .completed else { throw Failure.export(export.error) }
  }

  /// Blocks the calling (utility) thread until the remux ends.
  /// `rotationDegrees` is the phone's position when the clip was saved (see `DeviceUpright.videoRotationDegrees`).
  /// The writer stamps the position it saw at its first frame on the whole session, so a phone started upright and
  /// then laid on its side would save every clip sideways; the saved clip is re-stamped here instead. The new
  /// transform goes on a composition track, which the passthrough export keeps without re-encoding.
  static func normalize(_ source: URL, to dest: URL, rotationDegrees: Int? = nil) throws {
    let asset = AVURLAsset(url: source)
    guard let video = asset.tracks(withMediaType: .video).first else { throw Failure.noVideo }
    var input: AVAsset = asset
    if let degrees = rotationDegrees {
      let composition = AVMutableComposition()
      guard let track = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
      else { throw Failure.noVideo }
      try track.insertTimeRange(video.timeRange, of: video, at: .zero)
      track.preferredTransform = CGAffineTransform(rotationAngle: CGFloat(degrees) * .pi / 180)
      // The sound goes along, on the same timeline as the picture (without it the clip was saved silent).
      for audio in asset.tracks(withMediaType: .audio) {
        guard let audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
        else { continue }
        let range = CMTimeRangeGetIntersection(audio.timeRange, otherRange: video.timeRange)
        guard range.duration > .zero else { continue }
        try audioTrack.insertTimeRange(range, of: audio, at: CMTimeSubtract(range.start, video.timeRange.start))
      }
      input = composition
    }
    guard let export = AVAssetExportSession(asset: input, presetName: AVAssetExportPresetPassthrough)
    else { throw Failure.noVideo }
    export.outputURL = dest
    export.outputFileType = .mp4
    export.timeRange = CMTimeRange(start: .zero, duration: video.timeRange.duration)
    let done = DispatchSemaphore(value: 0)
    export.exportAsynchronously { done.signal() }
    done.wait()
    guard export.status == .completed else { throw Failure.export(export.error) }
  }
}

/// The join's error, handed from the async join back to the waiting save thread (written once, read after the wait).
private final class JoinResult: @unchecked Sendable {
  var error: Error?
}
