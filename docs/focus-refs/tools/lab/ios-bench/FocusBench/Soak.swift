// FocusBench (Modo Foco lab): the soak test. Processes the bundled clips back to back for a set time, as the app would
// after a game, and writes per clip: time, battery and heat. Two kinds, on the same clips and the same phone:
//   people  today's Modo Foco analysis (FocusAnalyzer: Vision people boxes, whole frame + 9 tiles, 10 fps)
//   peopleflow  test 13: the same + Vision optical flow (VNGenerateOpticalFlowRequest) between consecutive ticks on
//           frames scaled to 320 px, reduced to the fast-motion peak (FlowProbe, as tools/lab/flow-probe.swift)
//   ball    Foco na Bola: EdgeTAM pass 1 on the whole frame, pass 2 on 40% crops at full resolution (the crops of the
//           lab's roi40b, so pass 2 can be compared with the Mac), both read from the video with AVAssetReader.
// Throwaway test code, not the app's.

import AVFoundation
import CoreImage
import CoreML
import UIKit
import Vision

struct SoakClip: Decodable {
    let name: String
    let video: String?        // "<clip>.mp4" in the bundle (ios_bench.py prepare)
    let frames: Int
    let side: Int
    let seedFrame: Int
    let seedXY: [Double]      // the click in the crop, 0..1
    let seedXYWhole: [Double]? // the click in the whole picture, 0..1
    let roiSize: [Int]?       // upright video size the crops were cut from
    let rois: [[Int]]?        // per 100 ms frame: crop's top-left corner, px
    let players: [[Double]]?  // per 100 ms frame: centre of today's framing (roi.py's "p" guide), whole picture 0..1
    let racket: Bool?
    let refs: [String: [[Double]?]]
}

func orientationOf(_ t: CGAffineTransform) -> CGImagePropertyOrientation {
    if t.a == 0 && t.b == 1 && t.c == -1 && t.d == 0 { return .right }
    if t.a == 0 && t.b == -1 && t.c == 1 && t.d == 0 { return .left }
    if t.a == -1 && t.d == -1 { return .down }
    return .up
}

/// One reader over a clip: one frame per 100 ms tick (the first at or after each tick), upright, shaped by `shape` into
/// a 1024x1024 image for the encoder. Ticks are read in order; the ones before the clicked frame are kept (as 1024 px
/// images) for the backward pass. The app will read the backward part in chunks; here the clicks are early (0 or 2 s).
final class VideoFrames {
    private let reader: AVAssetReader
    private let output: AVAssetReaderTrackOutput
    private let orientation: CGImagePropertyOrientation
    private let shape: (CIImage, Int) -> CIImage
    private let context: CIContext
    private var pool: CVPixelBufferPool?
    private var nextMs = 0.0
    private var count = 0
    private var early: [Int: MLFeatureValue] = [:]
    private var earlyImages: [Int: CIImage] = [:]
    /// Lab test 14: ticks the tracker will ask for (the others are decoded but neither rendered nor kept).
    var wanted: (Int) -> Bool = { _ in true }
    let size: CGSize

    init(url: URL, context: CIContext, shape: @escaping (CIImage, Int) -> CIImage) throws {
        let asset = AVURLAsset(url: url)
        guard let track = asset.tracks(withMediaType: .video).first else {
            throw BenchError.missing(url.lastPathComponent)
        }
        let o = orientationOf(track.preferredTransform)
        let natural = track.naturalSize
        let turned = o == .left || o == .right
        let r = try AVAssetReader(asset: asset)
        // the decoder's own format (as FocusAnalyzer): no colour conversion of every decoded frame, Core Image converts
        // only the ticks it renders (2026-11-04 optimisation; was 32BGRA for every frame)
        let out = AVAssetReaderTrackOutput(track: track, outputSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
        ])
        out.alwaysCopiesSampleData = false
        r.add(out)
        guard r.startReading() else {
            throw BenchError.badOutput("video reader")
        }
        let attrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: 1024, kCVPixelBufferHeightKey as String: 1024,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any],
        ]
        var p: CVPixelBufferPool?
        CVPixelBufferPoolCreate(nil, nil, attrs as CFDictionary, &p)
        orientation = o
        size = CGSize(width: turned ? natural.height : natural.width, height: turned ? natural.width : natural.height)
        reader = r
        output = out
        pool = p
        self.context = context
        self.shape = shape
    }

    deinit {
        reader.cancelReading()
    }

    /// The encoder input of tick `i`.
    func feature(_ i: Int) throws -> MLFeatureValue {
        if let v = early[i] {
            early[i] = nil
            return v
        }
        while true {
            guard let next = try readTick() else {
                throw BenchError.missing("frame \(i)")
            }
            let (tick, image) = next
            if tick != i && !wanted(tick) {
                continue
            }
            let value = try render(shape(image, tick))
            if tick == i {
                return value
            }
            if tick > i {
                throw BenchError.badOutput("frames read out of order")
            }
            if wanted(tick) {
                early[tick] = value
            }
        }
    }

    /// The upright full-resolution picture of tick `i` (one pass: the crop is chosen while tracking). Ticks before the
    /// clicked frame are kept as copies for the backward part.
    func upright(_ i: Int) throws -> CIImage {
        if let image = earlyImages[i] {
            earlyImages[i] = nil
            return image
        }
        while true {
            guard let next = try readTick() else {
                throw BenchError.missing("frame \(i)")
            }
            let (tick, image) = next
            if tick == i {
                return image
            }
            if tick > i {
                throw BenchError.badOutput("frames read out of order")
            }
            if !wanted(tick) {
                continue
            }
            var copy: CVPixelBuffer?
            let attrs = [kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any]] as CFDictionary
            CVPixelBufferCreate(nil, Int(image.extent.width), Int(image.extent.height), kCVPixelFormatType_32BGRA,
                                attrs, &copy)
            guard let buffer = copy else {
                throw BenchError.badOutput("pixel buffer")
            }
            context.render(image, to: buffer)
            earlyImages[tick] = CIImage(cvPixelBuffer: buffer)
        }
    }

    /// An already shaped 1024x1024 image as the encoder's input.
    func encoderInput(_ image: CIImage) throws -> MLFeatureValue {
        return try render(image)
    }

    private func readTick() throws -> (Int, CIImage)? {
        while let buffer = output.copyNextSampleBuffer() {
            let t = CMSampleBufferGetPresentationTimeStamp(buffer).seconds * 1000
            if t + 0.5 < nextMs {
                continue
            }
            while nextMs <= t + 0.5 {
                nextMs += 100
            }
            guard let pixels = CMSampleBufferGetImageBuffer(buffer) else {
                continue
            }
            var image = CIImage(cvPixelBuffer: pixels).oriented(orientation)
            image = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
            let tick = count
            count += 1
            return (tick, image)
        }
        if reader.status == .failed {
            var detail = "unknown"
            if let e = reader.error {
                let ns = e as NSError
                detail = "\(ns.domain) \(ns.code): \(ns.localizedDescription)"
            }
            throw BenchError.badOutput("video reader failed at tick \(count) (\(detail))")
        }
        return nil
    }

    private func render(_ image: CIImage) throws -> MLFeatureValue {
        var out: CVPixelBuffer?
        if let pool = pool {
            CVPixelBufferPoolCreatePixelBuffer(nil, pool, &out)
        }
        guard let buffer = out else {
            throw BenchError.badOutput("pixel buffer")
        }
        context.render(image, to: buffer)
        return MLFeatureValue(pixelBuffer: buffer)
    }
}

