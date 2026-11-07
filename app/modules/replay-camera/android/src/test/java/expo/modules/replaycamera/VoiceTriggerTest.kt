package expo.modules.replaycamera

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The save command is found as a whole word, ignoring case and accents, as on iOS (VoiceCommandTests). */
class VoiceTriggerTest {
  @Test fun findsTheWordInPortuguese() {
    assertTrue(VoiceTrigger.matches("Salvar.", "pt-BR"))
    assertTrue(VoiceTrigger.matches(" vai, SALVAR esse", "pt-BR"))
    assertTrue(VoiceTrigger.matches("sálvar", "pt-BR"))
  }

  @Test fun ignoresOtherFormsAndCourtTalk() {
    assertFalse(VoiceTrigger.matches("salvou", "pt-BR"))
    assertFalse(VoiceTrigger.matches("salvando o ponto", "pt-BR"))
    assertFalse(VoiceTrigger.matches("vamos lá", "pt-BR"))
    assertFalse(VoiceTrigger.matches("save", "pt-BR"))
  }

  @Test fun findsTheWordInEnglish() {
    assertTrue(VoiceTrigger.matches("Save!", "en-US"))
    assertFalse(VoiceTrigger.matches("saved it", "en-US"))
    assertFalse(VoiceTrigger.matches("saving", "en-US"))
    assertFalse(VoiceTrigger.matches("salvar", "en-US"))
  }
}
