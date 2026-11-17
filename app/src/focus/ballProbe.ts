/** Seguir a Bola's speed rule (spec 2026-11-09 §4.7, Victor: per typical cut): up to 400 ms per 19-region frame. */
export const BALL_PROBE_MAX_MS = 400;

/**
 * Whether the one-time probe lets Bola show: unknown yet = shown; over BALL_PROBE_MAX_MS = hidden, on iOS and on Android
 * alike (Marcus, 2026-11-16, after the POCO X3 test: ~1.7 s a frame, about 9 s of waiting per second of cut); a build
 * without the model (probe stored as MAX_SAFE_INTEGER) = hidden.
 */
export function ballShownForProbe(probeMs: number | undefined, _platform: string): boolean {
  if (probeMs === undefined) return true;
  return probeMs <= BALL_PROBE_MAX_MS;
}