func uprightSize(_ url: URL) throws -> CGSize {
    guard let track = AVURLAsset(url: url).tracks(withMediaType: .video).first else {
        throw BenchError.missing(url.lastPathComponent)
    }
    let o = orientationOf(track.preferredTransform)
    let n = track.naturalSize
    return (o == .left || o == .right) ? CGSize(width: n.height, height: n.width) : n
}

/// pass 1: the whole upright picture squeezed to 1024x1024 (as EdgeTAM's loader does).
func wholeFrame(_ size: CGSize) -> (CIImage, Int) -> CIImage {
    return { image, _ in
        image.transformed(by: CGAffineTransform(scaleX: 1024 / size.width, y: 1024 / size.height))
    }
}

/// pass 2: the crop of tick i (top-left corner in px, upright picture), scaled to 1024x1024.
func cropFrame(_ size: CGSize, side: Int, rois: [[Int]], sourceSize: [Int]) -> (CIImage, Int) -> CIImage {
    // the crops were computed on the source video's size; the bundled video may be scaled
    let sx = size.width / CGFloat(sourceSize[0])
    let sy = size.height / CGFloat(sourceSize[1])
    return { image, i in
        let r = rois[min(max(i, 0), rois.count - 1)]
        let s = CGFloat(side)
        let x = CGFloat(r[0]) * sx
        let yTop = CGFloat(r[1]) * sy
        let rect = CGRect(x: x, y: size.height - yTop - s * sy, width: s * sx, height: s * sy) // CI: origin bottom-left
        return image.cropped(to: rect)
            .transformed(by: CGAffineTransform(translationX: -rect.minX, y: -rect.minY))
            .transformed(by: CGAffineTransform(scaleX: 1024 / rect.width, y: 1024 / rect.height))
    }
}

// MARK: - the two kinds of work

struct SoakResult {
    var seconds: Double = 0
    var frames = 0
    var detail: [String: Any] = [:]
}

/// Foco na Bola on one clip: pass 1 (whole frame) then pass 2 (crops), as the app will run it after the tap.
/// Lab test 14: how many ticks of a clip are on the grid through the clicked frame.
func trackedCount(_ n: Int, seed: Int, step: Int) -> Int {
    return (0..<n).filter { ($0 - seed) % step == 0 }.count
}

/// Lab test 14: `steps` = (pass 1, pass 2) ticks between tracked frames: (1, 1) = v6 at 10 fps, (2, 2) = both at 5 fps,
/// (3, 2) = pass 1 at 3.3 fps, pass 2 at 5 fps. The crops of pass 2 stay v6's (roi40b): the cost does not depend on
/// where the crop is; the quality of each version was measured on the Mac (README test 14).
func ballClip(_ clip: SoakClip, models: EdgeTAMModels, noMem: [Float], context: CIContext, steps: (Int, Int) = (1, 1),
              shouldStop: @escaping () -> Bool) throws -> SoakResult {
    guard let videoName = clip.video, let url = bundleURL((videoName as NSString).deletingPathExtension, "mp4"),
          let rois = clip.rois, let sourceSize = clip.roiSize, let whole = clip.seedXYWhole else {
        throw BenchError.missing("\(clip.name).mp4 / rois (run ios_bench.py prepare again)")
    }
    var result = SoakResult()
    let t0 = now()
    var passMs: [Double] = []
    var track: [FrameResult?] = []
    let size = try uprightSize(url)
    for pass in 1...2 {
        let tp = now()
        let reader = try VideoFrames(url: url, context: context,
                                     shape: pass == 1 ? wholeFrame(size)
                                         : cropFrame(size, side: clip.side, rois: rois, sourceSize: sourceSize))
        let info = ClipInfo(name: clip.name, variant: "soak", sport: "", frames: clip.frames,
                            side: pass == 1 ? 1024 : clip.side, seedFrame: clip.seedFrame,
                            seedXY: pass == 1 ? whole : clip.seedXY, refs: [:])
        let tracker = Tracker(models: models, noMem: noMem)
        let step = pass == 1 ? steps.0 : steps.1
        tracker.step = step
        let seed = clip.seedFrame
        reader.wanted = { tick in (tick - seed) % step == 0 }
        tracker.source = { i in try reader.feature(i) }
        let out = try tracker.trackFast(info, shouldStop: shouldStop)
        passMs.append((now() - tp) * 1000)
        var ms: [String: Double] = [:]
        for name in ["prep", "loop", "summary", "frame"] + EdgeTAMModels.names {
            ms[name] = tracker.timing.stats(name)["median"] ?? 0
        }
        result.detail["pass\(pass)Ms"] = ms
        if pass == 2 {
            track = out
        }
        result.frames += trackedCount(clip.frames, seed: clip.seedFrame, step: step)
    }
    result.seconds = now() - t0
    let summaries: [[Double]?] = track.map { r in r.flatMap { $0.summary } }
    if let mac = clip.refs["coreml_ne_fp16"], steps == (1, 1) {
        let a = agreement(summaries, mac, side: clip.side)
        result.detail["vsMacPx"] = a.medianPx
        result.detail["vsMacMismatch"] = a.mismatches
    }
    result.detail["pass1S"] = round1(passMs[0] / 1000)
    result.detail["pass2S"] = round1(passMs[1] / 1000)
    return result
}

/// Today's Modo Foco analysis on one clip (FocusAnalyzer's reading and Vision requests; the path itself is negligible).
// MARK: - lab tests 17 / 19: per-frame ball detector (YOLOX, COCO "sports ball"), whole frame + 640 px tiles

