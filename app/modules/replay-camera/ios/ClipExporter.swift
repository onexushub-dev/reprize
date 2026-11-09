import AVFoundation
import UIKit

/// Renders a share video from a saved clip: the cut, any speed (silent unless 1x) and mute, the video (or the part of it
/// the player zoomed to) aspect-fit in a `width`×`height` frame, and a full-frame PNG overlay (the bands and mark) on top.
enum ClipExporter {
  struct Options {
    let clipPath: String
    let startMs: Double
    let endMs: Double
    let speed: Double
    let muted: Bool
    /// Extra clockwise turn in degrees (0, 90, 180, 270) on top of the clip's own rotation.
    let rotation: Int
    /// The visible part of the video, 0..1 of its (rotated) size; nil = all of it.
    let crop: CGRect?
    /// Modo Foco: the framing file and which track to follow (ignored when `crop` is set). `fill`: Seguir a Bola's 9:16
    /// crop fills the whole frame instead of the spot the whole video would take.
    var focus: (path: String, aspect: String, fill: Bool)? = nil
    let width: Int
    let height: Int
    let overlayPngPath: String?
    let background: UIColor
  }

  enum Failure: Error { case noVideo, export(Error?) }

  static var exportsDir: URL {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("exports")
  }

  static func export(_ o: Options) async throws -> (path: String, durationMs: Int) {
    let asset = AVURLAsset(url: URL(fileURLWithPath: o.clipPath))
    guard let source = try await asset.loadTracks(withMediaType: .video).first else { throw Failure.noVideo }
    let assetDuration = try await asset.load(.duration)
    let start = CMTime(seconds: o.startMs / 1000, preferredTimescale: 600)
    let end = CMTimeMinimum(CMTime(seconds: o.endMs / 1000, preferredTimescale: 600), assetDuration)
    let range = CMTimeRange(start: start, end: end)

    let composition = AVMutableComposition()
    guard let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
    else { throw Failure.noVideo }
    try video.insertTimeRange(range, of: source, at: .zero)
    let changed = o.speed != 1
    if !o.muted, !changed, let audio = try await asset.loadTracks(withMediaType: .audio).first,
       let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
    {
      try track.insertTimeRange(range, of: audio, at: .zero)
    }
    if changed {
      let cut = CMTimeRange(start: .zero, duration: range.duration)
      composition.scaleTimeRange(cut, toDuration: CMTimeMultiplyByFloat64(range.duration, multiplier: 1 / o.speed))
    }

    // Place the (possibly rotated) video in the middle of the frame. A zoom shows only `crop` of it, scaled to fill the
    // same spot; whatever spills past that spot is hidden by the overlay's opaque bands and the frame's edges.
    let render = CGSize(width: o.width, height: o.height)
    let turn = CGAffineTransform(rotationAngle: CGFloat(o.rotation) * .pi / 180)
    let transform = try await source.load(.preferredTransform).concatenating(turn)
    let natural = try await source.load(.naturalSize)
    let rotated = CGRect(origin: .zero, size: natural).applying(transform)
    let filled = o.crop == nil && o.focus.map { $0.fill } == true
    let target = filled ? CGRect(origin: .zero, size: render) : FitRect.fit(rotated.size, into: render)
    func placement(_ crop: CGRect?) -> CGAffineTransform {
      let visible = crop.map {
        CGRect(x: $0.minX * rotated.width, y: $0.minY * rotated.height, width: $0.width * rotated.width, height: $0.height * rotated.height)
      } ?? CGRect(origin: .zero, size: rotated.size)
      let scale = target.width / visible.width
      return transform
        .concatenating(CGAffineTransform(translationX: -rotated.minX - visible.minX, y: -rotated.minY - visible.minY))
        .concatenating(CGAffineTransform(scaleX: scale, y: scale))
        .concatenating(CGAffineTransform(translationX: target.minX, y: target.minY))
    }

    let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: video)
    // Modo Foco: the framing moves along the path, one linear ramp per 100 ms. The overlay below is untouched, so the
    // mark stays in the corner of the video image in every frame.
    let segments = o.crop == nil ? o.focus.map { FocusFile.segments(path: $0.path, aspect: $0.aspect, cutStartMs: o.startMs,
                                                                    cutEndMs: o.endMs, speed: o.speed) } ?? [] : []
    if segments.isEmpty {
      layer.setTransform(placement(o.crop), at: .zero)
    } else {
      for s in segments {
        let from = CMTime(seconds: s.fromSec, preferredTimescale: 6000), to = CMTime(seconds: s.toSec, preferredTimescale: 6000)
        layer.setTransformRamp(fromStart: placement(cgRect(s.from)), toEnd: placement(cgRect(s.to)),
                               timeRange: CMTimeRange(start: from, end: to))
      }
    }
    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: composition.duration)
    instruction.backgroundColor = o.background.cgColor
    instruction.layerInstructions = [layer]

    let videoComposition = AVMutableVideoComposition()
    videoComposition.renderSize = render
    // The clip's own frame rate (60 for the default 1080p60): a fixed 30 dropped half the frames of a 60 fps clip.
    let sourceFps = try await source.load(.nominalFrameRate)
    let fps = FitRect.exportFrameRate(source: Double(sourceFps), speed: o.speed)
    videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(fps))
    videoComposition.instructions = [instruction]

    if let png = o.overlayPngPath, let image = UIImage(contentsOfFile: png)?.cgImage {
      let frame = CGRect(origin: .zero, size: render)
      let parent = CALayer(), videoLayer = CALayer(), overlay = CALayer()
      [parent, videoLayer, overlay].forEach { $0.frame = frame }
      overlay.contents = image
      overlay.contentsGravity = .resize
      parent.addSublayer(videoLayer)
      parent.addSublayer(overlay)
      videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer: videoLayer, in: parent)
    }

    try FileManager.default.createDirectory(at: exportsDir, withIntermediateDirectories: true)
    let out = exportsDir.appendingPathComponent("\(UUID().uuidString).mp4")
    guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
      throw Failure.export(nil)
    }
    session.outputURL = out
    session.outputFileType = .mp4
    session.videoComposition = videoComposition
    session.shouldOptimizeForNetworkUse = true
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
      session.exportAsynchronously { done.resume() }
    }
    guard session.status == .completed else {
      try? FileManager.default.removeItem(at: out) // never leave a partial file behind
      throw Failure.export(session.error)
    }
    return (out.path, Int(composition.duration.seconds * 1000))
  }
}

