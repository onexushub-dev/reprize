import type { PartnerDirectory } from '../partner/directory';
import type { PaymentsClient, PaywallOutcome } from './client';
import { EMPTY_SNAPSHOT, type Offering, type PartnerOffering, type Snapshot } from './types';

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
    /** The (code, source, offering) of every setPartner call. */
    partnerCalls: [] as [string, string, PartnerOffering][],
    /** What `redeemOfferCode` answers, and the codes it was asked for. */
    redeemResult: true,
    redeemed: [] as string[],
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
    async appUserId(): Promise<string | null> {
      return fake.identified ?? 'anonymous';
    },
    async setPartner(code: string, source: string, offering: PartnerOffering, _appliedAt: number): Promise<void> {
      fake.partnerCalls.push([code, source, offering]);
    },
    async redeemOfferCode(code: string): Promise<boolean> {
      fake.redeemed.push(code);
      return fake.redeemResult;
    },
    async partners(): Promise<PartnerDirectory | null> {
      return fake.directory;
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
