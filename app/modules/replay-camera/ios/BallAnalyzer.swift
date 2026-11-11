import AVFoundation
import CoreImage
import CoreML

/// Seguir a Bola analysis (spec 2026-11-09 §4.3–4.6): the sport's detector (`BallSport`: basketball `ball_tiny_gym`,
/// beach tennis `ball_tiny_btpl`, YOLOX-Tiny 416) on the cut at 5 fps — the whole frame and every 416 px tile, all of a frame's regions in ONE Core ML call (test 42) —
/// then `BallFraming` (path, trusted points, zoom, camera C) into `<clip>.ball.json`, the Modo Foco file's format with
/// the 9:16 track under "portrait". The detections are kept in `<clip>.balldet.json`, so a changed cut, a cancel or a
/// stop for heat continues from what was found. One analysis at a time; it is the user waiting, so `.userInitiated`.
///
/// Heat (Victor, 2026-11-09, after the iPhone XR run): an analysis waits to start while the phone is `serious` or worse,
/// always finishes once started, and stops at `critical` (keeping the detections). Victor, 2026-11-11: a short cut (up
/// to `shortCutMs`, about 4 s of work on a 16 Pro Max) starts even at `serious`; it waits only at `critical`.
enum BallAnalyzer {
  /// Cuts up to this long start while the phone is `serious` (only `critical` makes them wait).
  static let shortCutMs = 15_000.0

  struct Outcome {
    let ready: Bool
    /// Analysed frames in the cut: found now, and taken from the cache.
    let analysed: Int
    let reused: Int
    let ballFrames: Int
    let trustedFrames: Int
    /// Share of the cut's 100 ms frames with a trusted ball (the "Bola pouco visível" note under 0.35).
    let ballShare: Double
    let zoom: Double
    let elapsedMs: Double
    /// Test 47a: why the mode is not worth applying to this cut (`BallVerdictReason`), "" = apply.
    let verdict: String
  }

  /// `interrupted`: Core ML or the reader kept failing (the app went to the background); `hot`: stopped at `critical`.
  enum Failure: Error { case noVideo, unreadable, noModel, cancelled, interrupted, hot }

  /// Progress for the chip on the video: `state` "cooling" (waiting for the phone to cool), "running", "framing".
  nonisolated(unsafe) static var emit: ((_ clipPath: String, _ done: Int, _ total: Int, _ state: String) -> Void)?

  static let modelSide = 416
  static let tileSide = 416
  static let conf: Float = 0.05
  private static let work = DispatchQueue(label: "reprize.ball", qos: .userInitiated)
  private static let lock = NSLock()
  nonisolated(unsafe) private static var cancelled = Set<String>() // guarded by `lock`
  nonisolated(unsafe) private static var detector: Detector? // used on `work` only; one sport's model at a time

  static func cancel(clipPath: String) {
    lock.lock(); cancelled.insert(clipPath); lock.unlock()
  }

  private static func isCancelled(_ clipPath: String) -> Bool {
    lock.lock(); defer { lock.unlock() }
    return cancelled.contains(clipPath)
  }

  private static func clearCancel(_ clipPath: String) {
    lock.lock(); cancelled.remove(clipPath); lock.unlock()
  }

