// Test 43a (2026-11-09): can Apple's built-in scene classifier (Vision `VNClassifyImageRequest`, on-device, free) tell
// a basketball recording from the other sports, so Seguir a Bola needs no question about the sport?
//
// For every clip in clips.txt: 3 frames inside its window (at 20%, 50%, 80%), each classified; writes every label with
// confidence >= 0.01 per frame, plus the classifier's sport-like labels, to lab/tests/sport/t43a.json.
// tools/lab/sport_report.py scores it.
//
//   cd docs/focus-refs && swift tools/lab/sport_classify.swift
import AVFoundation
import Foundation
import Vision

let root = FileManager.default.currentDirectoryPath
let clipsTxt = root + "/tools/lab/clips.txt"
guard let text = try? String(contentsOfFile: clipsTxt, encoding: .utf8) else {
  print("run from docs/focus-refs (clips.txt not found)")
  exit(1)
}

struct Clip { let name: String; let video: String; let startMs: Double; let durMs: Double; let sport: String }
var clips: [Clip] = []
var seen = Set<String>()
for line in text.split(separator: "\n") {
  let s = line.trimmingCharacters(in: .whitespaces)
  if s.isEmpty || s.hasPrefix("#") { continue }
  let f = s.split(separator: "|").map(String.init)
  guard f.count >= 5, !seen.contains(f[0]), let a = Double(f[2]), let d = Double(f[3]) else { continue }
  seen.insert(f[0])
  clips.append(Clip(name: f[0], video: f[1], startMs: a, durMs: d, sport: f[4]))
}

let words = ["ball", "sport", "basket", "volley", "tennis", "soccer", "football", "court", "stadium", "arena", "gym",
             "beach", "racket", "net", "athlet", "player", "game", "hoop", "field", "sand"]
let request = VNClassifyImageRequest()
let known = (try? request.supportedIdentifiers()) ?? []
let sportLabels = known.filter { id in words.contains { id.lowercased().contains($0) } }

var out: [[String: Any]] = []
let started = Date()
for c in clips {
  let url = URL(fileURLWithPath: root + "/" + c.video)
  guard FileManager.default.fileExists(atPath: url.path) else {
    print("missing", c.name)
    continue
  }
  let gen = AVAssetImageGenerator(asset: AVURLAsset(url: url))
  gen.appliesPreferredTrackTransform = true
  gen.maximumSize = CGSize(width: 1280, height: 1280)
  gen.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 10)
  gen.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 10)
  var frames: [[String: Any]] = []
  for f in [0.2, 0.5, 0.8] {
    let t = CMTime(seconds: (c.startMs + c.durMs * f) / 1000, preferredTimescale: 600)
    guard let image = try? gen.copyCGImage(at: t, actualTime: nil) else { continue }
    let r = VNClassifyImageRequest()
    do { try VNImageRequestHandler(cgImage: image).perform([r]) } catch { continue }
    var labels: [String: Double] = [:]
    for o in r.results ?? [] where o.confidence >= 0.01 { labels[o.identifier] = (Double(o.confidence) * 1000).rounded() / 1000 }
    frames.append(["at": f, "labels": labels])
  }
  out.append(["clip": c.name, "sport": c.sport, "frames": frames])
  let top = (frames.first?["labels"] as? [String: Double] ?? [:]).sorted { $0.value > $1.value }.prefix(4)
    .map { "\($0.key) \($0.value)" }.joined(separator: ", ")
  print(c.name, c.sport, "→", top)
}

let dir = root + "/lab/tests/sport"
try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
let file: [String: Any] = ["test": "43a", "seconds": Date().timeIntervalSince(started), "sportLabels": sportLabels.sorted(),
                           "clips": out]
let data = try! JSONSerialization.data(withJSONObject: file, options: [.prettyPrinted, .sortedKeys])
try! data.write(to: URL(fileURLWithPath: dir + "/t43a.json"))
print("wrote lab/tests/sport/t43a.json:", out.count, "clips in", Int(Date().timeIntervalSince(started)), "s")
