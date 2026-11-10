import type { AnalyzeFocusOptions, FocusAnalysis } from '../../modules/replay-camera/src/ReplayCamera.types';
import { focusPath } from '../data/focusFile';
import type { Repo } from '../data/repo';
import type { Clip } from '../data/schema';

export type FocusQueueDeps = {
  analyze(opts: AnalyzeFocusOptions): Promise<FocusAnalysis>;
  /** Stops the native analysis of this clip file. */
  cancel(clipPath: string): void;
  supported(): boolean;
  repo: Pick<Repo, 'getClip' | 'updateClip'>;
  deleteFile(path: string): void;
  /** Every finished analysis with its numbers (field test: how long the Modo Foco takes on each phone). */
  measured?(clip: Clip, result: FocusAnalysis, waitedMs: number): void;
};

export type FocusQueue = {
  /** A clip just saved: mark it pending and analyse it when its turn comes. */
  enqueue(clipId: string): void;
  /** A clip opened in the editor: queue it if it was never analysed, or was left pending by a closed app. */
  ensure(clip: Clip): void;
  /** The clip file is being deleted: drop it from the queue and stop its analysis. */
  cancel(clipPath: string): void;
  /** True: nothing new starts (same as `setHold('all')`); false: `setHold('none')`. */
  setPaused(paused: boolean): void;
  /** What may start while a recording runs: see `focusHold`. `all` also stops a running analysis and queues it again. */
  setHold(hold: FocusHold): void;
  /** Clips left pending by an app that closed: queued again behind what waits, newest first (the likeliest opened). */
  restore(clips: Clip[]): void;
  /** The app is in front (true) or not: Vision cannot run in the background, so nothing starts there. */
  setForeground(foreground: boolean): void;
  /**
   * A recording's screen is open: its pending clips are analysed, in the order they were saved. Returns the close (the
   * analysis running finishes; no new one of this recording starts).
   */
  openRecording(sessionId: string): () => void;
};

/**
 * `none`: everything runs. `openedOnly`: only clips opened in the editor (`ensure`) start. `all`: nothing new starts.
 */
export type FocusHold = 'none' | 'openedOnly' | 'all';

/**
 * The camera and the phone's heat come first: no analysis while the camera is on, recording or on the setup screen
 * (2026-11-07 basketball field test: the queue running between recordings kept the phone `serious` all morning).
 */
export function focusHold(cameraOn: boolean): FocusHold {
  return cameraOn ? 'all' : 'none';
}

const codeOf = (e: unknown) => (typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined);

/**
 * Modo Foco analyses, one at a time, in the order the clips were saved, for the recording whose screen is open, with a
 * clip opened in the editor first; only with the app in front and the camera off (2026-11-07 spec §4.1). A saved clip
 * waits, pending, until its recording is opened.
 */
