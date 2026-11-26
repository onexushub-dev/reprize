import AVFoundation
import Speech

/// Listens for the save command in the app's language ("salvar" in Portuguese, "save" in English)
/// in the game's own audio (the capture session's microphone samples), strictly on the device (court audio never goes to a server). Each recognition task is restarted every ~50s (Apple's
/// limit is about a minute) and right after a command, which also clears the transcript.
///
/// Two engines (plan 2026-11-24 voice keyword detector): the "salvar" detector (`KeywordDetector`, model
/// `salvar-v2-rc4` in the pod's resource bundle) for Portuguese, and dictation for English or when the model fails to
/// load (`VoiceEngine.choose`). Exactly one engine is live at a time.
final class VoiceTrigger {
  static let restartAfter: TimeInterval = 50
  static let cooldown: TimeInterval = 2
  /// After a failed task, wait before trying again (doubling up to 30s) instead of retrying every buffer.
  static let firstBackoff: TimeInterval = 2
  static let maxBackoff: TimeInterval = 30
  /// How often the detector's dropped audio is reported (only when some was dropped).
  static let dropReportEvery: TimeInterval = 60

  /// Offline recognition in `locale` exists on this phone.
  static func isSupported(_ locale: VoiceLocale) -> Bool {
    SFSpeechRecognizer(locale: locale.locale)?.supportsOnDeviceRecognition ?? false
  }

  var onCommand: (() -> Void)?
  /// Diagnóstico lines (`voz: …`), never anything that was said. Called on this trigger's queue.
  var log: ((String) -> Void)?

  private let queue = DispatchQueue(label: "replay.voice")
  private var locale = VoiceLocale.ptBR
  private var recognizer = SFSpeechRecognizer(locale: VoiceLocale.ptBR.locale)
  private var enabled = false
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var startedAt = Date.distantPast
  private var lastCommand = Date.distantPast
  private var retryAt = Date.distantPast
  private var backoff = firstBackoff
  /// The engine listening now (meaningful while `enabled`).
  private var live = VoiceEngine.dictation
  /// Loaded on first use of the detector; `keywordFailed` stops retrying after a failed load.
  private var keyword: KeywordDetector?
  private var keywordFailed = false
  private var reportedDrops = 0.0
  private var lastDropReport = Date.distantPast

  static func requestPermission(completion: @escaping (Bool) -> Void) {
    SFSpeechRecognizer.requestAuthorization { completion($0 == .authorized) }
  }

  /// Turns listening on or off, in `locale`. A new language replaces the recognizer and drops the running task.
  func setEnabled(_ on: Bool, locale: VoiceLocale) {
    queue.async {
      if locale != self.locale {
        self.stopTask()
        self.locale = locale
        self.recognizer = SFSpeechRecognizer(locale: locale.locale)
        self.retryAt = .distantPast
        self.backoff = Self.firstBackoff
      }
      let wasOn = self.enabled
      self.enabled = on
      self.mirror(on)
      if on {
        self.chooseEngine(announce: !wasOn)
      } else {
        self.stopTask()
      }
    }
  }

  /// Whether listening is on (Diagnóstico's energy test), from any thread without waiting for `queue`.
  var isEnabled: Bool {
    enabledLock.lock()
    defer { enabledLock.unlock() }
    return enabledMirror
  }
  private let enabledLock = NSLock()
  private var enabledMirror = false
  private func mirror(_ on: Bool) {
    enabledLock.lock()
    enabledMirror = on
    enabledLock.unlock()
  }

  func stop() {
    queue.async {
      self.enabled = false
      self.mirror(false)
      self.stopTask()
    }
  }

  /// Call with every audio sample buffer from the capture session.
  func consider(_ buffer: CMSampleBuffer) {
    queue.async {
      guard self.enabled else { return }
      if self.live == .keyword, let keyword = self.keyword {
        keyword.consider(buffer)
        self.reportDrops(keyword)
      } else {
        self.feedDictation { $0.appendAudioSampleBuffer(buffer) }
      }
    }
  }

  /// The same for microphone buffers from an audio engine (the remote phone). The buffer must be one its owner does not
  /// reuse (a copy of the tap's).
  func consider(_ buffer: AVAudioPCMBuffer) {
    queue.async {
      guard self.enabled else { return }
      if self.live == .keyword, let keyword = self.keyword {
        keyword.consider(buffer)
        self.reportDrops(keyword)
      } else {
        self.feedDictation { $0.append(buffer) }
      }
    }
  }

