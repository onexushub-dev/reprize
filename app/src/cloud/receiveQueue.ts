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
  /** Downloads to this path (replacing what is there); false when it failed. */
  download(url: string, path: string): Promise<boolean>;
  /** Where a received clip and its framing files live on the phone. */
  paths(shareId: string, position: number): { video: string; focus: string; ball: string };
  now(): number;
  /** Runs `fn` again after `ms` (a share whose sender is still uploading). Returns a cancel. */
  later(fn: () => void, ms: number): () => void;
  log(text: string): void;
  /** Every clip of this received recording is on the phone now (once). */
  downloaded?: (session: Session) => void;
};

/** How far a received recording is: clips on the phone of those the sender shared. */
export type ReceiveProgress = { done: number; total: number; downloading: boolean; state: 'active' | 'expired' | 'off' | 'removed' | 'error' };

/** While the sender is still uploading, the share is asked again this often. */
export const RECHECK_MS = 10_000;

/**
 * Downloads received recordings into the app (sharing design decision 7, §5.5): every clip the sender's upload
 * confirmed, with its framing files, one at a time, until all are on the phone or the link expires. A clip becomes a
 * clip of the received recording only once its video is complete; framing files are best effort.
 */
export function createReceiveQueue(deps: ReceiveDeps) {
  const running = new Set<string>();
  /** Recordings with a file coming down right now (what "Baixando" means; asking the server again is not). */
  const downloading = new Set<string>();
  const again = new Set<string>();
  const timers = new Map<string, () => void>();
  const states = new Map<string, ReceiveProgress['state']>();
  const listeners = new Set<() => void>();
  let version = 0;
  let foreground = true;

  const notify = () => {
    version += 1;
    listeners.forEach((fn) => fn());
  };

  const have = (sessionId: string) =>
    new Set(deps.repo.listClips(sessionId).map((c) => (c.sharePosition === undefined ? -1 : c.sharePosition)));

  function complete(session: Session): boolean {
    return session.received !== undefined && have(session.id).size >= session.received.total;
  }

  async function run(sessionId: string): Promise<void> {
    if (running.has(sessionId)) {
      again.add(sessionId);
      return;
    }
    const session = deps.repo.getSession(sessionId);
    const received = session ? session.received : undefined;
    if (session === undefined || received === undefined || complete(session)) return;
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
      const present = have(sessionId);
      for (const clip of opened.clips) {
        if (!clip.ready || clip.video === undefined || present.has(clip.position)) continue;
        const target = deps.paths(opened.shareId, clip.position);
        downloading.add(sessionId);
        notify();
        if (!(await deps.download(clip.video, target.video))) {
          deps.log(`recebidas: clipe ${clip.position} FALHOU`);
          continue;
        }
        const focus = clip.focus !== undefined && (await deps.download(clip.focus, target.focus)) ? target.focus : undefined;
        const ball = clip.ball !== undefined && (await deps.download(clip.ball, target.ball)) ? target.ball : undefined;
        deps.repo.addReceivedClip(receivedClip(sessionId, clip, { video: target.video, focus, ball }, deps.now()));
        deps.log(`recebidas: clipe ${clip.position} baixado`);
        notify();
      }
      // The sender's phone is still uploading: ask again a little later.
      const now = deps.repo.getSession(sessionId);
      if (now !== undefined && complete(now) && deps.downloaded) deps.downloaded(now);
      if (now !== undefined && !complete(now) && foreground && !timers.has(sessionId)) {
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
      downloading.delete(sessionId);
      notify();
      if (again.delete(sessionId)) void run(sessionId);
    }
  }

  return {
    /** Starts every received recording that still misses clips (at launch, on coming to the front, after a link). */
    sync(): void {
      for (const session of deps.repo.receivedSessions()) void run(session.id);
    },

    /** Downloads this received recording now (it was just opened). */
    run,

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
      const expired = received !== undefined && received.expiresAt <= deps.now();
      const state = states.get(sessionId) || (expired ? 'expired' : 'active');
      return { done: Math.min(total, have(sessionId).size), total, downloading: downloading.has(sessionId), state };
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
