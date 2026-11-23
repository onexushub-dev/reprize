import { repo } from '../data/mmkv';

/**
 * The first-time tour of the camera (2026-11-22): shown once, until Pular or Entendi; Ajustes > Tutorial shows it again
 * the next time the camera is open.
 */
export function cameraTourSeen(): boolean {
  return repo.getPrefs().cameraTourSeen === true;
}

export function finishCameraTour(): void {
  repo.setPrefs({ cameraTourSeen: true });
}

export function restartCameraTour(): void {
  repo.setPrefs({ cameraTourSeen: false });
}
