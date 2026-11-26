import AudioToolbox
import AVFoundation
import QuartzCore
import Speech
import SwiftUI
import UIKit

enum BenchMode: String, CaseIterable, Identifiable {
  case acerto = "Acerto"
  case ruido = "Ruído"
  case parecidas = "Parecidas"
  case consumo = "Consumo"
  var id: String { rawValue }
  var kind: String {
    switch self {
    case .acerto: return "accuracy"
    case .ruido: return "noise"
    case .parecidas: return "confusers"
    case .consumo: return "perf"
    }
  }
  /// Modes where who speaks matters (required to start).
  var needsSpeaker: Bool { self == .acerto || self == .parecidas }
}

enum PerfChoice: String, CaseIterable, Identifiable {
  case mic = "Só microfone"
  case atual = "Só atual"
  case novo = "Só novo"
  var id: String { rawValue }
  var key: String {
    switch self {
    case .mic: return "none"
    case .atual: return "dictation"
    case .novo: return "keyword"
    }
  }
}

/// One VoiceBench session at a time: which engines listen, the counters, the minute-by-minute readings, the files.
final class BenchModel: ObservableObject {
  static let distances = [3, 5, 10, 12]
  /// Read in Parecidas, 3 times each, never "salvar" (bench-protocol.md). Every firing there is a confusion.
  /// The second half are verbs ending in -ar, which fired rc1 in the 2026-11-25 field test.
  static let confusers = ["salvando", "salvamento", "salva-me", "salvador", "salvação", "salva-vidas", "salvei", "salvou",
                          "salvo", "salve", "salva", "salto", "saltar", "sacar", "salada",
                          "pular", "cavar", "gritar", "treinar", "jogar", "chutar", "passar", "marcar", "parar", "ganhar",
                          "selar", "salgar", "sentar", "cansar", "lançar", "tocar", "falar", "amar", "levantar", "olhar"]

  @Published var mode: BenchMode = .acerto
  @Published var distance = 3
  /// Who speaks in Acerto (kept between launches; required to start).
  @Published var speaker = UserDefaults.standard.string(forKey: "speaker") ?? "" {
    didSet { UserDefaults.standard.set(speaker, forKey: "speaker") }
  }
  @Published var expected = 6
  @Published var perfChoice: PerfChoice = .mic
  @Published var perfMinutes = 10
  @Published private(set) var running = false
  @Published private(set) var atual = 0
  @Published private(set) var novo = 0
  /// With a veto model (rc4): what its main classifier alone (rc1) heard, live, on the same audio.
  @Published private(set) var base = 0
  @Published private(set) var flashBase = false
  @Published private(set) var hasBase = BenchModel.bundledHasVeto()
  @Published private(set) var elapsed = 0.0
  @Published private(set) var status = ""
  @Published private(set) var sessions: [BenchSession] = []
  @Published private(set) var flashAtual = false
  @Published private(set) var flashNovo = false
  /// The "Novo" model copied in by `voice_bench.py prepare` (salvar-v1, salvar-v2…).
  let modelVersion = BenchModel.bundledModelVersion()

  private let capture = AudioCapture()
  private var dictation: DictationEngine?
  private var keyword: KeywordDetector?
  private var activeMode: BenchMode = .acerto
  private var startTime = 0.0
  private var startDate = Date()
  private var events: [BenchEvent] = []
  private var issues: [BenchIssue] = []
  private var finishing = false
  private var perf: [PerfRow] = []
  private var timer: Timer?
  private var lastPerfAt = 0.0
  private var lastSteps = 0
  private var lastStepSeconds = 0.0
  private var baseName = ""
  private var savedBrightness: CGFloat = 0.5

