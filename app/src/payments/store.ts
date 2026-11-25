import type { Repo } from '../data/repo';
import type { PaymentsClient, PaywallOutcome } from './client';
import { availableCredit, creditCount, detectPurchase, planOf, startPlan } from './rules';
import { EMPTY_SNAPSHOT, type Offering, type Plan, type Snapshot, type StartDecision, type UnlockOption } from './types';

/**
 * A paywall purchase not seen yet (SDK lag). Its Pass is a credit like any other; the marker only keeps it from being
 * taken for a restore (which never creates a credit) and makes a start re-read until it shows up.
 */
type Pending = { before: Snapshot };

export function createPaymentsStore(
  client: PaymentsClient,
  repo: Pick<Repo, 'getSession' | 'spentPasses' | 'spendPasses'>,
) {
  let current: Snapshot | null = null;
  // At most one paywall result we could not explain yet. A new paywall never opens while it exists unresolved.
  let pending: Pending | null = null;
  let open = false;
  let version = 0;
  let started = false;
  const listeners = new Set<() => void>();

  // Restored passes whose ledger write failed: counted as spent from here and written again at the next update, so a
  // storage failure never turns a restore into credits (not even when the listener delivers the same passes again).
  const unledgered = new Set<string>();

  function notify() {
    version += 1;
    listeners.forEach((fn) => fn());
  }

  /** The ledger plus the restored passes it could not take yet. */
  function spent(): Set<string> {
    const ids = repo.spentPasses();
    unledgered.forEach((id) => ids.add(id));
    return ids;
  }

  /** Writes the held restored passes to the ledger; throws, keeping them held, if storage fails. */
  function writeUnledgered() {
    if (unledgered.size === 0) return;
    repo.spendPasses([...unledgered]);
    unledgered.clear();
  }

  /** The oldest pass in `snapshot` that is neither in `before` nor in the ledger: what a purchase after `before` bought. */
  function purchasedSince(before: Snapshot, snapshot: Snapshot): string | undefined {
    const known = spent(); // the ledger: a spent or restored pass is never a purchase
    before.passTransactions.forEach((t) => known.add(t.id));
    const fresh = snapshot.passTransactions.filter((t) => !known.has(t.id));
    if (fresh.length === 0) return undefined;
    return fresh.reduce((x, y) => (y.purchasedAt < x.purchasedAt ? y : x)).id;
  }

  /**
   * Explains the pending purchase if `snapshot` shows it (oldest new pass tx): it stays a credit. Clears it on a new
   * pass or Pro. Returns the pass id it explained.
   */
  function resolvePending(snapshot: Snapshot): string | undefined {
    if (!pending) return undefined;
    const id = purchasedSince(pending.before, snapshot);
    if (id) {
      pending = null;
      return id;
    }
    if (detectPurchase(pending.before, snapshot).pro) pending = null;
    return undefined;
  }

  function apply(s: Snapshot) {
    current = s;
    resolvePending(s);
    try {
      writeUnledgered();
    } catch {
      // still held: counted as spent, written at the next update
    }
    notify();
  }

  /**
   * After a restore: explains a waiting purchase first (it is a purchase, not a restore), then puts every other pass
   * that is new against `before` (all unspent ones when `before` is unknown) in the ledger, so a restore never
   * creates a credit. `dropped` is a pending this paywall's pre-read dropped unexplained: its Pass is kept too. Notifies.
   * The restored passes count as spent before `current` shows them; throws if the ledger write fails (they stay held).
   */
  function applyRestored(s: Snapshot, before: Snapshot | null, dropped?: Pending | null): { droppedExplained: boolean } {
    const resolved = resolvePending(s);
    const droppedId = !resolved && dropped ? purchasedSince(dropped.before, s) : undefined;
    const kept = resolved ?? droppedId;
    const known = spent();
    before?.passTransactions.forEach((t) => known.add(t.id));
    if (kept) known.add(kept);
    s.passTransactions.filter((t) => !known.has(t.id)).forEach((t) => unledgered.add(t.id));
    current = s;
    try {
      writeUnledgered();
    } finally {
      notify();
    }
    return { droppedExplained: !!droppedId };
  }

  /** Never throws, and never mutates the store (it runs while rendering): any failure decides free. */
  function decide(): StartDecision {
    try {
      const snap = current ?? EMPTY_SNAPSHOT;
      return startPlan({ proActive: snap.proActive });
    } catch {
      return { kind: 'free' };
    }
  }

  /**
   * The "before" of a restore: a fresh read when there is no snapshot or a purchase waits (it may explain it now);
   * the pending is kept, so the restore result still treats its Pass as a purchase. Null only if nothing is known.
   */
  async function restoreBefore(): Promise<Snapshot | null> {
    if (current === null || pending) {
      const fresh = await read(() => client.getSnapshot());
      if (fresh) apply(fresh);
    }
    return current;
  }

  async function read(fresh: () => Promise<Snapshot>): Promise<Snapshot | null> {
    try {
      return await fresh();
    } catch {
      return null;
    }
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      client.onSnapshot(apply);
      void read(() => client.getSnapshot()).then((s) => {
        if (s && current === null) apply(s); // a stale initial read must not overwrite newer data
      });
    },

    getSnapshot(): Snapshot {
      return current ?? EMPTY_SNAPSHOT;
    },

    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },

    version(): number {
      return version;
    },

    /**
     * Opens `offering` (Pro by default, the Single Pass with 'pass'). A Pass bought here is a credit until the player
     * unlocks a recording with it; a Pass that shows up by a restore is never a credit: it goes to the ledger. Never
     * throws.
     */
    async showPaywall(offering: Offering = 'default'): Promise<PaywallOutcome> {
      if (open) return 'cancelled';
      open = true;
      let dropped: Pending | null = null;
      try {
        let before = current;
        if (pending || !before) {
          let fresh: Snapshot | null;
          try {
            fresh = await read(() => client.getSnapshot());
            if (fresh) apply(fresh); // explains the pending if its pass shows up now
          } catch {
            return 'error'; // storage failed before selling anything
          }
          // Never sell while an earlier purchase is unexplained, nor without a "before": with an unknown one an old
          // credit could be taken for this purchase and the new Pass later ledgered by a restore.
          if (!fresh) return 'error';
          dropped = pending;
          pending = null; // still unexplained: dropped so it cannot capture this paywall's purchase
          before = fresh;
        }
        let outcome: PaywallOutcome;
        try {
          outcome = await client.showPaywall(offering);
        } catch {
          return 'error';
        }
        try {
          if (outcome === 'restored') {
            // The listener may already have delivered the restored data during the paywall.
            const after = (await read(() => client.getSnapshot())) ?? current;
            if (after && applyRestored(after, before, dropped).droppedExplained) dropped = null;
            else if (!after) notify();
          } else if (outcome === 'purchased') {
            dropped = null; // the single slot now waits for this purchase
            // The marker keeps a lagging Pass a credit: a restore never spends it, a start re-reads.
            pending = { before };
            const after = await read(() => client.getSnapshot());
            if (after) {
              current = after;
              resolvePending(after);
            } else if (current) {
              // The SDK listener may already have delivered the new data during the paywall.
              resolvePending(current);
            }
            notify();
          }
        } catch {
          // Storage failed after the store sold: the outcome stands, a waiting marker re-reads at the next start.
          notify();
        }
        return outcome;
      } finally {
        // Nothing was bought here: the dropped purchase is still unexplained, so it waits again (a restore must not
        // spend its Pass, a start must re-read). Checked against what is known now in case it already showed up.
        if (dropped && pending === null) {
          pending = dropped;
          try {
            if (current) resolvePending(current);
          } catch {
            // stays pending: the next read explains it
          }
        }
        open = false;
      }
    },

    /** Re-reads the purchases (something outside the paywall may have bought: a purchase on another device, a renewal). */
    async refresh(): Promise<Snapshot> {
      const fresh = await read(() => client.getSnapshot());
      if (fresh) apply(fresh);
      return current ?? EMPTY_SNAPSHOT;
    },

    /** Restores Pro. Passes it brings go to the ledger, never become credits. False if that ledger write fails. */
    async restore(): Promise<boolean> {
      try {
        // Taken before the call: the listener may deliver the restored data before `restore` resolves.
        const before = await restoreBefore();
        const s = await client.restore();
        applyRestored(s, before);
        return s.proActive;
      } catch {
        return false;
      }
    },

    /** The plan the next start would get: what the preparation shows and opens the camera with. */
    nextPlan(): Plan {
      return planOf(decide());
    },

    /**
     * "Começar gravação": reads first when there is no snapshot yet or a purchase waits (it may be Pro now). Never
     * throws: a failed read decides with what is known (the empty snapshot at worst), any failure is 'free'.
     */
    async startDecision(): Promise<StartDecision> {
      try {
        if (current === null || pending) {
          const fresh = await read(() => client.getSnapshot());
          if (fresh && (current === null || pending)) apply(fresh);
        }
        return decide();
      } catch {
        return { kind: 'free' };
      }
    },

    /**
     * What could unlock a recording already made, with what is known now: Pro (nothing is spent), the oldest unused
     * Pass (spent on that recording), or nothing.
     */
    unlockOption(): UnlockOption {
      try {
        const snap = current ?? EMPTY_SNAPSHOT;
        if (snap.proActive) return { kind: 'pro' };
        const credit = availableCredit(snap, spent());
        return credit ? { kind: 'credit', passTransactionId: credit.id } : { kind: 'none' };
      } catch {
        return { kind: 'none' };
      }
    },

    /** Unused Passes: bought and not yet used to unlock a recording. */
    credits(): number {
      try {
        return creditCount(current ?? EMPTY_SNAPSHOT, spent());
      } catch {
        return 0;
      }
    },
  };
}

export type PaymentsStore = ReturnType<typeof createPaymentsStore>;
