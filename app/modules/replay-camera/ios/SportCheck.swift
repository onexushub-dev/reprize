import AVFoundation
import Vision

/// Test 43 (2026-11-09): which sport a recording looks like, from Apple's built-in scene classifier (Vision
/// `VNClassifyImageRequest`, on the phone, no model to ship). Three frames of a clip (at 20%, 50% and 80% of the given
/// range); for each label the highest confidence over them (>= 0.01). The rule lives in JS (`focus/sportCheck.ts`):
/// another sport's label >= 0.4 with "basketball" < 0.1 means "not basketball".
/// Test 51: the same frames' floor (`SportFloor`), the median over them under two keys no Apple label has, "_floorSand"
/// and "_floorTex": a sand court is beach tennis' (JS).
enum SportCheck {
  private static let work = DispatchQueue(label: "reprize.sport", qos: .utility)

  static func classify(clipPath: String, startMs: Double, endMs: Double) async -> [String: Double] {
    await withCheckedContinuation { (done: CheckedContinuation<[String: Double], Never>) in
      work.async { done.resume(returning: run(clipPath: clipPath, startMs: startMs, endMs: endMs)) }
    }
  }

  private static func run(clipPath: String, startMs: Double, endMs: Double) -> [String: Double] {
    let gen = AVAssetImageGenerator(asset: AVURLAsset(url: URL(fileURLWithPath: clipPath)))
    gen.appliesPreferredTrackTransform = true
    gen.maximumSize = CGSize(width: 1280, height: 1280)
    gen.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 10)
    gen.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 10)
    var best: [String: Double] = [:]
    var floors: [SportFloor.Measure] = []
    for f in [0.2, 0.5, 0.8] {
      autoreleasepool {
        let t = CMTime(seconds: (startMs + (endMs - startMs) * f) / 1000, preferredTimescale: 600)
        guard let image = try? gen.copyCGImage(at: t, actualTime: nil) else { return }
        if let m = SportFloor.measure(image) { floors.append(m) }
        let request = VNClassifyImageRequest()
        guard (try? VNImageRequestHandler(cgImage: image).perform([request])) != nil else { return }
        for o in request.results ?? [] where o.confidence >= 0.01 {
          let c = (Double(o.confidence) * 1000).rounded() / 1000
          if c > (best[o.identifier] ?? 0) { best[o.identifier] = c }
        }
      }
    }
    if !floors.isEmpty {
      best["_floorSand"] = (SportFloor.median(floors.map { $0.sand }) * 1000).rounded() / 1000
      best["_floorTex"] = (SportFloor.median(floors.map { $0.texture }) * 100).rounded() / 100
    }
    return best
  }
}
