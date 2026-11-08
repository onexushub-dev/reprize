/// Image coordinates, y grows downward.
public struct Point: Equatable {
  public let x: Double
  public let y: Double
  public let confidence: Double

  public init(x: Double, y: Double, confidence: Double) {
    self.x = x
    self.y = y
    self.confidence = confidence
  }
}

public struct Pose: Equatable {
  public let leftWrist, rightWrist, leftElbow, rightElbow, leftShoulder, rightShoulder, nose: Point?
  /// The face and the hips: which way the person faces (`Facing`). Nil when not read.
  public let leftEye, rightEye, leftEar, rightEar, leftHip, rightHip: Point?

  public init(leftWrist: Point?, rightWrist: Point?, leftElbow: Point?, rightElbow: Point?,
              leftShoulder: Point?, rightShoulder: Point?, nose: Point?,
              leftEye: Point? = nil, rightEye: Point? = nil, leftEar: Point? = nil, rightEar: Point? = nil,
              leftHip: Point? = nil, rightHip: Point? = nil) {
    self.leftWrist = leftWrist
    self.rightWrist = rightWrist
    self.leftElbow = leftElbow
    self.rightElbow = rightElbow
    self.leftShoulder = leftShoulder
    self.rightShoulder = rightShoulder
    self.nose = nose
    self.leftEye = leftEye
    self.rightEye = rightEye
    self.leftEar = leftEar
    self.rightEar = rightEar
    self.leftHip = leftHip
    self.rightHip = rightHip
  }
}

/// A pose plus where its person was in the frame (centre of the person's box, 0...1 on both axes),
/// so WaveTracker can follow each person from one sample to the next.
public struct Sighting: Equatable {
  public let pose: Pose
  public let x: Double
  public let y: Double
  /// The person's PersonTracks id, or -1 when unknown (whole-frame fallback, no tracking): then only the position
  /// tells people apart.
  public let id: Int

  public init(pose: Pose, x: Double, y: Double, id: Int = -1) {
    self.pose = pose
    self.x = x
    self.y = y
    self.id = id
  }
}

/// The hold gesture: both arms raised above the head. Big body geometry, so it stays readable when the
/// player is small in the frame; HoldTracker requires it held, which filters blocks and celebrations.
///
/// Since 2026-11-02 the app does not fire on the hold (GesturePipeline.Options.hold): an indoor volleyball set followed
/// by a block passed as a hold. ArmsUp still tells who to look at first and when to sample faster.
///
/// Field test (sand court, phone high at 3-4 m, 0.5x): the old rules (7 joints at 0.3, wrists 0.5 shoulder widths
/// above the nose) missed it too often, so the elbows and the nose are optional now and the rise is smaller.
public enum ArmsUp {
  /// How far above the head both wrists must be, in shoulder widths.
  public static let minWristRise = 0.35
  /// Without a visible nose, the head sits this far above the shoulder line, in shoulder widths.
  public static let noseAboveShoulders = 0.75
  public static let defaultConfidence = 0.2

  private static func usable(_ p: Point?, _ minConfidence: Double) -> Point? {
    guard let p = p, p.confidence >= minConfidence else { return nil }
    return p
  }

  /// The y of the head (the nose, or an estimate from the shoulders) and the shoulder width.
  /// Nil when the shoulders cannot be trusted.
  public static func headLine(_ p: Pose, minConfidence: Double = ArmsUp.defaultConfidence) -> (y: Double, shoulderWidth: Double)? {
    guard let ls = usable(p.leftShoulder, minConfidence), let rs = usable(p.rightShoulder, minConfidence) else { return nil }
    let width = abs(ls.x - rs.x)
    guard width > 0 else { return nil }
    if let nose = usable(p.nose, minConfidence) { return (nose.y, width) }
    return ((ls.y + rs.y) / 2 - noseAboveShoulders * width, width)
  }

  public static func isUp(_ p: Pose, minConfidence: Double = ArmsUp.defaultConfidence) -> Bool {
    guard let lw = usable(p.leftWrist, minConfidence), let rw = usable(p.rightWrist, minConfidence),
          let head = headLine(p, minConfidence: minConfidence)
    else { return false }

    let wristLine = head.y - minWristRise * head.shoulderWidth
    guard lw.y < wristLine, rw.y < wristLine else { return false }

    // Elbows only count when they were seen: far away they are the first joints to drop out.
    if let le = usable(p.leftElbow, minConfidence), let ls = p.leftShoulder, !(le.y < ls.y) { return false }
    if let re = usable(p.rightElbow, minConfidence), let rs = p.rightShoulder, !(re.y < rs.y) { return false }
    return true
  }
}

