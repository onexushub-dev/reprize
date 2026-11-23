export type PassTransaction = { id: string; productId: string; purchasedAt: number };

export type Snapshot = {
  proActive: boolean;
  passTransactions: PassTransaction[];
  /**
   * When the active Pro was first bought (RevenueCat's original purchase date of the entitlement, kept across renewals),
   * in ms. Decides whether the subscription keeps the rule of its day for the app mark (`payments/watermarkRule.ts`).
   * Absent when Pro is not active or the store did not say.
   */
  proSince?: number;
};

export const EMPTY_SNAPSHOT: Snapshot = { proActive: false, passTransactions: [] };

export const PRO_ENTITLEMENT = 'pro';
export const PASS_PRODUCT_ID = 'single_pass';

export type Plan = 'free' | 'paid';

/** How a recording starts: Pro makes it paid, anything else free. The plan never stops a start. */
export type StartDecision = { kind: 'pro' } | { kind: 'free' };

/** The paywall offerings: `default` sells Pro (annual and monthly), `pass` sells the Single Pass. */
export type Offering = 'default' | 'pass';

/** What could unlock a recording already made: Pro (free of charge), the oldest unused Pass, or nothing yet. */
export type UnlockOption = { kind: 'pro' } | { kind: 'credit'; passTransactionId: string } | { kind: 'none' };