/// YOLOX as Core ML (`yolox_s` / `yolox_tiny` / `yolox_nano`.mlpackage, made in the lab from Megvii's COCO weights,
/// Apache-2.0): image side x side BGR (640 for S, 416 for Tiny and Nano), output [1, anchors, 85] = per anchor xy
/// offsets, log wh, objectness, 80 class scores (already sigmoid).
/// Test 34 (2026-11-08): also the lab's one-class basketball detector (`ball_tiny_hn`.mlpackage, YOLOX-Tiny fine-tuned
/// by tools/lab/ball_train_pub.py, converted by yolox_coreml.py --ball): output [1, anchors, 6], the class in column 5.
struct BallCandidate {
    var x: Double  // centre in the upright frame, 0..1, origin top-left
    var y: Double
    var score: Float
}

final class BallDetector {
    let model: MLModel
    let context: CIContext
    let name: String
    let side: Int  // the model's input side
    let tile: Int  // tile side in video px (scaled to `side`; test 19: 640 or 416)
    private var pool: CVPixelBufferPool?
    let timing = Timing()
    private var grid: [(Float, Float, Float)] = []  // (gx, gy, stride) per anchor

    init(context: CIContext, name: String = "yolox_s", tile: Int = 640) throws {
        guard let url = bundleURL(name, "mlmodelc") else {
            throw BenchError.missing("\(name).mlpackage (ios_bench.py prepare)")
        }
        let config = MLModelConfiguration()
        config.computeUnits = .cpuAndNeuralEngine
        let m = try MLModel(contentsOf: url, configuration: config)
        var s = 640
        if let input = m.modelDescription.inputDescriptionsByName["image"], let c = input.imageConstraint {
            s = c.pixelsWide
        }
        model = m
        side = s
        self.name = name
        self.tile = tile
        self.context = context
        let attrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: s, kCVPixelBufferHeightKey as String: s,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any],
        ]
        var p: CVPixelBufferPool?
        CVPixelBufferPoolCreate(nil, nil, attrs as CFDictionary, &p)
        pool = p
        for stride in [8, 16, 32] {
            let n = s / stride
            for y in 0..<n {
                for x in 0..<n {
                    grid.append((Float(x), Float(y), Float(stride)))
                }
            }
        }
    }

    /// Tile origins along one side (as tools/lab/ball_detect.py: `t` px, 80 px overlap at least).
    static func starts(_ n: Int, _ t: Int = 640, _ overlap: Int = 80) -> [Int] {
        if n <= t {
            return [0]
        }
        let k = Int((Double(n - overlap) / Double(t - overlap)).rounded(.up))
        return (0..<k).map { i in Int((Double(i) * Double(n - t) / Double(k - 1)).rounded()) }
    }

    /// All tile origins (x, y from the top-left) of a W x H upright frame.
    func tileOrigins(_ W: Int, _ H: Int) -> [(Int, Int)] {
        var out: [(Int, Int)] = []
        for y0 in BallDetector.starts(H, tile) {
            for x0 in BallDetector.starts(W, tile) {
                out.append((x0, y0))
            }
        }
        return out
    }

    /// One upright frame (origin 0, 0): the whole frame and the tiles (`tiles` nil = all of them). Returns the number of
    /// candidates with score >= conf, the best one, and the number of model calls.
    func detect(_ image: CIImage, conf: Float = 0.05, tiles: [(Int, Int)]? = nil) throws
        -> (count: Int, best: BallCandidate?, regions: Int) {
        let W = Int(image.extent.width), H = Int(image.extent.height)
        let S = CGFloat(side)
        let grey = CIImage(color: CIColor(red: 114 / 255, green: 114 / 255, blue: 114 / 255))
            .cropped(to: CGRect(x: 0, y: 0, width: S, height: S))
        // (model input, model px per video px, tile origin in the frame)
        var regions: [(CIImage, CGFloat, Int, Int)] = []
        // whole frame, letterboxed into the top-left corner of a grey square
        let r = min(S / CGFloat(W), S / CGFloat(H))
        let scaled = image.transformed(by: CGAffineTransform(scaleX: r, y: r))
        let top = scaled.transformed(by: CGAffineTransform(translationX: 0, y: S - scaled.extent.height))
        regions.append((top.composited(over: grey), r, 0, 0))
        let ts = S / CGFloat(tile)
        var chosen: [(Int, Int)] = []
        if let list = tiles {
            chosen = list
        } else {
            chosen = tileOrigins(W, H)
        }
        for (x0, y0) in chosen {
            let tw = min(tile, W), th = min(tile, H)
            let rect = CGRect(x: x0, y: H - y0 - th, width: tw, height: th)  // CI: origin bottom-left
            var crop = image.cropped(to: rect).transformed(by: CGAffineTransform(translationX: -rect.minX,
                                                                                 y: -rect.minY))
            if ts != 1 {
                crop = crop.transformed(by: CGAffineTransform(scaleX: ts, y: ts))
            }
            crop = crop.transformed(by: CGAffineTransform(translationX: 0, y: S - crop.extent.height))
            regions.append((ts == 1 && tw == tile && th == tile ? crop : crop.composited(over: grey), ts, x0, y0))
        }
        var found = 0
        var best: BallCandidate?
        for (region, scale, x0, y0) in regions {
            var out: CVPixelBuffer?
            if let pool = pool {
                CVPixelBufferPoolCreatePixelBuffer(nil, pool, &out)
            }
            guard let buffer = out else {
                throw BenchError.badOutput("pixel buffer")
            }
            let t0 = now()
            context.render(region, to: buffer)
            timing.add("detPrep", now() - t0)
            let t1 = now()
            let result = try model.prediction(from: MLDictionaryFeatureProvider(dictionary: ["image": MLFeatureValue(pixelBuffer: buffer)]))
            timing.add("detModel", now() - t1)
            let t2 = now()
            guard let value = result.featureValue(for: "output"), let array = value.multiArrayValue else {
                throw BenchError.badOutput("yolox output")
            }
            let s = scan(array, conf)
            found += s.count
            if s.index >= 0 && s.index < grid.count {
                let isBetter: Bool
                if let b = best {
                    isBetter = s.score > b.score
                } else {
                    isBetter = true
                }
                if isBetter {
                    let g = grid[s.index]
                    let cx = (s.dx + g.0) * g.2, cy = (s.dy + g.1) * g.2  // model px
                    best = BallCandidate(x: (Double(cx) / Double(scale) + Double(x0)) / Double(W),
                                         y: (Double(cy) / Double(scale) + Double(y0)) / Double(H), score: s.score)
                }
            }
            timing.add("detDecode", now() - t2)
        }
        return (found, best, regions.count)
    }

    /// Anchors whose objectness x ball class score >= conf, and the best one (index, raw xy offsets, score).
    private func scan(_ a: MLMultiArray, _ conf: Float) -> (count: Int, index: Int, dx: Float, dy: Float, score: Float) {
        let rows = a.shape[1].intValue
        let rowStride = a.strides[1].intValue
        let colStride = a.strides[2].intValue
        // COCO (85 columns): class 32 "sports ball"; the lab's one-class ball model (6 columns): class 0
        let cls = a.shape[2].intValue == 85 ? 32 : 0
        var n = 0
        var bi = -1
        var bs: Float = 0
        var dx: Float = 0
        var dy: Float = 0
        if a.dataType == .float16 {
            let p = a.dataPointer.assumingMemoryBound(to: Float16.self)
            for i in 0..<rows {
                let obj = Float(p[i * rowStride + 4 * colStride])
                if obj < conf {
                    continue
                }
                let s = obj * Float(p[i * rowStride + (5 + cls) * colStride])
                if s >= conf {
                    n += 1
                    if s > bs {
                        bs = s
                        bi = i
                        dx = Float(p[i * rowStride])
                        dy = Float(p[i * rowStride + colStride])
                    }
                }
            }
        } else {
            let p = a.dataPointer.assumingMemoryBound(to: Float.self)
            for i in 0..<rows {
                let obj = p[i * rowStride + 4 * colStride]
                if obj < conf {
                    continue
                }
                let s = obj * p[i * rowStride + (5 + cls) * colStride]
                if s >= conf {
                    n += 1
                    if s > bs {
                        bs = s
                        bi = i
                        dx = p[i * rowStride]
                        dy = p[i * rowStride + colStride]
                    }
                }
            }
        }
        return (n, bi, dx, dy, bs)
    }
}

