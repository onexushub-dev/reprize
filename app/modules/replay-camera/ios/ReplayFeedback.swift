import AVFoundation

/// Confirmation for a player far from the phone, one sound and one torch pattern per action (2026-11-08 spec §5): a
/// clip saved (two rising notes, 2 short blinks), a recording started (three rising notes, 1 steady light), ended
/// (three falling notes, 3 slow pulses), a failure (low double beep). `Chime` and `TorchPattern` hold the shapes.
final class ReplayFeedback {
  private let queue = DispatchQueue(label: "replay.feedback")
  private lazy var savedSound = Chime.wav(notes: Chime.saved)
  private lazy var failedSound = Chime.wav(notes: Chime.failed)
  private lazy var startedSound = Chime.wav(notes: Chime.started)
  private lazy var endedSound = Chime.wav(notes: Chime.ended)
  private var player: AVAudioPlayer?

  func saved(sound: Bool, flash: Bool, activeCamera: AVCaptureDevice?) {
    if sound { play(savedSound) }
    if flash { blink(activeCamera, TorchPattern.saved) }
  }

  /// "started" or "ended" (a recording, from the remote's hold); anything else plays nothing.
  func action(_ kind: String, sound: Bool, flash: Bool, activeCamera: AVCaptureDevice?) {
    switch kind {
    case "started":
      if sound { play(startedSound) }
      if flash { blink(activeCamera, TorchPattern.started) }
    case "ended":
      if sound { play(endedSound) }
      if flash { blink(activeCamera, TorchPattern.ended) }
    default:
      break
    }
  }

  func failed(sound: Bool) {
    if sound { play(failedSound) }
  }

  /// Plays inside the capture session's play-and-record audio session (which ignores the silent switch),
  /// routed to the loudspeaker rather than the earpiece.
  private func play(_ data: Data) {
    DispatchQueue.main.async {
      try? AVAudioSession.sharedInstance().overrideOutputAudioPort(.speaker)
      self.player = try? AVAudioPlayer(data: data)
      self.player?.volume = 1
      self.player?.play()
    }
  }

  /// Plays `steps` on the torch. The ultra-wide lens has no torch of its own, so fall back to the wide camera's.
  private func blink(_ active: AVCaptureDevice?, _ steps: [TorchPattern.Step]) {
    let device = [active, AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)]
      .compactMap { $0 }
      .first { $0.hasTorch && $0.isTorchModeSupported(.on) }
    guard let device else { return }
    queue.async {
      for step in steps {
        // A step that can't lock (the camera is being reconfigured) is skipped, never left half-done.
        if (try? device.lockForConfiguration()) != nil {
          if step.on { try? device.setTorchModeOn(level: 1) } else { device.torchMode = .off }
          device.unlockForConfiguration()
        }
        Thread.sleep(forTimeInterval: step.seconds)
      }
      // Always end dark, even if an earlier step failed.
      for _ in 0..<5 {
        if (try? device.lockForConfiguration()) != nil {
          device.torchMode = .off
          device.unlockForConfiguration()
          return
        }
        Thread.sleep(forTimeInterval: 0.05)
      }
    }
  }
}
