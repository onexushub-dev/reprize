/// Which engine listens for the save command (plan 2026-11-24 voice keyword detector, Phase 2 revision): today's
/// dictation or the "salvar" detector. The detector is only for Portuguese and only when its model loaded; anything
/// else is dictation, whatever the Diagnóstico switch asks for.
public enum VoiceEngine: String {
  case dictation
  case keyword

  public static func choose(preferred: VoiceEngine, locale: VoiceLocale, keywordAvailable: Bool) -> VoiceEngine {
    if preferred == .keyword && locale == .ptBR && keywordAvailable { return .keyword }
    return .dictation
  }
}
