import { File } from 'expo-file-system';
import { AppState } from 'react-native';

import * as camera from '../../modules/replay-camera';
import { setBallLabVariant } from '../data/ballFile';
import { focusCovers, focusPath } from '../data/focusFile';
import { onFileRemoved, repo } from '../data/mmkv';
import { stagesText } from '../diag/clipTimings';
import { DIAGNOSTICS_ENABLED, diag } from '../diag/diagLog';
import { focusEveryMs } from './appFocusQueue';
import { createBallQueue } from './ballQueue';
import { autoSport, ballSportIdOf, inheritedSport, labelSummary, sportNeedsCheck, sportVerdict } from './sportCheck';

/** Seguir a Bola's speed rule (spec 2026-11-09 §4.7, Victor: per typical cut): up to 400 ms per 19-region frame. */
export const BALL_PROBE_MAX_MS = 400;

/**
 * Bola's frames are scaled to 1920 wide before the ball search (4K only; Full HD is unchanged): Victor's decision after
 * the 2026-11-12 speed test (~3.8x faster on 4K, fewer false balls). TEMP(lab-4k): Diagnóstico can still pick the
 * native size (0) to compare.
 */
export function ballMaxWidth(): number {
  const v = repo.getPrefs().labBallMaxWidth;
  return v === 0 ? 0 : 1920;
}

/** TEMP(lab-motion): Diagnóstico can send to the ball model only the tiles where the picture changed. */
export function ballMotionTiles(): boolean {
  return repo.getPrefs().labBallMotionTiles === true;
}

/** TEMP(lab-4k, lab-motion): the variants are part of Bola's rules, so switching one in Diagnóstico analyses the clip again. */
export function applyLabVariants(): void {
  setBallLabVariant((ballMaxWidth() > 0 ? `@w${ballMaxWidth()}` : '') + (ballMotionTiles() ? '+mt' : ''));
}
applyLabVariants();

/** TEMP(lab-pass): Diagnóstico can run the people and ball detectors one after the other, to time against side by side. */
export function scanSequential(): boolean {
  return repo.getPrefs().labScanSequential === true;
}

/** TEMP(diag-remote): battery and heat in one line; never throws (module mocks, older builds). */
function power(): string {
  try {
    return camera.diagPower();
  } catch {
    return '';
  }
}

/** TEMP(diag-remote): battery and heat when each Bola analysis started (by clip file), for its line (plan 2026-11-12). */
const powerAtStart = new Map<string, string>();

/** The app's one Seguir a Bola queue. */
export const ballQueue = createBallQueue({
  analyze: (o) => {
    if (DIAGNOSTICS_ENABLED) powerAtStart.set(o.clipPath, power());
    return camera.analyzeBall({
      ...o,
      ...(ballMaxWidth() > 0 ? { maxWidth: ballMaxWidth() } : {}),
      ...(scanSequential() ? { sequential: true } : {}),
      ...(ballMotionTiles() ? { motionTiles: true } : {}),
    });
  },
  cancel: camera.cancelBall,
  supported: camera.isBallSupported,
  repo,
  sportOf: (clip) => ballSportIdOf(repo.getSession(clip.sessionId)),
  now: () => Date.now(),
  appActive: () => AppState.currentState === 'active',
  // The players' boxes (the Jogadores file) feed Bola's rules: the shirt rule (basketball), the head filter and "keep
  // whole who hits" (beach tennis). When the file is missing (Jogadores runs only when picked, 2026-11-11) or from
  // before 2026-11-10 (test 50: no person boxes), the native analysis finds the people in the same pass as the ball and
  // writes it. A clip already analysed with no people is not tried again.
  focusLacksPeople: (clip) => {
    // a Jogadores file made for another cut (lab test 56: only the cut ± 2 s is analysed) has no people for this one
    if (clip.focus !== undefined && clip.focus.status === 'ready' && !focusCovers(clip.focus, clip.trim)) return true;
    try {
      const f = JSON.parse(new File(`file://${focusPath(clip.path)}`).textSync()) as Record<string, unknown>;
      return f.v === 1 && f.people === undefined;
    } catch {
      return clip.focus === undefined || clip.focus.status === 'pending';
    }
  },
  focusEvery: () => focusEveryMs(),
  note: (e) => {
    if (DIAGNOSTICS_ENABLED) diag(`Seguir a Bola: corte analisado de novo (regras ${e.from || 'antigas'} para ${e.to})`);
  },
  // TEMP(diag-remote): the field test reads the analysis time on the Diagnóstico screen.
  measured: (clip, r) => {
    if (!DIAGNOSTICS_ENABLED) return;
    diag(
      `Seguir a Bola: corte de ${((clip.trim.endMs - clip.trim.startMs) / 1000).toFixed(1)} s ` +
        `analisado em ${(r.elapsedMs / 1000).toFixed(1)} s (${r.analysed} quadros, ${r.reused} do cache, ` +
        `bola em ${Math.round(r.ballShare * 100)}%, ` +
        `${r.playSeconds !== undefined && r.playSeconds >= 0 ? `jogo ${r.playSeconds.toFixed(1)} s, ` : ''}` +
        `zoom ${r.zoom}, ` +
        `${ballMaxWidth() > 0 ? `quadro reduzido a ${ballMaxWidth()}` : 'quadro nativo'}, ` +
        `${ballMotionTiles() ? 'recortes com movimento' : 'todos os recortes'}, Jogadores 1 a cada ${focusEveryMs()} ms` +
        `${r.focus === 'ready' || r.focus === 'none' ? `, jogadores no mesmo passe${scanSequential() ? ' (em sequencia)' : ' (lado a lado)'}` : ''}` +
        `${r.status === 'unsuitable' ? `, sem aplicar: ${r.reason}` : ''})` +
        ` — antes: ${powerAtStart.has(clip.path) ? powerAtStart.get(clip.path) : '?'} — depois: ${power()}` +
        stagesText(r),
    );
    powerAtStart.delete(clip.path);
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
 * Once per recording, on the first clip opened (spec 2026-11-11 §4): Apple's scene classifier and the floor on 3 frames
 * of the clip work out the recording's sport (no proof, no sport), or it takes the previous recording's sport (started
 * at most 3 h before, floors agreeing). Recordings made in a sport mode, or with a sport the player chose, need no look.
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
      const now = repo.getSession(sessionId);
      // The player may have chosen a sport meanwhile: theirs stays.
      if (!now || (now.ballSport && (now.ballSport.sport || now.ballSport.unlocked))) return;
      const others = repo.listSessions().map((s) => s.session);
      const inherited = inheritedSport(now, others, labels);
      repo.setBallSport(sessionId, {
        v: 1,
        verdict,
        labels,
        rule: 2,
        ...(auto !== undefined ? { auto } : {}),
        ...(inherited !== undefined ? { sport: inherited, inherited: true } : {}),
      });
      // TEMP(diag-remote): the field test checks the verdict on the Diagnóstico screen.
      if (DIAGNOSTICS_ENABLED) {
        const said = auto === undefined ? 'sem medida do piso' : auto === 'unsure' ? 'SEM CERTEZA (nada marcado)' : auto;
        const from = inherited !== undefined ? ` — herdado da anterior: ${inherited}` : '';
        diag(`Esporte: ${said}${from} — ${labelSummary(labels)}`);
      }
    })
    .catch((e: unknown) => console.warn('[Reprize] sport check failed', e))
    .finally(() => checking.delete(sessionId));
}
