import type { PartnerDirectory } from '../partner/directory';
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
    /** What `partners()` answers; null = could not be read. */
    directory: {} as PartnerDirectory | null,
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
    async partners(): Promise<PartnerDirectory | null> {
      return fake.directory;
    },
    emit(s: Snapshot) {
      fake.snapshot = s;
      listeners.forEach((fn) => fn(s));
    },
  };
  return fake satisfies PaymentsClient & Record<string, unknown>;
}
