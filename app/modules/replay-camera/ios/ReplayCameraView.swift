import AVFoundation
import ExpoModulesCore

/// Live preview of the replay session's camera.
class ReplayCameraView: ExpoView {
  private let previewLayer = AVCaptureVideoPreviewLayer(session: ReplayEngine.shared.capture.session)

  /// Every live preview, so screen economy can stop them all from drawing.
  private static let views = NSHashTable<ReplayCameraView>.weakObjects()
  private static var previewEnabled = true

  /// Off: the preview layers stop receiving frames (capture and writing go on). Main thread.
  static func setPreviewEnabled(_ enabled: Bool) {
    previewEnabled = enabled
    EnergyDiag.previewOn = enabled
    for view in views.allObjects { view.applyPreviewEnabled() }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)
    Self.views.add(self)
    applyPreviewEnabled()
  }

  /// The live previews: the capture-event interaction (CaptureButtons) sits on each of them.
  static func liveViews() -> [ReplayCameraView] { views.allObjects }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    CaptureButtons.shared.previewMoved(self) // the Bluetooth remote's presses arrive on the preview
  }

  private func applyPreviewEnabled() {
    previewLayer.connection?.isEnabled = Self.previewEnabled
    previewLayer.isHidden = !Self.previewEnabled
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
  }
}

/// What the camera preview is doing, readable off the main thread (Diagnóstico's energy test, plan 2026-11-12 I3d).
enum EnergyDiag {
  private static let lock = NSLock()
  private static var _previewOn = true
  static var previewOn: Bool {
    get { lock.lock(); defer { lock.unlock() }; return _previewOn }
    set { lock.lock(); _previewOn = newValue; lock.unlock() }
  }
}
