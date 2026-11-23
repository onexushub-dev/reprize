import type { PartnerDirectory } from '../partner/directory';
import type { Offering, Snapshot, PartnerOffering } from './types';

export type PaywallOutcome = 'purchased' | 'restored' | 'cancelled' | 'error';

export interface PaymentsClient {
  configure(): void;
  getSnapshot(): Promise<Snapshot>;
  onSnapshot(fn: (s: Snapshot) => void): () => void;
  /** The paywall of `offering` performs the purchase itself; callers never purchase directly. */
  showPaywall(offering: Offering): Promise<PaywallOutcome>;
  restore(): Promise<Snapshot>;
  /** The partner codes from the `partner_<tier>` offerings; null when they could not be read (offline, no key). */
  partners(): Promise<PartnerDirectory | null>;
  /** Records who referred this customer as RevenueCat attributes. Never throws; a build without a key does nothing. */
  setPartner(code: string, source: string, offering: PartnerOffering, appliedAt: number): Promise<void>;
  /** The RevenueCat customer of this install; null when it cannot be read. */
  appUserId(): Promise<string | null>;
  /** iOS: opens Apple's offer code redemption with `code` filled in. False when it could not be opened (and always off iOS). */
  redeemOfferCode(code: string): Promise<boolean>;
  /** Ties purchases to the signed-in account (its id); null goes back to the anonymous user of this install. */
  identify(appUserId: string | null): Promise<void>;
}
