import ExpoModulesCore
import Foundation

/// One file to download into the app (a received clip, its framing file): a presigned GET URL and where it goes.
struct DownloadItem: Record {
  @Field var id: String = ""
  @Field var url: String = ""
  @Field var path: String = ""
}

/// Downloads received clips through the system's background session (sharing design §5.5): the transfer goes on with
/// the app in the background or the screen locked, and iOS wakes the app when it ends. The file is moved to its place
/// as soon as it arrives; the app adds the clip to the recording the next time it runs. A failed file starts again up
/// to `maxAttempts`. The state of every file is kept in UserDefaults, as for uploads (BackgroundUpload.swift).
///
/// iOS rule: when the user swipes the app away in the app switcher, the system cancels every background transfer;
/// `restore` starts them again on the next launch.
final class BackgroundDownloader: NSObject, URLSessionDownloadDelegate {
  static let shared = BackgroundDownloader()
  static let sessionId = "app.reprize.downloads"
  private static let stateKey = "reprize.downloads.v1"
  private static let maxAttempts = 5
  private static let separator = "\n"

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
    // A few clips at once: the whole recording is queued, and the phone is not flooded.
    config.httpMaximumConnectionsPerHost = 3
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

  @discardableResult
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

  private func stored(_ id: String) -> [String: Any]? {
    lock.lock()
    defer { lock.unlock() }
    return load()[id]
  }

  private static func now() -> Double { Date().timeIntervalSince1970 * 1000 }

  // MARK: API

  /// Queues the files and starts them at once (or keeps them `paused` when `paused` is true: a recording is on). An id
  /// already known is replaced: the URL may be a fresh one.
  func start(_ items: [DownloadItem], paused: Bool) {
    for item in items {
      update(item.id) { entry in
        entry["url"] = item.url
        entry["path"] = item.path
        entry["bytes"] = 0.0
        entry["received"] = 0.0
        entry["attempts"] = 0
        entry["status"] = paused ? "paused" : "running"
        entry["queuedAt"] = Self.now()
        entry["moved"] = false
        entry["error"] = nil
        entry["finishedAt"] = nil
      }
      if !paused { launch(id: item.id) }
    }
  }

  private func launch(id: String) {
    guard let saved = stored(id), let url = URL(string: saved["url"] as? String ?? "") else {
      finish(id: id, ok: false, status: 0, error: "bad url")
      return
    }
    let task = session.downloadTask(with: url)
    // The file's id plus a token for this transfer: an older transfer of the same file that reports late is ignored.
    let token = UUID().uuidString
    task.taskDescription = id + Self.separator + token
    update(id) { entry in
      entry["token"] = token
      entry["moved"] = false
      entry["attempts"] = ((entry["attempts"] as? Int) ?? 0) + 1
      if entry["startedAt"] == nil { entry["startedAt"] = Self.now() }
    }
    task.resume()
  }

  /// Stops every running download and keeps it `paused` (a recording started, or the phone is too hot).
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

  /// Starts again every paused download, from its first byte.
  func resume() {
    let paused = state().filter { $0["status"] as? String == "paused" }
    for entry in paused {
      guard let id = entry["id"] as? String else { continue }
      update(id) { e in
        e["status"] = "running"
        e["received"] = 0.0
        e["attempts"] = 0
      }
      launch(id: id)
    }
  }

  /// Cancels these downloads and forgets them (the clip is in the recording now, or the recording was deleted).
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

  /// Every file the downloader knows about, with its status (`running`, `paused`, `done`, `failed`).
  func state() -> [[String: Any]] {
    lock.lock()
    defer { lock.unlock() }
    return Array(load().values)
  }

  /// Cancels every download and forgets every file.
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
        self.launch(id: id)
      }
    }
  }

  private func finish(id: String, ok: Bool, status: Int, error: String?) {
    let entry = update(id) { entry in
      entry["status"] = ok ? "done" : "failed"
      entry["httpStatus"] = status
      entry["error"] = error
      entry["finishedAt"] = Self.now()
      if ok { entry["received"] = entry["bytes"] }
    }
    var body = entry
    body["ok"] = ok
    emit?("onDownloadDone", body)
  }

  /// The current transfer of the file this task belongs to (nil for a transfer that was replaced since).
  private func current(_ task: URLSessionTask) -> String? {
    guard let parsed = Self.parse(task.taskDescription) else { return nil }
    if let token = parsed.token, let latest = stored(parsed.id)?["token"] as? String, latest != token { return nil }
    return parsed.id
  }

  // MARK: URLSession delegate

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                  totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
    guard let id = Self.parse(downloadTask.taskDescription)?.id else { return }
    let time = Date().timeIntervalSince1970
    lock.lock()
    let last = lastProgress[id] ?? 0
    let due = time - last > 1
    if due { lastProgress[id] = time }
    lock.unlock()
    guard due else { return }
    update(id) { entry in
      entry["received"] = Double(totalBytesWritten)
      if totalBytesExpectedToWrite > 0 { entry["bytes"] = Double(totalBytesExpectedToWrite) }
    }
  }

  /// The file is in a temporary place that iOS deletes when this returns: it is moved to its path here.
  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    guard let id = current(downloadTask), let path = stored(id)?["path"] as? String else { return }
    let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else { return }
    let target = URL(fileURLWithPath: path)
    do {
      try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
      if FileManager.default.fileExists(atPath: path) { try FileManager.default.removeItem(at: target) }
      try FileManager.default.moveItem(at: location, to: target)
      let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? NSNumber)?.doubleValue ?? 0
      update(id) { entry in
        entry["moved"] = true
        entry["bytes"] = size
      }
    } catch {
      update(id) { entry in entry["error"] = "move: \(error.localizedDescription)" }
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let id = current(task) else { return }
    let entry = stored(id) ?? [:]
    let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
    if error == nil && (200..<300).contains(status) && entry["moved"] as? Bool == true {
      finish(id: id, ok: true, status: status, error: nil)
      return
    }
    let reason = error.map { $0.localizedDescription } ?? (entry["error"] as? String ?? "HTTP \(status)")
    let cancelled = (error as NSError?)?.code == NSURLErrorCancelled
    let attempts = entry["attempts"] as? Int ?? 0
    let running = entry["status"] as? String == "running"
    // Cancelled while still `running`: not by us (pause marks `paused`, remove forgets the file) but by iOS, which
    // cancels every transfer when the app is swiped away. Start it again.
    if cancelled && running && attempts < Self.maxAttempts {
      launch(id: id)
      return
    }
    // A 4xx means the link expired or the file is gone: trying again with this URL will not help.
    let retry = !cancelled && running && attempts < Self.maxAttempts && !(400..<500).contains(status)
    if retry {
      emit?("onDownloadRetry", ["id": id, "attempt": attempts, "error": reason])
      launch(id: id)
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
