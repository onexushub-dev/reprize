import type { DownloadEntry, DownloadItem } from '../../modules/replay-camera/src/ReplayCamera.types';
import type { Clip, Session } from '../data/schema';
import { type OpenedClip, receivedClip } from './receivedClip';

/** What `open-share` answers. */
export type OpenResult =
  | {
      state: 'active';
      shareId: string;
      kind: 'recording' | 'clip';
      title: string | null;
      sport: string | null;
      from: string | null;
      expiresAt: string;
      total: number;
      /** How long the recording ran on the sender's phone (ms); null for shares made before it was sent. */
      recordedMs?: number | null;
      clips: OpenedClip[];
    }
  | { state: 'own' | 'expired' | 'off' | 'removed' | 'not_found' | 'error' };

export type ReceiveDeps = {
  repo: {
    receivedSessions(): Session[];
    getSession(id: string): Session | undefined;
    listClips(sessionId: string): Clip[];
    addReceivedClip(input: Omit<Clip, 'id'>): Clip;
  };
  open(code: string): Promise<OpenResult>;
  /** The system's background downloads (iOS): they go on with the screen locked. */
  native: {
    available(): boolean;
    start(items: DownloadItem[], paused: boolean): void;
    state(): DownloadEntry[];
    pause(): void;
    resume(): void;
    remove(ids: string[]): void;
  };
  /**
   * The clips' edit data as `open-share` gave it, kept on the phone: a clip whose files arrived while the app was
   * closed becomes a clip of the recording at the next launch, even without a network.
   */
  meta: { get(shareId: string): OpenedClip[] | undefined; set(shareId: string, clips: OpenedClip[]): void };
  /** Where a received clip and its framing files live on the phone. */
  paths(shareId: string, position: number): { video: string; focus: string; ball: string };
  now(): number;
  /** Runs `fn` again after `ms` (a share whose sender is still uploading). Returns a cancel. */
  later(fn: () => void, ms: number): () => void;
  log(text: string): void;
  /** Every clip of this received recording is on the phone now (once). */
  downloaded?: (session: Session) => void;
};

/**
 * How far a received recording is: clips on the phone of those the sender shared. `paused`: a recording is on (or
 * the phone is critically hot), and nothing downloads until it ends (decision 16).
 */
export type ReceiveProgress = {
  done: number;
  total: number;
  downloading: boolean;
  paused: boolean;
  /**
   * Every clip of the share in the sender's order, with the number it has there (2026-11-21): the grid keeps one place
   * per clip, so a clip that arrives fills its own place instead of the list moving under the player. Empty until the
   * share's clip list is known.
   */
  slots: { position: number; number: number }[];
  /** Positions whose video is downloading right now. */
  running: number[];
  state: 'active' | 'expired' | 'off' | 'removed' | 'error';
};

/**
 * While the sender is still uploading, the share is asked again this often (with the app in front). 5 s since
 * 2026-11-21: at 10 s a clip the sender had just finished waited up to 20 s to start coming down.
 */
export const RECHECK_MS = 5_000;

type Kind = 'video' | 'focus' | 'ball';

/** The downloader's id of one file of a received clip. */
export function downloadId(shareId: string, position: number, kind: Kind): string {
  return `recv/${shareId}/${position}/${kind}`;
}

const ID = /^recv\/([^/]+)\/(\d+)\/(video|focus|ball)$/;

function parseId(id: string): { shareId: string; position: number; kind: Kind } | undefined {
  const match = ID.exec(id);
  return match === null ? undefined : { shareId: match[1], position: Number(match[2]), kind: match[3] as Kind };
}

/**
 * Downloads received recordings into the app (sharing design decision 7, §5.5) through the system's background
 * downloads: every clip the sender's upload confirmed, with its framing files, until all are on the phone or the
 * link expires. The transfers go on with the screen locked; a clip becomes a clip of the recording once its video has
 * arrived and its framing files have arrived or failed (they are best effort). Nothing downloads while held (a
 * recording is on, decision 16): the transfers pause and start again when it ends.
 */
