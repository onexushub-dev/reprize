import { File } from 'expo-file-system';
import { AppState } from 'react-native';

import * as camera from '../../modules/replay-camera';
import { onFileRemoved, repo } from '../data/mmkv';
import { DIAGNOSTICS_ENABLED, diag } from '../diag/diagLog';
import { createBackgroundClock } from './backgroundTime';
import { createFocusQueue } from './focusQueue';

/** TEMP(diag-remote): when the app was in the background, so the analysis time leaves it out. */
const backgroundClock = createBackgroundClock();

/** "analisado em 2.4 s", plus the time the app spent in the background meanwhile, when there was any (over 1 s). */
function analysisTime(elapsedMs: number, endAt: number): string {
  const away = backgroundClock.backgroundMsBetween(endAt - elapsedMs, endAt);
  const busy = `analisado em ${((elapsedMs - away) / 1000).toFixed(1)} s`;
  return away > 1000 ? `${busy} (+${(away / 1000).toFixed(0)} s com o app em segundo plano)` : busy;
}

/** TEMP(diag-remote): battery and heat in one line; never throws (module mocks, older builds). */
function power(): string {
  try {
    return camera.diagPower();
  } catch {
    return '';
  }
}

/** TEMP(diag-remote): battery and heat when each analysis started (by clip file), for the line written at its end. */
const powerAtStart = new Map<string, string>();

/** The app's one Modo Foco queue. */
export const focusQueue = createFocusQueue({
  // Diagnostics off (store builds): no battery reads around each analysis.
  analyze: DIAGNOSTICS_ENABLED
    ? (opts) => {
        powerAtStart.set(opts.clipPath, power());
        return camera.analyzeFocus(opts);
      }
    : camera.analyzeFocus,
  cancel: camera.cancelFocus,
  supported: camera.isFocusSupported,
  repo,
  // TEMP(diag-remote): the Modo Foco v14 field test reads the analysis time on the Diagnóstico screen.
  measured: (clip, r, waitedMs) => {
    if (!DIAGNOSTICS_ENABLED) return;
    const before = powerAtStart.get(clip.path);
    powerAtStart.delete(clip.path);
    diag(
      `Modo Foco: clipe de ${((clip.bounds ? clip.bounds.endMs - clip.bounds.startMs : clip.durationMs) / 1000).toFixed(0)} s ` +
        `${analysisTime(r.elapsedMs, Date.now())} (${r.frames} quadros, ${r.meanPeople.toFixed(1)} pessoas/quadro, ${r.status}, esperou ${(waitedMs / 1000).toFixed(1)} s na fila)` +
        ` — antes: ${before !== undefined ? before : '?'} — depois: ${power()}`,
    );
  },
  deleteFile: (path) => {
    try {
      new File(`file://${path}`).delete();
    } catch {
      // already gone
    }
  },
});

onFileRemoved((clipPath) => focusQueue.cancel(clipPath));

/** After launch, once the first screen is up: the clips a closed app left pending are analysed in the background. */
const RESTORE_AFTER_MS = 3000;

function allClips() {
  return repo.listSessions().flatMap(({ session }) => repo.listClips(session.id));
}

/**
 * For as long as the app runs (root layout): the queue follows the app to the front and back, and a few seconds after
 * launch takes up the clips a closed app left pending. Returns the stop.
 */
export function startFocusQueue(): () => void {
  const sub = AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      backgroundClock.foreground(Date.now());
      focusQueue.setForeground(true);
    }
    if (next === 'background') {
      backgroundClock.background(Date.now());
      focusQueue.setForeground(false);
    }
  });
  const timer = setTimeout(() => {
    try {
      focusQueue.restore(allClips());
    } catch (e) {
      console.warn('[Reprize] Modo Foco restore failed', e);
    }
  }, RESTORE_AFTER_MS);
  return () => {
    sub.remove();
    clearTimeout(timer);
  };
}
