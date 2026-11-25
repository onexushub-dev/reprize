import Foundation

/// The voice detector's backlog guard (plan 2026-11-24 voice keyword detector): audio waiting to be processed may
/// add up to `capacitySeconds`; past that, new audio is refused (and counted) instead of blocking the capture thread.
/// Not thread-safe by itself: the owner holds a lock around it.
public struct DropCounter {
  public let capacitySeconds: Double
  public private(set) var pendingSeconds = 0.0
  public private(set) var droppedSeconds = 0.0

  public init(capacitySeconds: Double = 2) {
    self.capacitySeconds = capacitySeconds
  }

  /// `seconds` of audio arrive. True: queue it (and call `release` once processed). False: it was dropped.
  public mutating func offer(_ seconds: Double) -> Bool {
    if pendingSeconds + seconds > capacitySeconds {
      droppedSeconds += seconds
      return false
    }
    pendingSeconds += seconds
    return true
  }

  public mutating func release(_ seconds: Double) {
    pendingSeconds = max(0, pendingSeconds - seconds)
  }
}
