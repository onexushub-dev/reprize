import { AppState } from 'react-native';

import * as camera from '../../modules/replay-camera';
import { onFileRemoved, repo } from '../data/mmkv';
import { DIAGNOSTICS_ENABLED, diag } from '../diag/diagLog';
import { createBallQueue } from './ballQueue';

/** Seguir a Bola's speed rule (spec 2026-11-09 §4.7, Victor: per typical cut): up to 400 ms per 19-region frame. */
export const BALL_PROBE_MAX_MS = 400;

/** The app's one Seguir a Bola queue. */
export const ballQueue = createBallQueue({
  analyze: camera.analyzeBall,
  cancel: camera.cancelBall,
  supported: camera.isBallSupported,
  repo,
  now: () => Date.now(),
  // TEMP(diag-remote): the field test reads the analysis time on the Diagnóstico screen.
  measured: (clip, r) => {
    if (!DIAGNOSTICS_ENABLED) return;
    diag(
      `Seguir a Bola: corte de ${((clip.trim.endMs - clip.trim.startMs) / 1000).toFixed(1)} s ` +
        `analisado em ${(r.elapsedMs / 1000).toFixed(1)} s (${r.analysed} quadros, ${r.reused} do cache, ` +
        `bola em ${Math.round(r.ballShare * 100)}%, zoom ${r.zoom})`,
    );
  },
});

onFileRemoved((clipPath) => ballQueue.forget(clipPath));

try {
  camera.addReplayListener('onBallProgress', (e) => ballQueue.onNativeProgress(e));
} catch {
  // no native module here (tests, web)
}

AppState.addEventListener('change', (next) => {
  if (next === 'active') ballQueue.setForeground(true);
  if (next === 'background') ballQueue.setForeground(false);
});

/**
 * Whether this phone shows Seguir a Bola: the native analysis is there and the one-time probe (run on first use) found
 * it fast enough. Unknown yet = shown; the probe decides once it ran.
 */
export function ballAvailable(): boolean {
  if (!camera.isBallSupported()) return false;
  const ms = repo.getPrefs().ballProbeMs;
  return ms === undefined || ms <= BALL_PROBE_MAX_MS;
}

let probing = false;

/** Runs the speed probe once ever (a single frame through the model); the result is kept in the prefs. */
export function probeBallOnce(): void {
  if (probing || !camera.isBallSupported() || repo.getPrefs().ballProbeMs !== undefined) return;
  probing = true;
  camera
    .probeBall()
    .then((ms) => {
      repo.setPrefs({ ballProbeMs: Math.round(ms) });
      if (DIAGNOSTICS_ENABLED) diag(`Seguir a Bola: teste de velocidade ${Math.round(ms)} ms por quadro`);
    })
    .catch((e: unknown) => {
      // A build without the model can never analyse: the option stays hidden.
      if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'BALL_NO_MODEL') {
        repo.setPrefs({ ballProbeMs: Number.MAX_SAFE_INTEGER });
      }
      console.warn('[Reprize] Seguir a Bola probe failed', e);
    })
    .finally(() => {
      probing = false;
    });
}