export function createFocusQueue(deps: FocusQueueDeps): FocusQueue {
  let waiting: string[] = [];
  let running: { id: string; path: string } | undefined;
  let hold: FocusHold = 'none';
  let foreground = true;
  /** The running analysis was stopped by a recording: it goes back to the front of the queue. */
  let stopping: string | undefined;
  /** Clips opened in the editor: they go first, and may start during an `openedOnly` hold. */
  const opened = new Set<string>();
  /** When each clip was queued or opened (the first of the two), for how long it waited before its analysis began. */
  const queuedAt = new Map<string, number>();
  const markQueued = (id: string) => {
    if (!queuedAt.has(id)) queuedAt.set(id, Date.now());
  };
  /** Recordings whose screen is open, with how many times (a screen pushed twice). */
  const openRecordings = new Map<string, number>();

  function eligible(id: string, clip: Clip): boolean {
    if (opened.has(id)) return true;
    if (hold === 'openedOnly') return false;
    const count = openRecordings.get(clip.sessionId);
    return count !== undefined && count > 0;
  }

  function pump() {
    if (running || hold === 'all' || !foreground) return;
    // A clip opened in the editor goes first, even ahead of one that was put back by `ensure` stopping it.
    const openedAt = waiting.findIndex((id) => opened.has(id));
    if (openedAt > 0) waiting.unshift(...waiting.splice(openedAt, 1));
    let i = 0;
    while (i < waiting.length) {
      const id = waiting[i];
      const clip = deps.repo.getClip(id);
      if (!clip) {
        // deleted while waiting
        waiting.splice(i, 1);
        opened.delete(id);
        continue;
      }
      if (!eligible(id, clip)) {
        i += 1;
        continue;
      }
      waiting.splice(i, 1);
      opened.delete(id);
      start(clip);
      return;
    }
  }

  function start(clip: Clip) {
    const outPath = focusPath(clip.path);
    const range = clip.bounds ? clip.bounds : { startMs: 0, endMs: clip.durationMs };
    running = { id: clip.id, path: clip.path };
    const waited = Date.now() - (queuedAt.get(clip.id) ?? Date.now());
    queuedAt.delete(clip.id);
    deps
      .analyze({ clipPath: clip.path, startMs: range.startMs, endMs: range.endMs, outPath })
      .then((result) => {
        try {
          if (deps.measured) deps.measured(clip, result, waited);
        } catch {
          // a measurement never breaks an analysis
        }
        // updateClip never brings back a deleted clip; the file it wrote is then left over.
        if (!deps.repo.updateClip(clip.id, { focus: { v: 1, status: result.status, file: outPath } })) {
          deps.deleteFile(outPath);
          return;
        }
      })
      .catch((e: unknown) => {
        const code = codeOf(e);
        if (code === 'CANCELLED') {
          if (stopping === clip.id && deps.repo.getClip(clip.id)) waiting.unshift(clip.id);
          return;
        }
        // Vision cannot run with the app in the background: still pending, first in line when the app is back.
        if (code === 'FOCUS_INTERRUPTED') {
          foreground = false;
          waiting.unshift(clip.id);
          return;
        }
        console.warn('[Reprize] Modo Foco analysis failed', clip.path, e);
        deps.repo.updateClip(clip.id, { focus: { v: 1, status: 'failed' } });
      })
      .finally(() => {
        if (stopping === clip.id) stopping = undefined;
        running = undefined;
        pump();
      });
  }

  function enqueue(clipId: string) {
    if (!deps.supported()) return;
    if (waiting.includes(clipId) || (running && running.id === clipId)) return;
    if (!deps.repo.updateClip(clipId, { focus: { v: 1, status: 'pending' } })) return;
    markQueued(clipId);
    waiting.push(clipId);
    pump();
  }

  return {
    enqueue,
    ensure(clip) {
      if (clip.focus && clip.focus.status !== 'pending') return;
      if (!deps.supported()) return;
      if (running && running.id === clip.id) return;
      // Opened in the editor: it goes first, and may run during an `openedOnly` hold. The app is in front.
      opened.add(clip.id);
      markQueued(clip.id);
      foreground = true;
      // The clip being looked at does not wait for another one's analysis: that one is stopped and goes back in line.
      if (running && stopping === undefined && !opened.has(running.id)) {
        stopping = running.id;
        deps.cancel(running.path);
      }
      const at = waiting.indexOf(clip.id);
      if (at >= 0) {
        waiting.splice(at, 1);
        waiting.unshift(clip.id);
        pump();
        return;
      }
      if (!deps.repo.updateClip(clip.id, { focus: { v: 1, status: 'pending' } })) {
        opened.delete(clip.id);
        return;
      }
      waiting.unshift(clip.id);
      pump();
    },
    cancel(clipPath) {
      waiting = waiting.filter((id) => {
        const clip = deps.repo.getClip(id);
        return clip !== undefined && clip.path !== clipPath;
      });
      if (running && running.path === clipPath) deps.cancel(clipPath);
    },
    setPaused(value) {
      hold = value ? 'all' : 'none';
      pump();
    },
    setHold(value) {
      hold = value;
      // A recording starts: a running analysis would share the phone's heat with the camera; it is redone afterwards.
      if (hold === 'all' && running && stopping === undefined) {
        stopping = running.id;
        deps.cancel(running.path);
      }
      pump();
    },
    restore(clips) {
      if (!deps.supported()) return;
      const pending = clips
        .filter((c) => c.focus !== undefined && c.focus.status === 'pending')
        .filter((c) => !waiting.includes(c.id) && !(running && running.id === c.id))
        .sort((a, b) => b.createdAt - a.createdAt);
      waiting.push(...pending.map((c) => c.id));
      pump();
    },
    setForeground(value) {
      foreground = value;
      pump();
    },
    openRecording(sessionId) {
      openRecordings.set(sessionId, (openRecordings.get(sessionId) ?? 0) + 1);
      pump();
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        const left = (openRecordings.get(sessionId) ?? 1) - 1;
        if (left > 0) openRecordings.set(sessionId, left);
        else openRecordings.delete(sessionId);
      };
    },
  };
}
