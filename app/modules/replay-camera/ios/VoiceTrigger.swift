import AVFoundation
import Speech

/// Listens for the save command in the app's language ("salvar" in Portuguese, "save" in English)
/// in the game's own audio (the capture session's microphone samples), strictly on the device (court audio never goes to a server). Each recognition task is restarted every ~50s (Apple's
/// limit is about a minute) and right after a command, which also clears the transcript.
final class VoiceTrigger {
  static let restartAfter: TimeInterval = 50
  static let cooldown: TimeInterval = 2
  /// After a failed task, wait before trying again (doubling up to 30s) instead of retrying every buffer.
  static let firstBackoff: TimeInterval = 2
  static let maxBackoff: TimeInterval = 30

  /// Offline recognition in `locale` exists on this phone.
  static func isSupported(_ locale: VoiceLocale) -> Bool {
    SFSpeechRecognizer(locale: locale.locale)?.supportsOnDeviceRecognition ?? false
  }

  var onCommand: (() -> Void)?

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
      self.enabled = on
      self.mirror(on)
      if !on { self.stopTask() }
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
  func consider(_ buffer: CMSampleBuffer) { feed { $0.appendAudioSampleBuffer(buffer) } }

  /// The same for microphone buffers from an audio engine (the remote phone). The buffer must be one its owner does not
  /// reuse (a copy of the tap's).
  func consider(_ buffer: AVAudioPCMBuffer) { feed { $0.append(buffer) } }

  private func feed(_ append: @escaping (SFSpeechAudioBufferRecognitionRequest) -> Void) {
    queue.async {
      guard self.enabled, SFSpeechRecognizer.authorizationStatus() == .authorized,
            let recognizer = self.recognizer, recognizer.isAvailable, recognizer.supportsOnDeviceRecognition,
            Date() >= self.retryAt else { return }
      if self.request == nil || Date().timeIntervalSince(self.startedAt) > Self.restartAfter {
        self.startTask(recognizer)
      }
      if let request = self.request { append(request) }
    }
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