/// Reads the clip's video as the app would, at the 100 ms ticks through the click, every `step`-th one: `body(j, image)`
/// with j = the analysed frame's index (0 at the click, negative before it) and the upright image (origin 0, 0).
private func readTicks(_ clip: SoakClip, step: Int, shouldStop: () -> Bool,
                       _ body: (Int, CIImage) throws -> Void) throws {
    guard let videoName = clip.video, let url = bundleURL((videoName as NSString).deletingPathExtension, "mp4") else {
        throw BenchError.missing("\(clip.name).mp4 (run ios_bench.py prepare again)")
    }
    let asset = AVURLAsset(url: url)
    guard let track = asset.tracks(withMediaType: .video).first else {
        throw BenchError.missing(url.lastPathComponent)
    }
    let orientation = orientationOf(track.preferredTransform)
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
    ])
    output.alwaysCopiesSampleData = false
    reader.add(output)
    guard reader.startReading() else {
        throw BenchError.badOutput("video reader")
    }
    var next = 0.0
    var tick = 0
    while let buffer = output.copyNextSampleBuffer() {
        if shouldStop() {
            reader.cancelReading()
            throw BenchError.stopped
        }
        let t = CMSampleBufferGetPresentationTimeStamp(buffer).seconds * 1000
        if t + 0.5 < next {
            continue
        }
        while next <= t + 0.5 {
            next += 100
        }
        let k = tick
        tick += 1
        if (k - clip.seedFrame) % step != 0 {
            continue
        }
        guard let pixels = CMSampleBufferGetImageBuffer(buffer) else {
            continue
        }
        try autoreleasepool {
            var image = CIImage(cvPixelBuffer: pixels).oriented(orientation)
            image = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
            try body((k - clip.seedFrame) / step, image)
        }
    }
    if reader.status == .failed {
        var detail = ""
        if let e = reader.error {
            detail = ": " + e.localizedDescription
        }
        throw BenchError.badOutput("video reader failed" + detail)
    }
}

private func floorMod(_ a: Int, _ n: Int) -> Int {
    let r = a % n
    return r < 0 ? r + n : r
}

/// The detector over a clip at 5 fps (`step` 2). `anchor` 0 (test 17): the whole frame and all the tiles on every
/// analysed frame. `anchor` A > 0 (test 19, two stages, the video read twice): all the tiles on every A-th analysed
/// frame; then, on the others, the whole frame and only the `k` tiles nearest the ball interpolated between those frames
/// (here the best candidate of each anchor frame; the lab picks it with ball_track.py's path, the same cost).
func ballDetectPass(_ clip: SoakClip, detector: BallDetector, step: Int, anchor: Int = 0, k: Int = 2,
                    shouldStop: () -> Bool) throws -> (seconds: Double, frames: Int, candidates: Int, regions: Int) {
    let t0 = now()
    var frames = 0
    var candidates = 0
    var regions = 0
    if anchor <= 0 {
        try readTicks(clip, step: step, shouldStop: shouldStop) { _, image in
            let r = try detector.detect(image)
            candidates += r.count
            regions += r.regions
            frames += 1
        }
        return (now() - t0, frames, candidates, regions)
    }
    var best: [Int: BallCandidate] = [:]
    try readTicks(clip, step: step, shouldStop: shouldStop) { j, image in
        if floorMod(j, anchor) != 0 {
            return
        }
        let r = try detector.detect(image)
        candidates += r.count
        regions += r.regions
        frames += 1
        if let b = r.best {
            best[j] = b
        }
    }
    let keys = best.keys.sorted()
    try readTicks(clip, step: step, shouldStop: shouldStop) { j, image in
        if floorMod(j, anchor) == 0 {
            return
        }
        // the ball between the anchor frames around j (the frame centre when there is none yet)
        var prev: Int?
        var nextKey: Int?
        for key in keys {
            if key <= j {
                prev = key
            } else if nextKey == nil {
                nextKey = key
            }
        }
        var tx = 0.5
        var ty = 0.5
        if let a = prev, let pa = best[a], let b = nextKey, let pb = best[b] {
            let f = Double(j - a) / Double(b - a)
            tx = pa.x + (pb.x - pa.x) * f
            ty = pa.y + (pb.y - pa.y) * f
        } else if let a = prev, let pa = best[a] {
            tx = pa.x
            ty = pa.y
        } else if let b = nextKey, let pb = best[b] {
            tx = pb.x
            ty = pb.y
        }
        let W = Double(image.extent.width), H = Double(image.extent.height)
        let half = Double(detector.tile) / 2
        let px = tx * W, py = ty * H
        let order = detector.tileOrigins(Int(W), Int(H)).sorted { u, v in
            hypot(Double(u.0) + half - px, Double(u.1) + half - py) < hypot(Double(v.0) + half - px, Double(v.1) + half - py)
        }
        let r = try detector.detect(image, tiles: Array(order.prefix(k)))
        candidates += r.count
        regions += r.regions
        frames += 1
    }
    return (now() - t0, frames, candidates, regions)
}

// MARK: - optical flow (lab test 13; the same code as tools/lab/flow-probe.swift)

