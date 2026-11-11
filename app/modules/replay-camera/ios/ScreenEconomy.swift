import UIKit

/// Screen economy while recording (thermal work, item 2): the camera preview stops drawing and the screen brightness
/// goes down; turning it off gives both back. Capture, segment writing, triggers and saves are not touched.
/// The remote phone uses it too, with a brighter level and no camera preview to stop (`set(_:brightness:pausePreview:)`).
/// Main thread only.
@MainActor
enum ScreenEconomy {
  /// Brightness while dark (0..1). The JS side also covers the screen in black, so this only has to be low.
  static let dimBrightness: CGFloat = 0.02
  /// Brightness of the remote phone while dark: low, but the screen can still be read.
  static let remoteBrightness: CGFloat = 0.15

  private static var on = false
  /// The level of the current dark state.
  private static var level: CGFloat = dimBrightness
  /// Whether the current dark state stopped the camera preview (to give it back).
  private static var previewPaused = false
  /// The brightness to give back; nil while not dimmed.
  private static var saved: CGFloat?
  private static var observers: [NSObjectProtocol] = []

  static func set(_ value: Bool, brightness: CGFloat = ScreenEconomy.dimBrightness, pausePreview: Bool = true) {
    observe()
    if value == on { return }
    on = value
    if value {
      level = brightness
      previewPaused = pausePreview
      if pausePreview { ReplayCameraView.setPreviewEnabled(false) }
      dim()
    } else {
      if previewPaused { ReplayCameraView.setPreviewEnabled(true) }
      previewPaused = false
      restore()
    }
  }

  private static var screen: UIScreen? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return (scenes.first { $0.activationState == .foregroundActive } ?? scenes.first)?.screen
  }

  private static func dim() {
    // The brightness is the whole phone's, not the app's: only while the app is the one on screen (2026-11-10: a wait
    // that ended with the app minimised dimmed the home screen and every other app, down to nothing). Asked while away,
    // it waits for the app to come back (didBecomeActive).
    guard UIApplication.shared.applicationState == .active, let screen = screen else { return }
    if saved == nil { saved = screen.brightness }
    // Never brighter than the player's own setting.
    screen.brightness = min(screen.brightness, level)
  }

  private static func restore() {
    guard let value = saved else { return }
    saved = nil
    screen?.brightness = value
  }

  /// Leaving the app (switcher, home, another app, closing it) gives the brightness back (the player's own setting);
  /// coming back while still dark dims again. Installed on first use and kept: a restore must never be missed.
  private static func observe() {
    guard observers.isEmpty else { return }
    let center = NotificationCenter.default
    for name in [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification,
                 UIApplication.willTerminateNotification] {
      observers.append(center.addObserver(forName: name, object: nil, queue: .main) { _ in
        MainActor.assumeIsolated { restore() }
      })
    }
    observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
      MainActor.assumeIsolated { if on { dim() } }
    })
  }
}
