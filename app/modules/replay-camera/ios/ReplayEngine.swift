import AVFoundation
import UIKit

/// Ties capture, segment writing, the ring, gesture and thermal handling together.
/// One per app; the preview view reads its session.
///
/// Threading: engine state (writer, generation, pending saves) lives on `capture.queue`.
/// Clip copies run on `saveQueue`, so a save never blocks sample delivery.
final class ReplayEngine {
  static let shared = ReplayEngine()

  /// The rolling window of the current session (60s court, 120s gym).
  private(set) var windowSeconds = 60.0
  /// A save that hasn't seen its segment close by then is failed instead of hanging.
  static let saveTimeout = 5.0

  let capture = CaptureController()
  let gesture = GestureDetector()
  let feedback = ReplayFeedback()
  let voice = VoiceTrigger()
  var emit: ((String, [String: Any]) -> Void)?

  /// `shortSide`: the saved video's resolution (1080 Full HD, 2160 4K).
  typealias SaveResult = Result<(path: String, durationMs: Int, shortSide: Int), Failure>

  private struct PendingSave {
    let id: UUID
    let run: ([ClipSource]) -> Void
    let fail: (Failure) -> Void
  }

  /// Where a save reads from: a ring of segments and the init segment they belong to. `maxSeconds`: how much of it is
  /// still inside the buffer's window (a kept buffer ages out, below).
  struct ClipSource {
    let ring: SegmentRing
    let initSegment: URL
    let width: Int
    let height: Int
    let maxSeconds: Double
  }

  /// Heat (plan 2026-11-12, I3c): when a step has to change the picture size, the camera and writer restart. The old
  /// writer's buffer is kept (`kept`), readable, until it leaves the window, so a save right after the step still has
  /// the play, joined with what came after it into one clip (Victor, 2026-11-12). On `capture.queue`.
  private struct Previous {
    let ring: SegmentRing
    let initSegment: URL
    let width: Int
    let height: Int
    let generation: Int
    /// When its writer stopped (uptime): its last picture is that old.
    var endedAt: TimeInterval
  }

  private let fileOps = LocalFileOps()
  private let saveQueue = DispatchQueue(label: "replay.save", qos: .utility)
  private lazy var ring = SegmentRing(capacity: 60, fileOps: fileOps)
  private var writer: SegmentWriter?
  /// Whether the buffer is filling (a recording) or the camera only feeds the preview (the setup screen, 2026-11-08 spec
  /// §3.1). Lives on `capture.queue`.
  private var buffering = false
  /// The setup screen paused for inactivity: the preview camera at its lowest rate (spec §3.2). On `capture.queue`.
  private var idle = false
  private var generation = 0
  private var pendingSaves: [PendingSave] = []
  /// The buffers kept from heat restarts still inside the window, oldest first (4K → 1080p30, then → 720p30 within a
  /// minute keeps both).
  private var kept: [Previous] = []
  /// Segments per ring, as set at `start` (a ring made after a heat restart gets the same).
  private var ringCapacity = 60
  private var lens = "ultraWide"
  /// Steps the recording down as the phone heats up (1080p30 when `serious`, 720p30 when `critical`). Only touched on
  /// `thermalQueue`.
  private var ladder = ThermalLadder(requested: "1080p60", state: .nominal, now: 0)
  private let thermalQueue = DispatchQueue(label: "replay.thermal")
  /// Bumped per session, so a recheck scheduled by an old session does nothing.
  private var thermalEpoch = 0
  /// A recheck is waiting (only one at a time).
  private var thermalRecheck = false
  private var observers: [NSObjectProtocol] = []
  private(set) var running = false
  let watchPreview = WatchPreview()
  /// Bigger and quicker pictures for the remote phone's camera view.
  let remotePreview = WatchPreview(longSide: 480, interval: 0.25, quality: 0.5)

  enum Failure: Error { case lowStorage, permission, unavailable(Error), noSession, encoder(Error?) }

