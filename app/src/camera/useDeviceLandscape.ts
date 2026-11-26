import { useEffect, useState } from 'react';

import { getDeviceGravity, getDeviceUpright } from '../../modules/replay-camera';
import type { DeviceUpright, Gravity } from '../../modules/replay-camera/src/ReplayCamera.types';

const POLL_MS = 300;
/** Same answer this many times in a row before the screen changes, so a tilt in passing does not flicker the layout. */
const STABLE_READS = 2;

/**
 * How far on its side the phone must be (2026-11-20): the native position flips at 45° with only 0.15 g of lean, so a
 * phone leaning back nearly upright on a tripod could turn the controls. Now the side must carry most of gravity
 * (≥ 0.8 g, ~53° and more) and the top edge little of it (≤ 0.4 g), and the controls stand back up only once the top
 * edge carries more than the side: a hysteresis, so a phone between the two does not flip back and forth.
 */
const SIDE_IN = 0.8;
const TOP_MAX = 0.4;
/** Below this on both edges the phone lies (nearly) flat: keep whatever was shown. */
const FLAT = 0.3;

export function isLandscape(upright: DeviceUpright): boolean {
  return upright === 'landscapeLeft' || upright === 'landscapeRight';
}

/** The quarter turn that stands the app's (portrait) controls upright for someone holding the phone on its side. */
export type LandscapeTurn = 0 | 90 | -90;

/** Home button (or the bottom edge) on the right: the screen's top points left, so the controls turn clockwise. */
export function landscapeTurn(upright: DeviceUpright): LandscapeTurn {
  if (upright === 'landscapeLeft') return 90;
  if (upright === 'landscapeRight') return -90;
  return 0;
}

/** The turn for this accelerometer reading, given the one shown now (see SIDE_IN). x < 0 is landscapeLeft. */
export function turnFromGravity(shown: LandscapeTurn, g: Gravity): LandscapeTurn {
  const side = Math.abs(g.x);
  const top = Math.abs(g.y);
  if (side < FLAT && top < FLAT) return shown;
  if (side >= SIDE_IN && top <= TOP_MAX) return g.x < 0 ? 90 : -90;
  if (shown !== 0 && side > top) return shown;
  return 0;
}

/** One reading: from gravity where the build gives it, else the native position (older builds). */
function read(shown: LandscapeTurn): LandscapeTurn {
  const g = getDeviceGravity();
  return g ? turnFromGravity(shown, g) : landscapeTurn(getDeviceUpright());
}

/** Which side the phone is held on: the turn for the controls. 0 upright or when not `active`. */
export function useLandscapeTurn(active: boolean): LandscapeTurn {
  // The first answer is read at once, so a phone already on its side never flashes the upright layout.
  const [turn, setTurn] = useState<LandscapeTurn>(() => (active ? read(0) : 0));
  useEffect(() => {
    if (!active) return;
    // The first read after (re)activating applies at once; later changes wait for STABLE_READS matching reads.
    let shown: LandscapeTurn | undefined;
    let candidate: LandscapeTurn | undefined;
    let seen = 0;
    const timer = setInterval(() => {
      const now = read(shown ?? 0);
      if (shown === undefined) {
        shown = now;
        setTurn(now);
        return;
      }
      if (now === candidate) {
        seen += 1;
      } else {
        candidate = now;
        seen = 1;
      }
      if (seen >= STABLE_READS && candidate !== shown) {
        shown = candidate;
        setTurn(candidate);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active]);
  return active ? turn : 0;
}

/** Whether the phone is held on its side. Only polls while `active`; false whenever it is not. */
export function useDeviceLandscape(active: boolean): boolean {
  return useLandscapeTurn(active) !== 0;
}
