import { PASS_PRODUCT_ID, PRO_ENTITLEMENT, type Snapshot } from './types';

export type CustomerInfoLike = {
  entitlements: { active: Record<string, unknown> };
  nonSubscriptionTransactions: {
    transactionIdentifier: string;
    productIdentifier: string;
    purchaseDate: string; // ISO 8601, as the SDK delivers it
  }[];
};

function time(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

export function toSnapshot(info: CustomerInfoLike): Snapshot {
  const pro = info.entitlements.active[PRO_ENTITLEMENT] as { latestPurchaseDate?: unknown; originalPurchaseDate?: unknown } | undefined;
  const proPurchasedAt = time(pro?.latestPurchaseDate);
  const proFirstPurchasedAt = time(pro?.originalPurchaseDate);
  return {
    ...(proPurchasedAt === undefined ? {} : { proPurchasedAt }),
    ...(proFirstPurchasedAt === undefined ? {} : { proFirstPurchasedAt }),
    proActive: PRO_ENTITLEMENT in info.entitlements.active,
    passTransactions: info.nonSubscriptionTransactions
      .filter((t) => t.productIdentifier === PASS_PRODUCT_ID)
      .map((t) => ({ id: t.transactionIdentifier, productId: t.productIdentifier, purchasedAt: Date.parse(t.purchaseDate) })),
  };
}
