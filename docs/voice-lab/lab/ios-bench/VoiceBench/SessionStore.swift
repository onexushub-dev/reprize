import Foundation
import UIKit

/// One session's file (`Documents/<yyyyMMdd-HHmmss>-<kind>.json`, next to its .m4a). Read by
/// docs/voice-lab/lab/tools/voice_bench.py `results`. No transcripts are stored.
struct BenchSession: Codable {
  var kind: String              // "accuracy" | "noise" | "perf"
  var engines: [String]         // "dictation" and/or "keyword"
  var perfEngine: String?       // perf runs: "none" | "dictation" | "keyword"
  var distance: Int?
  var speaker: String?
  var expected: Int?
  var device: String
  var ios: String
  var model: String
  var start: String
  var durationSec: Double
  var events: [BenchEvent]
  var perf: [PerfRow]
  var audio: String
  var audioParts: [String]? = nil   // when recording had to start over: every .m4a, in order
  var issues: [BenchIssue]? = nil   // interruptions, app in background, recording errors
}

struct BenchIssue: Codable {
  var t: Double
  var what: String
}

struct BenchEvent: Codable {
  var engine: String            // "dictation" | "keyword"
  var t: Double                 // seconds since the session started
  var score: Double?
}

struct PerfRow: Codable {
  var t: Double
  var battery: Double           // 0…1 (iOS gives apps 5% steps)
  var thermal: String           // nominal | fair | serious | critical
  var cpuSec: Double            // this app's user + system CPU time so far
  var keywordStepMs: Double?    // mean ms per keyword step since the previous row
  var charging: Bool? = nil     // plugged in (charging or full): the battery reading is meaningless
}

enum SessionStore {
  static var folder: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }

  static func baseName(kind: String, at date: Date) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyyMMdd-HHmmss"
    return "\(f.string(from: date))-\(kind)"
  }

  static func save(_ session: BenchSession, baseName: String) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    try encoder.encode(session).write(to: folder.appendingPathComponent(baseName + ".json"))
  }

  /// Saved sessions, newest first.
  static func list() -> [BenchSession] {
    let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
    return files.filter { $0.pathExtension == "json" }
      .sorted { $0.lastPathComponent > $1.lastPathComponent }
      .compactMap { try? JSONDecoder().decode(BenchSession.self, from: Data(contentsOf: $0)) }
  }

  /// A session's two files (its .json and .m4a), whichever exist.
  static func files(of session: BenchSession) -> [URL] {
    let base = (session.audio as NSString).deletingPathExtension
    return ([base + ".json"] + (session.audioParts ?? [session.audio]))
      .map { folder.appendingPathComponent($0) }
      .filter { FileManager.default.fileExists(atPath: $0.path) }
  }

  /// Every session's files in one .zip (in the temporary folder), for AirDrop. iOS zips a folder for free when it is
  /// read "for uploading".
  static func zipAll() throws -> URL {
    let fm = FileManager.default
    let tmp = fm.temporaryDirectory
    for old in (try? fm.contentsOfDirectory(at: tmp, includingPropertiesForKeys: nil)) ?? [] where old.lastPathComponent.hasPrefix("VoiceBench-") {
      try? fm.removeItem(at: old)
    }
    let name = "VoiceBench-" + baseName(kind: SessionStore.deviceModel, at: Date())
    let dir = tmp.appendingPathComponent(name)
    try fm.createDirectory(at: dir, withIntermediateDirectories: true)
    let all = (try fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil))
      .filter { $0.pathExtension == "json" || $0.pathExtension == "m4a" }
    guard !all.isEmpty else { throw BenchError.message("Nenhuma sessão para exportar") }
    for file in all { try fm.copyItem(at: file, to: dir.appendingPathComponent(file.lastPathComponent)) }
    let zip = tmp.appendingPathComponent(name + ".zip")
    var coordinatorError: NSError?
    var copyError: Error?
    NSFileCoordinator().coordinate(readingItemAt: dir, options: .forUploading, error: &coordinatorError) { zipped in
      do { try fm.copyItem(at: zipped, to: zip) } catch { copyError = error }
    }
    try? fm.removeItem(at: dir)
    if let error = coordinatorError { throw error }
    if let error = copyError { throw error }
    return zip
  }

  static var deviceModel: String {
    var info = utsname()
    uname(&info)
    return withUnsafeBytes(of: &info.machine) { raw in
      String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
    }
  }
}

/// Battery, heat and CPU every 60 s (and on demand).
enum PerfSampler {
  static func row(at t: Double, keywordStepMs: Double?) -> PerfRow {
    var usage = rusage()
    getrusage(RUSAGE_SELF, &usage)
    let cpu = Double(usage.ru_utime.tv_sec) + Double(usage.ru_utime.tv_usec) / 1e6
      + Double(usage.ru_stime.tv_sec) + Double(usage.ru_stime.tv_usec) / 1e6
    let state = UIDevice.current.batteryState
    return PerfRow(t: t, battery: Double(UIDevice.current.batteryLevel), thermal: thermalName, cpuSec: cpu,
                   keywordStepMs: keywordStepMs, charging: state == .charging || state == .full)
  }

  static var thermalName: String {
    switch ProcessInfo.processInfo.thermalState {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "unknown"
    }
  }
}
