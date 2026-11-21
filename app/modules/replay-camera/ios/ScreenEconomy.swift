import UIKit

/// Screen economy (thermal work, item 2). Since 2026-11-21 both callers dim on the JS side with a veil (the camera stays
/// in view while recording), so nothing native changes; `pausePreview` stays for a caller that wants the preview off.
///
/// 2026-11-21: the phone's brightness is no longer touched at all. It is the whole phone's, not the app's, and iOS
/// does not reliably take a brightness back while the screen is locking: locked during a dark recording, the phone
/// stayed dim on the lock screen and in every app, whatever was given back on the way out. A black screen costs next
/// to nothing on an OLED iPhone, so nothing the app does to save battery can reach the rest of the phone.
/// The remote phone calls it too, with no camera preview to stop (`set(_:pausePreview:)`); its screen dims on the JS side.
/// Main thread only.
@MainActor
enum ScreenEconomy {
  private static var on = false
  /// Whether the current dark state stopped the camera preview (to give it back).
  private static var previewPaused = false

  static func set(_ value: Bool, pausePreview: Bool = true) {
    if value == on { return }
    on = value
    if value {
      previewPaused = pausePreview
      if pausePreview { ReplayCameraView.setPreviewEnabled(false) }
    } else {
      if previewPaused { ReplayCameraView.setPreviewEnabled(true) }
      previewPaused = false
    }
  }
}
