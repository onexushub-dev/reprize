// FocusBench (Modo Foco lab, iPhone step 2): pick clips and compute units, run, share the results JSON.

import CoreImage
import CoreML
import SwiftUI
import UIKit

struct UnitChoice: Hashable {
    let key: String
    let label: String
    let units: MLComputeUnits

    static let all: [UnitChoice] = [
        UnitChoice(key: "ne", label: "Neural Engine", units: .cpuAndNeuralEngine),
        UnitChoice(key: "gpu", label: "GPU", units: .cpuAndGPU),
        UnitChoice(key: "cpu", label: "CPU", units: .cpuOnly),
        UnitChoice(key: "all", label: "All", units: .all),
    ]

    static func find(_ key: String) -> UnitChoice {
        return all.first { $0.key == key } ?? all[0]
    }
}

/// One run configuration: the compute units of each model. Same units for all = "ne", "gpu"...; mixed = "e-ne.a-gpu...".
struct RunConfig {
    let key: String
    let label: String
    let units: [String: MLComputeUnits]

    static func same(_ u: UnitChoice) -> RunConfig {
        var units: [String: MLComputeUnits] = [:]
        for name in EdgeTAMModels.names {
            units[name] = u.units
        }
        return RunConfig(key: u.key, label: u.label, units: units)
    }

    static func mixed(_ perModel: [String: String]) -> RunConfig {
        var units: [String: MLComputeUnits] = [:]
        var parts: [String] = []
        var labels: [String] = []
        for name in EdgeTAMModels.names {
            let u = UnitChoice.find(perModel[name] ?? "ne")
            units[name] = u.units
            parts.append("\(name.prefix(1))-\(u.key)")
            labels.append("\(name.prefix(3)) \(u.key)")
        }
        return RunConfig(key: parts.joined(separator: "."), label: labels.joined(separator: ", "), units: units)
    }
}

func machineName() -> String {
    var info = utsname()
    uname(&info)
    let mirror = Mirror(reflecting: info.machine)
    var text = ""
    for child in mirror.children {
        if let value = child.value as? Int8, value != 0 {
            text.append(Character(UnicodeScalar(UInt8(bitPattern: value))))
        }
    }
    return text
}

func thermalText() -> String {
    switch ProcessInfo.processInfo.thermalState {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "unknown"
    }
}

final class BenchModel: ObservableObject {
    @Published var clips: [String] = []
    @Published var attentionFiles: [String] = ["attention"]
    @Published var attentionFile = "attention"
    @Published var selectedClips: Set<String> = []
    @Published var selectedUnits: Set<String> = ["ne"]
    @Published var mixed = false
    @Published var perModel: [String: String] = ["encoder": "ne", "attention": "gpu", "decoder": "ne", "memory": "ne"]
    @Published var quick = false
    @Published var running = false
    @Published var status = ""
    @Published var live = ""
    @Published var lines: [String] = []
    @Published var probeLines: [String] = []
    @Published var files: [URL] = []
    @Published var error = ""
    @Published var soakMode = "ball"
    @Published var detectorChoice = "yolox_s@640"  // lab test 19: model @ tile side in video px
    @Published var soakMinutes = 30
    @Published var soakLines: [String] = []
    private var stopFlag = false

    static let quickFrames = 50

    init() {
        do {
            let list = try loadJSON(BenchList.self, "bench")
            clips = list.clips
            attentionFiles = ["attention"] + (list.attentionVariants ?? []).map { "attention_" + $0 }
            selectedClips = Set(clips)
        } catch {
            self.error = error.localizedDescription
        }
        files = existingFiles()
    }

