import Foundation

/// Bola with motion-gated tiles (lab tests 53 and 54; plan 2026-11-12, I2): the camera is on a tripod, so a tile goes to
/// the detector only when the picture changed inside it. Exactly the lab's `motion_tiles.py`: grey thumbnails, a pixel
/// "changed" when the 3 × 3 mean of its difference to BOTH neighbouring frames is over the threshold, a tile runs with
/// enough changed pixels or when it ran on the analysed frame before. What a tile held the last time it ran stays as
/// evidence for the path's still-object filter (the lamp is still there), never as a point of the path.
public enum BallMotion {
  /// The thumbnail's width (test 54: 480 px and under lose the small ball of beach tennis at night).
  public static let thumbWidth = 640
  /// Grey levels (0..255) of the 3 × 3 mean difference that count as a change.
  public static let threshold = 20
  /// Changed thumbnail pixels for a tile to run.
  public static let minPixels = 2

  /// Per thumbnail pixel (row-major, `width` × `height`): whether it changed against both neighbours, or against the
  /// one there is (the first and last frames); nothing changed with no neighbour.
  public static func changed(_ frame: [UInt8], before: [UInt8]?, after: [UInt8]?, width: Int, height: Int,
                             threshold: Int = threshold) -> [Bool] {
    let a = before.map { over(frame, $0, width: width, height: height, threshold: threshold) }
    let b = after.map { over(frame, $0, width: width, height: height, threshold: threshold) }
    if let a = a, let b = b { return zip(a, b).map { $0 && $1 } }
    return a ?? b ?? [Bool](repeating: false, count: width * height)
  }

  /// The 3 × 3 mean (edges repeated) of |a − b| over `threshold`, per pixel: `box3(abs(a - b)) > thr`.
  static func over(_ a: [UInt8], _ b: [UInt8], width W: Int, height H: Int, threshold: Int) -> [Bool] {
    let n = W * H
    guard W > 0, H > 0, a.count >= n, b.count >= n else { return [Bool](repeating: false, count: max(0, n)) }
    var diff = [Int](repeating: 0, count: n)
    for i in 0..<n { diff[i] = abs(Int(a[i]) - Int(b[i])) }
    // separable: sums of 3 along x, then along y (the mean × 9 is compared with the threshold × 9, in whole numbers)
    var rows = [Int](repeating: 0, count: n)
    for y in 0..<H {
      let o = y * W
      for x in 0..<W { rows[o + x] = diff[o + max(x - 1, 0)] + diff[o + x] + diff[o + min(x + 1, W - 1)] }
    }
    var out = [Bool](repeating: false, count: n)
    for y in 0..<H {
      let up = max(y - 1, 0) * W, mid = y * W, down = min(y + 1, H - 1) * W
      for x in 0..<W { out[mid + x] = rows[up + x] + rows[mid + x] + rows[down + x] > threshold * 9 }
    }
    return out
  }

  /// The tiles with at least `minPixels` changed pixels: indices into `regions` (the whole frame, region 0, is never
  /// in the answer: it always runs). `regions`: `BallDetect.regions` of the frame the tiles are cut from.
  public static func tiles(changed: [Bool], width: Int, height: Int, frameWidth: Int, frameHeight: Int,
                           regions: [BallDetect.Region], tile: Int, minPixels: Int = minPixels) -> Set<Int> {
    let sx = Double(width) / Double(frameWidth), sy = Double(height) / Double(frameHeight)
    var out = Set<Int>()
    for i in regions.indices.dropFirst() {
      let r = regions[i]
      let x0 = Int(Double(r.x0) * sx), y0 = Int(Double(r.y0) * sy)
      let x1 = min(width, Int((Double(min(r.x0 + tile, frameWidth)) * sx).rounded(.up)))
      let y1 = min(height, Int((Double(min(r.y0 + tile, frameHeight)) * sy).rounded(.up)))
      var count = 0
      rows: for y in y0..<max(y0, y1) {
        for x in x0..<max(x0, x1) where changed[y * width + x] {
          count += 1
          if count >= minPixels { break rows }
        }
      }
      if count >= minPixels { out.insert(i) }
    }
    return out
  }

  /// From one analysed frame to the next: which tiles run, and what the others held.
  public struct Gate {
    private let regions: [BallDetect.Region]
    private let frameWidth: Double, frameHeight: Double, tile: Double
    private var before = Set<Int>()
    private var held: [Int: [BallCandidate]] = [:]

    public init(regions: [BallDetect.Region], frameWidth: Int, frameHeight: Int, tile: Int) {
      self.regions = regions
      self.frameWidth = Double(frameWidth)
      self.frameHeight = Double(frameHeight)
      self.tile = Double(tile)
    }

    /// The tiles to run on this analysed frame: those that changed now, and those that changed on the one before.
    public mutating func run(changed now: Set<Int>) -> Set<Int> {
      let run = now.union(before)
      before = now
      return run
    }

    private func inside(_ c: BallCandidate, _ i: Int) -> Bool {
      let px = c.cx * frameWidth, py = c.cy * frameHeight
      let x0 = Double(regions[i].x0), y0 = Double(regions[i].y0)
      return x0 <= px && px < x0 + tile && y0 <= py && py < y0 + tile
    }

    /// After the detector: `candidates` are the frame's (from the whole frame and the tiles in `ran`). Each tile that
    /// ran now holds its own; the answer is what the tiles that did not run held, left out when a tile that ran covers
    /// the same spot.
    public mutating func stale(ran: Set<Int>, candidates: [BallCandidate]) -> [BallCandidate] {
      for i in ran where regions.indices.contains(i) { held[i] = candidates.filter { inside($0, i) } }
      var out: [BallCandidate] = []
      for i in regions.indices.dropFirst() where !ran.contains(i) {
        for c in held[i] ?? [] {
          if candidates.contains(c) || out.contains(c) || ran.contains(where: { inside(c, $0) }) { continue }
          out.append(c)
        }
      }
      return out
    }
  }
}