  init() {
    capture.onVideo = { [weak self] buffer in
      self?.writer?.appendVideo(buffer)
      self?.gesture.consider(buffer)
      let upright: () -> CGImagePropertyOrientation = { [weak self] in GestureDetector.orientation(for: self?.gesture.currentUpright() ?? .landscapeLeft) }
      self?.watchPreview.offer(buffer, orientation: upright)
      self?.remotePreview.offer(buffer, orientation: upright)
    }
    capture.onAudio = { [weak self] buffer in
      self?.writer?.appendAudio(buffer)
      self?.voice.consider(buffer)
    }
    voice.onCommand = { [weak self] in
      self?.emit?("onTrigger", ["source": "voice", "at": Date().timeIntervalSince1970 * 1000])
    }
    capture.onPressure = { [weak self] pressure in
      self?.diag("câmera: pressão \(pressure) — \(Self.thermalLevel().name)") // TEMP(diag-remote), plan 2026-11-12 I3a
    }
    gesture.onDebug = { [weak self] in self?.emit?("onGestureDebug", $0) }
    gesture.onTrace = { [weak self] in self?.emit?("onGestureTrace", $0) }
    gesture.optics = { [weak self] in
      guard let camera = self?.capture.camera else { return nil }
      return (Double(camera.activeFormat.videoFieldOfView), Double(camera.videoZoomFactor))
    }
    gesture.onGesture = { [weak self] in
      self?.emit?("onTrigger", ["source": "gesture", "at": Date().timeIntervalSince1970 * 1000])
    }
  }

  static func requestPermissions(completion: @escaping (Bool) -> Void) {
    AVCaptureDevice.requestAccess(for: .video) { video in
      AVCaptureDevice.requestAccess(for: .audio) { _ in completion(video) }
    }
  }

  /// No-op when a session is already running. `preview`: the camera runs for the setup screen only, at 30 fps at most,
  /// with no encoder and no buffer, until `startBuffering()` (2026-11-08 spec §3.1).
  func start(lens: String, zoom: Double? = nil, maxQuality: String, bufferSeconds: Double = 60, preview: Bool = false) throws {
    guard !running else { return }
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else { throw Failure.permission }
    let free = (try? ReplayPaths.buffer.deletingLastPathComponent()
      .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
      .volumeAvailableCapacityForImportantUsage) ?? 0
    do { try StorageGuard.check(freeBytes: free) } catch { throw Failure.lowStorage }

    ReplayPaths.ensure(ReplayPaths.buffer)
    ReplayPaths.ensure(ReplayPaths.clips)
    ring.clear()
    windowSeconds = bufferSeconds > 0 ? bufferSeconds : 60
    ringCapacity = BufferPlan.segments(forSeconds: windowSeconds, segmentSeconds: SegmentWriter.segmentSeconds)
    ring = SegmentRing(capacity: ringCapacity, fileOps: fileOps)
    SegmentRing.purgeOrphans(dir: ReplayPaths.buffer, fileOps: fileOps)

    self.lens = lens
    capture.wantedZoom = zoom // nil = no zoom (the lens decides); a thermal reconfiguration keeps whatever is set here
    let state = Self.thermalLevel()
    let quality: String = thermalQueue.sync {
      thermalEpoch += 1
      thermalRecheck = false
      ladder = ThermalLadder(requested: maxQuality, state: state, now: Self.uptime())
      return ladder.quality
    }
    gesture.degraded = state.slowsGesture
    do { try capture.configure(lens: lens, maxQuality: quality) } catch { throw Failure.unavailable(error) }
    capture.queue.sync {
      buffering = !preview
      idle = false
      if preview { capture.setRate(.preview) } else { startWriter() }
    }
    gesture.start()
    capture.start()
    running = true
    observe()
    NSLog("[replay] thermal at start: %@, recording %@ (asked %@)", state.name, quality, maxQuality)
    if state != .nominal { thermalChanged() }
  }

