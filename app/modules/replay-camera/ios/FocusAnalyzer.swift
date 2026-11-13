import AVFoundation
import Vision

/// Modo Foco: Jogadores. One picture every `everyMs` between `startMs` and `endMs` (`ClipScan`), people found with
/// Vision, the framing computed by `FocusPath` and written next to the clip (<clip>.focus.json). The people of each
/// analysed picture are kept in <clip>.people.json, so an analysis that was stopped goes on from where it was.
enum FocusAnalyzer {
  struct Outcome {
    let ready: Bool
    /// Analysed pictures in the range: found now and taken from the kept ones.
    let frames: Int
    let reused: Int
    let framesWithPeople: Int
    let meanPeople: Double
    let elapsedMs: Double
    let stages: ClipScan.Stages
    /// How much the framing moves (`FramingMotion`), in the video's own orientation.
    let panP95: Double
    let turnsPer10s: Double
  }

  typealias Failure = ClipScan.Failure

  static let stepMs = 100.0
  private static let lock = NSLock()
  nonisolated(unsafe) private static var cancelled = Set<String>() // guarded by `lock`

  /// Stops the analysis of this clip if it is waiting or running; it then rejects with `cancelled`.
  static func cancel(clipPath: String) {
    lock.lock(); cancelled.insert(clipPath); lock.unlock()
  }

  private static func isCancelled(_ clipPath: String) -> Bool {
    lock.lock(); defer { lock.unlock() }
    return cancelled.contains(clipPath)
  }

  private static func clearCancel(_ clipPath: String) {
    lock.lock(); cancelled.remove(clipPath); lock.unlock()
  }

  /// `peoplePath`: where the people of each analysed picture are kept ("" = not kept).
  static func analyze(clipPath: String, startMs: Double, endMs: Double, outPath: String, peoplePath: String = "",
                      debug: Bool, everyMs: Double = 100) async throws -> Outcome {
    let video = try await ClipScan.Video.load(clipPath: clipPath)
    return try await withCheckedThrowingContinuation { (done: CheckedContinuation<Outcome, Error>) in
      ClipScan.work.async {
        defer { clearCancel(clipPath) }
        do {
          done.resume(returning: try run(video: video, clipPath: clipPath, startMs: startMs, endMs: endMs,
                                         outPath: outPath, peoplePath: peoplePath, debug: debug, everyMs: everyMs))
        } catch {
          done.resume(throwing: error)
        }
      }
    }
  }

  private static func run(video: ClipScan.Video, clipPath: String, startMs: Double, endMs: Double, outPath: String,
                          peoplePath: String, debug: Bool, everyMs: Double) throws -> Outcome {
    let started = Date()
    if isCancelled(clipPath) { throw Failure.cancelled }
    let every = max(stepMs, everyMs)
    let end = endMs > startMs ? endMs : video.durationMs
    let kept = FocusFrames.read(ClipScan.readJSON(peoplePath), width: video.width, height: video.height)
    let missing = ScanTicks.missing(ticks: ScanTicks.ticks(startMs: startMs, endMs: end, everyMs: every),
                                    have: kept.map { $0.tMs }, windowMs: every)
    var stages = ClipScan.Stages()
    var found: [FocusSample] = []
    let keep = {
      ClipScan.writeJSON(FocusFrames.json(FocusFrames.merged(kept, found), width: video.width, height: video.height),
                         to: peoplePath)
    }
    defer { if !found.isEmpty { keep() } } // whatever happened, keep what was found
    try ClipScan.run(video: video, people: missing, peopleWindowMs: every, ball: nil, sideBySide: false,
                     stages: &stages, cancelled: { isCancelled(clipPath) }) { f in
      guard let p = f.people else { return }
      found.append(p)
      if found.count % 25 == 0 { keep() }
    }
    let frames = inRange(FocusFrames.merged(kept, found), startMs: startMs, endMs: end)
    let framed = Date()
    let file = try write(frames: frames, startMs: startMs, endMs: endMs, everyMs: every, width: Double(video.width),
                         height: Double(video.height), outPath: outPath, debug: debug)
    stages.path += Date().timeIntervalSince(framed) * 1000
    let motion = FramingMotion.stats(rects: file.rects.map { [$0.x, $0.y, $0.width, $0.height] }, stepMs: stepMs)
    return Outcome(ready: file.ready, frames: frames.count, reused: frames.count - found.count,
                   framesWithPeople: frames.filter { !$0.boxes.isEmpty }.count,
                   meanPeople: frames.isEmpty ? 0 : Double(frames.reduce(0) { $0 + $1.boxes.count }) / Double(frames.count),
                   elapsedMs: Date().timeIntervalSince(started) * 1000, stages: stages, panP95: motion.panP95,
                   turnsPer10s: motion.turnsPer10s)
  }

