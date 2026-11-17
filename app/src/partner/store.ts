import type { KV } from '../data/repo';
import { codeFromUrl, normalizeCode } from './code';
import type { PartnerDirectory } from './directory';

export type PartnerSource = 'link' | 'install_referrer' | 'typed';

/** Who referred this install. `pending` is a code not yet found in the directory (offline): it never changes the paywall. */
export type Attribution = {
  code: string;
  name: string;
  source: PartnerSource;
  appliedAt: number;
  status: 'valid' | 'pending';
  /** Set by the first purchase observed with this attribution: after it, no other code replaces it. */
  lockedAt?: number;
};

export type ApplyResult = 'applied' | 'pending' | 'invalid' | 'locked';

const KEY = 'partner.attribution';
/** A code applied offline while a valid attribution exists: held beside it until the directory confirms or rejects it. */
const CANDIDATE_KEY = 'partner.candidate';

/**
 * One attribution per install, kept in storage. A newer valid code replaces an older one until the first purchase locks
 * it. Storage and `onValid` failures are swallowed: the in-memory state is authoritative for the run.
 */
export function createPartnerStore(o: {
  kv: KV;
  directory: () => Promise<PartnerDirectory | null>;
  now: () => number;
  /** Fired when an attribution becomes valid, and again at every start while one exists (so a failed write is retried). */
  onValid?: (a: Attribution) => void;
}) {
  const { kv, directory, now, onValid } = o;
  const listeners = new Set<() => void>();

  function load(key: string): Attribution | null {
    try {
      const raw = kv.getString(key);
      return raw === undefined ? null : (JSON.parse(raw) as Attribution);
    } catch {
      return null;
    }
  }

  let state: Attribution | null = load(KEY);
  let candidate: Attribution | null = load(CANDIDATE_KEY);

  function write(key: string, next: Attribution | null) {
    try {
      if (next === null) kv.delete(key);
      else kv.set(key, JSON.stringify(next));
    } catch {
      // kept in memory for this run
    }
  }

  function save(next: Attribution | null) {
    state = next;
    write(KEY, next);
    if (candidate !== null) saveCandidate(null); // a code in hand makes any held candidate moot
    listeners.forEach((fn) => fn());
  }

  function saveCandidate(next: Attribution | null) {
    candidate = next;
    write(CANDIDATE_KEY, next);
  }

  function valid(a: Attribution) {
    try {
      onValid?.(a);
    } catch {
      // the attribute write is retried at the next start
    }
  }

  async function read(): Promise<PartnerDirectory | null> {
    try {
      return await directory();
    } catch {
      return null;
    }
  }

  return {
    /** Re-announces a valid code, and confirms a pending one (or a held candidate) against the directory. */
    async start(): Promise<void> {
      if (state !== null && state.status === 'valid') valid(state);
      const waiting = state !== null && state.status === 'pending' ? state : candidate;
      if (waiting === null) return;
      const dir = await read();
      if (dir === null) return; // still offline: stays pending
      if (state?.lockedAt !== undefined) {
        saveCandidate(null); // a purchase locked the attribution meanwhile
        return;
      }
      const hit = dir[waiting.code];
      if (!hit) {
        if (waiting === candidate) saveCandidate(null);
        else save(null);
        return;
      }
      const confirmed: Attribution = { ...waiting, name: hit.name, status: 'valid' };
      save(confirmed);
      valid(confirmed);
    },

    /** True while a code waits for the directory (offline): the screen can say so, and a foreground return retries. */
    pending(): boolean {
      return candidate !== null || (state !== null && state.status === 'pending');
    },

    /** `blocked`: the customer already has PRO, so a discount code no longer applies. */
    async apply(raw: string, source: PartnerSource, opts: { blocked?: boolean } = {}): Promise<ApplyResult> {
      if (opts.blocked || state?.lockedAt !== undefined) return 'locked';
      const code = codeFromUrl(raw) ?? normalizeCode(raw);
      if (code === null) return 'invalid';
      const dir = await read();
      if (state?.lockedAt !== undefined) return 'locked'; // a purchase landed while the directory loaded
      if (dir === null) {
        const waiting: Attribution = { code, name: code, source, appliedAt: now(), status: 'pending' };
        // A valid attribution is never traded for an unconfirmed code: the new one waits beside it.
        if (state !== null && state.status === 'valid') saveCandidate(waiting);
        else save(waiting);
        return 'pending';
      }
      const hit = dir[code];
      if (!hit) return 'invalid';
      const next: Attribution = { code, name: hit.name, source, appliedAt: now(), status: 'valid' };
      save(next);
      valid(next);
      return 'applied';
    },

    current(): Attribution | null {
      return state;
    },

    /** The attribution that changes the paywall: valid and not yet locked by a purchase. */
    active(): Attribution | null {
      return state !== null && state.status === 'valid' && state.lockedAt === undefined ? state : null;
    },

    /** The first purchase was observed: this code stays. */
    lock(): void {
      if (state === null || state.status !== 'valid' || state.lockedAt !== undefined) return;
      save({ ...state, lockedAt: now() });
    },

    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

export type PartnerStore = ReturnType<typeof createPartnerStore>;
