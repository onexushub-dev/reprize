import Foundation

/// `ProcessInfo.ThermalState`, platform-free (same raw values).
public enum ThermalLevel: Int, Comparable {
  case nominal = 0, fair, serious, critical

  public var name: String {
    switch self {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    }
  }

  public static func < (a: ThermalLevel, b: ThermalLevel) -> Bool { a.rawValue < b.rawValue }

  /// The gesture checks run lighter (GesturePipeline.Options.hot) from `serious` on. It used to be `fair`, which a long
  /// game reaches easily: it halved the samples and the people looked at, and the wave needs both (2026-11-02).
  public var slowsGesture: Bool { self >= .serious }
}

/// How a recording steps down when the phone heats up (2026-11-07 spec §4). Keep the quality as long as possible:
/// - `serious` held for `holdBeforeNextStep` → 1080p30 (anything above becomes 1080p30). A short hot spell costs nothing.
///   From 1080p60 that is the same picture size at half the rate: the running camera is slowed down (`throttle`), with
///   no restart, so the buffer and the play in it stay (plan 2026-11-12, I3). Any other step changes the size and
///   restarts the writer (`reconfigure`).
/// - Already `serious` when the camera opens → 1080p30 from the first second: no minutes at 60 fps followed by a restart
///   (each restart empties the buffer and drops the microphone for a moment).
/// - `critical` → 720p30 at once (`emergency`). The app never stops a recording for heat: only iOS taking the camera
///   away does (ReplayEngine).
/// It never steps back up during a session: every step restarts the writer (and empties the buffer).
public struct ThermalLadder {
  /// How long the phone must stay `serious`, without cooling to `fair` or below, before the quality goes down.
  public static let holdBeforeNextStep: TimeInterval = 120
  /// What `critical` records: the last step before iOS itself would stop the camera.
  public static let emergency = "720p30"

  public enum Action: Equatable {
    case none
    /// Same picture size, lower frame rate: change the rate of the running camera.
    case throttle(String)
    /// Another picture size: the camera and the writer restart at this quality.
    case reconfigure(String)
  }

  public let requested: String
  public private(set) var quality: String
  /// When the current `serious` stretch began (or the last step was taken in it); nil while cooler.
  private var seriousSince: TimeInterval?

  /// A phone already hot when the camera opens starts one step down (and at `emergency` when `critical`).
  public init(requested: String, state: ThermalLevel, now: TimeInterval) {
    self.requested = requested
    quality = requested
    if state >= .serious {
      seriousSince = now
      if let lower = Self.step(below: requested) { quality = lower }
    }
    if state == .critical { quality = Self.emergency }
  }

  /// True once the recording runs below what was asked for.
  public var degraded: Bool { quality != requested }

  public mutating func update(state: ThermalLevel, now: TimeInterval) -> Action {
    if state == .critical {
      if seriousSince == nil { seriousSince = now }
      guard quality != Self.emergency else { return .none }
      quality = Self.emergency
      return .reconfigure(quality)
    }
    guard state == .serious else {
      seriousSince = nil
      return .none
    }
    guard let since = seriousSince else {
      seriousSince = now
      return .none
    }
    guard now - since >= Self.holdBeforeNextStep, let lower = Self.step(below: quality) else { return .none }
    let action: Action = Self.sameSize(quality, lower) ? .throttle(lower) : .reconfigure(lower)
    quality = lower
    seriousSince = now
    return action
  }

  /// Whether two qualities ("1080p60", "1080p30", "2160p30", "720p30") have the same picture size.
  public static func sameSize(_ a: String, _ b: String) -> Bool {
    let size = { (q: String) in q.split(separator: "p").first.map(String.init) ?? q }
    return size(a) == size(b)
  }

  /// The next quality down while `serious`, or nil at the Full HD floor (1080p30, and anything already below it).
  public static func step(below quality: String) -> String? {
    switch quality {
    case "720p30", "1080p30": return nil
    default: return "1080p30"
    }
  }
}
