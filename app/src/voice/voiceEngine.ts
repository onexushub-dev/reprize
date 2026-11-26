import * as camera from '../../modules/replay-camera';
import { repo } from '../data/mmkv';
import { DIAGNOSTICS_ENABLED } from '../diag/diagLog';

/**
 * Which engine listens for "salvar" (plan docs/superpowers/plans/2026-11-24-voice-keyword-detector.md, Phase 2): today's
 * dictation or the trained model. The model only in builds with diagnostics (REPRIZE_DIAGNOSTICS=1), chosen in
 * Diagnóstico; store builds always stay on dictation. The native side keeps English on dictation whatever this says.
 */
export type VoiceEngine = 'dictation' | 'keyword';

/** The rule, without the app around it: the model only when diagnostics are on and Diagnóstico asked for it. */
export function pickVoiceEngine(diagnostics: boolean, pref: VoiceEngine | undefined): VoiceEngine {
  return diagnostics && pref === 'keyword' ? 'keyword' : 'dictation';
}

export function voiceEngine(): VoiceEngine {
  return pickVoiceEngine(DIAGNOSTICS_ENABLED, repo.getPrefs().labVoiceEngine);
}

/** Tells the native side; never throws (module mocks, older builds, Android). */
export function applyVoiceEngine(): void {
  try {
    camera.setVoiceEngine(voiceEngine());
  } catch {
    // older native build: dictation, as before
  }
}

/** The Diagnóstico switch: saves the choice and applies it at once (also to a recording in progress). */
export function setVoiceEnginePref(engine: VoiceEngine): void {
  repo.setPrefs({ labVoiceEngine: engine });
  applyVoiceEngine();
}