  /// The recording starts: the recording's frame rate comes back, the buffer starts filling. No-op when it already is.
  func startBuffering(completion: @escaping () -> Void) {
    guard running else { return completion() }
    capture.queue.async {
      guard !self.buffering else { return completion() }
      self.buffering = true
      self.idle = false
      self.capture.setRate(.recording)
      self.ring.clear()
      self.startWriter()
      completion()
    }
  }

  /// The setup screen paused (true) or back (false): the preview camera drops to its lowest rate, or back to 30 fps.
  /// Ignored once the buffer fills (a recording keeps its rate).
  func setIdle(_ on: Bool) {
    guard running else { return }
    capture.queue.async {
      guard !self.buffering, self.idle != on else { return }
      self.idle = on
      self.capture.setRate(on ? .idle : .preview)
      self.diag(on ? "câmera: pausada (\(CaptureController.idleFps) fps, sem imagem)" : "câmera: de volta à prévia (30 fps)") // TEMP(diag)
    }
  }

  func stop(completion: @escaping () -> Void = {}) {
    guard running else { return completion() }
    running = false
    observers.forEach(NotificationCenter.default.removeObserver)
    observers.removeAll()
    gesture.stop()
    voice.stop()
    capture.stop()
    capture.queue.async {
      self.failPendingSaves(.noSession)
      self.dropKept()
      self.finishWriter {
        SegmentRing.purgeOrphans(dir: ReplayPaths.buffer, fileOps: self.fileOps)
        completion()
      }
    }
  }

  /// Waits for the in-progress segment (the one holding the trigger) to close, then copies the last `keepSeconds` of the
  /// window (whole 1 s segments, so a little more; 0 or more than the window = the whole window).
  /// `completion` is called exactly once.
  func saveClip(keepSeconds: Double = 0, completion: @escaping (SaveResult) -> Void) {
    guard running else { return completion(.failure(.noSession)) }
    let id = UUID()
    // The phone's position at the moment of the play, not the one the session started with.
    let rotation = gesture.currentUpright().videoRotationDegrees
    let pending = PendingSave(id: id, run: { [weak self] sources in
      guard let self else { return }
      self.saveQueue.async { completion(self.copyClip(from: sources, rotationDegrees: rotation, keepSeconds: keepSeconds)) }
    }, fail: { completion(.failure($0)) })

    capture.queue.async {
      // During a heat restart there is no writer for a moment, but the kept buffer and the new writer are coming.
      guard self.writer != nil || !self.kept.isEmpty else { return completion(.failure(.noSession)) }
      self.pendingSaves.append(pending)
    }
    capture.queue.asyncAfter(deadline: .now() + Self.saveTimeout) {
      guard let index = self.pendingSaves.firstIndex(where: { $0.id == id }) else { return }
      self.pendingSaves.remove(at: index).fail(.encoder(nil))
    }
  }

