import type { DownloadEntry, DownloadItem } from '../../modules/replay-camera/src/ReplayCamera.types';
import type { Clip, ReceivedDownload, ReceivedEnd, Session } from '../data/schema';
import { thumbnailPath } from '../data/thumbnailPath';
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
  | {
      /** A group link (multi-recording share design §4.3): its recordings only, each opened on its own afterwards. */
      state: 'active';
      kind: 'group';
      shareId: string;
      from: string | null;
      expiresAt: string;
      total: number;
      recordings: GroupRecording[];
    }
  /** `update`: a group link opened by an app too old for it (this app says it reads groups: never expected). */
  | { state: 'own' | 'expired' | 'off' | 'removed' | 'not_found' | 'update' | 'error' };

/** One recording of a group link as `open-share` lists it. */
export type GroupRecording = {
  shareId: string;
  title: string | null;
  sport: string | null;
  total: number;
  bytes: number;
  recordedMs: number | null;
};

export type ReceiveDeps = {
  repo: {
    receivedSessions(): Session[];
    getSession(id: string): Session | undefined;
    listClips(sessionId: string): Clip[];
    addReceivedClip(input: Omit<Clip, 'id'>): Clip;
    setReceivedDownload(id: string, download: ReceivedDownload): void;
    setReceivedEnded(id: string, ended: ReceivedEnd): void;
    deleteClip(id: string): void;
    /** Returns the files of its clips, for `removeFile`. */
    deleteSession(id: string): string[];
  };
  /** `shareId`: a recording of a group link, opened with the group's code. */
  open(code: string, shareId?: string): Promise<OpenResult>;
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
  meta: { get(shareId: string): OpenedClip[] | undefined; set(shareId: string, clips: OpenedClip[]): void; forget?(shareId: string): void };
  /** Where a received clip and its framing files live on the phone (its still: `thumbnailPath` of the video). */
  paths(shareId: string, position: number): { video: string; focus: string; ball: string };
  /** Whether a file is on the phone (a clip's still already downloaded). */
  exists?: (path: string) => boolean;
  /** Deletes a file of a clip taken off the phone (Cancelar). */
  removeFile?: (path: string) => void;
  /** Deletes everything kept on the phone for a received recording (its folder: stills, files of a stopped download). */
  removeShareFiles?: (shareId: string) => void;
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
  /**
   * What the person chose (multi-recording share design §5.4): `on` downloads; `waiting` not yet (a group's recording
   * until Baixar, or after Cancelar); `paused` stopped with Pausar, until Continuar.
   */
  download: ReceivedDownload;
  /** The size of every clip of the recording, for "Baixar (320 MB)"; 0 while unknown. */
  bytes: number;
  /** The still of each clip not on the phone yet, by position, once downloaded (a file uri). */
  thumbs: Record<number, string>;
};

/**
 * While the sender is still uploading, the share is asked again this often (with the app in front). 5 s since
 * 2026-11-21: at 10 s a clip the sender had just finished waited up to 20 s to start coming down.
 */
export const RECHECK_MS = 5_000;

/**
 * Opening a recording not downloading asks the server about its link at most this often per link (a group's recordings
 * opened one after the other cost one call), so the app learns a link was turned off without asking on its own.
 */
export const LOOK_MS = 60_000;

type Kind = 'video' | 'focus' | 'ball' | 'thumb';

/** The files that make a clip; its still comes on its own, whatever the person chose. */
const CLIP_FILES: Kind[] = ['video', 'focus', 'ball'];

/** The downloader's id of one file of a received clip. */
export function downloadId(shareId: string, position: number, kind: Kind): string {
  return `recv/${shareId}/${position}/${kind}`;
}