    func existingFiles() -> [URL] {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let list = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        return list.filter { $0.pathExtension == "json" || $0.pathExtension == "txt" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    func stop() {
        stopFlag = true
    }

    private func begin() -> Bool {
        if running {
            return false
        }
        running = true
        stopFlag = false
        error = ""
        live = ""
        UIApplication.shared.isIdleTimerDisabled = true
        return true
    }

    private func finish() {
        DispatchQueue.main.async {
            self.running = false
            self.files = self.existingFiles()
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }

    private func fail(_ error: Error) {
        DispatchQueue.main.async {
            self.error = error.localizedDescription
        }
    }

    func start() {
        if !begin() {
            return
        }
        let clips = self.clips.filter { selectedClips.contains($0) }
        let configs = mixed ? [RunConfig.mixed(perModel)]
            : UnitChoice.all.filter { selectedUnits.contains($0.key) }.map { RunConfig.same($0) }
        let limit = quick ? BenchModel.quickFrames : 0
        let attentionFile = self.attentionFile
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let constants = try loadJSON(Constants.self, "edgetam_constants")
                for config in configs {
                    self.post("loading the models (\(config.label))... the first Neural Engine load compiles them")
                    let models = try EdgeTAMModels(units: config.units, attentionFile: attentionFile)
                    for name in clips {
                        let clip = try loadJSON(ClipInfo.self, name + ".clip")
                        try self.runOne(clip, config, models, constants, limit, attentionFile)
                    }
                }
                self.post("done")
            } catch {
                self.fail(error)
            }
            self.finish()
        }
    }

    /// Each model alone on each compute unit, dummy inputs: which unit suits which model on this phone.
    func probeAll() {
        if !begin() {
            return
        }
        probeLines = []
        let first = clips.first ?? ""
        // only the units ticked under "Compute units" (untick GPU and All on an A12 phone: Core ML's GPU attention
        // kernel aborts the app there); each line is saved at once, so a crash keeps what was measured before it
        let units = UnitChoice.all.filter { selectedUnits.contains($0.key) }
        let attentionFiles = self.attentionFiles
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent("probe.\(machineName()).txt")
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let image = try loadFrame(first, 0)
                var lines: [String] = ["\(machineName()) iOS \(UIDevice.current.systemVersion)"]
                // every attention variant in the app, then the other models; a model that fails to load on a unit is
                // written down and the probe goes on
                var jobs: [(String, String)] = []
                for name in EdgeTAMModels.names {
                    if name == "attention" {
                        jobs += attentionFiles.map { (name, $0) }
                    } else {
                        jobs.append((name, name))
                    }
                }
                for (name, file) in jobs {
                    for unit in units {
                        if self.stopFlag {
                            throw BenchError.stopped
                        }
                        self.post("probe: \(file) on \(unit.label)...")
                        try? (lines.joined(separator: "\n") + "\n(running: \(file) on \(unit.label))\n")
                            .write(to: url, atomically: true, encoding: .utf8)
                        var line = ""
                        do {
                            let (load, ms) = try autoreleasepool {
                                try probe(name, units: unit.units, image: image, attentionFile: file)
                            }
                            line = "\(file) · \(unit.label): \(ms) ms per call (load \(round1(load)) s)"
                        } catch {
                            line = "\(file) · \(unit.label): FAILED \(error.localizedDescription.prefix(120))"
                        }
                        lines.append(line)
                        try? (lines.joined(separator: "\n") + "\n").write(to: url, atomically: true, encoding: .utf8)
                        DispatchQueue.main.async {
                            self.probeLines.append(line)
                        }
                    }
                }
                self.post("probe done")
                try? (lines.joined(separator: "\n") + "\n").write(to: url, atomically: true, encoding: .utf8)
            } catch {
                self.fail(error)
            }
            self.finish()
        }
    }

    /// The soak test (Soak.swift): the ticked clips back to back for `soakMinutes`, one row per clip with time,
    /// battery and heat, saved after every clip (soak.<work>.<device>.<time>.json).
    func startSoak() {
        if !begin() {
            return
        }
        soakLines = []
        let names = clips.filter { selectedClips.contains($0) }
        let mode = soakMode
        let minutes = soakMinutes
        let first = UnitChoice.all.first { selectedUnits.contains($0.key) } ?? UnitChoice.all[0]
        let config = mixed ? RunConfig.mixed(perModel) : RunConfig.same(first)
        let attentionFile = self.attentionFile
        let detectorChoice = self.detectorChoice
        let brightness = Double(UIScreen.main.brightness)
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmm"
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent("soak.\(mode).\(machineName()).\(formatter.string(from: Date())).json")
        DispatchQueue.global(qos: .utility).async {  // the app's analysis runs at utility priority too
            do {
                let constants = try loadJSON(Constants.self, "edgetam_constants")
                let soakClips = try names.map { try loadJSON(SoakClip.self, $0 + ".clip") }
                var models: EdgeTAMModels?
                if mode.hasPrefix("ball") {
                    self.post("loading the models (\(config.label))...")
                    models = try EdgeTAMModels(units: config.units, attentionFile: attentionFile)
                }
                let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull()])
                // lab test 17: the per-frame ball detector (alone, or before the two EdgeTAM passes at 5 fps)
                // lab test 19: the detector's model and tile side ("yolox_tiny@416"), and the two-stage modes (a3)
                var detector: BallDetector?
                let detectorParts = detectorChoice.split(separator: "@").map(String.init)
                let detectorName = detectorParts.isEmpty ? "yolox_s" : detectorParts[0]
                var detectorTile = 640
                if detectorParts.count > 1, let t = Int(detectorParts[1]) {
                    detectorTile = t
                }
                let detectorAnchor = mode.hasSuffix("a3") ? 3 : 0
                if mode.hasPrefix("det5") || mode.hasPrefix("ball5det") {
                    self.post("loading the ball detector (\(detectorName), tiles \(detectorTile) px)...")
                    detector = try BallDetector(context: context, name: detectorName, tile: detectorTile)
                    // lab test 42: one Core ML call per frame for all the regions; checked against one by one
                    if let d = detector, mode == "det5b" {
                        d.batched = true
                        d.verifyNext = true
                    }
                }
                let start = now()
                let startBattery = batteryPercent()
                var rows: [[String: Any]] = []
                var k = 0
                while now() - start < Double(minutes) * 60 && !self.stopFlag {
                    let clip = soakClips[k % soakClips.count]
                    let before = batteryPercent()
                    let thermalBefore = thermalText()
                    self.post("soak \(mode): clip \(k + 1) (\(clip.name)), \(Int((now() - start) / 60)) of \(minutes) min, battery \(Int(before))%")
                    // lab test 14: a clip whose video reader fails (seen once on ball5, clip 7) is retried up to twice
                    // with a fresh reader before the soak stops; the row keeps the retries and the reader's error
                    var retries = 0
                    var readerError = ""
                    var outcome: SoakResult?
                    while outcome == nil {
                      do {
                        outcome = try autoreleasepool { () throws -> SoakResult in
                        if let d = detector, mode.hasPrefix("det5") {
                            let r = try ballDetectPass(clip, detector: d, step: 2, anchor: detectorAnchor, k: 2,
                                                       shouldStop: { self.stopFlag })
                            var res = SoakResult()
                            res.seconds = r.seconds
                            res.frames = r.frames
                            res.detail["detS"] = round1(r.seconds)
                            res.detail["detCandidates"] = r.candidates
                            res.detail["detRegions"] = round1(Double(r.regions) / Double(max(r.frames, 1)))
                            res.detail["detMs"] = ["prep": d.timing.stats("detPrep")["median"] ?? 0,
                                                   "model": d.timing.stats("detModel")["median"] ?? 0,
                                                   "decode": d.timing.stats("detDecode")["median"] ?? 0]
                            if d.batched {
                                res.detail["batchMaxDiff"] = Double(d.batchMaxDiff)
                            }
                            return res
                        }
                        if let m = models {
                            if let d = detector, mode.hasPrefix("ball5det") {
                                let r = try ballDetectPass(clip, detector: d, step: 2, anchor: detectorAnchor, k: 2,
                                                           shouldStop: { self.stopFlag })
                                var res = try ballClip(clip, models: m, noMem: constants.noMemEmbed, context: context,
                                                       steps: (2, 2), shouldStop: { self.stopFlag })
                                res.seconds += r.seconds
                                res.detail["detS"] = round1(r.seconds)
                                res.detail["detCandidates"] = r.candidates
                                res.detail["detRegions"] = round1(Double(r.regions) / Double(max(r.frames, 1)))
                                res.detail["detMs"] = ["prep": d.timing.stats("detPrep")["median"] ?? 0,
                                                       "model": d.timing.stats("detModel")["median"] ?? 0,
                                                       "decode": d.timing.stats("detDecode")["median"] ?? 0]
                                return res
                            }
                            if mode == "ball1" || mode == "ball1_5" {
                                return try ballOnePassClip(clip, models: m, noMem: constants.noMemEmbed, context: context,
                                                           step: mode == "ball1_5" ? 2 : 1,
                                                           shouldStop: { self.stopFlag })
                            }
                            // lab test 14: two passes at lower frame rates
                            let steps: (Int, Int) = mode == "ball5" ? (2, 2) : (mode == "ball35" ? (3, 2) : (1, 1))
                            return try ballClip(clip, models: m, noMem: constants.noMemEmbed, context: context,
                                                steps: steps, shouldStop: { self.stopFlag })
                        }
                        return try peopleClip(clip, flowSide: mode == "peopleflow" ? 320 : 0,
                                              shouldStop: { self.stopFlag })
                        }
                      } catch BenchError.badOutput(let message) where message.hasPrefix("video reader") && retries < 2 {
                        retries += 1
                        readerError = message
                        self.post("soak \(mode): \(message); retrying \(clip.name) (\(retries))")
                        Thread.sleep(forTimeInterval: 1)
                      }
                    }
                    guard let r = outcome else {
                        throw BenchError.badOutput("no result")
                    }
                    k += 1
                    var row: [String: Any] = [
                        "i": k, "clip": clip.name, "seconds": round1(r.seconds), "frames": r.frames,
                        "elapsedMin": round1((now() - start) / 60), "batteryBefore": before,
                        "batteryAfter": batteryPercent(), "thermalBefore": thermalBefore, "thermalAfter": thermalText(),
                        "batteryState": batteryStateText(),
                    ]
                    for (key, value) in r.detail {
                        row[key] = value
                    }
                    if retries > 0 {
                        row["retries"] = retries
                        row["readerError"] = readerError
                    }
                    rows.append(row)
                    let report: [String: Any] = [
                        "kind": "soak", "mode": mode, "device": machineName(), "os": UIDevice.current.systemVersion,
                        "units": config.key, "attentionFile": attentionFile, "minutes": minutes,
                        "detector": mode.contains("det") ? detectorChoice : "",
                        "brightness": round1(brightness * 100) / 100,
                        "lowPower": ProcessInfo.processInfo.isLowPowerModeEnabled, "startBattery": startBattery,
                        "rows": rows,
                    ]
                    let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
                    try data.write(to: url)
                    var line = "\(k). \(clip.name): \(round1(r.seconds)) s, battery \(Int(before)) → \(Int(batteryPercent()))%, "
                        + "\(thermalBefore) → \(thermalText())"
                    if let px = r.detail["vsMacPx"] as? Double, let mm = r.detail["vsMacMismatch"] as? Int {
                        line += ", vs Mac \(px) px / \(mm)"
                    }
                    DispatchQueue.main.async {
                        self.soakLines.append(line)
                        self.files = self.existingFiles()
                    }
                }
                let used = startBattery - batteryPercent()
                let total = rows.reduce(0.0) { $0 + (($1["seconds"] as? Double) ?? 0) }
                let summary = "done: \(k) clips in \(Int((now() - start) / 60)) min, battery −\(Int(used))% "
                    + "(\(k > 0 ? round1(used / Double(k)) : 0)% per clip), \(k > 0 ? round1(total / Double(k)) : 0) s per clip, "
                    + "heat \(thermalText())"
                DispatchQueue.main.async {
                    self.soakLines.append(summary)
                }
                self.post(summary)
            } catch {
                self.fail(error)
            }
            self.finish()
        }
    }

    private func post(_ text: String) {
        DispatchQueue.main.async {
            self.status = text
        }
    }

    private func runOne(_ clip: ClipInfo, _ config: RunConfig, _ models: EdgeTAMModels, _ constants: Constants,
                        _ limit: Int, _ attentionFile: String) throws {
        let thermalStart = thermalText()
        let tracker = Tracker(models: models, noMem: constants.noMemEmbed)
        let t0 = now()
        var lastPost = 0.0
        let total = limit > 0 ? min(limit, clip.frames) : clip.frames
        let results = try tracker.track(clip, limit: limit, shouldStop: { self.stopFlag }) { done, ms in
            let t = now()
            if t - lastPost > 0.25 || done == total {
                lastPost = t
                let parts = ["encoder", "attention", "decoder", "memory", "prep", "loop", "summary"].map { name -> String in
                    let v = tracker.timing.ms[name] ?? []
                    let last = v.suffix(5).sorted()
                    return "\(name.prefix(3)) \(last.isEmpty ? 0 : Int(last[last.count / 2]))"
                }
                let liveText = "ms, last calls: " + parts.joined(separator: " · ")
                DispatchQueue.main.async {
                    self.status = "\(clip.name) · \(config.label) · frame \(done)/\(total) · \(Int(ms)) ms"
                    self.live = liveText
                }
            }
        }
        let seconds = now() - t0
        let track: [[Double]?] = results.map { r in r.flatMap { $0.summary } }
        var vsMac: [String: [String: Double]] = [:]
        if limit == 0 {
            for (name, ref) in clip.refs {
                let a = agreement(track, ref, side: clip.side)
                vsMac[name] = ["centroidPxMedian": a.medianPx, "presenceMismatch": Double(a.mismatches)]
            }
        }
        let timing = tracker.timing
        var perCall: [String: [String: Double]] = [:]
        for name in EdgeTAMModels.names {
            perCall[name] = timing.stats(name)
        }
        let report: [String: Any] = [
            "clip": clip.name, "variant": clip.variant, "device": machineName(),
            "os": UIDevice.current.systemVersion, "units": config.key, "unitsLabel": config.label,
            "attentionFile": attentionFile,
            "frames": clip.frames, "limitFrames": limit, "seedFrame": clip.seedFrame, "seconds": round1(seconds),
            "loadSeconds": models.loadSeconds.mapValues { round1($0 * 10) / 10 },
            "msPerCall": perCall, "msPrep": timing.stats("prep"), "msLoop": timing.stats("loop"),
            "msSummary": timing.stats("summary"), "msPerFrame": timing.stats("frame"),
            "thermal": [thermalStart, thermalText()], "vsMac": vsMac,
            "track": track.map { v -> Any in v.map { $0 as Any } ?? NSNull() },
            "score": results.map { r -> Any in r.map { Double($0.score) as Any } ?? NSNull() },
        ]
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let suffix = limit > 0 ? ".quick" : ""
        let att = attentionFile == "attention" ? "" : "." + attentionFile
        let url = dir.appendingPathComponent("\(clip.name).\(machineName()).\(config.key)\(att)\(suffix).json")
        let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
        try data.write(to: url)
        let frame = timing.stats("frame")
        var line = "\(clip.name) · \(config.label)\(limit > 0 ? " · first \(limit)" : ""): "
            + "\(frame["median"] ?? 0) ms/frame"
        let models4 = EdgeTAMModels.names.map { "\($0.prefix(3)) \(perCall[$0]?["median"] ?? 0)" }
        line += " (" + models4.joined(separator: ", ") + ")"
        if let mac = vsMac["coreml_ne_fp16"] {
            line += " · vs Mac \(mac["centroidPxMedian"] ?? -1) px, \(Int(mac["presenceMismatch"] ?? 0)) mismatches"
        }
        line += " · \(thermalStart) → \(thermalText())"
        DispatchQueue.main.async {
            self.lines.append(line)
            self.files = self.existingFiles()
        }
    }

    func clearResults() {
        for url in existingFiles() {
            try? FileManager.default.removeItem(at: url)
        }
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        try? FileManager.default.removeItem(at: dir.appendingPathComponent("probe.\(machineName()).txt"))
        files = []
        lines = []
        probeLines = []
    }
}

