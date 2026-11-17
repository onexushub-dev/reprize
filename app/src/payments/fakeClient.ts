import type { PaymentsClient, PaywallOutcome } from './client';
import { EMPTY_SNAPSHOT, type Offering, type Snapshot } from './types';

export function createFakeClient() {
  const listeners = new Set<(s: Snapshot) => void>();
  const fake = {
    snapshot: EMPTY_SNAPSHOT as Snapshot,
    nextOutcome: 'cancelled' as PaywallOutcome,
    failSnapshot: false,
    failPaywall: false,
    failRestore: false,
    /** The offering of the last showPaywall call. */
    lastOffering: undefined as Offering | undefined,
    /** When set, showPaywall waits for it (lets tests emit during the paywall). */
    paywallGate: undefined as Promise<void> | undefined,
    configure() {},
    async getSnapshot(): Promise<Snapshot> {
      if (fake.failSnapshot) throw new Error('snapshot unavailable');
      return fake.snapshot;
    },
    onSnapshot(fn: (s: Snapshot) => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    async showPaywall(offering: Offering): Promise<PaywallOutcome> {
      fake.lastOffering = offering;
      if (fake.failPaywall) throw new Error('paywall crashed');
      if (fake.paywallGate) await fake.paywallGate;
      return fake.nextOutcome;
    },
    async restore(): Promise<Snapshot> {
      if (fake.failRestore || fake.failSnapshot) throw new Error('snapshot unavailable');
      return fake.snapshot;
    },
    /** The last identify call: undefined = never called. */
    identified: undefined as string | null | undefined,
    async identify(appUserId: string | null): Promise<void> {
      fake.identified = appUserId;
    },
    emit(s: Snapshot) {
      fake.snapshot = s;
      listeners.forEach((fn) => fn(s));
    },
  };
  return fake satisfies PaymentsClient & Record<string, unknown>;
}
