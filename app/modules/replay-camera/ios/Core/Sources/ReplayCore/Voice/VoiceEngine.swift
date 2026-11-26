/// Which engine listens for the save command (plan 2026-11-24 voice keyword detector; spec section "salvar-v2-rc4 is
/// the Portuguese default"): Portuguese uses the "salvar" detector (`KeywordDetector`, model `salvar-v2-rc4`) whenever
/// its model loaded; English, and Portuguese when the model is missing or broken, use dictation.
/// Going back to dictation for Portuguese: set `portugueseUsesKeyword` to false (docs/voice-lab/MODELS.md, "Going back").
public enum VoiceEngine: String {
  case dictation
  case keyword

  /// true: Portuguese listens with the detector. false: dictation in every language, as before 2026-11-26.
  public static let portugueseUsesKeyword = true

  public static func choose(locale: VoiceLocale, keywordAvailable: Bool) -> VoiceEngine {
    if portugueseUsesKeyword && locale == .ptBR && keywordAvailable { return .keyword }
    return .dictation
  }
}
