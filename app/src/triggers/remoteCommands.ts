/**
 * The Bluetooth remote's hold during a recording: end it (2026-11-07 spec §5.1). The remote listens inside the session
 * (SessionContext); the recording screen, which knows how a recording ends, does it.
 */
const endListeners = new Set<() => void>();

export function emitRemoteEnd(): void {
  endListeners.forEach((fn) => fn());
}

/** Returns the unsubscribe. */
export function onRemoteEnd(fn: () => void): () => void {
  endListeners.add(fn);
  return () => void endListeners.delete(fn);
}
