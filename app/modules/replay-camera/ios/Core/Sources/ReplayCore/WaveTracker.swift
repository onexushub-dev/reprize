/// The wave gesture: both hands above the head, swung from side to side for about a second and a half,
/// like waving to someone far away. Motion is a stronger signal than a held pose at a distance.
///
/// Only a person facing the camera counts (`Facing`, 2026-11-07): rebounds and contested shots seen from the back or
/// the side are the same arms-up motion.
///
/// People are followed from sample to sample by where their box is in the frame, so two players doing half a wave
/// each never add up to one.
public final class WaveTracker {
  private struct Sample {
    let t: Double
    let raised: Bool
    let left: Double   // wrist x in shoulder widths from the shoulder centre
    let right: Double
  }

  private final class Track {
    var x: Double
    var y: Double
    /// The person's PersonTracks id when known (-1: matched by position only).
    var id: Int
    var samples: [Sample] = []
    init(x: Double, y: Double, id: Int) {
      self.x = x
      self.y = y
      self.id = id
    }
  }

  private let window: Double
  private let minSpan: Double
  private let minSamples: Int
  private let raisedFraction: Double
  private let minRange: Double
  private let minPath: Double
  private let cooldown: Double
  private let release: Double
  private let matchDistance: Double

  private var tracks: [Track] = []
  private var cooldownUntil = -Double.infinity
  private var awaitingRelease = false
  private var lastRaised = -Double.infinity

  /// `minRange`: how far each hand must travel sideways, in shoulder widths. `minPath`: how much sideways distance each
  /// hand must cover in total inside the window (a back and forth adds up, jitter does not).
  public init(window: Double = 1.6, minSpan: Double = 1.0, minSamples: Int = 5, raisedFraction: Double = 0.75,
              minRange: Double = 0.4, minPath: Double = 0.8, cooldown: Double = 3.0, release: Double = 0.8,
              matchDistance: Double = 0.15) {
    self.window = window
    self.minSpan = minSpan
    self.minSamples = minSamples
    self.raisedFraction = raisedFraction
    self.minRange = minRange
    self.minPath = minPath
    self.cooldown = cooldown
    self.release = release
    self.matchDistance = matchDistance
  }

  /// Both wrists above the head line, facing the camera: the cue to sample faster, since waving is quick. Arms up away
  /// from the camera (a rebound, a block) no longer make the detector work faster.
  public static func armsRaised(_ pose: Pose) -> Bool {
    return measure(pose)?.raised ?? false
  }

  /// Nil for a pose that cannot wave: joints missing, or not facing the camera (`Facing`).
  private static func measure(_ pose: Pose) -> (raised: Bool, left: Double, right: Double)? {
    let minConfidence = ArmsUp.defaultConfidence
    guard Facing.towardCamera(pose) else { return nil }
    guard let lw = pose.leftWrist, let rw = pose.rightWrist,
          lw.confidence >= minConfidence, rw.confidence >= minConfidence,
          let head = ArmsUp.headLine(pose, minConfidence: minConfidence),
          let ls = pose.leftShoulder, let rs = pose.rightShoulder
    else { return nil }
    let midX = (ls.x + rs.x) / 2
    let raised = lw.y < head.y && rw.y < head.y
    return (raised, (lw.x - midX) / head.shoulderWidth, (rw.x - midX) / head.shoulderWidth)
  }

  /// Call once per sample with everybody seen in it (an empty list is fine). True when somebody just waved.
  public func update(_ sightings: [Sighting], at t: Double) -> Bool {
    tracks = tracks.filter { track in
      guard let last = track.samples.last else { return false }
      return t - last.t <= window
    }
    var used = Set<ObjectIdentifier>()
    var anyRaised = false

    for s in sightings {
      guard let m = WaveTracker.measure(s.pose) else { continue }
      var best: Track?
      if s.id >= 0 {
        // A tracked person: their own samples only, however close other players stand.
        best = tracks.first { $0.id == s.id && !used.contains(ObjectIdentifier($0)) }
      } else {
        var bestDistance = matchDistance
        for track in tracks where track.id < 0 && !used.contains(ObjectIdentifier(track)) {
          let d = max(abs(track.x - s.x), abs(track.y - s.y))
          if d <= bestDistance {
            best = track
            bestDistance = d
          }
        }
      }
      let track = best ?? Track(x: s.x, y: s.y, id: s.id)
      if best == nil { tracks.append(track) }
      used.insert(ObjectIdentifier(track))
      track.x = s.x
      track.y = s.y
      track.samples.append(Sample(t: t, raised: m.raised, left: m.left, right: m.right))
      track.samples.removeAll { t - $0.t > window + 1e-9 }
      if m.raised { anyRaised = true }
    }

    if anyRaised { lastRaised = t }
    if awaitingRelease {
      if t - lastRaised > release + 1e-9 {
        awaitingRelease = false
      } else {
        return false
      }
    }
    if t < cooldownUntil { return false }

    for track in tracks where waves(track) {
      awaitingRelease = true
      cooldownUntil = t + cooldown
      lastRaised = t
      tracks = []
      return true
    }
    return false
  }

  private func waves(_ track: Track) -> Bool {
    let samples = track.samples
    guard samples.count >= minSamples, let first = samples.first, let last = samples.last,
          last.t - first.t >= minSpan - 1e-9
    else { return false }
    let raised = samples.filter { $0.raised }
    guard Double(raised.count) / Double(samples.count) >= raisedFraction else { return false }
    return swings(raised.map { $0.left }) && swings(raised.map { $0.right })
  }

  private func swings(_ xs: [Double]) -> Bool {
    guard let lo = xs.min(), let hi = xs.max(), hi - lo >= minRange else { return false }
    var path = 0.0
    for i in 1..<xs.count { path += abs(xs[i] - xs[i - 1]) }
    return path >= minPath
  }
}