/// Scales frames to `side` px on the long side (upright) and returns, per pair, the peak of the flow magnitude.
final class FlowProbe {
    let side: Int
    let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull()])
    var previous: CVPixelBuffer?
    var flowMs: [Double] = []
    var scaleMs: [Double] = []
    var outputSize: [Int] = []

    init(side: Int) { self.side = side }

    func scaled(_ pixels: CVPixelBuffer, _ orientation: CGImagePropertyOrientation) -> CVPixelBuffer? {
        let image = CIImage(cvPixelBuffer: pixels).oriented(orientation)
        let e = image.extent
        let s = Double(side) / Double(max(e.width, e.height))
        let w = Int((Double(e.width) * s).rounded()), h = Int((Double(e.height) * s).rounded())
        var out: CVPixelBuffer?
        let attrs: [String: Any] = [kCVPixelBufferIOSurfacePropertiesKey as String: [:]]
        CVPixelBufferCreate(nil, w, h, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &out)
        guard let buffer = out else { return nil }
        let moved = image.transformed(by: CGAffineTransform(translationX: -e.minX, y: -e.minY))
            .transformed(by: CGAffineTransform(scaleX: CGFloat(s), y: CGFloat(s)))
        context.render(moved, to: buffer)
        return buffer
    }

    /// The next tick's frame; nil for the first one (no pair yet) or when Vision fails.
    func add(_ pixels: CVPixelBuffer, _ orientation: CGImagePropertyOrientation) -> [Double]? {
        let t0 = Date()
        guard let current = scaled(pixels, orientation) else { return nil }
        scaleMs.append(Date().timeIntervalSince(t0) * 1000)
        defer { previous = current }
        guard let before = previous else { return nil }
        let t1 = Date()
        let request = VNGenerateOpticalFlowRequest(targetedCVPixelBuffer: current, options: [:])
        request.computationAccuracy = .low
        request.outputPixelFormat = kCVPixelFormatType_TwoComponent32Float
        do {
            try VNImageRequestHandler(cvPixelBuffer: before, options: [:]).perform([request])
        } catch {
            return nil
        }
        flowMs.append(Date().timeIntervalSince(t1) * 1000)
        guard let results = request.results, let observation = results.first else { return nil }
        return FlowProbe.peak(observation.pixelBuffer, inputLong: Double(max(CVPixelBufferGetWidth(current),
                                                                                CVPixelBufferGetHeight(current))),
                              sizeOut: &outputSize)
    }

    /// broadcast.py flow_peak: magnitude minus its median, box blur over 1/12 of the long side, argmax.
    static func peak(_ flow: CVPixelBuffer, inputLong: Double, sizeOut: inout [Int]) -> [Double]? {
        CVPixelBufferLockBaseAddress(flow, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(flow, .readOnly) }
        let w = CVPixelBufferGetWidth(flow), h = CVPixelBufferGetHeight(flow)
        sizeOut = [w, h]
        guard let base = CVPixelBufferGetBaseAddress(flow) else { return nil }
        let row = CVPixelBufferGetBytesPerRow(flow)
        // flow vectors are in pixels of the output buffer; scale them to the input frame
        let toInput = inputLong / Double(max(w, h))
        var mag = [Double](repeating: 0, count: w * h)
        for y in 0..<h {
            let p = (base + y * row).assumingMemoryBound(to: Float.self)
            for x in 0..<w {
                let u = Double(p[2 * x]), v = Double(p[2 * x + 1])
                mag[y * w + x] = (u * u + v * v).squareRoot() * toInput
            }
        }
        let sorted = mag.sorted()
        let median = sorted[sorted.count / 2]
        // integral image of max(mag - median, 0)
        var integral = [Double](repeating: 0, count: (w + 1) * (h + 1))
        for y in 0..<h {
            var acc = 0.0
            for x in 0..<w {
                acc += max(mag[y * w + x] - median, 0)
                integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + acc
            }
        }
        let k = max(3, (max(w, h) / 12) | 1), r = k / 2
        var best = -1.0, bx = 0, by = 0
        for y in 0..<h {
            let y0 = max(0, y - r), y1 = min(h, y + r + 1)
            for x in 0..<w {
                let x0 = max(0, x - r), x1 = min(w, x + r + 1)
                let sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0]
                    + integral[y0 * (w + 1) + x0]
                let mean = sum / Double(k * k) // cv2.blur's border handling differs slightly; fine for a lab signal
                if mean > best { best = mean; bx = x; by = y }
            }
        }
        let strength = best / inputLong
        if strength < 1e-4 { return nil }
        func r4(_ v: Double) -> Double { (v * 10000).rounded() / 10000 }
        return [r4((Double(bx) + 0.5) / Double(w)), r4((Double(by) + 0.5) / Double(h)), (strength * 100000).rounded() / 100000]
    }
}

func peopleClip(_ clip: SoakClip, flowSide: Int = 0, shouldStop: () -> Bool) throws -> SoakResult {
    guard let videoName = clip.video, let url = bundleURL((videoName as NSString).deletingPathExtension, "mp4") else {
        throw BenchError.missing("\(clip.name).mp4 (run ios_bench.py prepare again)")
    }
    let t0 = now()
    let asset = AVURLAsset(url: url)
    guard let track = asset.tracks(withMediaType: .video).first else {
        throw BenchError.missing(url.lastPathComponent)
    }
    let orientation = orientationOf(track.preferredTransform)
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
    ])
    output.alwaysCopiesSampleData = false
    reader.add(output)
    guard reader.startReading() else {
        throw BenchError.badOutput("video reader")
    }
    let request = VNDetectHumanRectanglesRequest()
    request.upperBodyOnly = false
    var tiles: [VNDetectHumanRectanglesRequest] = []
    for row in [1, 0, 2] { // ScanTiles.regions: 3 x 3 half-frame regions, middle row first
        for col in 0..<3 {
            let r = VNDetectHumanRectanglesRequest()
            r.upperBodyOnly = false
            r.regionOfInterest = CGRect(x: Double(col) * 0.25, y: Double(row) * 0.25, width: 0.5, height: 0.5)
            tiles.append(r)
        }
    }
    var next = 0.0
    var frames = 0
    var people = 0
    let flow: FlowProbe? = flowSide > 0 ? FlowProbe(side: flowSide) : nil
    var peaks = 0
    while let buffer = output.copyNextSampleBuffer() {
        if shouldStop() {
            reader.cancelReading()
            throw BenchError.stopped
        }
        let t = CMSampleBufferGetPresentationTimeStamp(buffer).seconds * 1000
        if t + 0.5 < next {
            continue
        }
        while next <= t + 0.5 {
            next += 100
        }
        guard let pixels = CMSampleBufferGetImageBuffer(buffer) else {
            continue
        }
        autoreleasepool {
            do {
                try VNImageRequestHandler(cvPixelBuffer: pixels, orientation: orientation).perform([request] + tiles)
                people += (request.results ?? []).filter { $0.confidence >= 0.3 }.count
            } catch {
            }
            if let f = flow, f.add(pixels, orientation) != nil {
                peaks += 1
            }
        }
        frames += 1
    }
    var result = SoakResult()
    result.seconds = now() - t0
    result.frames = frames
    result.detail["peoplePerFrame"] = frames > 0 ? round1(Double(people) / Double(frames)) : 0
    if let f = flow {
        func median(_ v: [Double]) -> Double { v.isEmpty ? 0 : v.sorted()[v.count / 2] }
        result.detail["flowMsMedian"] = round1(median(f.flowMs))
        result.detail["flowScaleMsMedian"] = round1(median(f.scaleMs))
        result.detail["flowPeaks"] = peaks
        result.detail["flowOutputSize"] = f.outputSize
    }
    return result
}

