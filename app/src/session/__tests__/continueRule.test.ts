import type { Session } from '../../data/schema';
import { CONTINUE_WINDOW_MS, canContinue, continuable, continueUntil } from '../continueRule';

const MIN = 60_000;
const NOW = 10_000_000;
const own = (id: string, startedAt: number, endedAt?: number, over: Partial<Session> = {}): Session =>
  ({ id, sport: 'beachTennis', startedAt, ...(endedAt === undefined ? {} : { endedAt }), ...over }) as Session;

test('the latest recording ended up to an hour ago can be continued (2026-11-23)', () => {
  expect(continuable([own('a', 0, NOW - 59 * MIN)], NOW)!.id).toBe('a');
  expect(continuable([own('a', 0, NOW - 60 * MIN)], NOW)!.id).toBe('a');
  expect(continuable([own('a', 0, NOW - 61 * MIN)], NOW)).toBeUndefined();
});

test('never a received recording, nor one unlocked with a Single Pass', () => {
  expect(continuable([own('a', 0, NOW - MIN, { received: { shareId: 's', code: 'c', receivedAt: 0, expiresAt: 1, total: 1 } })], NOW)).toBeUndefined();
  expect(continuable([own('a', 0, NOW - MIN, { passTransactionId: 'tx' })], NOW)).toBeUndefined();
});

test('a newer recording, even empty or still open, closes the window of the older one', () => {
  expect(continuable([own('a', 0, NOW - 30 * MIN), own('b', NOW - 20 * MIN, NOW - 19 * MIN)], NOW)!.id).toBe('b');
  expect(canContinue('a', [own('a', 0, NOW - 30 * MIN), own('b', NOW - 20 * MIN, NOW - 19 * MIN)], NOW)).toBe(false);
  expect(continuable([own('a', 0, NOW - 30 * MIN), own('b', NOW - 5 * MIN)], NOW)).toBeUndefined();
});

test('received recordings do not count as the latest own one', () => {
  const received = own('r', NOW - MIN, NOW - MIN, { received: { shareId: 's', code: 'c', receivedAt: 0, expiresAt: 1, total: 1 } });
  expect(canContinue('a', [own('a', 0, NOW - 30 * MIN), received], NOW)).toBe(true);
});

test('until when', () => {
  expect(CONTINUE_WINDOW_MS).toBe(3_600_000);
  expect(continueUntil({ endedAt: 1_000 })).toBe(3_601_000);
});
