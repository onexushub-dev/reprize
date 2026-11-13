import AVFoundation
import CoreImage
import Vision

/// The one pass over a clip's frames that Jogadores and Bola share (plan 2026-11-12, I1): the clip is decoded once, and
/// each kept frame goes to the people detector (Vision), to the ball detector (Core ML), or to both at the same time.
/// What each mode does with what is found (its cache, its framing, its file) stays in `FocusAnalyzer` and
/// `BallAnalyzer`. One analysis at a time, whichever mode asked: it is the player waiting, so `.userInitiated`.
enum ClipScan {
  /// `interrupted`: Vision or Core ML kept failing, as they do with the app in the background; `hot`: stopped at
  /// `critical` (Bola only, as before); `noModel`: this build has no ball model.
  enum Failure: Error { case noVideo, unreadable, noModel, cancelled, interrupted, hot }

  static let work = DispatchQueue(label: "reprize.scan", qos: .userInitiated)
  /// The people detector's own thread while the ball detector runs on `work` (the two side by side on one frame).
  private static let side = DispatchQueue(label: "reprize.scan.people", qos: .userInitiated)

  /// Milliseconds per stage of one analysis, for the Diagnóstico line (plan I5). With the two detectors side by side
  /// their times overlap, so the stages can add up to more than the analysis took.
  struct Stages {
    var decode = 0.0, people = 0.0, prep = 0.0, model = 0.0, path = 0.0
    /// Tiles sent to the ball model, and the frames they came from (their mean is the "regions per frame").
    var regions = 0, ballFrames = 0

    var json: [String: Any] {
      let r = { (v: Double) in (v * 10).rounded() / 10 }
      return ["decodeMs": r(decode), "peopleMs": r(people), "prepMs": r(prep), "modelMs": r(model), "pathMs": r(path),
              "regions": ballFrames > 0 ? r(Double(regions) / Double(ballFrames)) : 0]
    }
  }

  /// The clip's video track and how its frames stand upright.
  struct Video {
    let asset: AVAsset
    let track: AVAssetTrack
    let orientation: CGImagePropertyOrientation
    /// The upright picture.
    let width: Int, height: Int
    let durationMs: Double

    static func load(clipPath: String) async throws -> Video {
      let asset = AVURLAsset(url: URL(fileURLWithPath: clipPath))
      guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw Failure.noVideo }
      let transform = try await track.load(.preferredTransform)
      let natural = try await track.load(.naturalSize)
      let duration = try await asset.load(.duration).seconds * 1000
      let orientation = Self.orientation(of: transform)
      let turned = orientation == .left || orientation == .right
      return Video(asset: asset, track: track, orientation: orientation,
                   width: Int((turned ? natural.height : natural.width).rounded()),
                   height: Int((turned ? natural.width : natural.height).rounded()), durationMs: duration)
    }

