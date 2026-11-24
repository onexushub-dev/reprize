import type { Session } from '../data/schema';
import type { Snapshot } from './types';

/**
 * The app mark on every plan (decided 2026-11-23): from this moment every clip that leaves the app carries the Reprize
 * mark, Pro and the Single Pass included. What was bought or recorded before keeps the rule of its day, the one its
 * terms and the app showed then (paid exports without the mark):
 * - a Pro subscription first bought before it, while it stays active;
 * - a recording unlocked with a Pass bought before it;
 * - a paid recording started before it.
 *
 * 2026-11-25 (decided 2026-11-23): the day the version with the new rule reaches both stores; the Terms of Use
 * (item 6) quote it. Move it only together with that day. When in doubt, later rather than earlier: a later date only
 * leaves a few new buyers without the mark, an earlier one would put the mark on someone who bought under the old rule.
 */
export const MARK_ON_EVERY_PLAN_SINCE = Date.parse('2026-11-25T00:00:00-03:00');

/** What of a recording the rule reads. */
export type MarkSession = Pick<Session, 'startedAt' | 'paid' | 'passTransactionId' | 'received'>;

/**
 * True when an export may still leave without the app mark under the old rule: an active Pro bought before
 * `since`, or (for a recording made on this phone) the Pass that unlocked it, or its paid start, from before `since`.
 * A Pass the store does not list (not loaded yet) falls back to when the recording started. A received recording
 * goes by the person's own Pro only.
 */
export function markExempt(snapshot: Snapshot, session: MarkSession | undefined, since: number = MARK_ON_EVERY_PLAN_SINCE): boolean {
  if (snapshot.proActive && snapshot.proSince !== undefined && snapshot.proSince < since) return true;
  if (session === undefined || session.received !== undefined) return false;
  if (session.passTransactionId !== undefined) {
    const pass = snapshot.passTransactions.find((t) => t.id === session.passTransactionId);
    return pass !== undefined ? pass.purchasedAt < since : session.startedAt < since;
  }
  return session.paid === true && session.startedAt < since;
}