/// Fires once when the gesture is held for `holdSeconds`. A few missed samples (the detector flickers at a
/// distance) do not break the hold: only a gap longer than `gapTolerance` does. After firing, the arms must
/// really come down (a gap longer than `gapTolerance`) and `cooldownSeconds` must pass before it fires again.
///
/// Gesture v2 (distance): 15-20 m away the pose reads the raised arms in only ~30-50% of samples, so the gap allowed
/// is 1.2 s and 3 hits are enough; the hold still has to last `holdSeconds`, which keeps blocks and quick celebrations out.
public final class HoldTracker {
  private let holdSeconds: Double
  private let cooldownSeconds: Double
  private let gapTolerance: Double
  private let minHits: Int
  private var runStart: Double?
  private var lastHit: Double?
  private var hits = 0
  private var cooldownUntil = -Double.infinity
  private var awaitingRelease = false

  public init(holdSeconds: Double = 1.5, cooldownSeconds: Double = 3.0, gapTolerance: Double = 1.2, minHits: Int = 3) {
    self.holdSeconds = holdSeconds
    self.cooldownSeconds = cooldownSeconds
    self.gapTolerance = gapTolerance
    self.minHits = minHits
  }

  public func update(isX: Bool, at t: Double) -> Bool {
    if let last = lastHit, t - last > gapTolerance + 1e-9 {
      runStart = nil
      lastHit = nil
      hits = 0
      awaitingRelease = false
    }
    guard isX else { return false }
    lastHit = t
    if awaitingRelease { return false }
    if runStart == nil {
      runStart = t
      hits = 0
    }
    hits += 1
    guard let start = runStart, t - start >= holdSeconds - 1e-9, hits >= minHits, t >= cooldownUntil else { return false }
    runStart = nil
    hits = 0
    awaitingRelease = true
    cooldownUntil = t + cooldownSeconds
    return true
  }
}

/// The hold gesture per person (gesture v2, many players on screen): each tracked person has their own HoldTracker, so
/// two players who raise their arms one after the other (a block, then another block) never add up to one hold, and a
/// player who is not looked at in a sample (others took the pose slots) is not counted as having lowered the arms.
/// After any fire, nobody fires for `cooldownSeconds` (the trigger bus would merge it anyway).
public final class PersonHold {
  private var holds: [Int: (tracker: HoldTracker, lastSeen: Double)] = [:]
  private let make: () -> HoldTracker
  private let forgetSeconds: Double
  private let cooldownSeconds: Double
  private var cooldownUntil = -Double.infinity

  public init(forgetSeconds: Double = 10, cooldownSeconds: Double = 3, make: @escaping () -> HoldTracker = { HoldTracker() }) {
    self.make = make
    self.forgetSeconds = forgetSeconds
    self.cooldownSeconds = cooldownSeconds
  }

  /// Every person looked at in this sample, with whether their arms are up. True when somebody's hold just completed.
  public func update(_ people: [(id: Int, isUp: Bool)], at t: Double) -> Bool {
    var fired = false
    for person in people {
      let tracker = holds[person.id]?.tracker ?? make()
      holds[person.id] = (tracker, t)
      if tracker.update(isX: person.isUp, at: t) { fired = true }
    }
    holds = holds.filter { t - $0.value.lastSeen <= forgetSeconds }
    guard fired, t >= cooldownUntil else { return false }
    cooldownUntil = t + cooldownSeconds
    return true
  }
}

/// One gesture, one trigger. The hold and the wave watch the same raised arms and can both fire on one gesture, seconds
/// apart: on 2026-10-28 a slow hold completed 3.0 s after the wave, just past the trigger bus's 3 s, which made two clips.
/// After a fire, nothing fires again until nobody has had the arms up for `release` and `cooldown` has passed.
public final class FireGate {
  private let cooldown: Double
  private let release: Double
  private var lastFire = -Double.infinity
  private var lastRaised = -Double.infinity
  private var awaiting = false

  public init(cooldown: Double = 3.0, release: Double = 1.0) {
    self.cooldown = cooldown
    self.release = release
  }

  /// `fired`: a rule fired in this sample; `anyRaised`: somebody looked at had the arms up. True when it really fires.
  public func update(fired: Bool, anyRaised: Bool, at t: Double) -> Bool {
    if anyRaised { lastRaised = t }
    if awaiting {
      guard t - lastRaised > release + 1e-9, t - lastFire >= cooldown - 1e-9 else { return false }
      awaiting = false
    }
    guard fired else { return false }
    awaiting = true
    lastFire = t
    return true
  }
}
