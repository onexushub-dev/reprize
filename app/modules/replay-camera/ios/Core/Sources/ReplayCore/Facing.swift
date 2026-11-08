import Foundation

/// Whether a person faces the camera: the wave only counts then (2026-11-07 basketball field test). Every unwanted save
/// that day came from someone with both arms up and moving — a rebound, a contested shot, a shooter — seen from the back
/// or the side. A player who wants a clip turns to the camera to wave.
///
/// Two checks, both needed:
/// - The face is seen: the nose and both eyes. From the back Vision finds no face joints; side-on, one eye is missing.
/// - The shoulders are open: side-on they overlap and their width collapses (which also made every hand movement look
///   huge, measured in shoulder widths). The width is compared with the torso (shoulder line to hip line) or, with the
///   hips hidden (a railing, the edge of the frame), with the head (nose to shoulder line). Vision's shoulder joints sit
///   inside the shoulders (~0.31 m on the 2026-10-27 test): facing the camera that is ~0.6 of the torso and ~1.5 of the
///   head; side-on ~0.2-0.3 and ~0.5.
///
/// The thresholds are a first guess from those proportions: the gesture trace logs every joint so the field data can
/// tune them (target: a wave recognised from 10-15 m).
public enum Facing {
  /// Nose and both eyes must be seen at least this sure.
  public static let minEyeConfidence = 0.3
  /// Shoulder width over torso length (shoulder line to hip line), when both hips are seen.
  public static let minWidthToTorso = 0.45
  /// Shoulder width over head height (nose to shoulder line), when the hips are not seen.
  public static let minWidthToHead = 1.0
  /// Hips are used from this confidence on.
  public static let minHipConfidence = 0.2

  public static func towardCamera(_ p: Pose) -> Bool {
    guard faceSeen(p), let ratio = openness(p) else { return false }
    return ratio.toTorso ? ratio.value >= minWidthToTorso : ratio.value >= minWidthToHead
  }

  /// Nose and both eyes, each at least `minEyeConfidence`.
  public static func faceSeen(_ p: Pose) -> Bool {
    for joint in [p.nose, p.leftEye, p.rightEye] {
      guard let j = joint, j.confidence >= minEyeConfidence else { return false }
    }
    return true
  }

  /// The shoulder width over the torso (`toTorso`) or, without both hips, over the head. Nil without both shoulders
  /// and a nose above them.
  public static func openness(_ p: Pose) -> (value: Double, toTorso: Bool)? {
    let minConfidence = ArmsUp.defaultConfidence
    guard let ls = p.leftShoulder, let rs = p.rightShoulder, ls.confidence >= minConfidence, rs.confidence >= minConfidence
    else { return nil }
    let width = abs(ls.x - rs.x)
    let shoulderY = (ls.y + rs.y) / 2
    if let lh = p.leftHip, let rh = p.rightHip, lh.confidence >= minHipConfidence, rh.confidence >= minHipConfidence {
      let torso = (lh.y + rh.y) / 2 - shoulderY
      if torso > 0 { return (width / torso, true) }
    }
    guard let nose = p.nose, nose.confidence >= minConfidence else { return nil }
    let head = shoulderY - nose.y
    guard head > 0 else { return nil }
    return (width / head, false)
  }
}