const ID = /^recv\/([^/]+)\/(\d+)\/(video|focus|ball|thumb)$/;

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
  const exists = (path: string) => (deps.exists === undefined ? false : deps.exists(path));
  /** The stills on the phone, by share and position (a file uri): read from disk once per run, kept as they arrive. */
  const stills = new Map<string, Map<number, string>>();
  const stillsOf = (shareId: string) => {
    let known = stills.get(shareId);
    if (known === undefined) {
      known = new Map();
      stills.set(shareId, known);
    }
    return known;
  };
  const stillPath = (shareId: string, position: number) => thumbnailPath(deps.paths(shareId, position).video);

  /** Finds the stills already downloaded of a recording's clips. */
  function scanStills(shareId: string, clips: { position: number }[]): void {
    const known = stillsOf(shareId);
    for (const clip of clips) {
      if (known.has(clip.position)) continue;
      const path = stillPath(shareId, clip.position);
      if (exists(path)) known.set(clip.position, `file://${path}`);
    }
  }
  const running = new Set<string>();
  const again = new Set<string>();
  const timers = new Map<string, () => void>();
  /** Recordings open on screen: never removed from under the person. */
  const onScreen = new Set<string>();
  /** When the app last asked about each link on an opening (`look`), by group or share. */
  const looked = new Map<string, number>();
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

  /** What the person chose for the recording; a link opened before the choice existed downloads. */
  function modeOf(session: Session): ReceivedDownload {
    const received = session.received;
    return received === undefined || received.download === undefined ? 'on' : received.download;
  }

  /** Adds what already arrived, then stops and forgets the clip files still on their way (not the stills). */
  function stopClips(session: Session): void {
    const received = session.received;
    if (received === undefined) return;
    integrate(session);
    const timer = timers.get(session.id);
    if (timer !== undefined) {
      timer();
      timers.delete(session.id);
    }
    const prefix = `recv/${received.shareId}/`;
    const ids = deps.native
      .state()
      .map((e) => e.id)
      .filter((id) => {
        const parsed = id.startsWith(prefix) ? parseId(id) : undefined;
        return parsed !== undefined && parsed.kind !== 'thumb';
      });
    if (ids.length > 0) deps.native.remove(ids);
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
      deps.native.remove([...CLIP_FILES, 'thumb' as Kind].map((k) => downloadId(received.shareId, clip.position, k)));
      // Which framings came with it (2026-11-22: a clip sent on Bola opened on Jogadores; this says what arrived).
      deps.log(`recebidas: clipe ${clip.position} baixado (jogadores ${focus.path ? 'sim' : 'nao'}, bola ${ball.path ? 'sim' : 'nao'})`);
      added += 1;
    }
    if (added === 0) return;
    const now = deps.repo.getSession(session.id);
    if (now !== undefined && !wasComplete && complete(now) && deps.downloaded) deps.downloaded(now);
    notify();
  }

  /**
   * Asks the downloader for what is missing and not already on its way: every clip's still (small, so the person sees
   * the recording before choosing), and the clips themselves only when `clips` (the person chose to download).
   */
  function request(shareId: string, opened: OpenedClip[], present: Set<number>, clips: boolean): void {
    const known = entries();
    const items: DownloadItem[] = [];
    const sorted = [...opened].sort((a, b) => a.position - b.position);
    // The stills first: they show at once in the grid.
    scanStills(shareId, sorted);
    const stillsHere = stillsOf(shareId);
    for (const clip of sorted) {
      if (clip.thumb === undefined || present.has(clip.position) || stillsHere.has(clip.position)) continue;
      const id = downloadId(shareId, clip.position, 'thumb');
      const entry = known.get(id);
      if (entry !== undefined && entry.status !== 'failed') continue;
      items.push({ id, url: clip.thumb, path: stillPath(shareId, clip.position) });
    }
    // In the clips' order: the downloader goes first to first (2026-11-21).
    for (const clip of clips ? sorted : []) {
      if (!clip.ready || clip.video === undefined || present.has(clip.position)) continue;
      const target = deps.paths(shareId, clip.position);
      const files: [Exclude<Kind, 'thumb'>, string | undefined, string][] = [
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

  /**
   * The server said the link is over: kept on every recording of the link (a group's other recordings learn it from
   * this one call), then the ones with nothing on the phone leave it.
   */
  function ended(session: Session, state: ReceivedEnd): void {
    const received = session.received;
    if (received === undefined) return;
    const link = deps.repo
      .receivedSessions()
      .filter((s) =>
        s.received !== undefined &&
        (received.groupId === undefined ? s.id === session.id : s.received.groupId === received.groupId),
      );
    for (const s of link) {
      deps.repo.setReceivedEnded(s.id, state);
      states.set(s.id, state);
    }
    tidy();
  }

  /**
   * Received recordings that hold nothing and never will (their link over, no clip on the phone) leave the phone with
   * their stills: local work only, no network. The one on screen stays (it offers Apagar gravação) until it closes.
   */
  function tidy(): void {
    const now = deps.now();
    for (const session of deps.repo.receivedSessions()) {
      const received = session.received;
      if (received === undefined || onScreen.has(session.id)) continue;
      if (received.ended === undefined && received.expiresAt > now) continue;
      if (deps.repo.listClips(session.id).length > 0) continue;
      const prefix = `recv/${received.shareId}/`;
      const ids = deps.native
        .state()
        .map((e) => e.id)
        .filter((id) => id.startsWith(prefix));
      if (ids.length > 0) deps.native.remove(ids);
      const files = deps.repo.deleteSession(session.id);
      if (deps.removeFile !== undefined) files.forEach(deps.removeFile);
      if (deps.removeShareFiles !== undefined) deps.removeShareFiles(received.shareId);
      if (deps.meta.forget !== undefined) deps.meta.forget(received.shareId);
      stills.delete(received.shareId);
      states.delete(session.id);
      deps.log('recebidas: gravacao vazia de link encerrado removida');
    }
    notify();
  }

  async function run(sessionId: string, look = false): Promise<void> {
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
    // Known over: never asked again.
    if (received.ended !== undefined) {
      states.set(sessionId, received.ended);
      notify();
      return;
    }
    const mode = modeOf(session);
    // Not downloading and its clips already listed: nothing to ask the server (a group of ten opened at every return
    // to the front would cost ten calls for nothing).
    const listed = deps.meta.get(received.shareId);
    if (mode !== 'on' && listed !== undefined && !look) {
      scanStills(received.shareId, listed);
      notify();
      return;
    }
    running.add(sessionId);
    notify();
    try {
      const opened = await deps.open(received.code, received.groupId === undefined ? undefined : received.shareId);
      if (opened.state !== 'active' || opened.kind === 'group') {
        const state = opened.state === 'active' ? 'error' : opened.state;
        states.set(sessionId, state === 'own' || state === 'not_found' || state === 'update' ? 'error' : state);
        deps.log(`recebidas: link ${opened.state === 'active' ? 'grupo no lugar de gravacao' : opened.state}`);
        if (state === 'off' || state === 'expired' || state === 'removed') ended(session, state);
        return;
      }
      states.set(sessionId, 'active');
      deps.meta.set(opened.shareId, opened.clips.map(({ video: _v, focus: _f, ball: _b, thumb: _t, ...rest }) => rest));
      // Read again: Pausar or Cancelar may have come while the server answered.
      const now = deps.repo.getSession(sessionId) || session;
      const on = modeOf(now) === 'on';
      request(opened.shareId, opened.clips, have(sessionId), on);
      integrate(now);
      // The sender's phone is still uploading: ask again a little later.
      const pending = on && opened.clips.some((c) => !c.ready);
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
      tidy();
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
    run: (sessionId: string) => run(sessionId),

    /**
     * The recording's screen opened (2026-11-22): a recording not downloading asks about its link (at most once a
     * minute per link), so a link turned off is learnt by the person's own tap and never by asking on its own. While
     * open it is never removed; once closed, an empty recording of a link that is over leaves the phone. Returns the
     * closing.
     */
    opened(sessionId: string): () => void {
      onScreen.add(sessionId);
      const session = deps.repo.getSession(sessionId);
      const received = session ? session.received : undefined;
      if (session !== undefined && received !== undefined && modeOf(session) !== 'on' && !complete(session)) {
        const link = received.groupId === undefined ? received.shareId : received.groupId;
        const last = looked.get(link);
        if (last === undefined || deps.now() - last >= LOOK_MS) {
          looked.set(link, deps.now());
          void run(sessionId, true);
        }
      }
      return () => {
        onScreen.delete(sessionId);
        tidy();
      };
    },

    /** A file of the downloader finished (the system's event). */
    handleDone(e: { id: string; ok: boolean; error?: string }): void {
      const parsed = parseId(e.id);
      if (parsed === undefined) return;
      if (parsed.kind === 'thumb') {
        // The still is in its place (`thumbnailPath` of the video): the downloader can forget it. A failed one (not
        // uploaded yet) is asked for again at the next opening.
        if (e.ok) {
          stillsOf(parsed.shareId).set(parsed.position, `file://${stillPath(parsed.shareId, parsed.position)}`);
          deps.native.remove([e.id]);
        }
        notify();
        return;
      }
      if (!e.ok) deps.log(`recebidas: clipe ${parsed.position} (${parsed.kind}) FALHOU (${e.error || 'erro'})`);
      const session = sessionOfShare(parsed.shareId);
      if (session !== undefined) integrate(session);
      notify();
    },

    /**
     * Baixar, Pausar, Continuar (multi-recording share design §5.4): `on` asks for what is missing; `paused` stops the
     * files on their way (the clips already here stay; a stopped clip starts again from its first byte).
     */
    setDownload(sessionId: string, download: 'on' | 'paused'): void {
      const session = deps.repo.getSession(sessionId);
      if (session === undefined || session.received === undefined) return;
      deps.repo.setReceivedDownload(sessionId, download);
      if (download === 'on') {
        void run(sessionId);
        return;
      }
      stopClips(session);
      deps.log('recebidas: download pausado por quem recebeu');
      notify();
    },

    /**
     * Cancelar: stops the download and takes the clips already downloaded off the phone; the recording stays, with its
     * stills, ready to download again while the link lasts.
     */
    cancel(sessionId: string): void {
      const session = deps.repo.getSession(sessionId);
      if (session === undefined || session.received === undefined) return;
      // First, so the recording screen knows the clips leaving are not the person deleting the last one.
      deps.repo.setReceivedDownload(sessionId, 'waiting');
      stopClips(session);
      for (const clip of deps.repo.listClips(sessionId)) {
        deps.repo.deleteClip(clip.id);
        if (deps.removeFile !== undefined) {
          const remove = deps.removeFile;
          [clip.path, clip.focus ? clip.focus.file : undefined, clip.ball ? clip.ball.file : undefined].forEach((path) => {
            if (path !== undefined) remove(path);
          });
        }
      }
      deps.log('recebidas: download cancelado por quem recebeu');
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
      const over = received === undefined ? undefined : received.ended;
      const state = states.get(sessionId) || over || (expired ? 'expired' : 'active');
      const prefix = received ? `recv/${received.shareId}/` : undefined;
      const mine = prefix === undefined ? [] : deps.native.state().filter((e) => e.id.startsWith(prefix));
      const clipFiles = mine.filter((e) => {
        const parsed = parseId(e.id);
        return parsed !== undefined && parsed.kind !== 'thumb';
      });
      const waiting = clipFiles.some((e) => e.status === 'running' || e.status === 'paused');
      const listed = received ? deps.meta.get(received.shareId) : undefined;
      const download = session === undefined ? 'on' : modeOf(session);
      const present = have(sessionId);
      const thumbs: Record<number, string> = {};
      const known = received === undefined ? undefined : stills.get(received.shareId);
      if (known !== undefined) known.forEach((uri, position) => {
        if (!present.has(position)) thumbs[position] = uri;
      });
      const bytes =
        received !== undefined && received.bytes !== undefined
          ? received.bytes
          : (listed || []).reduce((total, c) => total + (typeof c.bytes === 'number' ? c.bytes : 0), 0);
      const slots = (listed || [])
        .map((c) => ({ position: c.position, number: typeof c.edit.number === 'number' ? c.edit.number : c.position }))
        .sort((a, b) => a.position - b.position);
      const running = held
        ? []
        : clipFiles
            .filter((e) => e.status === 'running')
            .map((e) => parseId(e.id))
            .filter((p): p is { shareId: string; position: number; kind: Kind } => p !== undefined && p.kind === 'video')
            .map((p) => p.position);
      return {
        done,
        total,
        downloading: !held && clipFiles.some((e) => e.status === 'running'),
        paused: held && download === 'on' && done < total && (waiting || clipFiles.length === 0),
        state,
        slots,
        running,
        download,
        bytes,
        thumbs,
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