  /// Runs on `saveQueue`; the rings pin the copied segments, so capture keeps going meanwhile. `sources`: oldest first
  /// (a buffer kept from before a heat restart, then the current one). The newest source gives what it has of the
  /// window, the older one the rest; parts of different sizes are joined at the smallest (`ClipConcat.join`).
  private func copyClip(from sources: [ClipSource], rotationDegrees: Int, keepSeconds: Double) -> SaveResult {
    let dest = ReplayPaths.clips.appendingPathComponent("\(UUID().uuidString).mp4")
    var temporary: [URL] = []
    defer { temporary.forEach { try? FileManager.default.removeItem(at: $0) } }
    do {
      let lastSeconds = keepSeconds > 0 ? min(keepSeconds, self.windowSeconds) : self.windowSeconds
      var remaining = lastSeconds
      var parts: [ClipConcat.Part] = []
      for source in sources.reversed() {
        let want = min(remaining, source.maxSeconds)
        guard want > 0.05, !source.ring.snapshot(lastSeconds: want).isEmpty else { continue }
        // Outside the buffer dir, so the buffer's disk size measures the ring alone.
        let joined = FileManager.default.temporaryDirectory.appendingPathComponent("save-\(UUID().uuidString).mp4")
        let part = FileManager.default.temporaryDirectory.appendingPathComponent("part-\(UUID().uuidString).mp4")
        temporary += [joined, part]
        let seconds: Double
        do {
          seconds = try source.ring.copyClip(lastSeconds: want, to: joined) { segments, joined in
            // a kept buffer dropped between the check above and here: nothing of it to copy
            guard !segments.isEmpty else { throw Skip.empty }
            try ClipConcat.concat(initSegment: source.initSegment, segments: segments, to: joined)
          }
        } catch Skip.empty {
          continue
        }
        try ClipConcat.normalize(joined, to: part, rotationDegrees: rotationDegrees)
        parts.insert(ClipConcat.Part(url: part, shortSide: min(source.width, source.height), seconds: seconds), at: 0)
        remaining -= seconds
      }
      guard !parts.isEmpty else { return .failure(.noSession) }
      let shortSide = try ClipConcat.join(parts, to: dest)
      return .success((dest.path, Int(parts.reduce(0) { $0 + $1.seconds } * 1000), shortSide))
    } catch {
      try? FileManager.default.removeItem(at: dest)
      return .failure(.encoder(error))
    }
  }

  /// Must run on `capture.queue`. What a save made now reads from (`copyClip`).
  private func sources() -> [ClipSource] {
    var out: [ClipSource] = []
    for p in kept {
      // the window counts from now: a kept buffer's last picture is `now - endedAt` old
      let left = windowSeconds - (Self.uptime() - p.endedAt)
      if left > 0.5 {
        out.append(ClipSource(ring: p.ring, initSegment: p.initSegment, width: p.width, height: p.height, maxSeconds: left))
      }
    }
    if let w = writer {
      out.append(ClipSource(ring: ring, initSegment: w.initSegmentURL, width: w.width, height: w.height,
                            maxSeconds: .infinity))
    }
    return out
  }

  /// Must run on `capture.queue`. Deletes the buffers kept from heat restarts (only that writer's with `generation`).
  private func dropKept(generation: Int? = nil) {
    for p in kept where generation == nil || p.generation == generation { p.ring.clear() }
    kept.removeAll { generation == nil || $0.generation == generation }
  }

  private enum Skip: Error { case empty }

  /// Must run on `capture.queue`.
  private func startWriter() {
    generation += 1
    let writer = SegmentWriter(width: capture.dimensions.width, height: capture.dimensions.height, fps: capture.fps,
                               withAudio: capture.hasAudio, generation: generation)
    writer.onSegment = { [weak self] segment, generation in
      guard let self else { return }
      self.capture.queue.async {
        guard generation == self.generation, self.writer != nil else {
          // The last segment of a writer replaced by a heat restart goes to the buffer kept from it (I3c); any other
          // late segment belongs to an init segment nobody reads any more: drop it.
          if let k = self.kept.first(where: { $0.generation == generation }) { return k.ring.append(segment) }
          return self.fileOps.delete(segment.url)
        }
        self.ring.append(segment)
        let saves = self.pendingSaves
        self.pendingSaves.removeAll()
        let sources = self.sources()
        saves.forEach { $0.run(sources) }
      }
    }
    writer.rotationDegrees = { [weak self] in self?.gesture.currentUpright().videoRotationDegrees ?? 0 }
    writer.onFailure = { [weak self] error in self?.fail(code: "ENCODER_FAILED", "\(error.map { "\($0)" } ?? "writer failed")") }
    self.writer = writer
  }

  /// Must run on `capture.queue`. Ends the writer and empties the ring: its segments belong to that writer's init segment.
  private func finishWriter(then next: @escaping () -> Void) {
    let old = writer
    writer = nil
    generation += 1
    let finish = {
      self.capture.queue.async {
        self.ring.clear()
        next()
      }
    }
    if let old { old.finish(completion: finish) } else { finish() }
  }

