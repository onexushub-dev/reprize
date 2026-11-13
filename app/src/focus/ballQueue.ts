import type { AnalyzeBallOptions, BallAnalysis } from '../../modules/replay-camera/src/ReplayCamera.types';
import { ballDetPath, ballForCut, ballPath, ballRules, ballRulesCurrent } from '../data/ballFile';
import { focusPath, focusRange, peoplePath } from '../data/focusFile';
import type { Repo } from '../data/repo';
import type { BallSportId, BallUnsuitable, Clip } from '../data/schema';
import type { FocusHold } from './focusQueue';

export type BallQueueDeps = {
  analyze(opts: AnalyzeBallOptions): Promise<BallAnalysis>;
  /** Stops the native analysis of this clip file (the detections found so far are kept by the native side). */
  cancel(clipPath: string): void;
  supported(): boolean;
  repo: Pick<Repo, 'getClip' | 'updateClip'>;
  /** The sport the clip's recording is analysed as (test 48: model and rules); undefined = not known, nothing runs. */
  sportOf(clip: Clip): BallSportId | undefined;
  /** Milliseconds now (tests pass their own clock). */
  now(): number;
  /** Every finished analysis with its numbers (field test). */
  measured?(clip: Clip, result: BallAnalysis): void;
  /**
   * Test 50: the clip's Jogadores file is missing or has no person boxes ("people", written since 2026-11-10), which
   * the path's shirt rule (basketball) and the players' rules (beach tennis) read. The native analysis then finds the
   * people in its own pass and writes that file (plan 2026-11-12, I1); a result made without them is made again.
   */
  focusLacksPeople?(clip: Clip): boolean;
  /** Jogadores' frame interval (ms), for the file the same pass may write; absent = 100. */
  focusEvery?(): number;
  /**
   * Whether the app is in front right now. The native side also reports `BALL_INTERRUPTED` when Core ML keeps failing
   * with the app in front (e.g. a camera left running): that is a failure to retry, not a wait for the app to come back.
   */
  appActive?(): boolean;
  /** For the Diagnóstico screen (field test): a cut already analysed is analysed again (older rules or no people). */
  note?(e: { redo: true; from: string | undefined; to: string }): void;
};

/** What the chip on the video shows while a clip is analysed. */
export type BallProgress = {
  state: 'waiting' | 'cooling' | 'running' | 'framing';
  /** Analysed frames of the cut done (including those taken from the cache) and in all. */
  done: number;
  total: number;
  /** When frames started being analysed in this run, and how many were done then: the measured speed. */
  runningSince?: number;
  doneAtStart?: number;
  /** The cut's length, for the estimate before the first frames are measured. */
  cutMs: number;
};

export type BallQueue = {
  /** Seguir a Bola on for this clip: analyse its current cut unless that is already done or under way. */
  request(clipId: string): void;
  /** The player cancelled (✕) or turned Modo Foco on: stop; what was found stays for next time. */
  cancel(clipId: string): void;
  /** The clip file is being deleted. */
  forget(clipPath: string): void;
  /** Progress of a clip being analysed (or waiting), else undefined. */
  progress(clipId: string): BallProgress | undefined;
  /** Hears every progress change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** The native `onBallProgress` event. */
  onNativeProgress(e: { clipPath: string; done: number; total: number; state: 'cooling' | 'running' | 'framing' }): void;
  /** As the Modo Foco queue: nothing starts while the camera is on (`all`). */
  setHold(hold: FocusHold): void;
  /** Core ML does not run in the background: nothing starts there. */
  setForeground(foreground: boolean): void;
};

const codeOf = (e: unknown) => (typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined);

const UNSUITABLE: BallUnsuitable[] = ['tooFar', 'rarelyFound', 'tooSmall', 'still'];
/** The native reason as the record keeps it (an unknown one reads as "the camera would hardly move"). */
const reasonOf = (r: string | undefined): BallUnsuitable =>
  UNSUITABLE.includes(r as BallUnsuitable) ? (r as BallUnsuitable) : 'still';

/** Before any frame is measured: about 0.4 s of analysis per second of cut (iPhone 16 Pro Max, test 42). */
export const SECONDS_PER_CUT_SECOND = 0.4;

/** Percentage done and seconds left for the chip, from the measured speed once a few frames are done. */
export function ballEstimate(p: BallProgress, now: number): { percent: number; secondsLeft: number } {
  const percent = p.total > 0 ? Math.min(100, Math.round((p.done * 100) / p.total)) : 0;
  const left = Math.max(0, p.total - p.done);
  const measured = p.runningSince !== undefined && p.doneAtStart !== undefined ? p.done - p.doneAtStart : 0;
  let seconds: number;
  if (measured >= 5 && p.runningSince !== undefined) seconds = ((now - p.runningSince) / 1000 / measured) * left;
  else seconds = (p.cutMs / 1000) * SECONDS_PER_CUT_SECOND * (p.total > 0 ? left / p.total : 1);
  return { percent, secondsLeft: Math.max(1, Math.ceil(seconds)) };
}

