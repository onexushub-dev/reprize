import { toSnapshot } from '../snapshot';

const tx = (id: string, productIdentifier: string) => ({
  transactionIdentifier: id,
  productIdentifier,
  purchaseDate: '1970-01-01T00:00:01.000Z',
});

describe('toSnapshot', () => {
  it('ignores products that are not the single pass', () => {
    const s = toSnapshot({
      entitlements: { active: {} },
      nonSubscriptionTransactions: [tx('a', 'single_pass'), tx('b', 'other')],
    });
    expect(s.passTransactions).toEqual([{ id: 'a', productId: 'single_pass', purchasedAt: 1000 }]);
  });

  it('proActive only with the pro entitlement', () => {
    const base = { nonSubscriptionTransactions: [] };
    expect(toSnapshot({ ...base, entitlements: { active: { pro: {} } } }).proActive).toBe(true);
    expect(toSnapshot({ ...base, entitlements: { active: { other: {} } } }).proActive).toBe(false);
  });
});

test('carries the dates of the Pro purchase', () => {
  const s = toSnapshot({
    entitlements: { active: { pro: { latestPurchaseDate: '2026-11-20T00:00:00Z', originalPurchaseDate: '2026-01-02T00:00:00Z' } } },
    nonSubscriptionTransactions: [],
  });
  expect(s.proPurchasedAt).toBe(Date.parse('2026-11-20T00:00:00Z'));
  expect(s.proFirstPurchasedAt).toBe(Date.parse('2026-01-02T00:00:00Z'));
});