struct ContentView: View {
    @StateObject private var bench = BenchModel()

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Clips")) {
                    ForEach(bench.clips, id: \.self) { name in
                        Toggle(name, isOn: binding(name, in: \.selectedClips))
                    }
                    Toggle("Quick: first \(BenchModel.quickFrames) frames only", isOn: $bench.quick)
                }
                Section(header: Text("Compute units")) {
                    Toggle("Mixed: a unit per model", isOn: $bench.mixed)
                    if bench.attentionFiles.count > 1 {
                        Picker("attention model", selection: $bench.attentionFile) {
                            ForEach(bench.attentionFiles, id: \.self) { file in
                                Text(file).tag(file)
                            }
                        }
                    }
                    if bench.mixed {
                        ForEach(EdgeTAMModels.names, id: \.self) { name in
                            Picker(name, selection: unitBinding(name)) {
                                ForEach(UnitChoice.all, id: \.key) { unit in
                                    Text(unit.label).tag(unit.key)
                                }
                            }
                        }
                    } else {
                        ForEach(UnitChoice.all, id: \.key) { unit in
                            Toggle(unit.label, isOn: binding(unit.key, in: \.selectedUnits))
                        }
                    }
                }
                Section {
                    Button(bench.running ? "Running…" : "Run") {
                        bench.start()
                    }
                    .disabled(bench.running || bench.selectedClips.isEmpty || (!bench.mixed && bench.selectedUnits.isEmpty))
                    Button("Probe each model on the ticked units") {
                        bench.probeAll()
                    }
                    .disabled(bench.running || bench.selectedUnits.isEmpty)
                    if bench.running {
                        Button("Stop", role: .destructive) {
                            bench.stop()
                        }
                    }
                    if !bench.status.isEmpty {
                        Text(bench.status).font(.footnote).foregroundColor(.secondary)
                    }
                    if !bench.live.isEmpty {
                        Text(bench.live).font(.footnote).foregroundColor(.secondary)
                    }
                    if !bench.error.isEmpty {
                        Text(bench.error).font(.footnote).foregroundColor(.red)
                    }
                }
                Section(header: Text("Soak: battery and heat")) {
                    Picker("Work", selection: $bench.soakMode) {
                        Text("Modo Foco atual (pessoas)").tag("people")
                        Text("Pessoas + fluxo óptico (teste 13)").tag("peopleflow")
                        Text("Foco na Bola (2 passadas)").tag("ball")
                        Text("Foco na Bola (1 passada)").tag("ball1")
                        Text("Bola: 2 passadas a 5 fps (teste 14)").tag("ball5")
                        Text("Bola: passada 1 a 3,3 fps + passada 2 a 5 fps (teste 14)").tag("ball35")
                        Text("Bola: 1 passada a 5 fps (teste 14)").tag("ball1_5")
                        Text("Detector de bola a 5 fps (teste 17)").tag("det5")
                        Text("Detector de bola a 5 fps, recortes em lote (teste 42)").tag("det5b")
                        Text("Detector + 2 passadas a 5 fps (teste 17)").tag("ball5det")
                        Text("Detector em 2 etapas a 5 fps (teste 19)").tag("det5a3")
                        Text("Detector em 2 etapas + 2 passadas a 5 fps (teste 19)").tag("ball5deta3")
                    }
                    Picker("Detector", selection: $bench.detectorChoice) {
                        Text("YOLOX-S (640)").tag("yolox_s@640")
                        Text("YOLOX-Tiny (416, recortes 640)").tag("yolox_tiny@640")
                        Text("YOLOX-Tiny (416, recortes 416)").tag("yolox_tiny@416")
                        Text("Bola basquete ball_tiny_hn (416, recortes 416, teste 34)").tag("ball_tiny_hn@416")
                        Text("Bola basquete ball_tiny_gym (416, recortes 416, teste 38)").tag("ball_tiny_gym@416")
                    }
                    Stepper("Minutes: \(bench.soakMinutes)", value: $bench.soakMinutes, in: 5...90, step: 5)
                    Button("Start soak") {
                        bench.startSoak()
                    }
                    .disabled(bench.running || bench.selectedClips.isEmpty)
                    Text("Unplugged, Low Power Mode off, the same brightness for both runs; the screen stays on. Ball: the compute units and attention model above.")
                        .font(.footnote).foregroundColor(.secondary)
                    ForEach(bench.soakLines, id: \.self) { line in
                        Text(line).font(.footnote)
                    }
                }
                if !bench.probeLines.isEmpty {
                    Section(header: Text("Probe (dummy inputs)")) {
                        ForEach(bench.probeLines, id: \.self) { line in
                            Text(line).font(.footnote)
                        }
                    }
                }
                if !bench.lines.isEmpty {
                    Section(header: Text("Results")) {
                        ForEach(bench.lines, id: \.self) { line in
                            Text(line).font(.footnote)
                        }
                    }
                }
                Section(header: Text("Result files (\(bench.files.count))")) {
                    if !bench.files.isEmpty {
                        ShareLink(items: bench.files) {
                            Label("Share results", systemImage: "square.and.arrow.up")
                        }
                        Button("Delete results", role: .destructive) {
                            bench.clearResults()
                        }
                        .disabled(bench.running)
                    }
                    Text("Device \(machineName()), iOS \(UIDevice.current.systemVersion)")
                        .font(.footnote).foregroundColor(.secondary)
                }
            }
            .navigationTitle("FocusBench")
        }
        .navigationViewStyle(.stack)
    }

    private func binding(_ key: String, in path: ReferenceWritableKeyPath<BenchModel, Set<String>>) -> Binding<Bool> {
        return Binding(
            get: { bench[keyPath: path].contains(key) },
            set: { on in
                if on {
                    bench[keyPath: path].insert(key)
                } else {
                    bench[keyPath: path].remove(key)
                }
            }
        )
    }

    private func unitBinding(_ name: String) -> Binding<String> {
        return Binding(
            get: { bench.perModel[name] ?? "ne" },
            set: { bench.perModel[name] = $0 }
        )
    }
}

@main
struct FocusBenchApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
