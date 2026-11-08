import { repo } from './mmkv';

/**
 * The recording opened last ("Visto por último" in Minhas gravações). Its own small store, so the list underneath
 * repaints the moment a recording opens, and is already right when the player comes back (2026-11-07: the badge
 * moved a beat after the screen did). Kept in the prefs.
 */
const listeners = new Set<() => void>();

export function lastOpenedSession(): string | undefined {
  return repo.getPrefs().lastOpenedSessionId;
}

export function markOpened(sessionId: string): void {
  if (lastOpenedSession() === sessionId) return;
  repo.setPrefs({ lastOpenedSessionId: sessionId });
  listeners.forEach((fn) => fn());
}

/** Returns the unsubscribe. */
export function subscribeLastOpened(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