// MARK: - battery

func batteryPercent() -> Double {
    let device = UIDevice.current
    if !device.isBatteryMonitoringEnabled {
        device.isBatteryMonitoringEnabled = true
    }
    let level = device.batteryLevel
    return level < 0 ? -1 : Double(Int((level * 100).rounded()))
}

func batteryStateText() -> String {
    switch UIDevice.current.batteryState {
    case .charging: return "charging"
    case .full: return "full"
    case .unplugged: return "unplugged"
    default: return "unknown"
    }
}

// MARK: - the loop without array copies (2026-11-04 optimisation)

func isContiguous(_ a: MLMultiArray) -> Bool {
    var expected = 1
    for (dim, stride) in zip(a.shape.reversed(), a.strides.reversed()) {
        if stride.intValue != expected {
            return false
        }
        expected *= dim.intValue
    }
    return true
}

/// `count` floats of `src` into `dst` from element `offset` (memcpy when the output is plain float32).
func copyFloats(_ src: MLMultiArray, into dst: MLMultiArray, at offset: Int, count: Int) {
    let target = dst.dataPointer.advanced(by: offset * MemoryLayout<Float>.size)
    if src.dataType == .float32 && isContiguous(src) {
        memcpy(target, src.dataPointer, count * MemoryLayout<Float>.size)
        return
    }
    let values = floats(src)
    values.withUnsafeBufferPointer { from in
        if let base = from.baseAddress {
            memcpy(target, base, min(count, values.count) * MemoryLayout<Float>.size)
        }
    }
}

extension Tracker {
    /// `track` with the model outputs passed on as they come: the bank keeps the memory model's own outputs (float32),
    /// the attention's inputs are preallocated once and filled with memcpy, the constant inputs are made once, and
    /// frames more than 16 away from both the click and the current frame leave the bank.
    func trackFast(_ clip: ClipInfo, shouldStop: () -> Bool) throws -> [FrameResult?] {
        let n = clip.frames
        let s = clip.seedFrame
        let memSize = Tracker.memSize
        var results = [FrameResult?](repeating: nil, count: n)
        var bank: [Int: (mem: MLMultiArray, ptr: MLMultiArray)] = [:]
        let memIn = try MLMultiArray(shape: [NSNumber(value: Tracker.nMem), 512, 64], dataType: .float32)
        let ptrIn = try MLMultiArray(shape: [NSNumber(value: Tracker.nPtr), 256], dataType: .float32)
        let memOn = try MLMultiArray(shape: [1, NSNumber(value: Tracker.nMem)], dataType: .float32)
        let ptrOn = try MLMultiArray(shape: [1, NSNumber(value: Tracker.nPtr)], dataType: .float32)
        let pad = feature(multiArray([0, 0, 0, 0], [1, 2, 2]))
        let none = feature(multiArray([-1, -1], [1, 2]))
        let soft = feature(multiArray([0], [1, 1]))

        var t = now()
        let (s0, s1, vision) = try encode(clip, s)
        var values = floats(vision)
        for c in 0..<256 {
            let add = noMem[c]
            for i in 0..<4096 {
                values[c * 4096 + i] += add
            }
        }
        let seed = multiArray([Float(clip.seedXY[0] * 1024), Float(clip.seedXY[1] * 1024), 0, 0], [1, 2, 2])
        let first = try models.run("decoder", ["pix": feature(multiArray(values, [1, 256, 64, 64])), "feat_s0": feature(s0),
                                               "feat_s1": feature(s1), "points": feature(seed),
                                               "labels": feature(multiArray([1, -1], [1, 2]))], timing)
        let mask = try output(first, "mask")
        let condPtr = try output(first, "obj_ptr")
        let condMem = try output(try models.run("memory", ["vision": feature(vision), "mask": feature(mask),
                                                           "hard": feature(multiArray([1], [1, 1]))], timing), "mem")
        let firstScore = floats(try output(first, "score"))
        results[s] = FrameResult(summary: summarize(floats(mask), n: 256, side: clip.side),
                                 score: firstScore.isEmpty ? -1 : firstScore[0])
        timing.add("frame", now() - t)

        for (sign, order) in [(1, Array(stride(from: s + step, to: n, by: step))),
                              (-1, Array(stride(from: s - step, through: 0, by: -step)))] {
            for f in order {
                if shouldStop() {
                    throw BenchError.stopped
                }
                try autoreleasepool {
                    t = now()
                    let (fs0, fs1, fvision) = try encode(clip, f)
                    let tLoop = now()
                    for slot in 0..<Tracker.nMem {
                        var src = condMem
                        var on: Float = 1
                        if slot > 0 {
                            if let prev = bank[f - sign * step * (Tracker.nMem - slot)] {
                                src = prev.mem
                            } else {
                                on = 0
                            }
                        }
                        copyFloats(src, into: memIn, at: slot * memSize, count: memSize)
                        memOn[slot] = NSNumber(value: on)
                    }
                    for k in 0..<Tracker.nPtr {
                        var src = condPtr
                        var on: Float = 1
                        if k > 0 {
                            if let prev = bank[f - sign * step * k] {
                                src = prev.ptr
                            } else {
                                on = 0
                            }
                        }
                        copyFloats(src, into: ptrIn, at: k * 256, count: 256)
                        ptrOn[k] = NSNumber(value: on)
                    }
                    timing.add("loop", now() - tLoop)
                    let att = try models.run("attention", ["vision": feature(fvision), "mem": feature(memIn),
                                                           "ptr": feature(ptrIn), "mem_on": feature(memOn),
                                                           "ptr_on": feature(ptrOn)], timing)
                    let dec = try models.run("decoder", ["pix": feature(try output(att, "pix")), "feat_s0": feature(fs0),
                                                         "feat_s1": feature(fs1), "points": pad, "labels": none], timing)
                    let fmask = try output(dec, "mask")
                    let fmem = try output(try models.run("memory", ["vision": feature(fvision), "mask": feature(fmask),
                                                                    "hard": soft], timing), "mem")
                    bank[f] = (mem: fmem, ptr: try output(dec, "obj_ptr"))
                    let old = f - sign * step * Tracker.nPtr
                    if abs(old - s) > step * Tracker.nPtr {
                        bank[old] = nil
                    }
                    let tSum = now()
                    let score = floats(try output(dec, "score"))
                    results[f] = FrameResult(summary: summarize(floats(fmask), n: 256, side: clip.side),
                                             score: score.isEmpty ? -1 : score[0])
                    timing.add("summary", now() - tSum)
                    timing.add("frame", now() - t)
                }
            }
        }
        return results
    }
}

