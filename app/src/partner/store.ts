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

  function load(): Attribution | null {
    try {
      const raw = kv.getString(KEY);
      return raw === undefined ? null : (JSON.parse(raw) as Attribution);
    } catch {
      return null;
    }
  }

  let state: Attribution | null = load();

  function save(next: Attribution | null) {
    state = next;
    try {
      if (next === null) kv.delete(KEY);
      else kv.set(KEY, JSON.stringify(next));
    } catch {
      // kept in memory for this run
    }
    listeners.forEach((fn) => fn());
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
    /** Confirms a pending code against the directory (drops it if absent), and re-announces a valid one. */
    async start(): Promise<void> {
      if (state === null) return;
      if (state.status === 'valid') {
        valid(state);
        return;
      }
      const dir = await read();
      if (dir === null) return; // still offline: stays pending
      const hit = dir[state.code];
      if (!hit) {
        save(null);
        return;
      }
      save({ ...state, name: hit.name, status: 'valid' });
      valid(state as Attribution);
    },

    /** `blocked`: the customer already has PRO, so a discount code no longer applies. */
    async apply(raw: string, source: PartnerSource, opts: { blocked?: boolean } = {}): Promise<ApplyResult> {
      if (opts.blocked || state?.lockedAt !== undefined) return 'locked';
      const code = codeFromUrl(raw) ?? normalizeCode(raw);
      if (code === null) return 'invalid';
      const dir = await read();
      if (state?.lockedAt !== undefined) return 'locked'; // a purchase landed while the directory loaded
      if (dir === null) {
        save({ code, name: code, source, appliedAt: now(), status: 'pending' });
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
