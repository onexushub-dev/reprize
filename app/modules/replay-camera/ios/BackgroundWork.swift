import UIKit

/// Extra time iOS gives an app that leaves the front with work in hand (about 30 s): the shared clips' cuts go on while
/// the sender is already in WhatsApp sending the link, so every file reaches the background uploader (2026-11-22). Each
/// piece of work is a key; iOS calling time ends it, as `end` does, so the app is never killed for holding it.
enum BackgroundWork {
  private static var tasks: [Int: UIBackgroundTaskIdentifier] = [:]
  private static var next = 0

  @MainActor
  static func begin(name: String) -> Int {
    next += 1
    let key = next
    let id = UIApplication.shared.beginBackgroundTask(withName: name) {
      Task { @MainActor in end(key: key) }
    }
    if id != .invalid { tasks[key] = id }
    return key
  }

  @MainActor
  static func end(key: Int) {
    guard let id = tasks.removeValue(forKey: key) else { return }
    UIApplication.shared.endBackgroundTask(id)
  }
}
