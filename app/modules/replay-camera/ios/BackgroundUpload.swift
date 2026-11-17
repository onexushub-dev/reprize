import ExpoModulesCore
import Foundation
import UIKit

/// One file to upload with a presigned PUT URL (sharing design §5.4, spike 1).
struct UploadItem: Record {
  @Field var id: String = ""
  @Field var path: String = ""
  @Field var url: String = ""
  @Field var contentType: String = "video/mp4"
}

/// Uploads files through the system's background session: the transfer goes on with the app in the background or the
/// screen locked, and iOS wakes the app when it ends. One file is one PUT; a failed file starts again from its first
/// byte (clips are tens of MB), up to `maxAttempts`. The state of every file is kept in UserDefaults, so a relaunch
/// can tell what finished while the app was not running.
///
/// iOS rule: when the user swipes the app away in the app switcher, the system cancels every background transfer.
final class BackgroundUploader: NSObject, URLSessionDataDelegate {
  static let shared = BackgroundUploader()
  static let sessionId = "app.reprize.uploads"
  private static let stateKey = "reprize.uploads.v1"
  private static let maxAttempts = 5

  /// Sends a module event; set by the module on create. Events sent while no JS listens are lost: the state is not.
  var emit: ((String, [String: Any]) -> Void)?
  /// The handler iOS gave when it woke the app for this session; called once the session has delivered its events.
  var finishEvents: (() -> Void)?

  private let lock = NSLock()
  private var lastProgress: [String: TimeInterval] = [:]

  private lazy var session: URLSession = {
    let config = URLSessionConfiguration.background(withIdentifier: Self.sessionId)
    config.isDiscretionary = false
    config.sessionSendsLaunchEvents = true
    config.allowsCellularAccess = true
    config.timeoutIntervalForResource = 24 * 3600
    return URLSession(configuration: config, delegate: self, delegateQueue: nil)
  }()

  // MARK: State

  private func load() -> [String: [String: Any]] {
    (UserDefaults.standard.dictionary(forKey: Self.stateKey) as? [String: [String: Any]]) ?? [:]
  }

  private func save(_ state: [String: [String: Any]]) {
    UserDefaults.standard.set(state, forKey: Self.stateKey)
  }