  init() {
    UIDevice.current.isBatteryMonitoringEnabled = true
    sessions = SessionStore.list()
    capture.onIssue = { [weak self] what in DispatchQueue.main.async { self?.note(what) } }
    let center = NotificationCenter.default
    center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
      self?.note("app foi para o fundo (tela bloqueada ou outro app)")
    }
    center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
      self?.note("app voltou")
    }
    center.addObserver(forName: UIDevice.batteryStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
      let state = UIDevice.current.batteryState
      self?.note(state == .unplugged ? "cabo desligado" : "cabo ligado")
    }
  }

  /// Something that may have disturbed the running session; saved with it and shown on screen.
  private func note(_ what: String) {
    guard running || finishing else { return }
    issues.append(BenchIssue(t: CACurrentMediaTime() - startTime, what: what))
    status = what
  }

  func requestPermissions() {
    AVCaptureDevice.requestAccess(for: .audio) { _ in }
    SFSpeechRecognizer.requestAuthorization { _ in }
  }

  /// Acerto needs a name, or its numbers can't be told apart later.
  var canStart: Bool { !mode.needsSpeaker || !speaker.trimmingCharacters(in: .whitespaces).isEmpty }

  private var usesDictation: Bool { mode != .consumo || perfChoice == .atual }
  private var usesKeyword: Bool { mode != .consumo || perfChoice == .novo }

  func start() {
    guard !running, canStart else { return }
    do {
      try capture.configure()
      dictation = nil
      keyword = nil
      if usesKeyword {
        let k = try Self.makeKeyword()
        k.onCommand = { [weak self] score in self?.heard("keyword", score: score) }
        if k.hasVeto {
          k.onMainCommand = { [weak self] score in self?.heard("keyword-main", score: score) }
        }
        hasBase = k.hasVeto
        k.log = { [weak self] line in DispatchQueue.main.async { self?.status = line } }
        keyword = k
      }
      if usesDictation {
        guard DictationEngine.isAvailable else { throw BenchError.message("Reconhecimento offline em português indisponível") }
        let d = DictationEngine()
        d.onCommand = { [weak self] in self?.heard("dictation", score: nil) }
        d.log = { [weak self] line in DispatchQueue.main.async { self?.status = line } }
        d.setEnabled(true)
        dictation = d
      }
      let d = dictation
      let k = keyword
      capture.onBuffer = { buffer in
        d?.consider(buffer)
        k?.consider(buffer)
      }
      activeMode = mode
      events = []
      issues = []
      perf = []
      atual = 0
      novo = 0
      base = 0
      elapsed = 0
      lastPerfAt = 0
      lastSteps = 0
      lastStepSeconds = 0
      startDate = Date()
      startTime = CACurrentMediaTime()
      baseName = SessionStore.baseName(kind: mode.kind, at: startDate)
      UIApplication.shared.isIdleTimerDisabled = true
      if mode == .consumo {
        savedBrightness = UIScreen.main.brightness
        UIScreen.main.brightness = 0.5
      }
      perf.append(sampleRow(at: 0))
      capture.start(recordTo: SessionStore.folder.appendingPathComponent(baseName + ".m4a"))
      running = true
      status = "Gravando"
      let battery = UIDevice.current.batteryState
      if mode == .consumo && (battery == .charging || battery == .full) {
        note("começou ligado no cabo: a bateria não vai medir nada")
      }
      timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
    } catch {
      status = "Erro: \(error.localizedDescription)"
    }
  }

  func stop() {
    guard running else { return }
    running = false
    timer?.invalidate()
    timer = nil
    elapsed = CACurrentMediaTime() - startTime
    perf.append(sampleRow(at: elapsed))
    dictation?.setEnabled(false)
    capture.onBuffer = nil
    var session = BenchSession(
      kind: activeMode.kind,
      engines: (dictation != nil ? ["dictation"] : []) + (keyword != nil ? ["keyword"] : []),
      perfEngine: activeMode == .consumo ? perfChoice.key : nil,
      distance: activeMode.needsSpeaker ? distance : nil,
      speaker: activeMode.needsSpeaker ? speaker.trimmingCharacters(in: .whitespaces) : nil,
      expected: activeMode == .acerto ? expected : nil,
      device: SessionStore.deviceModel,
      ios: UIDevice.current.systemVersion,
      model: modelVersion,
      start: ISO8601DateFormatter().string(from: startDate),
      durationSec: elapsed,
      events: events,
      perf: perf,
      audio: baseName + ".m4a")
    let name = baseName
    finishing = true
    capture.stop { [weak self] parts in
      guard let self else { return }
      self.finishing = false
      if parts.count > 1 { session.audioParts = parts }
      if !self.issues.isEmpty { session.issues = self.issues }
      do {
        try SessionStore.save(session, baseName: name)
        self.status = "Salvo: \(name)"
      } catch {
        self.status = "Erro ao salvar: \(error.localizedDescription)"
      }
      self.sessions = SessionStore.list()
    }
    if activeMode == .consumo { UIScreen.main.brightness = savedBrightness }
    UIApplication.shared.isIdleTimerDisabled = false
    dictation = nil
    keyword = nil
  }

  private func tick() {
    elapsed = CACurrentMediaTime() - startTime
    if elapsed - lastPerfAt >= 60 {
      perf.append(sampleRow(at: elapsed))
      lastPerfAt = elapsed
    }
    if activeMode == .consumo && elapsed >= Double(perfMinutes * 60) { stop() }
  }

  private func heard(_ engine: String, score: Double?) {
    guard running else { return }
    let t = CACurrentMediaTime() - startTime
    events.append(BenchEvent(engine: engine, t: t, score: score))
    if engine == "keyword-main" {
      base += 1
      flashBase = true
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.flashBase = false }
    } else if engine == "dictation" {
      atual += 1
      flashAtual = true
      AudioServicesPlaySystemSound(1104)
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.flashAtual = false }
    } else {
      novo += 1
      flashNovo = true
      AudioServicesPlaySystemSound(1057)
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.flashNovo = false }
    }
  }

  private func sampleRow(at t: Double) -> PerfRow {
    var stepMs: Double?
    if let k = keyword {
      let s = k.stats
      if s.steps > lastSteps {
        stepMs = (s.stepSeconds - lastStepSeconds) / Double(s.steps - lastSteps) * 1000
      }
      lastSteps = s.steps
      lastStepSeconds = s.stepSeconds
    }
    return PerfSampler.row(at: t, keywordStepMs: stepMs)
  }

  /// The bundled model names a veto (salvar-v2-rc4), so the panel shows rc1 and rc4 side by side.
  static func bundledHasVeto() -> Bool {
    let url = Bundle.main.url(forResource: "detector", withExtension: "json")
      ?? Bundle.main.url(forResource: "detector", withExtension: "json", subdirectory: "Data")
    guard let url, let data = try? Data(contentsOf: url),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
    return json["veto"] != nil
  }

  static func bundledModelVersion() -> String {
    let url = Bundle.main.url(forResource: "detector", withExtension: "json")
      ?? Bundle.main.url(forResource: "detector", withExtension: "json", subdirectory: "Data")
    guard let url, let data = try? Data(contentsOf: url),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let version = json["version"] as? String else { return "?" }
    return version
  }

  /// The model files copied into the app by `voice_bench.py prepare` (bundle root, or Data/).
  static func makeKeyword() throws -> KeywordDetector {
    func find(_ name: String, _ ext: String) -> URL? {
      Bundle.main.url(forResource: name, withExtension: ext)
        ?? Bundle.main.url(forResource: name, withExtension: ext, subdirectory: "Data")
    }
    guard let config = find("detector", "json"), let model = find("voice_embedding", "mlmodelc") else {
      throw BenchError.message("Modelos ausentes: rode voice_bench.py prepare")
    }
    return try KeywordDetector(directory: config.deletingLastPathComponent(), embeddingModel: model)
  }
}