// MARK: - one pass: the crop follows the ball while tracking (lab test 12, single_pass.py `track`, variant roi40f)

/// Round 6's per-frame shape filters (hybrid.trusted without the look-ahead ones); v in whole-picture 0..1.
func plausibleBall(_ v: [Double]?, width: Double, height: Double, racket: Bool) -> Bool {
    guard let v = v, v.count >= 7 else {
        return false
    }
    let L = max(width, height)
    let area = v[6]
    if area <= 0 || area > 0.003 {
        return false
    }
    let wpx = v[4] * width
    let hpx = v[5] * height
    let fill = area * width * height / max(1.0, wpx * hpx)
    let main = v.count > 7 ? v[7] : 1.0
    if max(wpx, hpx) > 0.06 * L || fill < 0.45 || main < 0.7 {
        return false
    }
    if max(wpx, hpx) / max(1e-6, min(wpx, hpx)) > (racket ? 2.0 : 3.0) {
        return false
    }
    if racket && fill < 0.6 {
        return false
    }
    return true
}

/// single_pass.py `Guide` with its defaults (vel 1, vel_alpha 0.5, max_step 0.1, follow 1, hold 3, glide 0.35).
struct BallGuide {
    let width: Double
    let height: Double
    let racket: Bool
    let players: [[Double]]
    var last: (frame: Int, x: Double, y: Double)
    var vel = (x: 0.0, y: 0.0)
    var centre: (x: Double, y: Double)
    static let hold = 3
    static let glide = 0.35
    static let maxStep = 0.1
    static let follow = 1.0
    static let velAlpha = 0.5

    init(width: Double, height: Double, racket: Bool, players: [[Double]], seedFrame: Int, click: [Double]) {
        self.width = width
        self.height = height
        self.racket = racket
        self.players = players
        last = (seedFrame, click[0], click[1])
        centre = (click[0], click[1])
    }

    mutating func next(_ f: Int) -> (x: Double, y: Double) {
        let gap = abs(f - last.frame)
        if gap <= BallGuide.hold + 1 {
            var dx = vel.x * Double(f - last.frame)
            var dy = vel.y * Double(f - last.frame)
            let d = hypot(dx * width, dy * height) / max(width, height)
            let lim = BallGuide.maxStep * Double(gap)
            if lim > 0 && d > lim {
                dx *= lim / d
                dy *= lim / d
            }
            centre = (centre.x + (last.x + dx - centre.x) * BallGuide.follow,
                      centre.y + (last.y + dy - centre.y) * BallGuide.follow)
        } else {
            let p = players[min(max(f, 0), players.count - 1)]
            centre = (centre.x + (p[0] - centre.x) * BallGuide.glide, centre.y + (p[1] - centre.y) * BallGuide.glide)
        }
        return centre
    }

    mutating func update(_ f: Int, _ v: [Double]?) {
        guard plausibleBall(v, width: width, height: height, racket: racket), let v = v else {
            return
        }
        let gap = abs(f - last.frame)
        let d = hypot((v[0] - last.x) * width, (v[1] - last.y) * height) / max(width, height)
        if d > 0.09 * Double(min(gap, 8)) {
            return
        }
        if gap <= BallGuide.hold + 1 {
            let k = BallGuide.velAlpha
            let steps = Double(f - last.frame)
            vel = (k * (v[0] - last.x) / steps + (1 - k) * vel.x, k * (v[1] - last.y) / steps + (1 - k) * vel.y)
        } else {
            vel = (0, 0)
        }
        last = (f, v[0], v[1])
    }
}