  private func update(_ id: String, _ change: (inout [String: Any]) -> Void) -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    var state = load()
    var entry = state[id] ?? ["id": id]
    change(&entry)
    state[id] = entry
    save(state)
    return entry
  }

  private static func now() -> Double { Date().timeIntervalSince1970 * 1000 }

  // MARK: API

  /// Queues the files and starts them at once; an id already in the state is replaced.
  func start(_ items: [UploadItem]) {
    for item in items {
      let size = (try? FileManager.default.attributesOfItem(atPath: item.path)[.size] as? NSNumber)?.doubleValue ?? 0
      _ = update(item.id) { entry in
        entry["path"] = item.path
        entry["url"] = item.url
        entry["contentType"] = item.contentType
        entry["bytes"] = size
        entry["sent"] = 0.0
        entry["attempts"] = 0
        entry["status"] = "running"
        entry["queuedAt"] = Self.now()
        entry["error"] = nil
        entry["finishedAt"] = nil
      }
      launch(id: item.id, path: item.path, url: item.url, contentType: item.contentType)
    }
  }

  private func launch(id: String, path: String, url: String, contentType: String) {
    guard let target = URL(string: url), FileManager.default.fileExists(atPath: path) else {
      finish(id: id, ok: false, status: 0, error: "missing file or bad url")
      return
    }
    var request = URLRequest(url: target)
    request.httpMethod = "PUT"
    request.setValue(contentType, forHTTPHeaderField: "Content-Type")
    let task = session.uploadTask(with: request, fromFile: URL(fileURLWithPath: path))
    task.taskDescription = id
    _ = update(id) { entry in
      entry["attempts"] = ((entry["attempts"] as? Int) ?? 0) + 1
      if entry["startedAt"] == nil { entry["startedAt"] = Self.now() }
    }
    task.resume()
  }

  /// Every file the uploader knows about, with its status (`running`, `done`, `failed`).
  func state() -> [[String: Any]] {
    lock.lock()
    defer { lock.unlock() }
    return Array(load().values)
  }

  /// Cancels every transfer and forgets every file.
  func reset() {
    session.getAllTasks { tasks in tasks.forEach { $0.cancel() } }
    lock.lock()
    save([:])
    lock.unlock()
  }

  /// On launch: reconnects to the background session and starts again any file left running with no transfer behind
  /// it (the app was swiped away, or the system dropped the task).
  func restore() {
    session.getAllTasks { [weak self] tasks in
      guard let self else { return }
      let alive = Set(tasks.compactMap { $0.taskDescription })
      for entry in self.state() {
        guard let id = entry["id"] as? String, entry["status"] as? String == "running", !alive.contains(id) else { continue }
        self.launch(
          id: id,
          path: entry["path"] as? String ?? "",
          url: entry["url"] as? String ?? "",
          contentType: entry["contentType"] as? String ?? "video/mp4"
        )
      }
    }
  }

  private func finish(id: String, ok: Bool, status: Int, error: String?) {
    let entry = update(id) { entry in
      entry["status"] = ok ? "done" : "failed"
      entry["httpStatus"] = status
      entry["error"] = error
      entry["finishedAt"] = Self.now()
      if ok { entry["sent"] = entry["bytes"] }
    }
    var body = entry
    body["ok"] = ok
    emit?("onUploadDone", body)
  }

  // MARK: URLSession delegate

  func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64,
                  totalBytesExpectedToSend: Int64) {
    guard let id = task.taskDescription else { return }
    let time = Date().timeIntervalSince1970
    lock.lock()
    let last = lastProgress[id] ?? 0
    let due = time - last > 0.5 || totalBytesSent == totalBytesExpectedToSend
    if due { lastProgress[id] = time }
    lock.unlock()
    guard due else { return }
    _ = update(id) { entry in entry["sent"] = Double(totalBytesSent) }
    emit?("onUploadProgress", ["id": id, "sent": Double(totalBytesSent), "total": Double(totalBytesExpectedToSend)])
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let id = task.taskDescription else { return }
    let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
    if error == nil && (200..<300).contains(status) {
      finish(id: id, ok: true, status: status, error: nil)
      return
    }
    let reason = error.map { $0.localizedDescription } ?? "HTTP \(status)"
    let cancelled = (error as NSError?)?.code == NSURLErrorCancelled
    let entry = state().first { $0["id"] as? String == id } ?? [:]
    let attempts = entry["attempts"] as? Int ?? 0
    // A 4xx means the URL is wrong or expired: trying again will not help.
    let retry = !cancelled && attempts < Self.maxAttempts && !(400..<500).contains(status) && entry["status"] as? String == "running"
    if retry {
      emit?("onUploadRetry", ["id": id, "attempt": attempts, "error": reason])
      launch(
        id: id,
        path: entry["path"] as? String ?? "",
        url: entry["url"] as? String ?? "",
        contentType: entry["contentType"] as? String ?? "video/mp4"
      )
    } else if !cancelled {
      finish(id: id, ok: false, status: status, error: reason)
    }
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    DispatchQueue.main.async {
      let handler = self.finishEvents
      self.finishEvents = nil
      handler?()
    }
  }

  /// Creates the session so iOS can hand it the pending events after waking the app.
  func wake() { _ = session }
}

/// Receives iOS's wake-up for the upload session (registered in expo-module.config.json).
public final class UploadAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                          completionHandler: @escaping () -> Void) {
    guard identifier == BackgroundUploader.sessionId else {
      completionHandler()
      return
    }
    BackgroundUploader.shared.finishEvents = completionHandler
    BackgroundUploader.shared.wake()
  }
}