  /// The kept pictures that belong to a range (the reader used to stop at its ends).
  static func inRange(_ frames: [FocusSample], startMs: Double, endMs: Double) -> [FocusSample] {
    frames.filter { $0.tMs >= startMs - 0.5 && $0.tMs < endMs }
  }

  /// The Jogadores file of a range from its analysed pictures (`frames`, in time order). `endMs` as the analysis was
  /// asked (at or before `startMs` = to the end of the clip). Returns whether there is a framing, and its rects in the
  /// video's own orientation.
  static func write(frames: [FocusSample], startMs: Double, endMs: Double, everyMs: Double, width: Double,
                    height: Double, outPath: String, debug: Bool) throws -> (ready: Bool, rects: [FocusRect]) {
    // Row k of the file is at startMs + k × 100 ms, whatever gaps the frames had.
    var samples = FocusGrid.samples(from: frames, startMs: startMs, endMs: endMs > startMs ? endMs : .infinity, stepMs: stepMs)
    // At 5 fps the last analysed frame can be up to 200 ms before the end; its people are held to the end so the file
    // has as many rows as at 10 fps (Bola reads them row by row).
    if everyMs > stepMs, endMs > startMs, let last = samples.last {
      var tick = last.tMs + stepMs
      while tick < endMs - 0.5 { samples.append(FocusSample(tMs: tick, boxes: last.boxes)); tick += stepMs }
    }

    let landscape = width >= height
    let main: FocusAspect = landscape ? .landscape : .portrait
    let other: FocusAspect = landscape ? .portrait : .landscape
    let mainRects = FocusPath.compute(samples: samples, videoWidth: width, videoHeight: height, aspect: main, zoom: true,
                                      tuning: .action)
    let otherRects = mainRects == nil
      ? nil : FocusPath.compute(samples: samples, videoWidth: width, videoHeight: height, aspect: other, zoom: false,
                                tuning: .action)

    var file: [String: Any] = [
      "v": 1, "rules": "v15-acao-zoom110", "stepMs": stepMs, "startMs": startMs, "size": [width, height],
      "landscape": rows(landscape ? mainRects : otherRects),
      "portrait": rows(landscape ? otherRects : mainRects),
    ]
    // Test 47a: the players' median height (share of the frame height, every box of every frame), so Bola can tell a
    // recording made too far before analysing it. Read by BallAnalyzer only; the framing above is unchanged.
    let heights = frames.flatMap { $0.boxes.map { $0.height } }.sorted()
    if !heights.isEmpty {
      let mid = heights.count / 2
      file["playersHeight"] = r4(heights.count % 2 == 1 ? heights[mid] : (heights[mid - 1] + heights[mid]) / 2)
    }
    // Test 49: the person boxes per row (x, y, width, height, top-left), so Bola can keep to the main players' court
    // and aim toward the player hitting the ball (sports with `follow`). Read by BallAnalyzer only.
    file["people"] = samples.map { s in s.boxes.map { [r4($0.x), r4($0.y), r4($0.width), r4($0.height)] } }
    if debug {
      file["samples"] = samples.map { s in [s.tMs, s.boxes.map { [r4($0.x), r4($0.y), r4($0.width), r4($0.height)] }] as [Any] }
    }
    let data = try JSONSerialization.data(withJSONObject: file)
    try data.write(to: URL(fileURLWithPath: outPath), options: .atomic) // never a half-written file to read
    return (mainRects != nil, mainRects ?? [])
  }

  private static func rows(_ rects: [FocusRect]?) -> [[Double]] {
    (rects ?? []).map { [r4($0.x), r4($0.y), r4($0.width), r4($0.height)] }
  }

  private static func r4(_ v: Double) -> Double { (v * 10000).rounded() / 10000 }
}
