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
    let run: (SegmentWriter) -> Void
    let fail: (Failure) -> Void
  }

  private let fileOps = LocalFileOps()
  private let saveQueue = DispatchQueue(label: "replay.save", qos: .utility)
  private lazy var ring = SegmentRing(capacity: 60, fileOps: fileOps)
  private var writer: SegmentWriter?
  private var generation = 0
  private var pendingSaves: [PendingSave] = []
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

  /// No-op when a session is already running.
  func start(lens: String, zoom: Double? = nil, maxQuality: String, bufferSeconds: Double = 60) throws {
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
    ring = SegmentRing(capacity: BufferPlan.segments(forSeconds: windowSeconds, segmentSeconds: SegmentWriter.segmentSeconds), fileOps: fileOps)
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
    capture.queue.sync { startWriter() }
    gesture.start()
    capture.start()
    running = true
    observe()
    NSLog("[replay] thermal at start: %@, recording %@ (asked %@)", state.name, quality, maxQuality)
    if state != .nominal { thermalChanged() }
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
    let pending = PendingSave(id: id, run: { [weak self] writer in
      guard let self else { return }
      self.saveQueue.async { completion(self.copyClip(using: writer, rotationDegrees: rotation, keepSeconds: keepSeconds)) }
    }, fail: { completion(.failure($0)) })

    capture.queue.async {
      guard self.writer != nil else { return completion(.failure(.noSession)) }
      self.pendingSaves.append(pending)
    }
    capture.queue.asyncAfter(deadline: .now() + Self.saveTimeout) {
      guard let index = self.pendingSaves.firstIndex(where: { $0.id == id }) else { return }
      self.pendingSaves.remove(at: index).fail(.encoder(nil))
    }
  }

  /// Runs on `saveQueue`; the ring pins the copied segments, so capture keeps going meanwhile.
  private func copyClip(using writer: SegmentWriter, rotationDegrees: Int, keepSeconds: Double) -> SaveResult {
    // Outside the buffer dir, so the buffer's disk size measures the ring alone.
    let joined = FileManager.default.temporaryDirectory.appendingPathComponent("save-\(UUID().uuidString).mp4")
    let dest = ReplayPaths.clips.appendingPathComponent("\(UUID().uuidString).mp4")
    defer { try? FileManager.default.removeItem(at: joined) }
    do {
      let lastSeconds = keepSeconds > 0 ? min(keepSeconds, self.windowSeconds) : self.windowSeconds
      let seconds = try ring.copyClip(lastSeconds: lastSeconds, to: joined) { segments, joined in
        try ClipConcat.concat(initSegment: writer.initSegmentURL, segments: segments, to: joined)
      }
      try ClipConcat.normalize(joined, to: dest, rotationDegrees: rotationDegrees)
      return .success((dest.path, Int(seconds * 1000), min(writer.width, writer.height)))
    } catch {
      try? FileManager.default.removeItem(at: dest)
      return .failure(.encoder(error))
    }
  }

  /// Must run on `capture.queue`.
  private func startWriter() {
    generation += 1
    let writer = SegmentWriter(width: capture.dimensions.width, height: capture.dimensions.height, fps: capture.fps,
                               withAudio: capture.hasAudio, generation: generation)
    writer.onSegment = { [weak self] segment, generation in
      guard let self else { return }
      self.capture.queue.async {
        // A late segment from a replaced writer belongs to another init segment: drop it.
        guard generation == self.generation, let current = self.writer else {
          return self.fileOps.delete(segment.url)
        }
        self.ring.append(segment)
        let saves = self.pendingSaves
        self.pendingSaves.removeAll()
        saves.forEach { $0.run(current) }
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
        self.finishWriter { self.startWriter() }
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
    return "bateria \(percent)% (\(state)\(lowPower)), calor \(thermal)"
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

      switch action {
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

  /// Closes the writer and reopens the camera at `quality`; saves waiting on the old writer fail (the UI says so).
  private func restartCapture(quality: String) {
    // Before the camera stops: its audio restarts with it and moves the volume the remote reads (a false press at 10:19
    // in the 2026-10-31 log). JS stops reading volume changes as presses until it has settled.
    emit?("onAudioChange", ["reason": "cameraRestart"])
    diag("câmera: reiniciando em \(quality) (calor) — \(Self.audioState())") // TEMP(diag-remote)
    capture.stop()
    capture.queue.async {
      self.failPendingSaves(.noSession)
      self.finishWriter {
        do {
          try self.capture.configure(lens: self.lens, maxQuality: quality)
        } catch {
          return self.fail(code: "CAMERA_UNAVAILABLE", "\(error)")
        }
        self.startWriter()
        self.capture.start()
        self.diag("câmera: reiniciada em \(quality) — \(Self.audioState())") // TEMP(diag-remote)
      }
    }
  }
}
