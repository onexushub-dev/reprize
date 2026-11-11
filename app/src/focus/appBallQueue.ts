import { File } from 'expo-file-system';
import { AppState } from 'react-native';

import * as camera from '../../modules/replay-camera';
import { focusPath } from '../data/focusFile';
import { onFileRemoved, repo } from '../data/mmkv';
import { DIAGNOSTICS_ENABLED, diag } from '../diag/diagLog';
import { createBallQueue } from './ballQueue';
import { autoSport, ballSportIdOf, labelSummary, sportNeedsCheck, sportVerdict } from './sportCheck';

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
  // Test 50: a Modo Foco file from before 2026-11-10 has no person boxes; made again (same range as the Modo Foco queue).
  focusLacksPeople: (clip) => {
    try {
      const f = JSON.parse(new File(`file://${focusPath(clip.path)}`).textSync()) as Record<string, unknown>;
      return f.v === 1 && f.people === undefined;
    } catch {
      return false; // no file (yet) or unreadable: the native side copes as before
    }
  },
  refreshFocus: (clip) => {
    const range = clip.bounds ? clip.bounds : { startMs: 0, endMs: clip.durationMs };
    if (DIAGNOSTICS_ENABLED) diag('Seguir a Bola: Modo Foco refeito para ter as pessoas (arquivo antigo)');
    return camera.analyzeFocus({
      clipPath: clip.path,
      startMs: range.startMs,
      endMs: range.endMs,
      outPath: focusPath(clip.path),
    });
  },
  note: (e) => {
    if (DIAGNOSTICS_ENABLED) diag(`Seguir a Bola: corte analisado de novo (regras ${e.from || 'antigas'} para ${e.to})`);
  },
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

/** Test 51: whether this recording's sport is being worked out right now (the row says "Verificando…"). */
export function sportChecking(sessionId: string): boolean {
  return checking.has(sessionId);
}

/**
 * Test 43: once per recording, Apple's scene classifier on 3 frames of one of its clips decides whether Seguir a Bola
 * shows as "EM BREVE" (another sport for sure) or stays on offer. Recordings made in a sport mode need no look.
 */
export function checkSportOnce(sessionId: string, clip: { path: string; trim: { startMs: number; endMs: number } }): void {
  const session = repo.getSession(sessionId);
  if (!session || checking.has(sessionId) || !sportNeedsCheck(session)) return;
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
      const auto = autoSport(labels);
      repo.setBallSport(sessionId, { v: 1, verdict, labels, ...(auto !== undefined ? { auto } : {}) });
      // TEMP(diag-remote): the field test checks the verdict on the Diagnóstico screen.
      if (DIAGNOSTICS_ENABLED) {
        const said = auto === undefined ? (verdict === 'other' ? 'OUTRO (EM BREVE)' : 'liberado') : auto === 'other' ? 'OUTRO (somente Modo Foco)' : auto;
        diag(`Seguir a Bola: esporte ${said} — ${labelSummary(labels)}`);
      }
    })
    .catch((e: unknown) => console.warn('[Reprize] sport check failed', e))
    .finally(() => checking.delete(sessionId));
}
