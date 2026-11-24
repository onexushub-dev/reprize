import { EMPTY_SNAPSHOT, type Snapshot } from '../types';
import { MARK_ON_EVERY_PLAN_SINCE, markExempt } from '../watermarkRule';

const since = Date.parse('2026-12-01T00:00:00-03:00');
const before = since - 1;
const after = since + 1;
const pro = (proSince?: number): Snapshot => ({ proActive: true, passTransactions: [], ...(proSince !== undefined ? { proSince } : {}) });

test('the rule starts at a fixed moment', () => {
  expect(Number.isNaN(MARK_ON_EVERY_PLAN_SINCE)).toBe(false);
});

test('a Pro first bought before the rule keeps exporting without the mark; one bought after carries it', () => {
  expect(markExempt(pro(before), undefined, since)).toBe(true);
  expect(markExempt(pro(after), undefined, since)).toBe(false);
  // The store did not say when: the new rule.
  expect(markExempt(pro(), undefined, since)).toBe(false);
  // A Pro that is no longer active keeps nothing by itself.
  expect(markExempt({ proActive: false, passTransactions: [], proSince: before }, undefined, since)).toBe(false);
});

test('an old Pro also covers recordings received by link, as its own', () => {
  const received = { startedAt: after, received: { from: 'Ana' } } as never;
  expect(markExempt(pro(before), received, since)).toBe(true);
  expect(markExempt(EMPTY_SNAPSHOT, received, since)).toBe(false);
});

test('a recording unlocked with a Pass goes by when that Pass was bought', () => {
  const old = { ...EMPTY_SNAPSHOT, passTransactions: [{ id: 'p1', productId: 'single_pass', purchasedAt: before }] };
  const fresh = { ...EMPTY_SNAPSHOT, passTransactions: [{ id: 'p1', productId: 'single_pass', purchasedAt: after }] };
  const session = { startedAt: before, paid: true, passTransactionId: 'p1' };
  expect(markExempt(old, session, since)).toBe(true);
  expect(markExempt(fresh, session, since)).toBe(false);
  // The store has not listed the Pass yet: when the recording started decides.
  expect(markExempt(EMPTY_SNAPSHOT, session, since)).toBe(true);
  expect(markExempt(EMPTY_SNAPSHOT, { ...session, startedAt: after }, since)).toBe(false);
});

test('a paid recording started before the rule keeps it; a free one or a later one does not', () => {
  expect(markExempt(EMPTY_SNAPSHOT, { startedAt: before, paid: true }, since)).toBe(true);
  expect(markExempt(EMPTY_SNAPSHOT, { startedAt: after, paid: true }, since)).toBe(false);
  expect(markExempt(EMPTY_SNAPSHOT, { startedAt: before, paid: false }, since)).toBe(false);
  expect(markExempt(EMPTY_SNAPSHOT, { startedAt: before }, since)).toBe(false);
});