extension Tracker {
    /// trackFast with the crop chosen per frame by a BallGuide (one pass). Returns whole-picture summaries.
    func trackFollow(_ clip: SoakClip, frames: VideoFrames, shouldStop: () -> Bool) throws -> [[Double]?] {
        guard let click = clip.seedXYWhole, let players = clip.players else {
            throw BenchError.missing("\(clip.name): players / seed (run ios_bench.py prepare again)")
        }
        let n = clip.frames
        let s = clip.seedFrame
        let W = Double(frames.size.width)
        let H = Double(frames.size.height)
        let side = clip.side
        let memSize = Tracker.memSize
        var results = [[Double]?](repeating: nil, count: n)
        var bank: [Int: (mem: MLMultiArray, ptr: MLMultiArray)] = [:]
        let memIn = try MLMultiArray(shape: [NSNumber(value: Tracker.nMem), 512, 64], dataType: .float32)
        let ptrIn = try MLMultiArray(shape: [NSNumber(value: Tracker.nPtr), 256], dataType: .float32)
        let memOn = try MLMultiArray(shape: [1, NSNumber(value: Tracker.nMem)], dataType: .float32)
        let ptrOn = try MLMultiArray(shape: [1, NSNumber(value: Tracker.nPtr)], dataType: .float32)
        let pad = feature(multiArray([0, 0, 0, 0], [1, 2, 2]))
        let none = feature(multiArray([-1, -1], [1, 2]))
        let soft = feature(multiArray([0], [1, 1]))

        func place(_ cx: Double, _ cy: Double) -> (Int, Int) {
            let x0 = min(max(Int((cx * W - Double(side) / 2).rounded()), 0), Int(W) - side)
            let y0 = min(max(Int((cy * H - Double(side) / 2).rounded()), 0), Int(H) - side)
            return (x0, y0)
        }
        func encodeAt(_ f: Int, _ x0: Int, _ y0: Int) throws -> (MLMultiArray, MLMultiArray, MLMultiArray) {
            let t = now()
            let image = try frames.upright(f)
            let sd = CGFloat(side)
            let rect = CGRect(x: CGFloat(x0), y: CGFloat(H) - CGFloat(y0) - sd, width: sd, height: sd)
            let shaped = image.cropped(to: rect)
                .transformed(by: CGAffineTransform(translationX: -rect.minX, y: -rect.minY))
                .transformed(by: CGAffineTransform(scaleX: 1024 / sd, y: 1024 / sd))
            let value = try frames.encoderInput(shaped)
            timing.add("prep", now() - t)
            let out = try models.run("encoder", ["image": value], timing)
            return (try output(out, "feat_s0"), try output(out, "feat_s1"), try output(out, "vision"))
        }
        func whole(_ v: [Double]?, _ x0: Int, _ y0: Int) -> [Double]? {
            guard let v = v else {
                return nil
            }
            let sd = Double(side)
            var w = [(Double(x0) + v[0] * sd) / W, (Double(y0) + v[1] * sd) / H, (Double(x0) + v[2] * sd) / W,
                     (Double(y0) + v[3] * sd) / H, v[4] * sd / W, v[5] * sd / H, v[6] * sd * sd / (W * H)]
            if v.count > 7 {
                w.append(v[7])
            }
            return w
        }

        var t = now()
        let (sx0, sy0) = place(click[0], click[1])
        let (s0, s1, vision) = try encodeAt(s, sx0, sy0)
        var values = floats(vision)
        for c in 0..<256 {
            let add = noMem[c]
            for i in 0..<4096 {
                values[c * 4096 + i] += add
            }
        }
        let px = Float((click[0] * W - Double(sx0)) / Double(side) * 1024)
        let py = Float((click[1] * H - Double(sy0)) / Double(side) * 1024)
        let first = try models.run("decoder", ["pix": feature(multiArray(values, [1, 256, 64, 64])), "feat_s0": feature(s0),
                                               "feat_s1": feature(s1), "points": feature(multiArray([px, py, 0, 0], [1, 2, 2])),
                                               "labels": feature(multiArray([1, -1], [1, 2]))], timing)
        let mask = try output(first, "mask")
        let condPtr = try output(first, "obj_ptr")
        let condMem = try output(try models.run("memory", ["vision": feature(vision), "mask": feature(mask),
                                                           "hard": feature(multiArray([1], [1, 1]))], timing), "mem")
        results[s] = whole(summarize(floats(mask), n: 256, side: side), sx0, sy0)
        timing.add("frame", now() - t)

        for (sign, order) in [(1, Array(stride(from: s + step, to: n, by: step))),
                              (-1, Array(stride(from: s - step, through: 0, by: -step)))] {
            var guide = BallGuide(width: W, height: H, racket: clip.racket ?? false, players: players, seedFrame: s,
                                  click: click)
            for f in order {
                if shouldStop() {
                    throw BenchError.stopped
                }
                try autoreleasepool {
                    t = now()
                    let c = guide.next(f)
                    let (x0, y0) = place(c.x, c.y)
                    let (fs0, fs1, fvision) = try encodeAt(f, x0, y0)
                    let tLoop = now()
                    for slot in 0..<Tracker.nMem {
                        var src = condMem
                        var on: Float = 1
                        if slot > 0 {
                            if let prev = bank[f - sign * step * (Tracker.nMem - slot)] {
                                src = prev.mem
                            } else {
                                on = 0
                            }
                        }
                        copyFloats(src, into: memIn, at: slot * memSize, count: memSize)
                        memOn[slot] = NSNumber(value: on)
                    }
                    for k in 0..<Tracker.nPtr {
                        var src = condPtr
                        var on: Float = 1
                        if k > 0 {
                            if let prev = bank[f - sign * step * k] {
                                src = prev.ptr
                            } else {
                                on = 0
                            }
                        }
                        copyFloats(src, into: ptrIn, at: k * 256, count: 256)
                        ptrOn[k] = NSNumber(value: on)
                    }
                    timing.add("loop", now() - tLoop)
                    let att = try models.run("attention", ["vision": feature(fvision), "mem": feature(memIn),
                                                           "ptr": feature(ptrIn), "mem_on": feature(memOn),
                                                           "ptr_on": feature(ptrOn)], timing)
                    let dec = try models.run("decoder", ["pix": feature(try output(att, "pix")), "feat_s0": feature(fs0),
                                                         "feat_s1": feature(fs1), "points": pad, "labels": none], timing)
                    let fmask = try output(dec, "mask")
                    let fmem = try output(try models.run("memory", ["vision": feature(fvision), "mask": feature(fmask),
                                                                    "hard": soft], timing), "mem")
                    bank[f] = (mem: fmem, ptr: try output(dec, "obj_ptr"))
                    let old = f - sign * step * Tracker.nPtr
                    if abs(old - s) > step * Tracker.nPtr {
                        bank[old] = nil
                    }
                    let tSum = now()
                    let v = whole(summarize(floats(fmask), n: 256, side: side), x0, y0)
                    results[f] = v
                    guide.update(f, v)
                    timing.add("summary", now() - tSum)
                    timing.add("frame", now() - t)
                }
            }
        }
        return results
    }
}

/// Foco na Bola in ONE pass (crop following the ball, lab test 12 roi40f), compared with the Mac's run of the same.
func ballOnePassClip(_ clip: SoakClip, models: EdgeTAMModels, noMem: [Float], context: CIContext, step: Int = 1,
                     shouldStop: @escaping () -> Bool) throws -> SoakResult {
    guard let videoName = clip.video, let url = bundleURL((videoName as NSString).deletingPathExtension, "mp4") else {
        throw BenchError.missing("\(clip.name).mp4 (run ios_bench.py prepare again)")
    }
    var result = SoakResult()
    let t0 = now()
    let frames = try VideoFrames(url: url, context: context, shape: { image, _ in image })
    let seed = clip.seedFrame
    frames.wanted = { tick in (tick - seed) % step == 0 }
    let tracker = Tracker(models: models, noMem: noMem)
    tracker.step = step
    let track = try tracker.trackFollow(clip, frames: frames, shouldStop: shouldStop)
    result.seconds = now() - t0
    result.frames = trackedCount(clip.frames, seed: clip.seedFrame, step: step)
    var ms: [String: Double] = [:]
    for name in ["prep", "loop", "summary", "frame"] + EdgeTAMModels.names {
        ms[name] = tracker.timing.stats(name)["median"] ?? 0
    }
    result.detail["pass1Ms"] = ms
    result.detail["pass1S"] = round1(result.seconds)
    if let mac = clip.refs["single_mac"], step == 1 {
        let a = agreement(track, mac, side: Int(max(frames.size.width, frames.size.height)))
        result.detail["vsMacPx"] = a.medianPx
        result.detail["vsMacMismatch"] = a.mismatches
    }
    return result
}
