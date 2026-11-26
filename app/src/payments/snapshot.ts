import { PASS_PRODUCT_ID, PRO_ENTITLEMENT, type Snapshot } from './types';

export type CustomerInfoLike = {
  entitlements: { active: Record<string, unknown> };
  nonSubscriptionTransactions: {
    transactionIdentifier: string;
    productIdentifier: string;
    purchaseDate: string; // ISO 8601, as the SDK delivers it
  }[];
};

/** A date of the active Pro entitlement (ISO 8601 from the SDK), in ms; undefined if unknown. */
function proDateOf(info: CustomerInfoLike, field: 'originalPurchaseDate' | 'latestPurchaseDate'): number | undefined {
  const pro = info.entitlements.active[PRO_ENTITLEMENT];
  if (pro === null || typeof pro !== 'object') return undefined;
  const date = (pro as Record<string, unknown>)[field];
  if (typeof date !== 'string') return undefined;
  const ms = Date.parse(date);
  return Number.isNaN(ms) ? undefined : ms;
}

export function toSnapshot(info: CustomerInfoLike): Snapshot {
  const snapshot: Snapshot = {
    proActive: PRO_ENTITLEMENT in info.entitlements.active,
    passTransactions: info.nonSubscriptionTransactions
      .filter((t) => t.productIdentifier === PASS_PRODUCT_ID)
      .map((t) => ({ id: t.transactionIdentifier, productId: t.productIdentifier, purchasedAt: Date.parse(t.purchaseDate) })),
  };
  if (!snapshot.proActive) return snapshot;
  const proSince = proDateOf(info, 'originalPurchaseDate');
  if (proSince !== undefined) snapshot.proSince = proSince;
  const proPurchasedAt = proDateOf(info, 'latestPurchaseDate');
  if (proPurchasedAt !== undefined) snapshot.proPurchasedAt = proPurchasedAt;
  return snapshot;
}