  /// `detPath`: the detections cache; `outPath`: the framing file; `focusPath`: today's Modo Foco file for the same cut
  /// (its framing is the camera's fallback and gives today's zoom; a centred crop if it is missing).
  static func analyze(clipPath: String, startMs: Double, endMs: Double, detPath: String, outPath: String,
                      focusPath: String, sport: BallSport = .basketball) async throws -> Outcome {
    let asset = AVURLAsset(url: URL(fileURLWithPath: clipPath))
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw Failure.noVideo }
    let transform = try await track.load(.preferredTransform)
    let natural = try await track.load(.naturalSize)
    let duration = try await asset.load(.duration).seconds * 1000
    return try await withCheckedThrowingContinuation { (done: CheckedContinuation<Outcome, Error>) in
      work.async {
        defer { clearCancel(clipPath) }
        do {
          done.resume(returning: try run(asset: asset, track: track, transform: transform, natural: natural,
                                         clipPath: clipPath, startMs: startMs,
                                         endMs: endMs > startMs ? min(endMs, duration) : duration,
                                         detPath: detPath, outPath: outPath, focusPath: focusPath, sport: sport))
        } catch {
          done.resume(throwing: error)
        }
      }
    }
  }

  private static func run(asset: AVAsset, track: AVAssetTrack, transform: CGAffineTransform, natural: CGSize,
                          clipPath: String, startMs: Double, endMs: Double, detPath: String, outPath: String,
                          focusPath: String, sport: BallSport) throws -> Outcome {
    let started = Date()
    let orientation = FocusAnalyzer.orientation(of: transform)
    let turned = orientation == .left || orientation == .right
    let W = Int((turned ? natural.height : natural.width).rounded())
    let H = Int((turned ? natural.width : natural.height).rounded())

    // Test 47a, before any frame is analysed: players too small for the 9:16 output = recorded too far, nothing to run.
    let players = playersHeight(focusPath: focusPath)
    if let early = BallVerdicts.before(playersHeight: players, width: Double(W), height: Double(H), sport: sport) {
      return Outcome(ready: true, analysed: 0, reused: 0, ballFrames: 0, trustedFrames: 0, ballShare: 0, zoom: 1,
                     elapsedMs: Date().timeIntervalSince(started) * 1000, verdict: early.rawValue)
    }

    let cache = readJSON(detPath)
    var dets = BallFraming.detections(fromJSON: cache, width: W, height: H, model: sport.modelId)
    // Test 47b: video screens, from this run's thumbnails or kept from an earlier run of the same model
    var screens = dets.isEmpty ? [] : BallFraming.screens(fromJSON: cache)
    let phase = BallFraming.phase(startMs: startMs, endMs: endMs, cached: dets)
    let missing = BallFraming.missingTicks(startMs: startMs, endMs: endMs, phase: phase, cached: dets)
    let total = (BallFraming.rows(startMs: startMs, endMs: endMs) - phase + BallFraming.step - 1) / BallFraming.step
    let reused = total - missing.count

    if !missing.isEmpty {
      try waitUntilCool(clipPath: clipPath, done: reused, total: total, short: endMs - startMs <= shortCutMs)
      if detector == nil || detector?.modelId != sport.modelId { detector = try Detector(modelId: sport.modelId) }
      guard let det = detector else { throw Failure.noModel }
      var found: [BallFraming.Detection] = []
      var thumbs: [[UInt8]] = []
      var thumbSize = (width: 0, height: 0)
      defer {
        // whatever happened, keep what was found
        if !found.isEmpty {
          writeJSON(BallFraming.detectionsJSON(dets + found, width: W, height: H, model: sport.modelId,
                                               screens: screens), to: detPath)
        }
      }
      let reader = try AVAssetReader(asset: asset)
      let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
      ])
      output.alwaysCopiesSampleData = false
      reader.add(output)
      let from = max(0, missing[0] - 50), to = missing[missing.count - 1] + BallFraming.stepMs + 50
      reader.timeRange = CMTimeRange(start: CMTime(seconds: from / 1000, preferredTimescale: 600),
                                     end: CMTime(seconds: to / 1000, preferredTimescale: 600))
      guard reader.startReading() else { throw Failure.unreadable }
      let regions = BallDetect.regions(width: W, height: H, side: modelSide, tile: tileSide)
      var next = 0 // index in `missing`
      var failures = 0
      emit?(clipPath, reused, total, "running")
      while next < missing.count, let buffer = output.copyNextSampleBuffer() {
        if isCancelled(clipPath) { reader.cancelReading(); throw Failure.cancelled }
        let t = CMSampleBufferGetPresentationTimeStamp(buffer).seconds * 1000
        // ticks with no picture in their 100 ms are passed over (the path reads them as not analysed)
        while next < missing.count && t >= missing[next] + BallFraming.stepMs - 0.5 { next += 1 }
        guard next < missing.count, t >= missing[next] - 0.5, let pixels = CMSampleBufferGetImageBuffer(buffer) else {
          continue
        }
        next += 1
        if ProcessInfo.processInfo.thermalState == .critical { reader.cancelReading(); throw Failure.hot }
        let boxes: [BallDetect.Box]? = autoreleasepool {
          var image = CIImage(cvPixelBuffer: pixels).oriented(orientation)
          image = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
          if sport.screens {
            let t = det.thumbnail(image)
            thumbs.append(t.pixels)
            thumbSize = (t.width, t.height)
          }
          return try? det.detect(image, regions: regions)
        }
        guard let b = boxes else {
          failures += 1
          if failures >= 5 && failures * 10 > found.count + failures { reader.cancelReading(); throw Failure.interrupted }
          continue
        }
        found.append(BallFraming.Detection(tMs: t, candidates: BallDetect.frameCandidates(b, width: W, height: H)))
        if found.count % 5 == 0 { emit?(clipPath, reused + found.count, total, "running") }
        if found.count % 25 == 0 {
          writeJSON(BallFraming.detectionsJSON(dets + found, width: W, height: H, model: sport.modelId,
                                               screens: screens), to: detPath)
        }
      }
      if reader.status == .failed { throw Failure.unreadable }
      // most of the cut seen in this run: its screens replace the kept ones (the defer above writes them)
      if sport.screens && thumbs.count >= 10 && thumbs.count * 2 >= total {
        screens = BallScreen.boxes(frames: thumbs, width: thumbSize.width, height: thumbSize.height)
      }
      dets += found
    }

    emit?(clipPath, total, total, "framing")
    let grid = BallFraming.grid(startMs: startMs, endMs: endMs, phase: phase, detections: dets)
    let today = todayRows(focusPath: focusPath, startMs: startMs, count: grid.count, landscape: W >= H)
    // the players (test 49, sports with `follow`) and the shirt rule of the path (test 50) read today's person boxes
    let people = sport.follow == nil && sport.path.personRatio <= 0
      ? [] : peopleRows(focusPath: focusPath, startMs: startMs, count: grid.count)
    let r = BallFraming.compute(grid: grid, width: Double(W), height: Double(H), today: today.portrait,
                                native: today.native, sport: sport, screens: screens, players: players, people: people)
    if r.rects.isEmpty { throw Failure.unreadable }
    var file = BallFraming.framingJSON(r, startMs: startMs, width: Double(W), height: Double(H), rules: sport.rules)
    file["endMs"] = endMs
    try JSONSerialization.data(withJSONObject: file).write(to: URL(fileURLWithPath: outPath), options: .atomic)
    return Outcome(ready: true, analysed: grid.filter { $0 != nil }.count, reused: reused, ballFrames: r.ballFrames,
                   trustedFrames: r.trustedFrames, ballShare: r.zoom.share, zoom: r.zoom.zoom,
                   elapsedMs: Date().timeIntervalSince(started) * 1000,
                   verdict: r.verdict?.reason?.rawValue ?? "")
  }

  /// The players' median height (share of the frame height) that today's Modo Foco analysis kept, if any.
  private static func playersHeight(focusPath: String) -> Double? {
    guard let f = readJSON(focusPath) as? [String: Any] else { return nil }
    return (f["playersHeight"] as? NSNumber)?.doubleValue
  }

  /// Today's person boxes for the cut's rows (test 49), none when the Modo Foco file has none (made before it).
  private static func peopleRows(focusPath: String, startMs: Double, count n: Int) -> [[[Double]]] {
    guard let f = readJSON(focusPath) as? [String: Any], (f["v"] as? NSNumber)?.intValue == 1,
          let fStart = (f["startMs"] as? NSNumber)?.doubleValue,
          let rows = f["people"] as? [[[NSNumber]]] else { return [] }
    let off = Int(((startMs - fStart) / BallFraming.stepMs).rounded())
    guard off >= 0, off < rows.count else { return [] }
    return rows[off..<min(rows.count, off + n)].map { row in
      row.filter { $0.count == 4 }.map { $0.map { $0.doubleValue } }
    }
  }

  /// Waits (cancellable) while the phone is `serious` or worse (`critical` for a short cut), with the card showing
  /// "Aguardando".
  private static func waitUntilCool(clipPath: String, done: Int, total: Int, short: Bool) throws {
    var told = false
    let limit = short ? ProcessInfo.ThermalState.critical : ProcessInfo.ThermalState.serious
    while ProcessInfo.processInfo.thermalState.rawValue >= limit.rawValue {
      if isCancelled(clipPath) { throw Failure.cancelled }
      if !told { emit?(clipPath, done, total, "cooling"); told = true }
      Thread.sleep(forTimeInterval: 2)
    }
  }

  /// Today's Modo Foco rows for the cut: portrait (the camera's fallback) and the video's own orientation (today's zoom).
  private static func todayRows(focusPath: String, startMs: Double, count n: Int,
                                landscape: Bool) -> (portrait: [[Double]], native: [[Double]]) {
    guard let f = readJSON(focusPath) as? [String: Any], (f["v"] as? NSNumber)?.intValue == 1,
          let fStart = (f["startMs"] as? NSNumber)?.doubleValue,
          let portrait = (f["portrait"] as? [[NSNumber]])?.map({ $0.map { $0.doubleValue } }) else { return ([], []) }
    let native = (f[landscape ? "landscape" : "portrait"] as? [[NSNumber]])?.map { $0.map { $0.doubleValue } } ?? []
    let off = Int(((startMs - fStart) / BallFraming.stepMs).rounded())
    func slice(_ rows: [[Double]]) -> [[Double]] {
      guard off >= 0, off < rows.count else { return rows }
      return Array(rows[off..<min(rows.count, off + n)])
    }
    return (slice(portrait), slice(native))
  }

  private static func readJSON(_ path: String) -> Any? {
    guard !path.isEmpty, let data = FileManager.default.contents(atPath: path) else { return nil }
    return try? JSONSerialization.jsonObject(with: data)
  }

  private static func writeJSON(_ obj: Any, to path: String) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
    try? data.write(to: URL(fileURLWithPath: path), options: .atomic)
  }

  /// First use (spec §4.7): one 19-region frame through the model, timed. Milliseconds for that frame (the median of 3
  /// after a warm-up); the JS side decides from it whether to show the option.
  static func probe() async throws -> Double {
    try await withCheckedThrowingContinuation { (done: CheckedContinuation<Double, Error>) in
      work.async {
        do {
          if detector == nil { detector = try Detector(modelId: BallFraming.modelId) }
          guard let det = detector else { throw Failure.noModel }
          let image = CIImage(color: CIColor(red: 0.4, green: 0.45, blue: 0.5)).cropped(to: CGRect(x: 0, y: 0, width: 1920,
                                                                                                    height: 1080))
          let regions = BallDetect.regions(width: 1920, height: 1080, side: modelSide, tile: tileSide)
          _ = try det.detect(image, regions: regions)
          var ms: [Double] = []
          for _ in 0..<3 {
            let t0 = Date()
            _ = try det.detect(image, regions: regions)
            ms.append(Date().timeIntervalSince(t0) * 1000)
          }
          done.resume(returning: ms.sorted()[1])
        } catch {
          done.resume(throwing: error)
        }
      }
    }
  }

  /// The Core ML side, as FocusBench's `BallDetector` (tests 34, 42): regions rendered into 416 BGRA squares (grey 114
  /// where the picture does not reach), one batched prediction, every candidate decoded.
  final class Detector {
    let modelId: String
    let model: MLModel
    let context = CIContext(options: [.cacheIntermediates: false])
    let anchors = BallDetect.anchors(side: BallAnalyzer.modelSide)
    private var pool: CVPixelBufferPool?

    init(modelId: String) throws {
      self.modelId = modelId
      guard let url = try Detector.modelURL(modelId) else { throw Failure.noModel }
      let config = MLModelConfiguration()
      config.computeUnits = .cpuAndNeuralEngine
      model = try MLModel(contentsOf: url, configuration: config)
      let s = BallAnalyzer.modelSide
      let attrs: [String: Any] = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: s, kCVPixelBufferHeightKey as String: s,
        kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any],
      ]
      CVPixelBufferPoolCreate(nil, nil, attrs as CFDictionary, &pool)
    }

    /// The compiled model in the pod's resource bundle (`ios/Models/<name>.mlmodelc`, e.g. ball_tiny_gym).
    static func modelURL(_ name: String) throws -> URL? {
      var bundles = [Bundle.main, Bundle(for: Detector.self)]
      for b in bundles {
        if let u = b.url(forResource: "ReplayCameraModels", withExtension: "bundle"), let inner = Bundle(url: u) {
          bundles.append(inner)
        }
      }
      for b in bundles {
        if let u = b.url(forResource: name, withExtension: "mlmodelc") { return u }
      }
      return nil
    }

    /// Test 47b: a grey thumbnail `BallScreen.thumbWidth` px wide of an upright frame (origin 0, 0), top row first, the
    /// mean of red, green and blue (as the lab's).
    func thumbnail(_ image: CIImage) -> (pixels: [UInt8], width: Int, height: Int) {
      let W = image.extent.width, H = image.extent.height
      let tw = BallScreen.thumbWidth
      let th = max(1, Int((CGFloat(tw) * H / max(1, W)).rounded(.down)))
      let small = image.transformed(by: CGAffineTransform(scaleX: CGFloat(tw) / max(1, W), y: CGFloat(th) / max(1, H)))
      var rgba = [UInt8](repeating: 0, count: tw * th * 4)
      context.render(small, toBitmap: &rgba, rowBytes: tw * 4, bounds: CGRect(x: 0, y: 0, width: tw, height: th),
                     format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
      var grey = [UInt8](repeating: 0, count: tw * th)
      for i in 0..<(tw * th) {
        grey[i] = UInt8((Int(rgba[4 * i]) + Int(rgba[4 * i + 1]) + Int(rgba[4 * i + 2])) / 3)
      }
      return (grey, tw, th)
    }

    /// One upright frame (origin 0, 0): all `regions` in one call; the candidates in frame px, before NMS.
    func detect(_ image: CIImage, regions: [BallDetect.Region]) throws -> [BallDetect.Box] {
      let W = image.extent.width, H = image.extent.height
      let S = CGFloat(BallAnalyzer.modelSide)
      let grey = CIImage(color: CIColor(red: 114 / 255, green: 114 / 255, blue: 114 / 255))
        .cropped(to: CGRect(x: 0, y: 0, width: S, height: S))
      var inputs: [MLFeatureProvider] = []
      for (i, region) in regions.enumerated() {
        let input: CIImage
        if i == 0 {
          // the whole frame, letterboxed into the top-left corner
          let r = CGFloat(region.scale)
          let scaled = image.transformed(by: CGAffineTransform(scaleX: r, y: r))
          input = scaled.transformed(by: CGAffineTransform(translationX: 0, y: S - scaled.extent.height))
            .composited(over: grey)
        } else {
          let tile = CGFloat(BallAnalyzer.tileSide)
          let tw = min(tile, W), th = min(tile, H)
          let rect = CGRect(x: CGFloat(region.x0), y: H - CGFloat(region.y0) - th, width: tw, height: th) // CI: bottom-left
          var crop = image.cropped(to: rect).transformed(by: CGAffineTransform(translationX: -rect.minX, y: -rect.minY))
          let ts = CGFloat(region.scale)
          if ts != 1 { crop = crop.transformed(by: CGAffineTransform(scaleX: ts, y: ts)) }
          crop = crop.transformed(by: CGAffineTransform(translationX: 0, y: S - crop.extent.height))
          input = ts == 1 && tw == tile && th == tile ? crop : crop.composited(over: grey)
        }
        var out: CVPixelBuffer?
        if let pool = pool { CVPixelBufferPoolCreatePixelBuffer(nil, pool, &out) }
        guard let buffer = out else { throw Failure.interrupted }
        context.render(input, to: buffer)
        inputs.append(try MLDictionaryFeatureProvider(dictionary: ["image": MLFeatureValue(pixelBuffer: buffer)]))
      }
      let batch = try model.predictions(fromBatch: MLArrayBatchProvider(array: inputs))
      var boxes: [BallDetect.Box] = []
      for i in 0..<batch.count {
        guard let a = batch.features(at: i).featureValue(for: "output")?.multiArrayValue else { throw Failure.interrupted }
        boxes += decode(a, region: regions[i])
      }
      return boxes
    }

    private func decode(_ a: MLMultiArray, region: BallDetect.Region) -> [BallDetect.Box] {
      let rows = a.shape[1].intValue
      let rs = a.strides[1].intValue, cs = a.strides[2].intValue
      let cls = a.shape[2].intValue == 85 ? 32 : 0 // COCO models: "sports ball"; ours: one class
      #if arch(arm64)
      if a.dataType == .float16 {
        let p = a.dataPointer.assumingMemoryBound(to: Float16.self)
        return BallDetect.decode(rows: rows, cls: cls, anchors: anchors, region: region, conf: BallAnalyzer.conf) {
          Float(p[$0 * rs + $1 * cs])
        }
      }
      #endif
      if a.dataType != .float32 {
        return BallDetect.decode(rows: rows, cls: cls, anchors: anchors, region: region, conf: BallAnalyzer.conf) {
          a[$0 * rs + $1 * cs].floatValue
        }
      }
      let p = a.dataPointer.assumingMemoryBound(to: Float.self)
      return BallDetect.decode(rows: rows, cls: cls, anchors: anchors, region: region, conf: BallAnalyzer.conf) {
        p[$0 * rs + $1 * cs]
      }
    }
  }
}
