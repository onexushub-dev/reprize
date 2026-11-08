import AVFoundation
import CoreImage
import CoreMotion
import Vision

/// Samples camera frames at ~4 fps and fires `onGesture` when a player waves both hands above the head (the hold rule is
/// off: see GesturePipeline).
/// Frame orientation follows the phone's physical position (accelerometer), not the UI, which is portrait-locked.
///
/// The vision work is in GesturePipeline: far from the phone a player is only ~60-100 px tall, so people are looked for
/// in tiles of the frame as well as in the whole of it, kept between samples, and pose runs on an enlarged crop of each.
final class GestureDetector {
  static let sampleInterval = 0.25
  static let maxPeople = 4
  /// Waving is quick: while somebody has their hands up, sample twice as fast for a couple of seconds.
  static let armedSampleInterval = 0.125
  static let armedSeconds = 2.0
  /// When the phone is hot (720p30 mode), sample less and look at fewer people.
  static let hotSampleInterval = 0.5
  /// While somebody has the arms up the rate stays at 8/s even when hot: the wave needs ~5 reads in 1.6 s, and at 4/s it
  /// fired in 60% of the tries instead of 99% (simulation, 2026-11-02). It only lasts while someone has the arms up.
  static let hotArmedSampleInterval = 0.125
  static let hotMaxPeople = 2
  /// Gravity (g) along x or y needed to tell how the phone is held; flatter than this keeps the last position.
  static let leanThreshold = 0.15

  var onGesture: (() -> Void)?
  /// Diagnostic: about once a second, what the detector saw (Etapa 0 spike only).
  var onDebug: (([String: Any]) -> Void)?
  /// Gesture test (spike screen): every sample, each person looked at, with size, estimated distance and pose.
  /// Only while `traceEnabled`.
  var onTrace: (([String: Any]) -> Void)?
  /// The camera's horizontal field of view (degrees, at zoom factor 1) and current zoom factor, to turn a person's
  /// height in pixels into an estimated distance.
  var optics: (() -> (hfovDegrees: Double, zoomFactor: Double)?)?
  /// Assumed height of a player for the distance estimate, and shoulder width (between the shoulder joints).
  static let personHeightM = 1.75
  /// Vision's shoulder joints sit inside the shoulders, and closer still with the arms up: ~0.31 m on the 2026-10-27 test.
  static let shoulderWidthM = 0.31

  private let queue = DispatchQueue(label: "replay.gesture", qos: .userInitiated)
  private let motion = CMMotionManager()
  private let pipeline = GesturePipeline()
  private let lock = NSLock()
  private var _enabled = true
  private var _degraded = false
  private var _traceEnabled = false
  private var _armedUntil = -Double.infinity
  private var busy = false
  private var lastSample = -Double.infinity
  /// Until the first reading: the app is portrait-locked, so a phone nobody has tilted is most likely held upright.
  private var upright: DeviceUpright = .portrait
  private var samples = 0
  private var lastDebug = -Double.infinity

  var enabled: Bool {
    get { lock.withLock { _enabled } }
    set { lock.withLock { _enabled = newValue } }
  }

  var degraded: Bool {
    get { lock.withLock { _degraded } }
    set { lock.withLock { _degraded = newValue } }
  }

  var traceEnabled: Bool {
    get { lock.withLock { _traceEnabled } }
    set { lock.withLock { _traceEnabled = newValue } }
  }

  func start() {
    motion.accelerometerUpdateInterval = Self.sampleInterval
    motion.startAccelerometerUpdates()
  }

  func stop() {
    motion.stopAccelerometerUpdates()
    queue.async { self.pipeline.reset() }
  }

  /// The phone's physical position from the latest accelerometer reading; the last known one while it lies flat.
  func currentUpright() -> DeviceUpright {
    lock.withLock {
      // A phone aimed down at a table has most of gravity along the lens: lean on the stronger of x and y (0.15 g).
      if let g = motion.accelerometerData?.acceleration,
         let now = DeviceUpright.from(gravityX: g.x, gravityY: g.y, threshold: Self.leanThreshold)
      {
        upright = now
      }
      return upright
    }
  }