private func cgRect(_ r: FocusRect) -> CGRect { CGRect(x: r.x, y: r.y, width: r.width, height: r.height) }

/// Reads a Modo Foco file (`FocusAnalyzer`). Anything unreadable, another version or an empty track gives no segments,
/// and the export shows the whole video.
enum FocusFile {
  static func segments(path: String, aspect: String, cutStartMs: Double, cutEndMs: Double, speed: Double) -> [FocusSegment] {
    guard let data = FileManager.default.contents(atPath: path),
          let file = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          (file["v"] as? NSNumber)?.intValue == 1,
          let stepMs = (file["stepMs"] as? NSNumber)?.doubleValue,
          let startMs = (file["startMs"] as? NSNumber)?.doubleValue,
          let rows = file[aspect] as? [[NSNumber]]
    else {
      NSLog("[Reprize] Modo Foco file unreadable: %@", path)
      return []
    }
    let rects = rows.compactMap { row -> FocusRect? in
      row.count == 4 ? FocusRect(x: row[0].doubleValue, y: row[1].doubleValue, width: row[2].doubleValue, height: row[3].doubleValue) : nil
    }
    return FocusRamp.segments(rects: rects, startMs: startMs, stepMs: stepMs, cutStartMs: cutStartMs, cutEndMs: cutEndMs,
                              speed: speed)
  }
}

extension UIColor {
  /// "#RRGGBB" → color; anything else → black.
  convenience init(hex: String) {
    let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
    self.init(red: CGFloat((value >> 16) & 0xFF) / 255, green: CGFloat((value >> 8) & 0xFF) / 255,
              blue: CGFloat(value & 0xFF) / 255, alpha: 1)
  }
}
