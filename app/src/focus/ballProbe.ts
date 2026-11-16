/** Seguir a Bola's speed rule (spec 2026-11-09 §4.7, Victor: per typical cut): up to 400 ms per 19-region frame. */
export const BALL_PROBE_MAX_MS = 400;

/**
 * Whether the one-time probe lets Bola show. Unknown yet = shown. iOS keeps the 400 ms limit. Android (spec 2026-11-16
 * §7, Marcus: fidelity first, judged after the evaluation): the probe is recorded but does not hide the mode; only a
 * build without the model (probe stored as MAX_SAFE_INTEGER) hides it.
 */
export function ballShownForProbe(probeMs: number | undefined, platform: string): boolean {
  if (probeMs === undefined) return true;
  if (probeMs === Number.MAX_SAFE_INTEGER) return false;
  return platform === 'android' ? true : probeMs <= BALL_PROBE_MAX_MS;
}
