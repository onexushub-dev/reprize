/**
 * Whether uploads must wait: a recording is on (sharing design, decision 16) or the phone is critically hot. Set by the
 * session, read by the upload queue; kept apart so the session does not load the cloud code.
 */
let held = false;
const listeners = new Set<(held: boolean) => void>();

export function setUploadHold(next: boolean): void {
  if (next === held) return;
  held = next;
  listeners.forEach((fn) => fn(held));
}

export function uploadHeld(): boolean {
  return held;
}

export function onUploadHold(fn: (held: boolean) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
