import { AppState } from 'react-native';

import * as camera from '../../modules/replay-camera';
import { onFileRemoved, repo } from '../data/mmkv';
import { DIAGNOSTICS_ENABLED, diag } from '../diag/diagLog';
import { createBallQueue } from './ballQueue';
import { ballSportIdOf, ballSportOf, labelSummary, sportVerdict } from './sportCheck';

/** Seguir a Bola's speed rule (spec 2026-11-09 §4.7, Victor: per typical cut): up to 400 ms per 19-region frame. */
export const BALL_PROBE_MAX_MS = 400;

/** The app's one Seguir a Bola queue. */
export const ballQueue = createBallQueue({
  analyze: camera.analyzeBall,
  cancel: camera.cancelBall,
  supported: camera.isBallSupported,
  repo,
  sportOf: (clip) => ballSportIdOf(repo.getSession(clip.sessionId)),
  now: () => Date.now(),
  // TEMP(diag-remote): the field test reads the analysis time on the Diagnóstico screen.
  measured: (clip, r) => {
    if (!DIAGNOSTICS_ENABLED) return;
    diag(
      `Seguir a Bola: corte de ${((clip.trim.endMs - clip.trim.startMs) / 1000).toFixed(1)} s ` +
        `analisado em ${(r.elapsedMs / 1000).toFixed(1)} s (${r.analysed} quadros, ${r.reused} do cache, ` +
        `bola em ${Math.round(r.ballShare * 100)}%, zoom ${r.zoom}` +
        `${r.status === 'unsuitable' ? `, sem aplicar: ${r.reason}` : ''})`,
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

const checking = new Set<string>();

/**
 * Test 43: once per recording, Apple's scene classifier on 3 frames of one of its clips decides whether Seguir a Bola
 * shows as "EM BREVE" (another sport for sure) or stays on offer. Recordings made in a sport mode need no look.
 */
export function checkSportOnce(sessionId: string, clip: { path: string; trim: { startMs: number; endMs: number } }): void {
  const session = repo.getSession(sessionId);
  if (!session || checking.has(sessionId) || ballSportOf(session) !== undefined) return;
  checking.add(sessionId);
  camera
    .classifySport(clip.path, clip.trim.startMs, clip.trim.endMs)
    .then((labels) => {
      // Nothing seen (a build without the classifier, a frame that would not decode): ask again next time.
      if (Object.keys(labels).length === 0) {
        if (DIAGNOSTICS_ENABLED) diag('Seguir a Bola: esporte sem verificar (classificador sem resposta)');
        return;
      }
      const verdict = sportVerdict(labels);
      repo.setBallSport(sessionId, { v: 1, verdict, labels });
      // TEMP(diag-remote): the field test checks the verdict on the Diagnóstico screen.
      if (DIAGNOSTICS_ENABLED) {
        diag(`Seguir a Bola: esporte ${verdict === 'other' ? 'OUTRO (EM BREVE)' : 'liberado'} — ${labelSummary(labels)}`);
      }
    })
    .catch((e: unknown) => console.warn('[Reprize] sport check failed', e))
    .finally(() => checking.delete(sessionId));
}