  /// Call from the capture queue with every video frame; most are skipped.
  func consider(_ buffer: CMSampleBuffer) {
    let t = CMSampleBufferGetPresentationTimeStamp(buffer).seconds
    let take: Bool = lock.withLock {
      // The gesture test (spike) samples fast all the time: lower waves and claps never arm the fast rate.
      let armed = t < _armedUntil || _traceEnabled
      let interval = _degraded ? (armed ? Self.hotArmedSampleInterval : Self.hotSampleInterval)
                               : (armed ? Self.armedSampleInterval : Self.sampleInterval)
      guard _enabled, !busy, t - lastSample >= interval else { return false }
      busy = true
      lastSample = t
      return true
    }
    guard take, let pixels = CMSampleBufferGetImageBuffer(buffer) else {
      if take { lock.withLock { busy = false } }
      return
    }
    let upright = currentUpright()
    let image = CIImage(cvPixelBuffer: pixels).oriented(Self.orientation(for: upright))
    let hot = degraded
    let trace = traceEnabled
    let lens = trace ? optics?() : nil
    let maxPeople = hot ? Self.hotMaxPeople : Self.maxPeople
    queue.async {
      defer { self.lock.withLock { self.busy = false } }
      let result = self.pipeline.process(image, at: t, maxPeople: maxPeople,
                                         options: hot ? GesturePipeline.Options.hot : GesturePipeline.Options.standard)
      if result.raised { self.lock.withLock { self._armedUntil = t + Self.armedSeconds } }
      if result.fired { self.onGesture?() }
      if trace {
        self.onTrace?(Self.traceInfo(result, at: t, frame: image.extent.size, upright: upright, lens: lens, hot: hot))
      }
      self.samples += 1
      if t - self.lastDebug >= 1 {
        self.lastDebug = t
        self.onDebug?(Self.debugInfo(result, samples: self.samples))
        self.samples = 0
      }
    }
  }

  private static func debugInfo(_ result: GesturePipeline.Result, samples: Int) -> [String: Any] {
    var info: [String: Any] = ["people": result.people, "posed": result.sightings.count, "fromTiles": result.fromTiles,
                               "smallestPx": Int(result.smallestPosedPx), "isX": result.isUp, "raised": result.raised,
                               "waved": result.waved, "orientation": 0, "samples": samples]
    guard let p = result.sightings.first.map({ $0.pose }) else { return info }
    let points: [(String, Point?)] = [("lw", p.leftWrist), ("rw", p.rightWrist), ("le", p.leftElbow),
                                      ("re", p.rightElbow), ("ls", p.leftShoulder), ("rs", p.rightShoulder),
                                      ("nose", p.nose)]
    info["missing"] = points.filter { $0.1 == nil }.map(\.0).joined(separator: ",")
    info["minConf"] = points.compactMap { $0.1?.confidence }.min() ?? 0
    if let lw = p.leftWrist, let rw = p.rightWrist, let nose = p.nose, let ls = p.leftShoulder, let rs = p.rightShoulder {
      let width = abs(ls.x - rs.x)
      if width > 0 {
        // How far the lower wrist is above the nose, in shoulder widths (needs > ArmsUp.minWristRise).
        info["wristGap"] = ((nose.y - max(lw.y, rw.y)) / width * 100).rounded() / 100
      }
    }
    if let le = p.leftElbow, let re = p.rightElbow, let ls = p.leftShoulder, let rs = p.rightShoulder {
      info["elbowsUp"] = le.y < ls.y && re.y < rs.y
    }
    return info
  }

