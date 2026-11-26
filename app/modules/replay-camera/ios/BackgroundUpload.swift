import ExpoModulesCore
import Foundation
import UIKit

/// One file to upload with a presigned PUT URL (sharing design §5.4, spike 1).
struct UploadItem: Record {
  @Field var id: String = ""
  @Field var path: String = ""
  @Field var url: String = ""
  @Field var contentType: String = "video/mp4"
  /// Whether the file may go over mobile data ("Enviar pelos dados móveis"); Wi-Fi only when false.
  @Field var cellular: Bool = true
  /// The transfer's priority (0 to 1, a hint to iOS) when the app sets the order itself, as across the recordings of a
  /// group link; below 0, the order of `TransferOrder`.
  @Field var priority: Double = -1
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
  private static let separator = "\n"

  /// The file id and the transfer token kept in a task's description (older builds kept only the id).
  private static func parse(_ description: String?) -> (id: String, token: String?)? {
    guard let description else { return nil }
    let parts = description.components(separatedBy: separator)
    return (parts[0], parts.count > 1 ? parts[1] : nil)
  }

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
    // The clips go up in their order, a couple at a time, so the receiver gets them in order too (TransferOrder).
    config.httpMaximumConnectionsPerHost = TransferOrder.connections
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
        entry["cellular"] = item.cellular
        entry["priority"] = item.priority
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
    request.allowsCellularAccess = (state().first { $0["id"] as? String == id }?["cellular"] as? Bool) ?? true
    request.setValue(contentType, forHTTPHeaderField: "Content-Type")
    let task = session.uploadTask(with: request, fromFile: URL(fileURLWithPath: path))
    let given = (state().first { $0["id"] as? String == id }?["priority"] as? Double) ?? -1
    task.priority = given >= 0 ? Float(min(1, given)) : TransferOrder.priority(for: id)
    // The file's id plus a token for this transfer: an older transfer of the same file that reports late is ignored.
    let token = UUID().uuidString
    task.taskDescription = id + Self.separator + token
    _ = update(id) { entry in
      entry["token"] = token
      entry["attempts"] = ((entry["attempts"] as? Int) ?? 0) + 1
      if entry["startedAt"] == nil { entry["startedAt"] = Self.now() }
    }
    task.resume()
  }

  /// Stops every running transfer and keeps it as `paused` (a recording started, or the phone is too hot). Nothing is
  /// lost: a paused file starts again from its first byte on `resume`, and `restore` leaves it alone.
  func pause() {
    lock.lock()
    var state = load()
    for (id, var entry) in state where entry["status"] as? String == "running" {
      entry["status"] = "paused"
      state[id] = entry
    }
    save(state)
    lock.unlock()
    session.getAllTasks { tasks in tasks.forEach { $0.cancel() } }
  }

  /// Starts again every paused file, with the mobile data choice of now.
  func resume(cellular: Bool) {
    let paused = state().filter { $0["status"] as? String == "paused" }
    for entry in paused {
      guard let id = entry["id"] as? String else { continue }
      _ = update(id) { e in
        e["status"] = "running"
        e["cellular"] = cellular
        e["sent"] = 0.0
        e["attempts"] = 0
      }
      launch(
        id: id,
        path: entry["path"] as? String ?? "",
        url: entry["url"] as? String ?? "",
        contentType: entry["contentType"] as? String ?? "video/mp4"
      )
    }
  }

  /// Cancels these files and forgets them (an expired or turned-off share).
  func remove(_ ids: [String]) {
    let gone = Set(ids)
    lock.lock()
    var state = load()
    for id in ids { state.removeValue(forKey: id) }
    save(state)
    lock.unlock()
    session.getAllTasks { tasks in
      tasks.filter { gone.contains(Self.parse($0.taskDescription)?.id ?? "") }.forEach { $0.cancel() }
    }
  }

  /// Every file the uploader knows about, with its status (`running`, `paused`, `done`, `failed`).
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
      let alive = Set(tasks.compactMap { Self.parse($0.taskDescription)?.id })
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
    guard let id = Self.parse(task.taskDescription)?.id else { return }
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
    guard let parsed = Self.parse(task.taskDescription) else { return }
    let id = parsed.id
    let token = parsed.token
    let current = state().first { $0["id"] as? String == id }
    // A transfer replaced by a newer one (restore or a retry started it again) no longer speaks for the file.
    if let token, let current, let latest = current["token"] as? String, latest != token { return }
    let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
    if error == nil && (200..<300).contains(status) {
      finish(id: id, ok: true, status: status, error: nil)
      return
    }
    let reason = error.map { $0.localizedDescription } ?? "HTTP \(status)"
    let cancelled = (error as NSError?)?.code == NSURLErrorCancelled
    let entry = state().first { $0["id"] as? String == id } ?? [:]
    let attempts = entry["attempts"] as? Int ?? 0
    let running = entry["status"] as? String == "running"
    // Cancelled while still `running`: not by us (pause marks `paused`, remove forgets the file) but by iOS, which
    // cancels every transfer when the app is swiped away and reports it on the next launch. Start it again.
    if cancelled && running && attempts < Self.maxAttempts {
      emit?("onUploadRetry", ["id": id, "attempt": attempts, "error": "cancelled by the system"])
      launch(
        id: id,
        path: entry["path"] as? String ?? "",
        url: entry["url"] as? String ?? "",
        contentType: entry["contentType"] as? String ?? "video/mp4"
      )
      return
    }
    // A 4xx means the URL is wrong or expired: trying again will not help.
    let retry = !cancelled && attempts < Self.maxAttempts && !(400..<500).contains(status) && running
    if retry {
      emit?("onUploadRetry", ["id": id, "attempt": attempts, "error": reason])
      launch(
        id: id,
        path: entry["path"] as? String ?? "",
        url: entry["url"] as? String ?? "",
        contentType: entry["contentType"] as? String ?? "video/mp4"
      )
    } else if !cancelled || running {
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

/// Receives iOS's wake-up for the background sessions, uploads and downloads (registered in expo-module.config.json).
/// One subscriber for both: each wake-up's handler must go to its own session and be called exactly once.
public final class UploadAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                          completionHandler: @escaping () -> Void) {
    if identifier == BackgroundUploader.sessionId {
      BackgroundUploader.shared.finishEvents = completionHandler
      BackgroundUploader.shared.wake()
    } else if identifier == BackgroundDownloader.sessionId {
      BackgroundDownloader.shared.finishEvents = completionHandler
      BackgroundDownloader.shared.wake()
    } else {
      completionHandler()
    }
  }
}