    /// How to turn the stored frames upright, from the track's transform (the camera stores sensor-oriented frames).
    static func orientation(of t: CGAffineTransform) -> CGImagePropertyOrientation {
      if t.a == 0 && t.b == 1 && t.c == -1 && t.d == 0 { return .right }
      if t.a == 0 && t.b == -1 && t.c == 1 && t.d == 0 { return .left }
      if t.a == -1 && t.d == -1 { return .down }
      return .up
    }
  }

  /// What Bola wants from the pass: its ticks, the model, and the size the tiles are cut from (a 4K frame is scaled to
  /// `width` × `height` first).
  struct BallJob {
    let ticks: [Double]
    let detector: BallAnalyzer.Detector
    let width: Int, height: Int
    /// Also a small grey picture of each frame (beach tennis's video-screen rule).
    let thumbnails: Bool
    /// Motion-gated tiles (`BallMotion`, lab tests 53 and 54; TEMP(lab-motion): a Diagnóstico switch, off by default):
    /// only the tiles where the picture changed go to the model.
    let motion: Bool
  }

  /// What one kept frame gave.
  struct Found {
    var people: FocusSample?
    var ball: BallFraming.Detection?
    var thumbnail: (pixels: [UInt8], width: Int, height: Int)?
  }

  /// People in one frame, as Jogadores has found them since v14: Vision's detector on the whole frame and on the
  /// gesture's 9 half-frame regions, so far players are found (`ScanTiles`), merged.
  final class PeopleDetector {
    static let minConfidence: VNConfidence = 0.3
    private let request = VNDetectHumanRectanglesRequest()
    private let tileRequests: [(request: VNDetectHumanRectanglesRequest, region: CGRect)]
    private let frameSize: CGSize

    init(width: Int, height: Int) {
      request.upperBodyOnly = false
      // With a regionOfInterest the boxes still come back normalized to the whole frame.
      tileRequests = ScanTiles.regions.map { region in
        let r = VNDetectHumanRectanglesRequest()
        r.upperBodyOnly = false
        r.regionOfInterest = region
        return (r, region)
      }
      frameSize = CGSize(width: width, height: height)
    }

    /// nil: Vision could not run (the app is in the background).
    func detect(_ pixels: CVPixelBuffer, orientation: CGImagePropertyOrientation) -> [FocusBox]? {
      autoreleasepool {
        do {
          try VNImageRequestHandler(cvPixelBuffer: pixels, orientation: orientation)
            .perform([request] + tileRequests.map { $0.request })
        } catch {
          return nil
        }
        // Vision: normalized, origin bottom-left, in the upright picture (the orientation above).
        let full = (request.results ?? []).filter { $0.confidence >= Self.minConfidence }
          .map { (box: $0.boundingBox, confidence: Double($0.confidence)) }
        var tiles: [(box: CGRect, confidence: Double)] = []
        for (r, region) in tileRequests {
          for o in r.results ?? [] {
            let b = o.boundingBox
            guard region.insetBy(dx: -0.02, dy: -0.02).contains(CGPoint(x: b.midX, y: b.midY)),
                  ScanTiles.plausible(b, confidence: Double(o.confidence), frame: frameSize) else { continue }
            tiles.append((b, Double(o.confidence)))
          }
        }
        return PersonBoxes.merge(full + tiles).map {
          FocusBox(x: Double($0.minX), y: Double(1 - $0.maxY), width: Double($0.width), height: Double($0.height))
        }
      }
    }
  }

  /// A result written on one thread and read on another after the group is done.
  private final class Slot<T>: @unchecked Sendable {
    var value: T?
    var ms = 0.0
  }

  /// Reads the stretch of the clip that the ticks need, once, and hands `each` what every kept frame gave. `people`:
  /// Jogadores' ticks still to analyse (each stands for `peopleWindowMs`); `ball`: Bola's. `sideBySide`: on a frame both
  /// want, the two detectors run at the same time.
  static func run(video: Video, people: [Double], peopleWindowMs: Double, ball: BallJob?, sideBySide: Bool,
                  stages: inout Stages, cancelled: () -> Bool, each: (Found) throws -> Void) throws {
    let ballTicks = ball.map { $0.ticks } ?? []
    guard let span = ScanTicks.span(people: people, peopleWindowMs: peopleWindowMs, ball: ballTicks,
                                    ballWindowMs: BallFraming.stepMs) else { return }
    if cancelled() { throw Failure.cancelled }
    let reader = try AVAssetReader(asset: video.asset)
    let output = AVAssetReaderTrackOutput(track: video.track, outputSettings: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
    ])
    output.alwaysCopiesSampleData = false
    reader.add(output)
    reader.timeRange = CMTimeRange(start: CMTime(seconds: max(0, span.fromMs - 50) / 1000, preferredTimescale: 600),
                                   end: CMTime(seconds: (span.toMs + 50) / 1000, preferredTimescale: 600))
    guard reader.startReading() else { throw Failure.unreadable }

    var peopleCursor = ScanTicks.Cursor(ticks: people, windowMs: peopleWindowMs)
    var ballCursor = ScanTicks.Cursor(ticks: ballTicks, windowMs: BallFraming.stepMs)
    // Motion-gated tiles compare each analysed frame with the pictures 100 ms before and after it.
    let gated = ball.map { $0.motion } ?? false
    let neighbours = gated
      ? Array(Set(ballTicks.flatMap { [$0 - BallFraming.stepMs, $0 + BallFraming.stepMs] })
                .subtracting(ballTicks).filter { $0 >= 0 }).sorted() : []
    var neighbourCursor = ScanTicks.Cursor(ticks: neighbours, windowMs: BallFraming.stepMs)
    let peopleDetector = people.isEmpty ? nil : PeopleDetector(width: video.width, height: video.height)
    let regions = ball.map { BallDetect.regions(width: $0.width, height: $0.height, side: BallAnalyzer.modelSide,
                                                tile: BallAnalyzer.tileSide) } ?? []
    var gate = BallMotion.Gate(regions: regions, frameWidth: ball.map { $0.width } ?? 1,
                               frameHeight: ball.map { $0.height } ?? 1, tile: BallAnalyzer.tileSide)
    var peopleFound = 0, peopleFailed = 0, ballFound = 0, ballFailed = 0

    /// The upright frame at the size the tiles are cut from, origin (0, 0).
    func picture(_ pixels: CVPixelBuffer, _ job: BallJob) -> CIImage {
      var image = CIImage(cvPixelBuffer: pixels).oriented(video.orientation)
      image = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
      if job.width != video.width || job.height != video.height {
        image = image.transformed(by: CGAffineTransform(scaleX: CGFloat(job.width) / CGFloat(video.width),
                                                        y: CGFloat(job.height) / CGFloat(video.height)))
      }
      return image
    }

    /// A ball frame waiting for the picture after it (motion-gated tiles), with the people task started on it.
    struct Pending {
      let t: Double
      let buffer: CMSampleBuffer
      var found: Found
      let grey: (pixels: [UInt8], width: Int, height: Int)?
      let before: [UInt8]?
      let wantPeople: Bool
      let group: DispatchGroup?
      let slot: Slot<[FocusBox]>
    }
    var pending: Pending?
    /// The last grey picture seen and its time (the "100 ms before" of the next ball frame).
    var lastGrey: (pixels: [UInt8], tMs: Double)?

    /// The ball detector on the waiting frame, then what the frame gave to `each`. `after`: the grey picture 100 ms
    /// later (motion-gated tiles; nil = none came).
    func settle(after: [UInt8]?) throws {
      guard let p = pending, let job = ball, let pixels = CMSampleBufferGetImageBuffer(p.buffer) else { return }
      pending = nil
      var found = p.found
      let result: (candidates: [BallCandidate], stale: [BallCandidate], ran: Int)? = autoreleasepool {
        let image = picture(pixels, job)
        if job.thumbnails { found.thumbnail = job.detector.thumbnail(image) }
        var run = regions
        var active = Set<Int>()
        if job.motion, let g = p.grey {
          let began = Date()
          let changed = BallMotion.changed(g.pixels, before: p.before, after: after, width: g.width, height: g.height)
          active = gate.run(changed: BallMotion.tiles(changed: changed, width: g.width, height: g.height,
                                                      frameWidth: job.width, frameHeight: job.height, regions: regions,
                                                      tile: BallAnalyzer.tileSide))
          run = [regions[0]] + active.sorted().map { regions[$0] }
          stages.prep += Date().timeIntervalSince(began) * 1000
        }
        guard let boxes = try? job.detector.detect(image, regions: run) else { return nil }
        let candidates = BallDetect.frameCandidates(boxes, width: job.width, height: job.height)
        return (candidates, job.motion ? gate.stale(ran: active, candidates: candidates) : [], run.count)
      }
      stages.prep += job.detector.lastPrepMs
      stages.model += job.detector.lastModelMs
      if let r = result {
        found.ball = BallFraming.Detection(tMs: p.t, candidates: r.candidates, stale: r.stale)
        ballFound += 1
        stages.regions += r.ran
        stages.ballFrames += 1
      } else {
        ballFailed += 1
        found.thumbnail = nil
      }
      if let group = p.group {
        // the people detector ran on this frame meanwhile, on its own thread
        group.wait()
        stages.people += p.slot.ms
        if let b = p.slot.value {
          found.people = FocusSample(tMs: p.t, boxes: b)
          peopleFound += 1
        } else {
          peopleFailed += 1
        }
      }
      // Core ML failing again and again: the app went to the background (what was found is kept by the caller).
      if ballFailed >= 5 && ballFailed * 10 > ballFound + ballFailed { reader.cancelReading(); throw Failure.interrupted }
      try each(found)
    }

    while !(peopleCursor.done && ballCursor.done && neighbourCursor.done) {
      let waited = Date()
      guard let buffer = output.copyNextSampleBuffer() else { break }
      stages.decode += Date().timeIntervalSince(waited) * 1000
      if cancelled() { reader.cancelReading(); throw Failure.cancelled }
      let t = CMSampleBufferGetPresentationTimeStamp(buffer).seconds * 1000
      let wantPeople = peopleCursor.take(t), wantBall = ballCursor.take(t)
      let wantNeighbour = neighbourCursor.take(t) && !wantBall
      guard wantPeople || wantBall || wantNeighbour, let pixels = CMSampleBufferGetImageBuffer(buffer) else { continue }
      // Bola stops at `critical` and keeps what it found (Victor, 2026-11-09); Jogadores alone never stopped for heat.
      if wantBall && ProcessInfo.processInfo.thermalState == .critical { reader.cancelReading(); throw Failure.hot }

      // The grey picture of this frame, when the motion gate wants it: it closes the frame that was waiting.
      var grey: (pixels: [UInt8], width: Int, height: Int)?
      if gated, wantBall || wantNeighbour, let job = ball {
        let began = Date()
        grey = autoreleasepool { job.detector.thumbnail(picture(pixels, job), width: BallMotion.thumbWidth) }
        stages.prep += Date().timeIntervalSince(began) * 1000
      }
      if pending != nil && (wantBall || wantNeighbour) { try settle(after: wantNeighbour ? grey?.pixels : nil) }

      let together = wantPeople && wantBall && sideBySide
      if wantBall {
        let slot = Slot<[FocusBox]>()
        var group: DispatchGroup?
        if together, let detector = peopleDetector {
          let g = DispatchGroup()
          side.async(group: g) {
            let t0 = Date()
            slot.value = detector.detect(pixels, orientation: video.orientation)
            slot.ms = Date().timeIntervalSince(t0) * 1000
          }
          group = g
        }
        // "before" is the picture about 100 ms earlier, when there is one
        let before = lastGrey.flatMap { t - $0.tMs <= BallFraming.stepMs * 1.5 ? $0.pixels : nil }
        pending = Pending(t: t, buffer: buffer, found: Found(), grey: grey, before: before, wantPeople: together,
                          group: group, slot: slot)
        if !gated { try settle(after: nil) }
      }
      if let g = grey { lastGrey = (g.pixels, t) }
      if wantPeople && !together, let detector = peopleDetector {
        let t0 = Date()
        let boxes = detector.detect(pixels, orientation: video.orientation)
        stages.people += Date().timeIntervalSince(t0) * 1000
        if let b = boxes {
          peopleFound += 1
          try each(Found(people: FocusSample(tMs: t, boxes: b)))
        } else {
          peopleFailed += 1
        }
      }
    }
    // the last ball frame had no picture after it
    if pending != nil { try settle(after: nil) }
    if reader.status == .failed { throw Failure.unreadable }
    // A few lost frames are covered by the grid; many mean Vision could not run (app in the background).
    if peopleFailed * 10 > peopleFound + peopleFailed { throw Failure.interrupted }
  }

  static func readJSON(_ path: String) -> Any? {
    guard !path.isEmpty, let data = FileManager.default.contents(atPath: path) else { return nil }
    return try? JSONSerialization.jsonObject(with: data)
  }

  static func writeJSON(_ obj: Any, to path: String) {
    guard !path.isEmpty, let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
    try? data.write(to: URL(fileURLWithPath: path), options: .atomic) // never a half-written file to read
  }
}
