/** Seguir a Bola's speed rule (spec 2026-11-09 §4.7, Victor: per typical cut): up to 400 ms per 19-region frame. */
export const BALL_PROBE_MAX_MS = 400;

/**
 * Android's limit (Marcus, 2026-11-17): 500 ms a frame, since the card shows the progress while the phone works (about
 * 35 s for a 15 s cut: the Pixel 8a and the Galaxy A56 in Test Lab). iOS keeps BALL_PROBE_MAX_MS.
 */
export const BALL_PROBE_MAX_MS_ANDROID = 500;

/**
 * Whether the one-time probe lets Bola show: unknown yet = shown; over the platform's limit = hidden (Android's was
 * the same as iOS's after the POCO X3 test on 2026-11-16, ~1.7 s a frame, then raised); a build without the model (probe
 * stored as MAX_SAFE_INTEGER) = hidden.
 */
export function ballShownForProbe(probeMs: number | undefined, platform: string): boolean {
  if (probeMs === undefined) return true;
  return probeMs <= (platform === 'android' ? BALL_PROBE_MAX_MS_ANDROID : BALL_PROBE_MAX_MS);
}
