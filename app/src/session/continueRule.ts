import type { Session } from '../data/schema';

/** How long after its last end a recording can be continued (continue-recording design, 2026-11-23). */
export const CONTINUE_WINDOW_MS = 60 * 60 * 1000;

/**
 * The recording that can be continued now, if any: the latest own one (received ones aside), ended no more than an
 * hour ago and never unlocked with a Single Pass. A newer recording, even empty or still open, closes the window.
 */
export function continuable(sessions: Session[], now: number): Session | undefined {
  const own = sessions.filter((s) => s.received === undefined);
  if (own.length === 0) return undefined;
  const latest = own.reduce((a, b) => (b.startedAt >= a.startedAt ? b : a));
  if (latest.endedAt === undefined || latest.passTransactionId !== undefined) return undefined;
  return now - latest.endedAt <= CONTINUE_WINDOW_MS ? latest : undefined;
}

export function canContinue(sessionId: string, sessions: Session[], now: number): boolean {
  const session = continuable(sessions, now);
  return session !== undefined && session.id === sessionId;
}

/** When the recording stops being continuable. */
export function continueUntil(session: Pick<Session, 'endedAt'>): number {
  return (session.endedAt !== undefined ? session.endedAt : 0) + CONTINUE_WINDOW_MS;
}
