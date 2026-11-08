import Foundation

/// Builds short notification sounds as 16-bit mono PCM WAV data, so no audio file ships with the app.
public enum Chime {
  /// "Saved": a rising two-note chime.
  public static let saved: [(frequency: Double, seconds: Double)] = [(1046.5, 0.09), (1568.0, 0.16)]
  /// "Failed": a low double beep.
  public static let failed: [(frequency: Double, seconds: Double)] = [(330, 0.12), (0, 0.06), (330, 0.12)]
  /// "Recording started" (from the remote): three rising notes, longer than the save's two.
  public static let started: [(frequency: Double, seconds: Double)] = [(784.0, 0.12), (1046.5, 0.12), (1568.0, 0.24)]
  /// "Recording ended" (from the remote): the same three notes falling.
  public static let ended: [(frequency: Double, seconds: Double)] = [(1568.0, 0.12), (1046.5, 0.12), (784.0, 0.24)]

  public static func wav(notes: [(frequency: Double, seconds: Double)], sampleRate: Int = 44_100) -> Data {
    var pcm = Data()
    for (frequency, seconds) in notes {
      let count = Int(Double(sampleRate) * seconds)
      for i in 0..<count {
        // Quick attack, linear fade-out: no clicks between notes.
        let envelope = min(1, Double(i) / (0.005 * Double(sampleRate))) * (1 - Double(i) / Double(count))
        let value = frequency == 0 ? 0 : sin(2 * .pi * frequency * Double(i) / Double(sampleRate)) * envelope * 0.8
        var sample = Int16(value * Double(Int16.max)).littleEndian
        withUnsafeBytes(of: &sample) { pcm.append(contentsOf: $0) }
      }
    }

    var header = Data()
    func u32(_ v: UInt32) { var x = v.littleEndian; withUnsafeBytes(of: &x) { header.append(contentsOf: $0) } }
    func u16(_ v: UInt16) { var x = v.littleEndian; withUnsafeBytes(of: &x) { header.append(contentsOf: $0) } }
    header.append(contentsOf: Array("RIFF".utf8)); u32(UInt32(36 + pcm.count))
    header.append(contentsOf: Array("WAVE".utf8))
    header.append(contentsOf: Array("fmt ".utf8)); u32(16); u16(1); u16(1)
    u32(UInt32(sampleRate)); u32(UInt32(sampleRate * 2)); u16(2); u16(16)
    header.append(contentsOf: Array("data".utf8)); u32(UInt32(pcm.count))
    return header + pcm
  }
}