  // MARK: Engine choice (on `queue`)

  /// Picks the engine for the current locale; switching stops the old one before the new one listens.
  private func chooseEngine(announce: Bool = false) {
    guard enabled else { return }
    if VoiceEngine.portugueseUsesKeyword && locale == .ptBR { loadKeywordIfNeeded() }
    let next = VoiceEngine.choose(locale: locale, keywordAvailable: keyword != nil)
    guard next != live || announce else { return }
    if next == .keyword {
      // Dictation stops before the detector listens, and the detector forgets audio from before (no stale word fires).
      stopTask()
      keyword?.reset()
    }
    live = next
    if next == .keyword, let keyword {
      log?("voz: gatilho modelo \(keyword.config.version)")
    } else {
      log?("voz: gatilho ditado")
    }
  }

  private func loadKeywordIfNeeded() {
    guard keyword == nil, !keywordFailed else { return }
    let detector = KeywordDetector.loadBundled(log: { [weak self] line in
      guard let self else { return }
      self.queue.async { self.log?(line) }
    })
    guard let detector else {
      keywordFailed = true
      return
    }
    detector.log = { [weak self] line in
      guard let self else { return }
      self.queue.async { self.log?(line) }
    }
    detector.onCommand = { [weak self] score in
      guard let self else { return }
      self.queue.async { self.keywordHeard(score) }
    }
    keyword = detector
    reportedDrops = 0
  }

  private func keywordHeard(_ score: Double) {
    guard enabled, live == .keyword, Date().timeIntervalSince(lastCommand) > Self.cooldown else { return }
    lastCommand = Date()
    let lag = keyword.map { Int($0.lastFireLagMs.rounded()) } ?? 0
    log?(String(format: "voz: comando (modelo, nota %.2f, atraso %d ms)", score, lag))
    onCommand?()
  }

  private func reportDrops(_ keyword: KeywordDetector) {
    guard Date().timeIntervalSince(lastDropReport) >= Self.dropReportEvery else { return }
    lastDropReport = Date()
    let dropped = keyword.stats.droppedSeconds
    if dropped > reportedDrops {
      log?(String(format: "voz: %.1f s de áudio descartados", dropped - reportedDrops))
      reportedDrops = dropped
    }
  }

  // MARK: Dictation (on `queue`)

  private func feedDictation(_ append: @escaping (SFSpeechAudioBufferRecognitionRequest) -> Void) {
    guard SFSpeechRecognizer.authorizationStatus() == .authorized,
          let recognizer = recognizer, recognizer.isAvailable, recognizer.supportsOnDeviceRecognition,
          Date() >= retryAt else { return }
    if request == nil || Date().timeIntervalSince(startedAt) > Self.restartAfter {
      startTask(recognizer)
    }
    if let request = request { append(request) }
  }

  /// Must run on `queue`.
  private func startTask(_ recognizer: SFSpeechRecognizer) {
    stopTask()
    let locale = self.locale
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.requiresOnDeviceRecognition = true
    request.contextualStrings = VoiceCommand.words(for: locale)
    self.request = request
    startedAt = Date()
    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self else { return }
      self.queue.async {
        guard self.request === request else { return } // a task we already replaced
        if result != nil { self.backoff = Self.firstBackoff } // recognition works again
        if let text = result?.bestTranscription.formattedString, VoiceCommand.matches(text, locale: locale),
           Date().timeIntervalSince(self.lastCommand) > Self.cooldown {
          self.lastCommand = Date()
          self.log?("voz: comando (ditado)")
          self.onCommand?()
          self.stopTask() // the next buffer starts a fresh transcript
        } else if error != nil {
          self.stopTask()
          self.retryAt = Date().addingTimeInterval(self.backoff)
          self.backoff = min(self.backoff * 2, Self.maxBackoff)
        } else if result?.isFinal == true {
          self.stopTask()
        }
      }
    }
  }

  /// Must run on `queue`.
  private func stopTask() {
    request?.endAudio()
    task?.cancel()
    request = nil
    task = nil
  }
}
