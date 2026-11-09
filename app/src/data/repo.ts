import { type Clip, DEFAULT_PREFS, DEFAULT_TRIM_MS, MAX_CLIP_NAME, MAX_GAME_NAME, type Prefs, type Session, type Sport } from './schema';

export interface KV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  /** All stored keys; used once to rebuild the game index for data saved before it existed. */
  keys?(): string[];
}

export interface FileProbe {
  exists(path: string): boolean;
  sizeBytes(path: string): number;
}

const key = {
  prefs: 'reprize:v1:prefs',
  session: (id: string) => `reprize:v1:session:${id}`,
  clip: (id: string) => `reprize:v1:clip:${id}`,
  clipsOf: (sessionId: string) => `reprize:v1:clips-of:${sessionId}`,
  sessions: 'reprize:v1:sessions',
  spentPasses: 'reprize:v1:spentPasses',
};
const SESSION_PREFIX = 'reprize:v1:session:';

/** Sessions and clips stored on the phone, one JSON value per record. IDs are UUIDs, ready for a future account. */
export function createRepo(kv: KV, files: FileProbe, newId: () => string) {
  const read = <T>(k: string): T | undefined => {
    const raw = kv.getString(k);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  };
  const write = (k: string, value: unknown) => kv.set(k, JSON.stringify(value));
  const clipIds = (sessionId: string) => read<string[]>(key.clipsOf(sessionId)) ?? [];

  // Screens re-read sessions/clips when this changes (useSyncExternalStore).
  const listeners = new Set<() => void>();
  let version = 0;
  const changed = () => {
    version += 1;
    listeners.forEach((fn) => fn());
  };

  function getSession(id: string): Session | undefined {
    return read<Session>(key.session(id));
  }

  function sessionIds(): string[] {
    const ids = read<string[]>(key.sessions);
    if (ids) return ids;
    const found = (kv.keys?.() ?? []).filter((k) => k.startsWith(SESSION_PREFIX)).map((k) => k.slice(SESSION_PREFIX.length));
    write(key.sessions, found);
    return found;
  }

  /** Pass transaction ids already tied to a game. Rebuilt from existing games when the key is missing or unreadable. */
  function spentList(): string[] {
    try {
      const stored = read<unknown>(key.spentPasses);
      if (Array.isArray(stored)) return stored.filter((x): x is string => typeof x === 'string');
    } catch {
      // corrupt value: rebuild below
    }
    const found: string[] = [];
    for (const id of sessionIds()) {
      try {
        const tx = getSession(id)?.passTransactionId;
        if (tx) found.push(tx);
      } catch {
        // a corrupt game record is skipped
      }
    }
    const unique = [...new Set(found)];
    write(key.spentPasses, unique);
    return unique;
  }

  /** Writes the merged list; true if anything was added. Does not notify. */
  function addSpent(ids: string[]): boolean {
    const current = spentList();
    const next = [...new Set([...current, ...ids])];
    if (next.length === current.length) return false;
    write(key.spentPasses, next);
    return true;
  }

  return {
    getPrefs(): Prefs {
      return { ...DEFAULT_PREFS, ...read<Partial<Prefs>>(key.prefs) };
    },

    setPrefs(patch: Partial<Prefs>): Prefs {
      const next = { ...this.getPrefs(), ...patch };
      write(key.prefs, next);
      return next;
    },

    getSession,

    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },

    version(): number {
      return version;
    },

    /** Pass transaction ids already tied to a game; only grows. */
    spentPasses(): Set<string> {
      return new Set(spentList());
    },

    spendPasses(ids: string[]): void {
      if (addSpent(ids)) changed();
    },

    startSession(sport: Sport, now: number, plan: { paid: boolean }): Session {
      const ids = sessionIds(); // before writing, so a first-time rebuild doesn't list this game twice
      spentList(); // build the ledger from existing games before this one exists
      const session: Session = { id: newId(), sport, startedAt: now, paid: plan.paid };
      write(key.session(session.id), session);
      write(key.sessions, [...ids, session.id]);
      changed();
      return session;
    },

    /**
     * Makes a finished free recording a paid one ("Liberar recursos PRO nessa gravação"): its clips export in Full HD,
     * with sound and Modo Foco, without the mark. With a Single Pass the pass is spent on this recording; with Pro
     * nothing is spent.
     */
    upgradeSession(id: string, plan: { passTransactionId?: string }): Session | undefined {
      const session = getSession(id);
      if (!session) return undefined;
      const { passTransactionId } = plan;
      const next: Session = { ...session, paid: true, ...(passTransactionId ? { passTransactionId } : {}) };
      write(key.session(id), next);
      if (passTransactionId) addSpent([passTransactionId]);
      changed();
      return next;
    },

    /** Seguir a Bola's sport check of this recording (test 43), or the player's "É basquete" unlock. */
    setBallSport(id: string, ballSport: Session['ballSport']): void {
      const session = getSession(id);
      if (!session) return;
      write(key.session(id), { ...session, ballSport });
      changed();
    },

    /** Records that this free recording already showed the full export panel: later exports get the short notice. */
    markFreeNoticeShown(id: string): void {
      const session = getSession(id);
      if (!session || session.freeNoticeShown) return;
      write(key.session(id), { ...session, freeNoticeShown: true });
      changed();
    },

    /**
     * At launch no recording can be running: every recording without an end (the app was closed mid-recording, as on
     * 2026-11-07) ends at its last clip, or at its start without clips, so it shows its real length and can be deleted.
     * Returns how many were closed.
     */
    closeOpenSessions(): number {
      let closed = 0;
      for (const id of sessionIds()) {
        const session = getSession(id);
        if (!session || session.endedAt !== undefined) continue;
        const clips = this.listClips(id);
        const last = clips.reduce((at, c) => Math.max(at, c.createdAt), session.startedAt);
        write(key.session(id), { ...session, endedAt: last });
        closed += 1;
      }
      if (closed > 0) changed();
      return closed;
    },

    endSession(id: string, now: number): Session {
      const session = { ...getSession(id)!, endedAt: now };
      write(key.session(id), session);
      changed();
      return session;
    },

    /** Trims and cuts the name to MAX_GAME_NAME; a blank name removes it. */
    renameSession(id: string, name: string): Session {
      const trimmed = name.trim().slice(0, MAX_GAME_NAME);
      const { name: _old, ...rest } = getSession(id)!;
      const session: Session = trimmed ? { ...rest, name: trimmed } : rest;
      write(key.session(id), session);
      changed();
      return session;
    },

    /** Trims and cuts the name to MAX_CLIP_NAME; a blank name removes it. Undefined if the clip is gone. */
    renameClip(id: string, name: string): Clip | undefined {
      const existing = read<Clip>(key.clip(id));
      if (!existing) return undefined;
      const trimmed = name.trim().slice(0, MAX_CLIP_NAME);
      const { name: _old, ...rest } = existing;
      const clip: Clip = trimmed ? { ...rest, name: trimmed } : rest;
      write(key.clip(id), clip);
      changed();
      return clip;
    },

    /**
     * iOS can give the app a new data folder on reinstall: the clip files are still there but the stored absolute paths
     * point to the old folder. Clips whose file is missing but exists under `documentsDir` (the current Documents
     * folder, ending in '/') get their path, and their Modo Foco file, moved there. Returns how many moved.
     */
    relocateClips(documentsDir: string): number {
      const MARK = '/Documents/';
      const rebase = (path: string) => {
        const at = path.indexOf(MARK);
        return at < 0 ? undefined : documentsDir + path.slice(at + MARK.length);
      };
      let moved = 0;
      for (const sessionId of sessionIds()) {
        for (const clipId of clipIds(sessionId)) {
          const clip = read<Clip>(key.clip(clipId));
          if (!clip || files.exists(clip.path)) continue;
          const path = rebase(clip.path);
          if (!path || path === clip.path || !files.exists(path)) continue;
          const file = clip.focus && clip.focus.file ? rebase(clip.focus.file) : undefined;
          const focus = clip.focus && file ? { ...clip.focus, file } : clip.focus;
          const ballFile = clip.ball && clip.ball.file ? rebase(clip.ball.file) : undefined;
          const ball = clip.ball && ballFile ? { ...clip.ball, file: ballFile } : clip.ball;
          write(key.clip(clipId), { ...clip, path, ...(focus ? { focus } : {}), ...(ball ? { ball } : {}) });
          moved += 1;
        }
      }
      if (moved > 0) changed();
      return moved;
    },

    /**
     * One-time cleanup (2026-11-01): the cut suggestion was removed. A clip it had cut (its cut is still the suggested
     * one) goes back to the cut it was saved with (`bounds`); a cut the player chose stays. The old field is dropped
     * either way. Returns how many clips it touched.
     */
    forgetCutSuggestions(): number {
      type Old = Clip & { cutSuggestion?: Clip['trim'] };
      let touched = 0;
      for (const sessionId of sessionIds()) {
        for (const clipId of clipIds(sessionId)) {
          const stored = read<Old>(key.clip(clipId));
          if (!stored || stored.cutSuggestion === undefined) continue;
          const { cutSuggestion, ...clip } = stored;
          const automatic =
            clip.bounds !== undefined &&
            clip.trim.startMs === cutSuggestion.startMs &&
            clip.trim.endMs === cutSuggestion.endMs;
          write(key.clip(clipId), automatic && clip.bounds ? { ...clip, trim: clip.bounds } : clip);
          touched += 1;
        }
      }
      if (touched > 0) changed();
      return touched;
    },

    /** Games with at least one existing clip, newest first. */
    listSessions(): { session: Session; clips: number; firstClip?: Clip }[] {
      return sessionIds()
        .map((id) => getSession(id))
        .filter((s): s is Session => s !== undefined)
        .map((session) => {
          const clips = this.listClips(session.id);
          return { session, clips: clips.length, firstClip: clips[0] };
        })
        .filter((g) => g.clips > 0)
        .sort((a, b) => b.session.startedAt - a.session.startedAt);
    },

    updateClip(
      id: string,
      patch: {
        trim?: Clip['trim'];
        edit?: Clip['edit'];
        contentStartMs?: number;
        savedAt?: number;
        sharedAt?: number;
        focus?: Clip['focus'];
        ball?: Clip['ball'];
      },
    ): Clip | undefined {
      const existing = read<Clip>(key.clip(id));
      if (!existing) return undefined; // deleted meanwhile: never resurrect a record without a file
      const clip = { ...existing, ...patch };
      write(key.clip(id), clip);
      changed();
      return clip;
    },

    /** `cutMs`: the default cut, the last N ms up to the trigger (the mode's cutSeconds). */
    addClip(input: Omit<Clip, 'id' | 'trim'>, cutMs: number = DEFAULT_TRIM_MS): Clip {
      const cut = { startMs: Math.max(0, input.durationMs - cutMs), endMs: input.durationMs };
      // One after the highest number in the recording, so deleting an earlier clip never renumbers the others.
      const stored = clipIds(input.sessionId)
        .map((id) => read<Clip>(key.clip(id)))
        .filter((c): c is Clip => c !== undefined);
      const number = stored.reduce((top, c, i) => Math.max(top, c.number !== undefined ? c.number : i + 1), 0) + 1;
      const clip: Clip = { ...input, id: newId(), trim: cut, bounds: cut, number };
      write(key.clip(clip.id), clip);
      write(key.clipsOf(clip.sessionId), [...clipIds(clip.sessionId), clip.id]);
      changed();
      return clip;
    },

    getClip(id: string): Clip | undefined {
      return read<Clip>(key.clip(id));
    },

    deleteClip(id: string): void {
      const clip = read<Clip>(key.clip(id));
      if (!clip) return;
      kv.delete(key.clip(id));
      write(key.clipsOf(clip.sessionId), clipIds(clip.sessionId).filter((c) => c !== id));
      changed();
    },

    /**
     * Removes a game and all its clips from the records. Returns the files of those clips, for the caller to delete
     * (the repo knows nothing about the file system beyond probing).
     */
    deleteSession(id: string): string[] {
      spentList(); // the ledger must exist before a game carrying a Pass disappears
      const paths: string[] = [];
      for (const clipId of clipIds(id)) {
        const clip = read<Clip>(key.clip(clipId));
        if (clip) paths.push(clip.path);
        kv.delete(key.clip(clipId));
      }
      kv.delete(key.clipsOf(id));
      kv.delete(key.session(id));
      write(key.sessions, sessionIds().filter((s) => s !== id));
      changed();
      return paths;
    },

    /** Oldest first; clips whose file is gone (OS cleanup, undo race) are left out. */
    listClips(sessionId: string): Clip[] {
      return clipIds(sessionId)
        .map((id) => read<Clip>(key.clip(id)))
        .filter((c): c is Clip => c !== undefined && files.exists(c.path))
        .sort((a, b) => a.createdAt - b.createdAt);
    },

    sessionStats(sessionId: string): { clips: number; bytes: number; recordedMs: number } {
      const clips = this.listClips(sessionId);
      const session = getSession(sessionId);
      return {
        clips: clips.length,
        bytes: clips.reduce((sum, c) => sum + files.sizeBytes(c.path), 0),
        recordedMs: session?.endedAt ? session.endedAt - session.startedAt : 0,
      };
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;
