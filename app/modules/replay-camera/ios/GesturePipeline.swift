import CoreImage
import Vision

/// The vision side of the gesture trigger for one sampled frame, apart from the camera and its timing, so the Mac probe
/// (docs/superpowers/spikes/gesture-distance) can replay recorded clips through exactly this code.
///
/// 1. Find people: the person detector on the whole frame, plus `tiles` regions of the frame scanned round-robin
///    (ScanTiles), so players far from the phone are found too. PersonTracks keeps them between samples.
/// 2. Run body pose on an enlarged crop around a few of them (PersonTracks.pick: arms up first, then turns).
/// 3. Feed the wave gesture (WaveTracker), and the hold (ArmsUp + PersonHold) only when `Options.hold` is on.
///
/// The hold is off in the app since 2026-11-02: in indoor volleyball the setter's set (both hands above the head, still,
/// ~1 s) and the blocks right after it are exactly the arms-up pose, and the hold only needs 3 hits over 1.5 s with gaps
/// up to 1.2 s, so a set followed by a jump at the net fired a clip nobody asked for. The app only teaches the wave.
final class GesturePipeline {
  struct Options: Equatable {
    /// Tiles scanned per sample, 0 for the whole frame only.
    var tiles: Int
    /// Keep people between samples (PersonTracks) instead of only those found in this frame.
    var tracks: Bool
    /// Enlarge small crops (Lanczos) before pose, so a far player is not just a few pixels to the pose model.
    var upscale: Bool
    /// Close looks per sample around small tracked or just-lost people (ScanTiles.focusRegion; needs `tracks`).
    var focus: Int
    /// Also fire on the hold (both arms up, still, 1.5 s). Off in the app: sets and blocks look the same (see above).
    var hold: Bool

    /// What the app shipped until v2: whole frame, the 4 biggest people of this frame, no upscaling.
    static let wholeFrame = Options(tiles: 0, tracks: false, upscale: false, focus: 0, hold: true)
    static let standard = Options(tiles: 2, tracks: true, upscale: true, focus: 2, hold: false)
    /// When the phone is hot: one tile and one close look per sample.
    static let hot = Options(tiles: 1, tracks: true, upscale: true, focus: 1, hold: false)
  }

  struct Result {
    let fired: Bool
    let held: Bool
    let waved: Bool
    /// Somebody had the arms up in this sample (the hold rule).
    let isUp: Bool
    /// Somebody had both wrists above the head: sample faster for a while.
    let raised: Bool
    let sightings: [Sighting]
    /// People known (tracked) after this sample, and how many of them came from the tiles in this sample.
    let people: Int
    let fromTiles: Int
    /// Height in pixels of the smallest person the pose step looked at (0: none).
    let smallestPosedPx: Double
    /// Each person the pose step looked at, for the gesture test (spike screen).
    let traces: [PersonTrace]
    /// Time this sample took (detection + pose), ms.
    let elapsedMs: Double
  }

  /// One person in one sample, as the gesture test needs it: where and how big they were, how their box was found,
  /// and the pose read (nil: no body found in the crop).
  struct PersonTrace {
    enum Source: String { case full, tile, focus, kept, wholeFrame }
    /// Track id (-1 without tracks or for the whole-frame fallback).
    let id: Int
    let source: Source
    /// Normalized to the frame, origin bottom-left (Vision).
    let box: CGRect
    /// Box height in pixels of the frame.
    let px: Double
    let pose: Pose?
  }

  /// Crops shorter than this are enlarged up to it (at most `maxUpscale` times).
  static let upscaleTo: CGFloat = 384
  static let maxUpscale: CGFloat = 4

  private let tracks = PersonTracks()
  private let hold = PersonHold()
  private let wave = WaveTracker()
  private let gate = FireGate()
  private var index = 0

  func reset() {
    tracks.reset()
    index = 0
  }

