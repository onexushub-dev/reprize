import type { PartnerDirectory } from '../partner/directory';
import type { Offering, Snapshot } from './types';

export type PaywallOutcome = 'purchased' | 'restored' | 'cancelled' | 'error';

export interface PaymentsClient {
  configure(): void;
  getSnapshot(): Promise<Snapshot>;
  onSnapshot(fn: (s: Snapshot) => void): () => void;
  /** The paywall of `offering` performs the purchase itself; callers never purchase directly. */
  showPaywall(offering: Offering): Promise<PaywallOutcome>;
  restore(): Promise<Snapshot>;
  /** The partner codes from the `default` offering metadata; null when they could not be read (offline, no key). */
  partners(): Promise<PartnerDirectory | null>;
  /** Records who referred this customer as RevenueCat attributes. Never throws; a build without a key does nothing. */
  setPartner(code: string, source: string): Promise<void>;
  /** iOS: opens Apple's offer code redemption with `code` filled in. False when it could not be opened (and always off iOS). */
  redeemOfferCode(code: string): Promise<boolean>;
}
