// Sport classifier (2026-11-11): Apple's Vision feature print of every frame under lab/sport-cls (frames/ and public/),
// for the lab to train the small head on (tools/lab/sport_cls_train.py). Run on the Mac (macOS 14+):
//
//     cd docs/focus-refs && swift tools/lab/SportFeatures.swift lab/sport-cls
//
// Writes lab/sport-cls/features.jsonl, one line per image: {"file", "rev", "v": [floats]}. Images already in the file
// are skipped, so run it again after new frames are added.
import Foundation
import Vision

let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "lab/sport-cls")
let out = root.appendingPathComponent("features.jsonl")
var done = Set<String>()
if let text = try? String(contentsOf: out, encoding: .utf8) {
  for line in text.split(separator: "\n") {
    if let d = line.data(using: .utf8),
       let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let f = o["file"] as? String {
      done.insert(f)
    }
  }
}
var files: [String] = []
for sub in ["frames", "public"] {
  let dir = root.appendingPathComponent(sub)
  guard let e = FileManager.default.enumerator(atPath: dir.path) else { continue }
  for case let p as String in e where p.lowercased().hasSuffix(".jpg") || p.lowercased().hasSuffix(".jpeg") || p.lowercased().hasSuffix(".png") {
    let rel = sub + "/" + p
    if !done.contains(rel) { files.append(rel) }
  }
}
files.sort()
print("\(done.count) already done, \(files.count) to go")
if !FileManager.default.fileExists(atPath: out.path) { FileManager.default.createFile(atPath: out.path, contents: nil) }
let fh = try FileHandle(forWritingTo: out)
fh.seekToEndOfFile()
var n = 0
for rel in files {
  autoreleasepool {
    let url = root.appendingPathComponent(rel)
    let req = VNGenerateImageFeaturePrintRequest()
    do {
      try VNImageRequestHandler(url: url).perform([req])
      guard let fp = req.results?.first as? VNFeaturePrintObservation, fp.elementType == .float else { return }
      let v: [Float] = fp.data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
      let o: [String: Any] = ["file": rel, "rev": req.revision, "v": v.map { (Double($0) * 1e5).rounded() / 1e5 }]
      var d = try JSONSerialization.data(withJSONObject: o)
      d.append(0x0A)
      fh.write(d)
      n += 1
      if n % 200 == 0 { print("\(n) / \(files.count)") }
    } catch {
      print("skip \(rel): \(error)")
    }
  }
}
try fh.close()
print("done: \(n) new")
