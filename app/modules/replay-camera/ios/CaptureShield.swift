import ExpoModulesCore
import UIKit

/// Spike 3 of the sharing design (docs/superpowers/specs/2026-11-16-recording-sharing-design.md, §8.2 and §10): keeps
/// its React children out of screenshots and screen recordings.
///
/// How: the system leaves the canvas of a secure text field out of every capture. The children are mounted inside that
/// canvas instead of inside this view. The canvas is not a documented API, so the spike exists to prove it on the
/// current iOS with the app's player. When no canvas is found the children are mounted as usual and `protected` is
/// false: the screen says so instead of pretending.
final class CaptureShieldView: ExpoView {
  /// Kept alive for as long as the view: the canvas only hides its content while its field is secure.
  private let field = UITextField()
  /// The secure canvas; nil when the system has none (nothing is protected then).
  private var host: UIView?
  private var screenshots = 0

  let onShieldState = EventDispatcher()

  /// Off: the same canvas, no longer secure. For comparing a capture with and without the protection.
  var enabled = true {
    didSet {
      field.isSecureTextEntry = enabled
      report()
    }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    field.isSecureTextEntry = true
    field.isUserInteractionEnabled = false
    field.layoutIfNeeded()
    if let canvas = Self.canvas(of: field) {
      canvas.subviews.forEach { $0.removeFromSuperview() }
      canvas.isUserInteractionEnabled = true
      canvas.frame = bounds
      canvas.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      addSubview(canvas)
      host = canvas
    }
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(captureChanged), name: UIScreen.capturedDidChangeNotification, object: nil)
    center.addObserver(self, selector: #selector(screenshotTaken), name: UIApplication.userDidTakeScreenshotNotification, object: nil)
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  /// The field's canvas: the subview whose class is the text layout canvas, else its first subview.
  private static func canvas(of field: UITextField) -> UIView? {
    let named = field.subviews.first { String(describing: type(of: $0)).contains("LayoutCanvasView") }
    return named ?? field.subviews.first
  }

  override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    if let host {
      host.insertSubview(childComponentView, at: index)
    } else {
      super.mountChildComponentView(childComponentView, index: index)
    }
  }

  override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    if host != nil {
      childComponentView.removeFromSuperview()
    } else {
      super.unmountChildComponentView(childComponentView, index: index)
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    host?.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil { report() }
  }

  @objc private func captureChanged() { report() }

  @objc private func screenshotTaken() {
    screenshots += 1
    report()
  }

  /// Screen recording, mirroring or AirPlay of this view's screen.
  private var capturing: Bool {
    if let screen = window?.screen { return screen.isCaptured }
    return UIScreen.main.isCaptured
  }

  private func report() {
    onShieldState([
      "protected": host != nil && enabled,
      "capturing": capturing,
      "canvas": host.map { String(describing: type(of: $0)) } ?? "",
      "screenshots": screenshots,
    ])
  }
}
