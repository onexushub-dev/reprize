/**
 * The recording the player chose to continue (continue-recording design, 2026-11-23): set from its "⋯" menu, read by
 * the camera screen until the recording starts again or the player drops it.
 */
let current: string | undefined;
const listeners = new Set<() => void>();

export function setContinueIntent(sessionId: string | undefined): void {
  if (sessionId === current) return;
  current = sessionId;
  listeners.forEach((l) => l());
}

export function continueIntent(): string | undefined {
  return current;
}

export function subscribeContinueIntent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
