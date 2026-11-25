import AVFoundation
import Speech

/// VoiceBench's "Atual": today's dictation trigger, copied from app/modules/replay-camera/ios/VoiceTrigger.swift
/// (2026-11-24) with only the outputs changed. Same rules: on-device `SFSpeechRecognizer` in the app's language,
/// `contextualStrings`, a fresh task every 50 s and right after a command, 2 s cooldown, back-off after errors, and
/// `VoiceCommand.matches` (whole word "salvar", case and accents ignored).
final class DictationEngine {
  static let restartAfter: TimeInterval = 50
  static let cooldown: TimeInterval = 2
  static let firstBackoff: TimeInterval = 2
  static let maxBackoff: TimeInterval = 30

  /// A command (on the main queue).
  var onCommand: (() -> Void)?
  var log: ((String) -> Void)?

  private let queue = DispatchQueue(label: "bench.dictation")
  private let locale: VoiceLocale
  private let recognizer: SFSpeechRecognizer?
  private var enabled = false
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var startedAt = Date.distantPast
  private var lastCommand = Date.distantPast
  private var retryAt = Date.distantPast
  private var backoff = firstBackoff

  init(locale: VoiceLocale = .ptBR) {
    self.locale = locale
    recognizer = SFSpeechRecognizer(locale: locale.locale)
  }

  static var isAvailable: Bool {
    SFSpeechRecognizer(locale: VoiceLocale.ptBR.locale)?.supportsOnDeviceRecognition ?? false
  }

  func setEnabled(_ on: Bool) {
    queue.async {
      self.enabled = on
      if !on { self.stopTask() }
    }
  }

  func consider(_ buffer: CMSampleBuffer) {
    queue.async {
      guard self.enabled, SFSpeechRecognizer.authorizationStatus() == .authorized,
            let recognizer = self.recognizer, recognizer.isAvailable, recognizer.supportsOnDeviceRecognition,
            Date() >= self.retryAt else { return }
      if self.request == nil || Date().timeIntervalSince(self.startedAt) > Self.restartAfter {
        self.startTask(recognizer)
      }
      if let request = self.request { request.appendAudioSampleBuffer(buffer) }
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
        guard self.request === request else { return }
        if result != nil { self.backoff = Self.firstBackoff }
        if let text = result?.bestTranscription.formattedString, VoiceCommand.matches(text, locale: locale),
           Date().timeIntervalSince(self.lastCommand) > Self.cooldown {
          self.lastCommand = Date()
          let callback = self.onCommand
          DispatchQueue.main.async { callback?() }
          self.stopTask()
        } else if error != nil {
          self.log?("atual: erro, nova tentativa em \(Int(self.backoff)) s")
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
