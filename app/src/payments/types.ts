export type PassTransaction = { id: string; productId: string; purchasedAt: number };

export type Snapshot = { proActive: boolean; passTransactions: PassTransaction[] };

export const EMPTY_SNAPSHOT: Snapshot = { proActive: false, passTransactions: [] };

export const PRO_ENTITLEMENT = 'pro';
export const PASS_PRODUCT_ID = 'single_pass';

export type Plan = 'free' | 'paid';

/** How a recording starts: Pro makes it paid, anything else free. The plan never stops a start. */
export type StartDecision = { kind: 'pro' } | { kind: 'free' };

/**
 * A partner price tier: a RevenueCat offering such as `partner_p20`, selling Pro with a discount on the first period.
 */
export type PartnerOffering = `partner_${string}`;

/** The paywall offerings: `default` sells Pro (annual and monthly), `pass` sells the Single Pass, the rest are partner tiers. */
export type Offering = 'default' | 'pass' | PartnerOffering;

/** What could unlock a recording already made: Pro (free of charge), the oldest unused Pass, or nothing yet. */
export type UnlockOption = { kind: 'pro' } | { kind: 'credit'; passTransactionId: string } | { kind: 'none' };
