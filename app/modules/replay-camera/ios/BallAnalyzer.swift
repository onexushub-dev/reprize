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
    /// The Jogadores file made in the same pass: "ready", "none" (too few people), or "" when it was not made here.
    let focus: String
    let stages: ClipScan.Stages
    /// How much the 9:16 camera moves (`FramingMotion`).
    let panP95: Double
    let turnsPer10s: Double
  }

  /// `interrupted`: Core ML or the reader kept failing (the app went to the background); `hot`: stopped at `critical`.
  typealias Failure = ClipScan.Failure

  /// Progress for the chip on the video: `state` "cooling" (waiting for the phone to cool), "running", "framing".
  nonisolated(unsafe) static var emit: ((_ clipPath: String, _ done: Int, _ total: Int, _ state: String) -> Void)?

  static let modelSide = 416
  static let tileSide = 416
  static let conf: Float = 0.05
  private static let work = ClipScan.work
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

  /// What the same pass does for Jogadores when its file is missing or has no person boxes (plan 2026-11-12, I1): the
  /// people of `startMs`..<`endMs` (the range Jogadores itself analyses), one picture every `everyMs`, kept in
  /// `peoplePath`. `endMs` at or before `startMs` = Bola never makes the Jogadores file.
  struct Players {
    var startMs = 0.0, endMs = 0.0, everyMs = 100.0
    var peoplePath = ""
  }

  /// `detPath`: the detections cache; `outPath`: the framing file; `focusPath`: the Jogadores file for the clip (its
  /// framing is the camera's fallback and gives today's zoom; its person boxes feed the sport's rules). When that file
  /// is missing or has no person boxes it is made here, in the same pass over the frames as the ball (`players`).
  /// `sideBySide`: on a frame both want, the people and the ball detectors run at the same time.
  static func analyze(clipPath: String, startMs: Double, endMs: Double, detPath: String, outPath: String,
                      focusPath: String, sport: BallSport = .basketball, maxWidth: Int = 0,
                      players: Players = Players(), sideBySide: Bool = true,
                      motionTiles: Bool = false) async throws -> Outcome {
    let video = try await ClipScan.Video.load(clipPath: clipPath)
    return try await withCheckedThrowingContinuation { (done: CheckedContinuation<Outcome, Error>) in
      ClipScan.work.async {
        defer { clearCancel(clipPath) }
        do {
          done.resume(returning: try run(video: video, clipPath: clipPath, startMs: startMs,
                                         endMs: endMs > startMs ? min(endMs, video.durationMs) : video.durationMs,
                                         detPath: detPath, outPath: outPath, focusPath: focusPath, sport: sport,
                                         maxWidth: maxWidth, players: players, sideBySide: sideBySide,
                                         motionTiles: motionTiles))
        } catch {
          done.resume(throwing: error)
        }
      }
    }
  }

  private static func run(video: ClipScan.Video, clipPath: String, startMs: Double, endMs: Double, detPath: String,
                          outPath: String, focusPath: String, sport: BallSport, maxWidth: Int, players want: Players,
                          sideBySide: Bool, motionTiles: Bool) throws -> Outcome {
    let started = Date()
    let W = video.width, H = video.height
    var stages = ClipScan.Stages()

    // The Jogadores file as it is: with its person boxes it is used as before; without them (or with no file) the
    // people are found in this pass and the file is made from them.
    let hasPeople = (readJSON(focusPath) as? [String: Any]).map { ($0["v"] as? NSNumber)?.intValue == 1 && $0["people"] != nil } ?? false
    let makeFocus = !hasPeople && want.endMs > want.startMs && !focusPath.isEmpty
    // Test 47a, before any frame is analysed: players too small for the 9:16 output = recorded too far, nothing to run.
    // (On a clip with no Jogadores file yet the same verdict comes after the pass, from the people it found.)
    if hasPeople, let early = BallVerdicts.before(playersHeight: playersHeight(focusPath: focusPath), width: Double(W),
                                                  height: Double(H), sport: sport) {
      return Outcome(ready: true, analysed: 0, reused: 0, ballFrames: 0, trustedFrames: 0, ballShare: 0, zoom: 1,
                     elapsedMs: Date().timeIntervalSince(started) * 1000, verdict: early.rawValue, focus: "",
                     stages: stages, panP95: 0, turnsPer10s: 0)
    }

    // A frame wider than `maxWidth` is scaled down before the tiles (4K → 1920: 19 regions instead of 85, the ball at
    // the size the model was trained on; plan 2026-11-12). Detections are kept normalized, so only the tiling and the
    // cache key change. TEMP(lab-4k): 0 = native size, still offered in Diagnóstico.
    let scale = maxWidth > 0 && max(W, H) > maxWidth ? Double(maxWidth) / Double(max(W, H)) : 1.0
    let DW = scale < 1 ? Int((Double(W) * scale / 2).rounded()) * 2 : W
    let DH = scale < 1 ? Int((Double(H) * scale / 2).rounded()) * 2 : H
    // TEMP(lab-motion): motion-gated tiles keep their own detections (the evidence they hold belongs with them)
    let detModel = (scale < 1 ? "\(sport.modelId)@\(maxWidth)" : sport.modelId) + (motionTiles ? "+mt" : "")
    let cache = readJSON(detPath)
    var dets = BallFraming.detections(fromJSON: cache, width: W, height: H, model: detModel)
    // Test 47b: video screens, from this run's thumbnails or kept from an earlier run of the same model
    var screens = dets.isEmpty ? [] : BallFraming.screens(fromJSON: cache)
    let phase = BallFraming.phase(startMs: startMs, endMs: endMs, cached: dets)
    let missing = BallFraming.missingTicks(startMs: startMs, endMs: endMs, phase: phase, cached: dets)
    let total = (BallFraming.rows(startMs: startMs, endMs: endMs) - phase + BallFraming.step - 1) / BallFraming.step
    let reused = total - missing.count

    // Jogadores' side of the pass: the pictures of its range that are not kept yet.
    let peopleEvery = max(FocusAnalyzer.stepMs, want.everyMs)
    let keptPeople = makeFocus
      ? FocusFrames.read(readJSON(want.peoplePath), width: W, height: H) : []
    let peopleTicks = makeFocus
      ? ScanTicks.missing(ticks: ScanTicks.ticks(startMs: want.startMs, endMs: want.endMs, everyMs: peopleEvery),
                          have: keptPeople.map { $0.tMs }, windowMs: peopleEvery) : []
    var foundPeople: [FocusSample] = []

    if !missing.isEmpty || !peopleTicks.isEmpty {
      // the chip counts every picture the pass still has to look at, for the ball or for the players
      let all = total + peopleTicks.count
      try waitUntilCool(clipPath: clipPath, done: reused, total: all, short: endMs - startMs <= shortCutMs)
      if !missing.isEmpty && (detector == nil || detector?.modelId != sport.modelId) {
        detector = try Detector(modelId: sport.modelId)
      }
      var job: ClipScan.BallJob?
      if !missing.isEmpty {
        guard let det = detector else { throw Failure.noModel }
        job = ClipScan.BallJob(ticks: missing, detector: det, width: DW, height: DH, thumbnails: sport.screens,
                               motion: motionTiles)
      }
      var found: [BallFraming.Detection] = []
      var thumbs: [[UInt8]] = []
      var thumbSize = (width: 0, height: 0)
      let keepPeople = {
        ClipScan.writeJSON(FocusFrames.json(FocusFrames.merged(keptPeople, foundPeople), width: W, height: H),
                           to: want.peoplePath)
      }
      defer {
        // whatever happened, keep what was found
        if !found.isEmpty {
          writeJSON(BallFraming.detectionsJSON(dets + found, width: W, height: H, model: detModel,
                                               screens: screens), to: detPath)
        }
        if !foundPeople.isEmpty { keepPeople() }
      }
      emit?(clipPath, reused, all, "running")
      try ClipScan.run(video: video, people: peopleTicks, peopleWindowMs: peopleEvery, ball: job,
                       sideBySide: sideBySide, stages: &stages, cancelled: { isCancelled(clipPath) }) { f in
        if let p = f.people {
          foundPeople.append(p)
          if foundPeople.count % 25 == 0 { keepPeople() }
        }
        if let t = f.thumbnail {
          thumbs.append(t.pixels)
          thumbSize = (t.width, t.height)
        }
        if let d = f.ball {
          found.append(d)
          if found.count % 25 == 0 {
            writeJSON(BallFraming.detectionsJSON(dets + found, width: W, height: H, model: detModel,
                                                 screens: screens), to: detPath)
          }
        }
        let seen = found.count + foundPeople.count
        if seen % 5 == 0 { emit?(clipPath, reused + seen, all, "running") }
      }
      // most of the cut seen in this run: its screens replace the kept ones (the defer above writes them)
      if sport.screens && thumbs.count >= 10 && thumbs.count * 2 >= total {
        screens = BallScreen.boxes(frames: thumbs, width: thumbSize.width, height: thumbSize.height)
      }
      dets += found
    }

    emit?(clipPath, total, total, "framing")
    let framed = Date()
    var focus = ""
    if makeFocus {
      let frames = FocusAnalyzer.inRange(FocusFrames.merged(keptPeople, foundPeople), startMs: want.startMs,
                                         endMs: want.endMs)
      let file = try FocusAnalyzer.write(frames: frames, startMs: want.startMs, endMs: want.endMs, everyMs: peopleEvery,
                                         width: Double(W), height: Double(H), outPath: focusPath, debug: false)
      focus = file.ready ? "ready" : "none"
    }
    let players = playersHeight(focusPath: focusPath)
    let grids = BallFraming.grids(startMs: startMs, endMs: endMs, phase: phase, detections: dets)
    let grid = grids.candidates
    let today = todayRows(focusPath: focusPath, startMs: startMs, count: grid.count, landscape: W >= H)
    // the players (test 49, sports with `follow`) and the shirt rule of the path (test 50) read today's person boxes
    let people = sport.follow == nil && sport.path.personRatio <= 0
      ? [] : peopleRows(focusPath: focusPath, startMs: startMs, count: grid.count)
    let r = BallFraming.compute(grid: grid, width: Double(W), height: Double(H), today: today.portrait,
                                native: today.native, sport: sport, screens: screens, players: players, people: people,
                                stale: motionTiles ? grids.stale : [])
    if r.rects.isEmpty { throw Failure.unreadable }
    var file = BallFraming.framingJSON(r, startMs: startMs, width: Double(W), height: Double(H), rules: sport.rules)
    file["endMs"] = endMs
    try JSONSerialization.data(withJSONObject: file).write(to: URL(fileURLWithPath: outPath), options: .atomic)
    stages.path += Date().timeIntervalSince(framed) * 1000
    let motion = FramingMotion.stats(rects: r.rects, stepMs: BallFraming.stepMs)
    return Outcome(ready: true, analysed: grid.filter { $0 != nil }.count, reused: reused, ballFrames: r.ballFrames,
                   trustedFrames: r.trustedFrames, ballShare: r.zoom.share, zoom: r.zoom.zoom,
                   elapsedMs: Date().timeIntervalSince(started) * 1000,
                   verdict: r.verdict?.reason?.rawValue ?? "", focus: focus, stages: stages, panP95: motion.panP95,
                   turnsPer10s: motion.turnsPer10s)
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

  private static func readJSON(_ path: String) -> Any? { ClipScan.readJSON(path) }

  private static func writeJSON(_ obj: Any, to path: String) { ClipScan.writeJSON(obj, to: path) }

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
    /// Milliseconds the last `detect` spent preparing the regions (Core Image) and in the model (plan I5).
    private(set) var lastPrepMs = 0.0, lastModelMs = 0.0

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
    func thumbnail(_ image: CIImage, width: Int = BallScreen.thumbWidth) -> (pixels: [UInt8], width: Int, height: Int) {
      let W = image.extent.width, H = image.extent.height
      let tw = width
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
      lastPrepMs = 0
      lastModelMs = 0
      let began = Date()
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
      let rendered = Date()
      lastPrepMs = rendered.timeIntervalSince(began) * 1000
      let batch = try model.predictions(fromBatch: MLArrayBatchProvider(array: inputs))
      var boxes: [BallDetect.Box] = []
      for i in 0..<batch.count {
        guard let a = batch.features(at: i).featureValue(for: "output")?.multiArrayValue else { throw Failure.interrupted }
        boxes += decode(a, region: regions[i])
      }
      lastModelMs = Date().timeIntervalSince(rendered) * 1000
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
