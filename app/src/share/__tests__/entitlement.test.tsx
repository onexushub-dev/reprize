import { act, renderHook } from '@testing-library/react-native';

import { exportTierOf, useMarkExempt, usePlan } from '../entitlement';

const mockStore = {
  v: 0,
  decision: null as null | { kind: string },
  plan: 'free' as 'free' | 'paid',
  snapshot: { proActive: false, passTransactions: [] } as { proActive: boolean; passTransactions: never[]; proSince?: number },
  listeners: new Set<() => void>(),
};

const mockRepo = {
  v: 0,
  sessions: {} as Record<string, { paid?: boolean; passTransactionId?: string; startedAt?: number }>,
  listeners: new Set<() => void>(),
};

jest.mock('../../payments', () => ({
  payments: {
    subscribe: (l: () => void) => {
      mockStore.listeners.add(l);
      return () => mockStore.listeners.delete(l);
    },
    version: () => mockStore.v,
    getSnapshot: () => mockStore.snapshot,
    nextPlan: jest.fn(() =>
      mockStore.decision ? jest.requireActual('../../payments/rules').planOf(mockStore.decision) : mockStore.plan,
    ),
  },
}));

jest.mock('../../data/mmkv', () => ({
  repo: {
    subscribe: (l: () => void) => {
      mockRepo.listeners.add(l);
      return () => mockRepo.listeners.delete(l);
    },
    version: () => mockRepo.v,
    getSession: jest.fn((id: string) => mockRepo.sessions[id]),
  },
}));

beforeEach(() => {
  mockStore.plan = 'free';
  mockStore.decision = null;
  mockStore.snapshot = { proActive: false, passTransactions: [] };
  mockRepo.sessions = { s1: { paid: true }, s2: { paid: false }, old: { passTransactionId: 'tx' } };
});

test('a session plays with the plan it was recorded with, even with Pro inactive', async () => {
  const { result } = await renderHook(() => usePlan('s1'));
  expect(result.current).toBe('paid');
});

test('a free session stays free even when the next start would be paid', async () => {
  mockStore.plan = 'paid';
  const { result } = await renderHook(() => usePlan('s2'));
  expect(result.current).toBe('free');
});

test('an old session without `paid` is paid when it holds a Pass; a missing one is free', async () => {
  expect((await renderHook(() => usePlan('old'))).result.current).toBe('paid');
  expect((await renderHook(() => usePlan('nope'))).result.current).toBe('free');
});

test('without a session it is the next start plan and follows the store', async () => {
  const { result } = await renderHook(() => usePlan());
  expect(result.current).toBe('free');
  await act(async () => {
    mockStore.plan = 'paid'; // a credit arrived
    mockStore.v += 1;
    mockStore.listeners.forEach((l) => l());
  });
  expect(result.current).toBe('paid');
});

test('re-renders when the repo notifies (a credit spent)', async () => {
  mockStore.plan = 'paid';
  const { result } = await renderHook(() => usePlan());
  expect(result.current).toBe('paid');
  await act(async () => {
    mockStore.plan = 'free';
    mockRepo.v += 1;
    mockRepo.listeners.forEach((l) => l());
  });
  expect(result.current).toBe('free');
});

test('exportTierOf: a received recording without Pro is a courtesy; a paid export under the old rule is legacy', () => {
  expect(exportTierOf('free', undefined)).toBe('free');
  expect(exportTierOf('paid', undefined)).toBe('paid');
  expect(exportTierOf('paid', undefined, true)).toBe('legacy');
  // The old rule never frees a free export of its mark.
  expect(exportTierOf('free', undefined, true)).toBe('free');
  expect(exportTierOf('free', 'courtesy', true)).toBe('courtesy');
  expect(exportTierOf('free', 'locked')).toBe('courtesy');
  expect(exportTierOf('paid', 'pro', true)).toBe('legacy');
});

test('useMarkExempt: an active Pro bought before the rule; a paid recording made before it', async () => {
  mockRepo.sessions = { early: { paid: true, startedAt: 0 }, late: { paid: true, startedAt: Date.parse('2030-01-01T00:00:00Z') } };
  expect((await renderHook(() => useMarkExempt('early'))).result.current).toBe(true);
  expect((await renderHook(() => useMarkExempt('late'))).result.current).toBe(false);
  mockStore.snapshot = { proActive: true, passTransactions: [], proSince: 0 };
  expect((await renderHook(() => useMarkExempt('late'))).result.current).toBe(true);
  expect((await renderHook(() => useMarkExempt(undefined))).result.current).toBe(true);
  mockStore.snapshot = { proActive: true, passTransactions: [], proSince: Date.parse('2030-01-01T00:00:00Z') };
  expect((await renderHook(() => useMarkExempt(undefined))).result.current).toBe(false);
});
