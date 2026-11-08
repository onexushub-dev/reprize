import Foundation

/// The torch's answer to each action (2026-11-08 spec §5). On the court the sound is often lost, so the three actions
/// differ by rhythm: one steady light (started), two short blinks (a clip), three slow pulses (ended).
public enum TorchPattern {
  public typealias Step = (on: Bool, seconds: Double)

  /// A clip saved: two short blinks.
  public static let saved: [Step] = [(true, 0.12), (false, 0.12), (true, 0.12)]
  /// A recording started from the remote: one steady light.
  public static let started: [Step] = [(true, 1.5)]
  /// A recording ended from the remote: three slow pulses.
  public static let ended: [Step] = [(true, 0.5), (false, 0.3), (true, 0.5), (false, 0.3), (true, 0.5)]

  /// How long the torch is lit in `steps`, and how many separate flashes it makes.
  public static func shape(_ steps: [Step]) -> (flashes: Int, lit: Double, total: Double) {
    var flashes = 0
    var wasOn = false
    for step in steps {
      if step.on && !wasOn { flashes += 1 }
      wasOn = step.on
    }
    return (flashes, steps.filter(\.on).map(\.seconds).reduce(0, +), steps.map(\.seconds).reduce(0, +))
  }
}