  /// One sample for the gesture test. Distances assume a 1.75 m player (from the box height) and 0.31 m between the
  /// shoulder joints (from the pose); the box includes raised arms when they are seen, which makes the person look
  /// taller (closer), so the shoulder estimate is the better one when the shoulders are read.
  private static func traceInfo(_ r: GesturePipeline.Result, at t: Double, frame: CGSize, upright: DeviceUpright,
                                lens: (hfovDegrees: Double, zoomFactor: Double)?, hot: Bool) -> [String: Any] {
    func r2(_ v: Double) -> Double { (v * 100).rounded() / 100 }
    func r4(_ v: Double) -> Double { (v * 10000).rounded() / 10000 }
    // Focal length in pixels along the frame's long side (the sensor's horizontal field of view).
    var focal: Double?
    if let lens = lens, lens.hfovDegrees > 0, lens.zoomFactor > 0 {
      let half = atan(tan(lens.hfovDegrees * .pi / 360) / lens.zoomFactor)
      focal = Double(max(frame.width, frame.height)) / 2 / tan(half)
    }
    var info: [String: Any] = [
      "t": r2(t), "ms": Int(r.elapsedMs.rounded()), "frame": [Int(frame.width), Int(frame.height)],
      "upright": "\(upright)", "hot": hot, "tracked": r.people, "isUp": r.isUp, "raised": r.raised,
      "thermal": (ThermalLevel(rawValue: ProcessInfo.processInfo.thermalState.rawValue) ?? .nominal).name,
    ]
    if let lens = lens { info["hfov"] = r2(lens.hfovDegrees); info["zoomFactor"] = r2(lens.zoomFactor) }
    if let focal = focal { info["focalPx"] = Int(focal.rounded()) }
    let rule: String? = r.held ? "hold" : (r.waved ? "wave" : nil)
    if let rule = rule {
      // A rule that fired again on the same gesture is held back by FireGate: reported apart, it saves no clip.
      info[r.fired ? "fired" : "suppressed"] = rule
    }
    info["persons"] = r.traces.map { p -> [String: Any] in
      var person: [String: Any] = [
        "id": p.id, "src": p.source.rawValue, "px": Int(p.px.rounded()),
        "box": [r4(Double(p.box.minX)), r4(Double(p.box.minY)), r4(Double(p.box.width)), r4(Double(p.box.height))],
      ]
      if let focal = focal, p.px > 0, p.source != .wholeFrame { person["estM"] = r2(personHeightM * focal / p.px) }
      guard let pose = p.pose else {
        person["pose"] = false
        return person
      }
      person["pose"] = true
      let joints: [(String, Point?)] = [("lw", pose.leftWrist), ("rw", pose.rightWrist), ("le", pose.leftElbow),
                                        ("re", pose.rightElbow), ("ls", pose.leftShoulder), ("rs", pose.rightShoulder),
                                        ("nose", pose.nose), ("leye", pose.leftEye), ("reye", pose.rightEye),
                                        ("lear", pose.leftEar), ("rear", pose.rightEar), ("lh", pose.leftHip),
                                        ("rh", pose.rightHip)]
      var conf: [String: Double] = [:]
      for (name, point) in joints { conf[name] = point.map { r2($0.confidence) } ?? -1 }
      person["conf"] = conf
      // Every joint as [x, y] in the pixels of the image the pose was read in (y down): other gestures (a lower wave,
      // claps) can be checked later against the shoulders of the same sample.
      var at: [String: [Double]] = [:]
      for (name, point) in joints {
        if let point = point { at[name] = [(point.x * 10).rounded() / 10, (point.y * 10).rounded() / 10] }
      }
      person["j"] = at
      person["up"] = ArmsUp.isUp(pose)
      person["raised"] = WaveTracker.armsRaised(pose)
      // Which way the person faces (Facing, 2026-11-07): only a person facing the camera can wave.
      person["facing"] = Facing.towardCamera(pose)
      person["face"] = Facing.faceSeen(pose)
      if let open = Facing.openness(pose) { person[open.toTorso ? "openTorso" : "openHead"] = r2(open.value) }
      if let head = ArmsUp.headLine(pose) {
        person["swPx"] = r2(head.shoulderWidth)
        if let focal = focal, head.shoulderWidth > 0 { person["estSwM"] = r2(shoulderWidthM * focal / head.shoulderWidth) }
        if let lw = pose.leftWrist, let rw = pose.rightWrist {
          // How far each wrist is above the head line, in shoulder widths (ArmsUp needs both > 0.35).
          person["riseL"] = r2((head.y - lw.y) / head.shoulderWidth)
          person["riseR"] = r2((head.y - rw.y) / head.shoulderWidth)
          if let ls = pose.leftShoulder, let rs = pose.rightShoulder {
            let mid = (ls.x + rs.x) / 2
            // Sideways wrist position in shoulder widths (the wave looks at how this swings).
            person["xL"] = r2((lw.x - mid) / head.shoulderWidth)
            person["xR"] = r2((rw.x - mid) / head.shoulderWidth)
          }
        }
        if let le = pose.leftElbow, let re = pose.rightElbow, let ls = pose.leftShoulder, let rs = pose.rightShoulder {
          person["elbowsUp"] = le.y < ls.y && re.y < rs.y
        }
      }
      return person
    }
    return info
  }

  /// Back-camera buffers are natively upright with the home button on the right (landscapeLeft).
  static func orientation(for upright: DeviceUpright) -> CGImagePropertyOrientation {
    switch upright {
    case .landscapeLeft: return .up
    case .landscapeRight: return .down
    case .portraitUpsideDown: return .left
    case .portrait: return .right
    }
  }
}