  /// Must run on `capture.queue`.
  private func failPendingSaves(_ failure: Failure) {
    let saves = pendingSaves
    pendingSaves.removeAll()
    saves.forEach { $0.fail(failure) }
  }

  /// A runtime failure after start: tell JS and stop, so the UI never shows a dead session as recording.
  private func fail(code: String, _ message: String) {
    NSLog("[replay] stopped: %@ — %@ (thermal state %ld)", code, message, ProcessInfo.processInfo.thermalState.rawValue)
    emit?("onError", ["code": code, "message": message])
    stop()
  }

  private func observe() {
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: nil) {
      [weak self] _ in self?.thermalChanged()
    })
    observers.append(center.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: capture.session, queue: nil) {
      [weak self] note in
      let error = note.userInfo?[AVCaptureSessionErrorKey] as? Error
      self?.fail(code: "CAMERA_UNAVAILABLE", "\(error.map { "\($0)" } ?? "capture runtime error")")
    })
    observers.append(center.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: capture.session, queue: nil) {
      [weak self] note in
      guard let self else { return }
      // iOS took the camera away because the phone is too hot: it will not come back by itself, so the recording ends
      // here with the heat message, keeping the clips (2026-11-07 spec §4.3). The app itself never stops for heat.
      let raw = (note.userInfo?[AVCaptureSessionInterruptionReasonKey] as? NSNumber)?.intValue
      if let raw, AVCaptureSession.InterruptionReason(rawValue: raw) == .videoDeviceNotAvailableDueToSystemPressure {
        self.diag("câmera: desligada pelo iOS (calor)") // TEMP(diag-remote)
        self.emit?("onThermalChange", ["level": "critical", "degraded": true, "quality": ThermalLadder.emergency])
        self.fail(code: "ENCODER_FAILED", "thermal")
        return
      }
      self.capture.queue.async {
        self.failPendingSaves(.noSession)
        self.finishWriter { if self.buffering { self.startWriter() } }
      }
      self.emit?("onInterrupted", [:])
    })
    observers.append(center.addObserver(forName: AVCaptureSession.interruptionEndedNotification, object: capture.session, queue: nil) {
      [weak self] _ in self?.emit?("onResumed", [:])
    })
    // The volume remote reads presses as volume changes, and a new audio route reports a volume of its own (the earpiece
    // at 1.00 in the 2026-10-31 log): JS ignores volume changes for a moment after one (`onAudioChange`).
    observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) {
      [weak self] note in
      let raw = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue ?? 0
      self?.emit?("onAudioChange", ["reason": "route \(raw)"])
    })
    observeAudioForDiag(center) // TEMP(diag-remote)
  }

  // MARK: - TEMP(diag-remote): Bluetooth remote investigation, remove with its commit

  /// One line for the in-app diagnostic log (`src/diag`), also in the device console as `[replay] diag`.
  func diag(_ message: String) {
    NSLog("[replay] diag %@", message)
    emit?("onDiag", ["message": message])
  }

  /// TEMP(diag-remote): battery, charging, Low Power Mode and heat in one line (field test: what Modo Foco costs per
  /// clip and per minute of recording). iOS gives the level in 1% steps.
  static func powerState() -> String {
    let device = UIDevice.current
    if !device.isBatteryMonitoringEnabled {
      device.isBatteryMonitoringEnabled = true
    }
    let level = device.batteryLevel
    let percent = level < 0 ? "?" : String(Int((level * 100).rounded()))
    let state: String
    switch device.batteryState {
    case .charging: state = "carregando"
    case .full: state = "cheia, no cabo"
    case .unplugged: state = "fora do cabo"
    default: state = "estado desconhecido"
    }
    let lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled ? ", pouca energia LIGADO" : ""
    let thermal = (ThermalLevel(rawValue: ProcessInfo.processInfo.thermalState.rawValue) ?? .nominal).name
    return "bateria \(percent)% (\(state)\(lowPower)), calor \(thermal)" + shared.energyConfig()
  }

  /// Plan 2026-11-12, I3a / I3d (energy test): the camera's own pressure and what is running, so each minute's line
  /// says which configuration the battery and the heat belong to. Empty with no camera open.
  private func energyConfig() -> String {
    guard running else { return "" }
    let info = capture.diagInfo
    let on = { (b: Bool) in b ? "ligado" : "desligado" }
    return ", pressão \(info.pressure) — config: \(info.format), gesto \(on(gesture.enabled)), voz \(on(voice.isEnabled)), " +
      "prévia \(on(EnergyDiag.previewOn))"
  }

  /// The audio session as the volume remote depends on it: the remote is read through `outputVolume`.
  static func audioState() -> String {
    let s = AVAudioSession.sharedInstance()
    let outputs = s.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ",")
    let inputs = s.currentRoute.inputs.map { $0.portType.rawValue }.joined(separator: ",")
    let category = s.category.rawValue.replacingOccurrences(of: "AVAudioSessionCategory", with: "")
    let mode = s.mode.rawValue.replacingOccurrences(of: "AVAudioSessionMode", with: "")
    return String(format: "categoria %@, modo %@, volume %.2f, saída %@, entrada %@", category, mode, s.outputVolume,
                  outputs.isEmpty ? "-" : outputs, inputs.isEmpty ? "-" : inputs)
  }

  private func observeAudioForDiag(_ center: NotificationCenter) {
    observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) {
      [weak self] note in
      let raw = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue ?? 0
      let reason = AVAudioSession.RouteChangeReason(rawValue: raw).map(Self.reasonName) ?? "\(raw)"
      self?.diag("áudio: rota mudou (\(reason)) — \(Self.audioState())")
    })
    observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) {
      [weak self] note in
      let raw = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue ?? 0
      let began = AVAudioSession.InterruptionType(rawValue: raw) == .began
      self?.diag("áudio: interrupção \(began ? "COMEÇOU" : "terminou") — \(Self.audioState())")
    })
    observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: nil) {
      [weak self] _ in self?.diag("áudio: serviços de mídia REINICIADOS pelo iOS")
    })
  }

  private static func reasonName(_ r: AVAudioSession.RouteChangeReason) -> String {
    switch r {
    case .newDeviceAvailable: return "novo dispositivo"
    case .oldDeviceUnavailable: return "dispositivo saiu"
    case .categoryChange: return "categoria mudou"
    case .override: return "override"
    case .wakeFromSleep: return "acordou"
    case .noSuitableRouteForCategory: return "sem rota"
    case .routeConfigurationChange: return "configuração"
    default: return "desconhecido"
    }
  }

  private static func thermalLevel() -> ThermalLevel {
    ThermalLevel(rawValue: ProcessInfo.processInfo.thermalState.rawValue) ?? .nominal
  }

  private static func uptime() -> TimeInterval { ProcessInfo.processInfo.systemUptime }

  /// `serious` slows the gesture checks (ThermalLevel.slowsGesture) and, held for two minutes, halves the frame rate
  /// (Full HD); `critical` goes to 720p30 at once (`ThermalLadder`). Only iOS taking the camera away for heat ends a
  /// recording (the interruption observer).
  private func thermalChanged() {
    thermalQueue.async { [weak self] in
      guard let self, self.running else { return }
      let state = Self.thermalLevel()
      let action = self.ladder.update(state: state, now: Self.uptime())
      let quality = self.ladder.quality
      let degraded = self.ladder.degraded
      self.gesture.degraded = state.slowsGesture || degraded
      NSLog("[replay] thermal %@: recording %@ (asked %@)", state.name, quality, self.ladder.requested)

      self.diag("calor: \(state.name), gravando \(quality) — pressão \(self.capture.diagInfo.pressure)") // TEMP(diag-remote)
      switch action {
      case .throttle(let next):
        self.throttleCapture(quality: next)
      case .reconfigure(let next):
        self.restartCapture(quality: next)
      case .none:
        break
      }
      // Still `serious` later? Look again when a step would be allowed: no notification comes by itself while the
      // level stays the same.
      if state == .serious && !self.thermalRecheck {
        self.thermalRecheck = true
        let epoch = self.thermalEpoch
        self.thermalQueue.asyncAfter(deadline: .now() + ThermalLadder.holdBeforeNextStep + 1) { [weak self] in
          guard let self, self.thermalEpoch == epoch else { return }
          self.thermalRecheck = false
          self.thermalChanged()
        }
      }
      self.emit?("onThermalChange", ["level": state.name, "degraded": degraded, "quality": quality])
    }
  }

  /// Heat, same picture size (1080p60 → 1080p30; plan 2026-11-12, I3b): the running camera only slows down. Nothing
  /// restarts: the writer, the ring and the play in it stay, and the microphone is not touched.
  private func throttleCapture(quality: String) {
    let fps = Int(CaptureController.target(for: quality).fps)
    capture.queue.async {
      self.capture.lowerRecordingRate(to: fps)
      self.capture.setRate(self.buffering ? .recording : (self.idle ? .idle : .preview))
      self.diag("câmera: \(quality) sem reiniciar (calor) — buffer mantido") // TEMP(diag-remote)
    }
  }

  /// Heat, another picture size: closes the writer and reopens the camera at `quality`. The old writer's buffer is kept
  /// readable (I3c): saves waiting on it are answered from it once its last segment is in, and a save in the next
  /// window joins it with what comes after.
  private func restartCapture(quality: String) {
    // Before the camera stops: its audio restarts with it and moves the volume the remote reads (a false press at 10:19
    // in the 2026-10-31 log). JS stops reading volume changes as presses until it has settled.
    emit?("onAudioChange", ["reason": "cameraRestart"])
    diag("câmera: reiniciando em \(quality) (calor) — \(Self.audioState())") // TEMP(diag-remote)
    capture.stop()
    capture.queue.async {
      let old = self.writer
      self.writer = nil
      self.generation += 1
      if let old, self.buffering {
        self.kept.append(Previous(ring: self.ring, initSegment: old.initSegmentURL, width: old.width, height: old.height,
                                  generation: old.generation, endedAt: Self.uptime()))
        self.ring = SegmentRing(capacity: self.ringCapacity, fileOps: self.fileOps)
        self.expirePrevious(generation: old.generation)
      } else {
        self.ring.clear()
      }
      let reopen = {
        self.capture.queue.async {
          if let old, let i = self.kept.firstIndex(where: { $0.generation == old.generation }) {
            self.kept[i].endedAt = Self.uptime()
            // the saves that were waiting for the old writer's segment: it is in the kept buffer now
            let saves = self.pendingSaves
            self.pendingSaves.removeAll()
            let sources = self.sources()
            saves.forEach { $0.run(sources) }
          } else {
            self.failPendingSaves(.noSession)
          }
          do {
            try self.capture.configure(lens: self.lens, maxQuality: quality)
          } catch {
            return self.fail(code: "CAMERA_UNAVAILABLE", "\(error)")
          }
          // A camera restarted on the setup screen stays a preview.
          if self.buffering { self.startWriter() } else { self.capture.setRate(self.idle ? .idle : .preview) }
          self.capture.start()
          self.diag("câmera: reiniciada em \(quality), buffer anterior mantido — \(Self.audioState())") // TEMP(diag-remote)
        }
      }
      if let old { old.finish(completion: reopen) } else { reopen() }
    }
  }

  /// The kept buffer goes once nothing of it is left in the window (a little after, so a save at the edge finishes).
  private func expirePrevious(generation: Int) {
    capture.queue.asyncAfter(deadline: .now() + windowSeconds + 5) {
      self.dropKept(generation: generation)
    }
  }
}