  func process(_ image: CIImage, at t: Double, maxPeople: Int, options: Options) -> Result {
    let started = CFAbsoluteTimeGetCurrent()
    let extent = image.extent
    let handler = VNImageRequestHandler(ciImage: image)

    var boxes: [(box: CGRect, confidence: Double)] = detect(handler, region: nil)
    let fullCount = boxes.count
    let fullBoxes = boxes.map(\.box)
    var tileBoxes: [CGRect] = []
    for region in ScanTiles.tiles(at: index, perSample: options.tiles) {
      let found = detect(handler, region: region).filter {
        ScanTiles.plausible($0.box, confidence: $0.confidence, frame: extent.size)
      }
      boxes += found
      tileBoxes += found.map(\.box)
    }
    // Close looks around far people the tiles may only revisit seconds later (2026-10-28: at 30 m, with the phone hot,
    // a player standing still went 12 s unseen between tile passes).
    var focusBoxes: [CGRect] = []
    if options.tracks {
      for target in tracks.focusTargets(options.focus, at: t) {
        let found = detect(handler, region: ScanTiles.focusRegion(around: target, frame: extent.size)).filter {
          ScanTiles.plausible($0.box, confidence: $0.confidence, frame: extent.size)
        }
        boxes += found
        focusBoxes += found.map(\.box)
      }
    }
    index += 1
    let merged = PersonBoxes.merge(boxes)

    // Who gets the pose step: tracked people, or (old behaviour) the biggest people in this frame.
    let picks: [(id: Int?, box: CGRect)]
    if options.tracks {
      tracks.update(merged, at: t)
      picks = tracks.pick(maxPeople, at: t).map { (id: Int?.some($0.id), box: $0.box) }
    } else {
      picks = merged.sorted { PersonBoxes.area($0) > PersonBoxes.area($1) }.prefix(maxPeople)
        .map { (id: Int?.none, box: $0) }
    }

    // Nobody found (e.g. very close, partly out of frame): the whole frame.
    var sightings: [Sighting] = []
    var traces: [PersonTrace] = []
    var smallest = Double.infinity
    if picks.isEmpty {
      let s = sighting(in: image, rect: extent, upscale: false, id: -1)
      if let s = s { sightings.append(s) }
      traces.append(PersonTrace(id: -1, source: .wholeFrame, box: CGRect(x: 0, y: 0, width: 1, height: 1),
                                px: Double(extent.height), pose: s.map { $0.pose }))
    } else {
      for pick in picks {
        let rect = PersonCrop.rect(person: pick.box, in: extent)
        let px = Double(pick.box.height * extent.height)
        smallest = min(smallest, px)
        let s = sighting(in: image, rect: rect, upscale: options.upscale, id: pick.id ?? -1)
        if let s = s { sightings.append(s) }
        let source: PersonTrace.Source = fullBoxes.contains(pick.box) ? .full
          : (tileBoxes.contains(pick.box) ? .tile : (focusBoxes.contains(pick.box) ? .focus : .kept))
        traces.append(PersonTrace(id: pick.id ?? -1, source: source, box: pick.box, px: px, pose: s.map { $0.pose }))
        if let id = pick.id {
          let up = s.map { ArmsUp.isUp($0.pose) || WaveTracker.armsRaised($0.pose) } ?? false
          tracks.posed(id, at: t, found: s != nil, raised: up)
        }
      }
    }

    let isUp = sightings.contains { ArmsUp.isUp($0.pose) }
    let raised = sightings.contains { WaveTracker.armsRaised($0.pose) }
    // Each person holds on their own (without tracks, people only have positions: they share id -1 as before).
    let people = Dictionary(grouping: sightings, by: { $0.id })
      .map { (id: $0.key, isUp: $0.value.contains { ArmsUp.isUp($0.pose) }) }
    let held = options.hold ? hold.update(people, at: t) : false
    let waved = wave.update(sightings, at: t) // every sample, so a wave is followed whether or not the hold is on
    let fired = gate.update(fired: held || waved, anyRaised: isUp || raised, at: t)
    return Result(fired: fired, held: held, waved: waved, isUp: isUp, raised: raised, sightings: sightings,
                  people: options.tracks ? tracks.tracks.count : merged.count, fromTiles: merged.count > fullCount ? merged.count - fullCount : 0,
                  smallestPosedPx: smallest.isFinite ? smallest : 0, traces: traces,
                  elapsedMs: (CFAbsoluteTimeGetCurrent() - started) * 1000)
  }

  /// People boxes (normalized to the frame, origin bottom-left) in the whole frame or in one region of it.
  private func detect(_ handler: VNImageRequestHandler, region: CGRect?) -> [(box: CGRect, confidence: Double)] {
    let request = VNDetectHumanRectanglesRequest()
    request.upperBodyOnly = false
    if let region = region { request.regionOfInterest = region }
    try? handler.perform([request])
    // With a regionOfInterest the detector only looks inside it, but the boxes still come back normalized to the
    // whole frame (checked on the 2026-10-27 field test: mapping them from the region put them in the wrong place).
    return (request.results ?? []).compactMap { o in
      let box = o.boundingBox
      if let region = region, !region.insetBy(dx: -0.02, dy: -0.02).contains(CGPoint(x: box.midX, y: box.midY)) { return nil }
      return (box: box, confidence: Double(o.confidence))
    }
  }

  /// The pose in `rect` (pixel units, y down, of the crop itself: ArmsUp only compares lengths within one body), with
  /// where the person was in the frame so the wave tracker can follow them between samples.
  private func sighting(in image: CIImage, rect: CGRect, upscale: Bool, id: Int) -> Sighting? {
    guard rect.width >= 4, rect.height >= 4 else { return nil }
    var crop = image.cropped(to: rect).transformed(by: CGAffineTransform(translationX: -rect.minX, y: -rect.minY))
    if upscale, rect.height < Self.upscaleTo {
      let scale = min(Self.maxUpscale, Self.upscaleTo / rect.height)
      crop = crop.applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: scale, kCIInputAspectRatioKey: 1])
        .cropped(to: CGRect(x: 0, y: 0, width: floor(rect.width * scale), height: floor(rect.height * scale)))
    }
    let request = VNDetectHumanBodyPoseRequest()
    try? VNImageRequestHandler(ciImage: crop).perform([request])
    guard let observation = request.results?.first else { return nil }
    let extent = image.extent
    return Sighting(pose: Self.pose(from: observation, size: rect.size),
                    x: (rect.midX - extent.minX) / extent.width,
                    y: (rect.midY - extent.minY) / extent.height, id: id)
  }

  /// Vision's normalized joints in pixel units of a crop of `size`, y down. Normalized, so an enlarged crop maps back
  /// to the same numbers.
  static func pose(from observation: VNHumanBodyPoseObservation, size: CGSize) -> Pose {
    func point(_ name: VNHumanBodyPoseObservation.JointName) -> Point? {
      guard let p = try? observation.recognizedPoint(name) else { return nil }
      return Point(x: Double(p.location.x * size.width), y: Double((1 - p.location.y) * size.height),
                   confidence: Double(p.confidence))
    }
    return Pose(leftWrist: point(.leftWrist), rightWrist: point(.rightWrist),
                leftElbow: point(.leftElbow), rightElbow: point(.rightElbow),
                leftShoulder: point(.leftShoulder), rightShoulder: point(.rightShoulder), nose: point(.nose),
                leftEye: point(.leftEye), rightEye: point(.rightEye), leftEar: point(.leftEar), rightEar: point(.rightEar),
                leftHip: point(.leftHip), rightHip: point(.rightHip))
  }
}
