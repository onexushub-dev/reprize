import AVFoundation

/// Owns the AVCaptureSession: lens, format and the video/audio sample outputs.
/// Samples arrive on `queue`, the one queue all writing happens on.
final class CaptureController: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate,
  AVCaptureAudioDataOutputSampleBufferDelegate
{
  let session = AVCaptureSession()
  let queue = DispatchQueue(label: "replay.capture")
  var onVideo: ((CMSampleBuffer) -> Void)?
  var onAudio: ((CMSampleBuffer) -> Void)?

  private let videoOutput = AVCaptureVideoDataOutput()
  private let audioOutput = AVCaptureAudioDataOutput()
  private(set) var dimensions = (width: 1920, height: 1080)
  private(set) var fps = 30
  private(set) var hasAudio = false
  private(set) var camera: AVCaptureDevice?
  /// The zoom the player wants (0.5 = ultra-wide, 1 = wide, above 1 a digital crop); nil = no zoom, the lens decides.
  /// Kept here, not only in the engine, so every reconfiguration (the thermal fallback) puts it back.
  var wantedZoom: Double?

  enum Failure: Error { case noCamera, cannotAddInput, cannotAddOutput }

  func configure(lens: String, maxQuality: String) throws {
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    session.inputs.forEach { session.removeInput($0) }
    session.outputs.forEach { session.removeOutput($0) }
    session.sessionPreset = .inputPriority

    guard let camera = Self.camera(lens: lens, continuousZoom: wantedZoom != nil) else { throw Failure.noCamera }
    self.camera = camera
    let input = try AVCaptureDeviceInput(device: camera)
    guard session.canAddInput(input) else { throw Failure.cannotAddInput }
    session.addInput(input)
    let target = Self.target(for: maxQuality)
    // A camera without that size (4K on an older phone or lens) records Full HD at the same rate instead.
    if Self.has(camera, width: target.width, fps: target.fps) {
      try applyFormat(camera, width: target.width, fps: target.fps)
    } else {
      try applyFormat(camera, width: 1920, fps: target.fps)
    }
    applyZoom(animated: false) // a new format starts at factor 1, so the zoom goes on after it

    hasAudio = false
    if AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
       let mic = AVCaptureDevice.default(for: .audio), let micInput = try? AVCaptureDeviceInput(device: mic),
       session.canAddInput(micInput)
    {
      session.addInput(micInput)
      hasAudio = true
    }

    videoOutput.alwaysDiscardsLateVideoFrames = false
    videoOutput.setSampleBufferDelegate(self, queue: queue)
    audioOutput.setSampleBufferDelegate(self, queue: queue)
    guard session.canAddOutput(videoOutput), session.canAddOutput(audioOutput) else { throw Failure.cannotAddOutput }
    session.addOutput(videoOutput)
    session.addOutput(audioOutput)
  }

  func start() { queue.async { self.session.startRunning() } }
  func stop() { queue.async { self.session.stopRunning() } }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
                     from connection: AVCaptureConnection) {
    if output === videoOutput { onVideo?(sampleBuffer) } else { onAudio?(sampleBuffer) }
  }

  /// The virtual ultra-wide + wide camera: one device for the whole zoom, so crossing 1x never restarts the session.
  private static var dualWide: AVCaptureDevice? {
    AVCaptureDevice.default(.builtInDualWideCamera, for: .video, position: .back)
  }

  /// With zoom the virtual camera is used where it exists (the others have no ultra-wide: the wide covers 1x and up).
  private static func camera(lens: String, continuousZoom: Bool) -> AVCaptureDevice? {
    if continuousZoom, let dual = dualWide { return dual }
    if lens == "ultraWide", let ultra = AVCaptureDevice.default(.builtInUltraWideCamera, for: .video, position: .back) {
      return ultra
    }
    return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
  }

  /// Where the virtual camera hands over from the ultra-wide to the wide (a device zoom factor): the player's 1x. 1 for a single lens.
  private static func wideFactor(of device: AVCaptureDevice) -> Double {
    guard device.deviceType == .builtInDualWideCamera,
          let first = device.virtualDeviceSwitchOverVideoZoomFactors.first else { return 1 }
    return first.doubleValue
  }

  /// What the player can zoom on this phone; needs no session.
  static func zoomRange() -> (min: Double, max: Double) {
    guard let device = dualWide ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
      return (1, 1)
    }
    return ZoomMath.userRange(minFactor: Double(device.minAvailableVideoZoomFactor),
                              maxFactor: Double(device.maxAvailableVideoZoomFactor),
                              wideFactor: wideFactor(of: device))
  }

  /// Zooms the running camera; `animated` ramps smoothly (a button tap), otherwise it follows the fingers at once.
  /// Remembered when the camera is not running, so the next start opens with it.
  func setZoom(_ zoom: Double, animated: Bool) {
    wantedZoom = zoom
    applyZoom(animated: animated)
  }

  private func applyZoom(animated: Bool) {
    guard let device = camera, let wanted = wantedZoom else { return }
    let upper = min(Double(device.maxAvailableVideoZoomFactor), Double(device.activeFormat.videoMaxZoomFactor))
    let factor = ZoomMath.deviceFactor(forUserZoom: wanted, wideFactor: Self.wideFactor(of: device),
                                       minFactor: Double(device.minAvailableVideoZoomFactor), maxFactor: upper)
    // A zoom that can't lock (the camera is being reconfigured) is skipped: the next call or the next start sets it.
    guard (try? device.lockForConfiguration()) != nil else { return }
    defer { device.unlockForConfiguration() }
    if animated {
      device.ramp(toVideoZoomFactor: CGFloat(factor), withRate: 4)
    } else {
      device.cancelVideoZoomRamp()
      device.videoZoomFactor = CGFloat(factor)
    }
  }

  /// "2160p30" (4K) | "1080p60" | "1080p30" | "720p30" (the thermal ladder at `critical`) → frame width and rate.
  static func target(for quality: String) -> (width: Int32, fps: Double) {
    switch quality {
    case "2160p30": return (3840, 30)
    case "1080p60": return (1920, 60)
    case "1080p30": return (1920, 30)
    default: return (1280, 30)
    }
  }

  /// A 16:9 format `width` wide that reaches `fps`.
  private static func has(_ device: AVCaptureDevice, width: Int32, fps: Double) -> Bool {
    device.formats.contains { f in
      let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
      return d.width == width && d.height == width * 9 / 16 && f.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= fps }
    }
  }

  /// Whether this phone records `quality` with the camera the app opens by default (the zoom camera); needs no session.
  static func supports(quality: String) -> Bool {
    let target = target(for: quality)
    guard let device = camera(lens: "ultraWide", continuousZoom: true) else { return false }
    return has(device, width: target.width, fps: target.fps)
  }

  /// The 16:9 format of `width` at `fps` when supported, else the best rate that format offers.
  private func applyFormat(_ device: AVCaptureDevice, width targetWidth: Int32, fps wantedFps: Double) throws {
    let candidates = device.formats.filter {
      let d = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
      return d.width == targetWidth && d.height == targetWidth * 9 / 16
    }
    let chosen = candidates.first { f in f.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= wantedFps } }
      ?? candidates.first
    guard let format = chosen else { return }

    let maxFps = format.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 30
    let frameRate = Int(min(wantedFps, maxFps))
    try device.lockForConfiguration()
    device.activeFormat = format
    let duration = CMTime(value: 1, timescale: CMTimeScale(frameRate))
    device.activeVideoMinFrameDuration = duration
    device.activeVideoMaxFrameDuration = duration
    device.unlockForConfiguration()

    let d = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
    dimensions = (Int(d.width), Int(d.height))
    fps = frameRate
  }
}
