import Foundation

/// The detector's side of Seguir a Bola, apart from Core ML and the pictures: which regions of a frame go to the model,
/// and how its raw output becomes the frame's candidates. Exactly the lab's `ball_detect.py` (tests 17, 38): the whole
/// frame letterboxed into the model's square, every tile, all anchors with objectness × class ≥ conf, merged and then
/// NMS at IoU 0.5, rounded as the lab stores them (spec 2026-11-09 §4.3).
public enum BallDetect {
  /// One region of the frame sent to the model: its origin in the frame and the model px per frame px.
  public struct Region: Equatable {
    public var x0: Int, y0: Int, scale: Double
    public init(x0: Int, y0: Int, scale: Double) { self.x0 = x0; self.y0 = y0; self.scale = scale }
  }

  /// A candidate in frame px (centre, size) with its score.
  public struct Box: Equatable {
    public var cx: Double, cy: Double, w: Double, h: Double, score: Double
    public init(cx: Double, cy: Double, w: Double, h: Double, score: Double) {
      self.cx = cx; self.cy = cy; self.w = w; self.h = h; self.score = score
    }
  }

  /// Tile origins along one side: `tile` px, at least `overlap` px shared (`ball_detect.tiles.starts`).
  public static func starts(_ n: Int, tile: Int, overlap: Int = 80) -> [Int] {
    if n <= tile { return [0] }
    let k = Int((Double(n - overlap) / Double(tile - overlap)).rounded(.up))
    return (0..<k).map { i in Int((Double(i) * Double(n - tile) / Double(k - 1)).rounded(.toNearestOrEven)) }
  }

  /// The frame's regions in the model's order: the whole frame first, then the tiles row by row (top to bottom, left to
  /// right). `side`: the model's input side; tiles are `tile` frame px scaled to it.
  public static func regions(width W: Int, height H: Int, side: Int, tile: Int) -> [Region] {
    var out = [Region(x0: 0, y0: 0, scale: min(Double(side) / Double(W), Double(side) / Double(H)))]
    for y0 in starts(H, tile: tile) {
      for x0 in starts(W, tile: tile) { out.append(Region(x0: x0, y0: y0, scale: Double(side) / Double(tile))) }
    }
    return out
  }

  /// YOLOX's anchors for a `side` square: (grid x, grid y, stride) at strides 8, 16, 32.
  public static func anchors(side: Int) -> [(gx: Float, gy: Float, stride: Float)] {
    var g: [(gx: Float, gy: Float, stride: Float)] = []
    for stride in [8, 16, 32] {
      let n = side / stride
      for y in 0..<n { for x in 0..<n { g.append((Float(x), Float(y), Float(stride))) } }
    }
    return g
  }

  /// One region's output, `value(row, column)` over `rows` anchors: columns 0–3 xy offsets and log wh, 4 objectness,
  /// 5 + `cls` the ball class. Candidates with objectness × class ≥ `conf`, in frame px, in anchor order.
  public static func decode(rows: Int, cls: Int, anchors: [(gx: Float, gy: Float, stride: Float)], region: Region,
                            conf: Float = 0.05, value: (Int, Int) -> Float) -> [Box] {
    var out: [Box] = []
    let r = region.scale
    for i in 0..<min(rows, anchors.count) {
      let obj = value(i, 4)
      if obj < conf { continue } // the class score is at most 1
      let s = obj * value(i, 5 + cls)
      if s < conf { continue }
      let a = anchors[i]
      let x = (value(i, 0) + a.gx) * a.stride, y = (value(i, 1) + a.gy) * a.stride
      let w = exp(value(i, 2)) * a.stride, h = exp(value(i, 3)) * a.stride
      out.append(Box(cx: Double(x) / r + Double(region.x0), cy: Double(y) / r + Double(region.y0),
                     w: Double(w) / r, h: Double(h) / r, score: Double(s)))
    }
    return out
  }

  /// `ball_detect.nms`: highest score first (ties in the given order), a box overlapping a kept one by IoU > `iou` dropped.
  public static func nms(_ boxes: [Box], iou: Double = 0.5) -> [Box] {
    let order = boxes.indices.sorted { boxes[$0].score != boxes[$1].score ? boxes[$0].score > boxes[$1].score : $0 < $1 }
    var keep: [Box] = []
    for i in order {
      let v = boxes[i]
      let ok = !keep.contains { k in
        let ix = max(0, min(v.cx + v.w / 2, k.cx + k.w / 2) - max(v.cx - v.w / 2, k.cx - k.w / 2))
        let iy = max(0, min(v.cy + v.h / 2, k.cy + k.h / 2) - max(v.cy - v.h / 2, k.cy - k.h / 2))
        let u = v.w * v.h + k.w * k.h - ix * iy
        return u > 0 && ix * iy / u > iou
      }
      if ok { keep.append(v) }
    }
    return keep
  }

  /// The frame's candidates as stored (0..1 of the frame, 4 decimals; score 3 decimals), after NMS.
  public static func frameCandidates(_ boxes: [Box], width W: Int, height H: Int) -> [BallCandidate] {
    nms(boxes).map { b in
      BallCandidate(cx: round(b.cx / Double(W), 4), cy: round(b.cy / Double(H), 4), width: round(b.w / Double(W), 4),
                    height: round(b.h / Double(H), 4), score: round(b.score, 3))
    }
  }

  static func round(_ v: Double, _ d: Int) -> Double { BallPath.roundTo(v, d) }
}