export function createReceiveQueue(deps: ReceiveDeps) {
  const running = new Set<string>();
  const again = new Set<string>();
  const timers = new Map<string, () => void>();
  const states = new Map<string, ReceiveProgress['state']>();
  const listeners = new Set<() => void>();
  let version = 0;
  let foreground = true;
  let held = false;

  const notify = () => {
    version += 1;
    listeners.forEach((fn) => fn());
  };

  const have = (sessionId: string) =>
    new Set(deps.repo.listClips(sessionId).map((c) => (c.sharePosition === undefined ? -1 : c.sharePosition)));

  function complete(session: Session): boolean {
    return session.received !== undefined && have(session.id).size >= session.received.total;
  }

  function entries(): Map<string, DownloadEntry> {
    return new Map(deps.native.state().map((e) => [e.id, e]));
  }

  function sessionOfShare(shareId: string): Session | undefined {
    return deps.repo.receivedSessions().find((s) => s.received !== undefined && s.received.shareId === shareId);
  }

  /**
   * Turns every clip whose files have arrived into a clip of the recording, and lets the downloader forget them. Needs
   * no network: the edit data is kept on the phone.
   */
  function integrate(session: Session): void {
    const received = session.received;
    if (received === undefined) return;
    const clips = deps.meta.get(received.shareId);
    if (clips === undefined) return;
    const known = entries();
    const present = have(session.id);
    const wasComplete = complete(session);
    let added = 0;
    for (const clip of clips) {
      if (present.has(clip.position)) continue;
      const video = known.get(downloadId(received.shareId, clip.position, 'video'));
      if (video === undefined || video.status !== 'done') continue;
      const extra = (kind: Kind): { settled: boolean; path?: string } => {
        const entry = known.get(downloadId(received.shareId, clip.position, kind));
        if (entry === undefined) return { settled: true };
        if (entry.status === 'done') return { settled: true, path: entry.path };
        return { settled: entry.status === 'failed' };
      };
      const focus = extra('focus');
      const ball = extra('ball');
      // A framing file still coming down: the clip waits for it (it would show without its framing otherwise).
      if (!focus.settled || !ball.settled) continue;
      deps.repo.addReceivedClip(receivedClip(session.id, clip, { video: video.path, focus: focus.path, ball: ball.path }, deps.now()));
      deps.native.remove((['video', 'focus', 'ball'] as Kind[]).map((k) => downloadId(received.shareId, clip.position, k)));
      deps.log(`recebidas: clipe ${clip.position} baixado`);
      added += 1;
    }
    if (added === 0) return;
    const now = deps.repo.getSession(session.id);
    if (now !== undefined && !wasComplete && complete(now) && deps.downloaded) deps.downloaded(now);
    notify();
  }

  /** Asks the downloader for what is missing and not already on its way. */
  function request(shareId: string, clips: OpenedClip[], present: Set<number>): void {
    const known = entries();
    const items: DownloadItem[] = [];
    // In the clips' order: the downloader goes first to first (2026-11-21).
    for (const clip of [...clips].sort((a, b) => a.position - b.position)) {
      if (!clip.ready || clip.video === undefined || present.has(clip.position)) continue;
      const target = deps.paths(shareId, clip.position);
      const files: [Kind, string | undefined, string][] = [
        ['video', clip.video, target.video],
        ['focus', clip.focus, target.focus],
        ['ball', clip.ball, target.ball],
      ];
      for (const [kind, url, path] of files) {
        if (url === undefined) continue;
        const id = downloadId(shareId, clip.position, kind);
        const entry = known.get(id);
        // Running, paused or done: already on its way. A failed one goes again with the fresh URL.
        if (entry !== undefined && entry.status !== 'failed') continue;
        items.push({ id, url, path });
      }
    }
    if (items.length === 0) return;
    deps.native.start(items, held);
    deps.log(`recebidas: ${items.length} arquivos na fila${held ? ' (pausados: gravando)' : ''}`);
  }

  async function run(sessionId: string): Promise<void> {
    if (running.has(sessionId)) {
      again.add(sessionId);
      return;
    }
    const session = deps.repo.getSession(sessionId);
    const received = session ? session.received : undefined;
    if (session === undefined || received === undefined) return;
    integrate(session);
    if (complete(deps.repo.getSession(sessionId) || session)) return;
    if (!deps.native.available()) {
      states.set(sessionId, 'error');
      deps.log('recebidas: download em segundo plano indisponivel neste build');
      notify();
      return;
    }
    if (received.expiresAt <= deps.now()) {
      states.set(sessionId, 'expired');
      notify();
      return;
    }
    running.add(sessionId);
    notify();
    try {
      const opened = await deps.open(received.code);
      if (opened.state !== 'active') {
        states.set(sessionId, opened.state === 'own' || opened.state === 'not_found' ? 'error' : opened.state);
        deps.log(`recebidas: link ${opened.state}`);
        return;
      }
      states.set(sessionId, 'active');
      deps.meta.set(opened.shareId, opened.clips.map(({ video: _v, focus: _f, ball: _b, ...rest }) => rest));
      request(opened.shareId, opened.clips, have(sessionId));
      integrate(deps.repo.getSession(sessionId) || session);
      // The sender's phone is still uploading: ask again a little later.
      const pending = opened.clips.some((c) => !c.ready);
      if (pending && foreground && !timers.has(sessionId)) {
        timers.set(
          sessionId,
          deps.later(() => {
            timers.delete(sessionId);
            void run(sessionId);
          }, RECHECK_MS),
        );
      }
    } catch (e) {
      states.set(sessionId, 'error');
      deps.log(`recebidas: FALHOU (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      running.delete(sessionId);
      notify();
      if (again.delete(sessionId)) void run(sessionId);
    }
  }

  return {
    /** Adds what arrived and asks for what is missing, for every received recording (at launch, back in front). */
    sync(): void {
      const sessions = deps.repo.receivedSessions();
      // Files of a recording deleted on this phone: nothing will take them any more.
      const shares = new Set(sessions.map((s) => (s.received === undefined ? '' : s.received.shareId)));
      const orphans = deps.native
        .state()
        .map((e) => e.id)
        .filter((id) => {
          const parsed = parseId(id);
          return parsed !== undefined && !shares.has(parsed.shareId);
        });
      if (orphans.length > 0) deps.native.remove(orphans);
      for (const session of sessions) void run(session.id);
    },

    /** Downloads this received recording now (it was just opened). */
    run,

    /** A file of the downloader finished (the system's event). */
    handleDone(e: { id: string; ok: boolean; error?: string }): void {
      const parsed = parseId(e.id);
      if (parsed === undefined) return;
      if (!e.ok) deps.log(`recebidas: clipe ${parsed.position} (${parsed.kind}) FALHOU (${e.error || 'erro'})`);
      const session = sessionOfShare(parsed.shareId);
      if (session !== undefined) integrate(session);
      notify();
    },

    /**
     * A recording started or ended (or the phone got critically hot): the downloads pause and start again, as uploads
     * do (decision 16).
     */
    setHold(next: boolean): void {
      if (next === held) return;
      held = next;
      if (held) {
        deps.native.pause();
        deps.log('recebidas: download pausado (gravando)');
      } else {
        deps.native.resume();
        deps.log('recebidas: download retomado');
      }
      notify();
    },

    /** Re-checks stop in the background (iOS would suspend them anyway) and start again in front. */
    setForeground(next: boolean): void {
      foreground = next;
      if (!next) {
        timers.forEach((cancel) => cancel());
        timers.clear();
      }
    },

    progress(sessionId: string): ReceiveProgress {
      const session = deps.repo.getSession(sessionId);
      const received = session ? session.received : undefined;
      const total = received ? received.total : 0;
      const done = Math.min(total, have(sessionId).size);
      const expired = received !== undefined && received.expiresAt <= deps.now();
      const state = states.get(sessionId) || (expired ? 'expired' : 'active');
      const prefix = received ? `recv/${received.shareId}/` : undefined;
      const mine = prefix === undefined ? [] : deps.native.state().filter((e) => e.id.startsWith(prefix));
      const waiting = mine.some((e) => e.status === 'running' || e.status === 'paused');
      const listed = received ? deps.meta.get(received.shareId) : undefined;
      const slots = (listed || [])
        .map((c) => ({ position: c.position, number: typeof c.edit.number === 'number' ? c.edit.number : c.position }))
        .sort((a, b) => a.position - b.position);
      const running = held
        ? []
        : mine
            .filter((e) => e.status === 'running')
            .map((e) => parseId(e.id))
            .filter((p): p is { shareId: string; position: number; kind: Kind } => p !== undefined && p.kind === 'video')
            .map((p) => p.position);
      return {
        done,
        total,
        downloading: !held && mine.some((e) => e.status === 'running'),
        paused: held && done < total && (waiting || mine.length === 0),
        state,
        slots,
        running,
      };
    },

    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },

    version(): number {
      return version;
    },
  };
}

export type ReceiveQueue = ReturnType<typeof createReceiveQueue>;