/**
 * Seguir a Bola analyses (spec 2026-11-09 §4.3): one at a time, only when the player asks (the switch), with the app in
 * front and the camera off. Separate from the Modo Foco queue, which keeps running as it does.
 */
export function createBallQueue(deps: BallQueueDeps): BallQueue {
  let waiting: string[] = [];
  let running: { id: string; path: string; startMs: number; endMs: number } | undefined;
  /** The running analysis is being stopped to be started again (a recording began, the cut changed). */
  let restart = false;
  let hold: FocusHold = 'none';
  let foreground = true;
  const progress = new Map<string, BallProgress>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  function cutOf(clip: Clip) {
    return { startMs: clip.trim.startMs, endMs: clip.trim.endMs };
  }

  function pump() {
    if (running || hold === 'all' || !foreground) return;
    while (waiting.length > 0) {
      const id = waiting.shift() as string;
      const clip = deps.repo.getClip(id);
      if (!clip || !clip.ball || clip.ball.status !== 'pending' || !ballForCut(clip.ball, clip.trim)) {
        progress.delete(id);
        continue;
      }
      start(clip);
      return;
    }
    notify();
  }

  function start(clip: Clip) {
    const cut = cutOf(clip);
    const sport: BallSportId = (clip.ball && clip.ball.sport) || 'basquete';
    running = { id: clip.id, path: clip.path, ...cut };
    progress.set(clip.id, { state: 'running', done: 0, total: 0, cutMs: cut.endMs - cut.startMs });
    notify();
    const outPath = ballPath(clip.path);
    // The result is written only while the clip still waits for this cut (a new cut or a cancel may have come meanwhile).
    const wanted = () => {
      const now = deps.repo.getClip(clip.id);
      return (
        now !== undefined && now.ball !== undefined && now.ball.status === 'pending' && ballForCut(now.ball, cut, sport)
      );
    };
    // The range Jogadores itself analyses (the cut ± 2 s, lab test 56): when its file is missing, has no person boxes or
    // does not cover this cut, the same pass over the frames finds the people and writes it (one decode for the two).
    const players = focusRange(clip);
    const every = deps.focusEvery !== undefined ? deps.focusEvery() : 100;
    deps
      .analyze({
        clipPath: clip.path,
        startMs: cut.startMs,
        endMs: cut.endMs,
        detPath: ballDetPath(clip.path),
        outPath,
        focusPath: focusPath(clip.path),
        sport,
        focusStartMs: players.startMs,
        focusEndMs: players.endMs,
        peoplePath: peoplePath(clip.path),
        ...(every !== 100 ? { focusEveryMs: every } : {}),
      })
      .then((result) => {
        try {
          if (deps.measured) deps.measured(clip, result);
        } catch {
          // a measurement never breaks an analysis
        }
        // The Jogadores file made on the way is the clip's, whatever became of the ball: picking Jogadores is instant.
        if (result.focus === 'ready' || result.focus === 'none') {
          deps.repo.updateClip(clip.id, {
            focus: {
              v: 1,
              status: result.focus,
              file: focusPath(clip.path),
              startMs: players.startMs,
              endMs: players.endMs,
              ...(every !== 100 ? { every } : {}),
            },
          });
        }
        if (!wanted()) return;
        if (result.status === 'unsuitable') {
          // test 47a: it would not look good on this video; the clip stays on Modo Foco and the panel says why
          deps.repo.updateClip(clip.id, {
            ball: {
              v: 1,
              status: 'unsuitable',
              ...cut,
              sport,
              rules: ballRules(sport),
              share: result.ballShare,
              reason: reasonOf(result.reason),
            },
          });
          return;
        }
        deps.repo.updateClip(clip.id, {
          ball: { v: 1, status: 'ready', ...cut, sport, rules: ballRules(sport), file: outPath, share: result.ballShare },
        });
      })
      .catch((e: unknown) => {
        const code = codeOf(e);
        if (code === 'CANCELLED') return; // the canceller decided what comes next
        const inFront = deps.appActive !== undefined && deps.appActive();
        if (code === 'BALL_INTERRUPTED' && !inFront) {
          foreground = false; // the app went to the background: first in line when it is back
          waiting.unshift(clip.id);
          return;
        }
        console.warn('[Reprize] Seguir a Bola analysis failed', clip.path, e);
        if (!wanted()) return;
        deps.repo.updateClip(clip.id, {
          ball: { v: 1, status: 'failed', ...cut, sport, rules: ballRules(sport), ...(code === 'BALL_HOT' ? { hot: true } : {}) },
        });
      })
      .finally(() => {
        running = undefined;
        if (restart) {
          restart = false;
        } else {
          progress.delete(clip.id);
        }
        // The cut changed while it ran: the switch is still on, so the new cut is analysed (the cache makes it quick).
        const now = deps.repo.getClip(clip.id);
        if (now && now.ball && now.ball.status === 'pending' && !waiting.includes(now.id)) waiting.unshift(now.id);
        pump();
      });
  }

  function request(clipId: string) {
    if (!deps.supported()) return;
    const clip = deps.repo.getClip(clipId);
    if (!clip) return;
    const sport = deps.sportOf(clip);
    if (!sport) return; // the player has not said which sport yet
    // Asked for on screen: the app is in front (an earlier interruption must not keep it waiting until the next return).
    foreground = true;
    const cut = cutOf(clip);
    if (clip.ball && ballForCut(clip.ball, clip.trim, sport) && clip.ball.status !== 'failed' && ballRulesCurrent(clip.ball)) {
      // ready or judged unsuitable for this cut, sport and rules, or already pending for them (a result made with older
      // rules is analysed again: the detections are cached, so only the path and the camera run)
      // A done result whose Modo Foco file still has no person boxes was made without them (test 50: the shirt rule could
      // not act): made again, the Modo Foco file first.
      const noPeople = deps.focusLacksPeople !== undefined && deps.focusLacksPeople(clip);
      if ((clip.ball.status === 'ready' || clip.ball.status === 'unsuitable') && !noPeople) return;
      if (running && running.id === clipId) return;
      if (waiting.includes(clipId)) return;
    }
    if (deps.note && clip.ball && clip.ball.status !== 'pending' && ballForCut(clip.ball, clip.trim, sport)) {
      deps.note({ redo: true, from: clip.ball.rules, to: ballRules(sport) });
    }
    deps.repo.updateClip(clipId, { ball: { v: 1, status: 'pending', ...cut, sport, rules: ballRules(sport) } });
    if (running && running.id === clipId) {
      // another cut is being analysed: stop it, then this one (the frames found so far are kept)
      restart = true;
      deps.cancel(running.path);
      progress.set(clipId, { state: 'waiting', done: 0, total: 0, cutMs: cut.endMs - cut.startMs });
      notify();
      return;
    }
    waiting = [clipId, ...waiting.filter((id) => id !== clipId)];
    progress.set(clipId, { state: 'waiting', done: 0, total: 0, cutMs: cut.endMs - cut.startMs });
    notify();
    pump();
  }

  function cancel(clipId: string) {
    waiting = waiting.filter((id) => id !== clipId);
    const clip = deps.repo.getClip(clipId);
    // Not ready for the cut: forget the request (a ready analysis stays, switching back is instant).
    if (clip && clip.ball && clip.ball.status !== 'ready') deps.repo.updateClip(clipId, { ball: undefined });
    if (running && running.id === clipId) deps.cancel(running.path);
    progress.delete(clipId);
    notify();
  }

  return {
    request,
    cancel,
    forget(clipPath) {
      waiting = waiting.filter((id) => {
        const clip = deps.repo.getClip(id);
        return clip !== undefined && clip.path !== clipPath;
      });
      if (running && running.path === clipPath) deps.cancel(clipPath);
    },
    progress: (clipId) => progress.get(clipId),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    onNativeProgress(e) {
      if (!running || running.path !== e.clipPath) return;
      const before = progress.get(running.id);
      const cutMs = running.endMs - running.startMs;
      const next: BallProgress = { state: e.state, done: e.done, total: e.total, cutMs };
      if (e.state === 'running') {
        // the speed is measured from the first frame this run analysed (cached ones come for free)
        const since = before && before.runningSince !== undefined ? before.runningSince : deps.now();
        const at = before && before.doneAtStart !== undefined ? before.doneAtStart : e.done;
        next.runningSince = since;
        next.doneAtStart = at;
      }
      progress.set(running.id, next);
      notify();
    },
    setHold(value) {
      hold = value;
      if (hold === 'all' && running && !restart) {
        // the camera comes first: stopped, and started again from its cache afterwards
        restart = true;
        waiting.unshift(running.id);
        deps.cancel(running.path);
      }
      pump();
    },
    setForeground(value) {
      foreground = value;
      pump();
    },
  };
}
