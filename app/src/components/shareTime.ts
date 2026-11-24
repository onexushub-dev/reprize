const HOUR_MS = 60 * 60 * 1000;

/** Whole hours left on a link (0 in its last hour). */
export function hoursLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.floor((expiresAt - now) / HOUR_MS));
}
