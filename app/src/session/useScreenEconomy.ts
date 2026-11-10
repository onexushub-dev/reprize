import { useCallback, useEffect, useRef, useState } from 'react';

import { sessionSummary } from '../analytics';
import { useAppActive } from './useAppActive';
import type { ThermalLevel } from '../../modules/replay-camera/src/ReplayCamera.types';

/** Without a touch for this long while recording, the screen goes dark (thermal spec, item 2). */
export const ECONOMY_IDLE_MS = 20_000;
/** Shorter once the phone is warm (`fair` or hotter): 5 s felt too short in use (2026-11-05), 10 s still saves. */
export const ECONOMY_WARM_IDLE_MS = 10_000;

export type ScreenEconomy = {
  /** True while the screen is dark: the preview is off and the brightness is down. */
  asleep: boolean;
  /** A touch: the screen comes back (if it was dark) and the wait starts again. */
  wake: () => void;
};

/**
 * Screen economy while a game is recorded: after a while without a touch the preview goes away, the screen turns
 * black and the brightness goes down (`setNative(true)`); a touch brings it back. The camera, the triggers and the
 * saves keep working. Outside a recording, or when the screen goes away, the brightness is given back.
 * `idleMs` replaces both waits (the remote phone, which does not heat up like the camera, waits longer).
 */
export function useScreenEconomy(
  wanted: boolean,
  thermal: ThermalLevel,
  setNative: (on: boolean) => void,
  idleMs?: number,
): ScreenEconomy {
  // Minimised or behind another app, no wait runs and the screen is given back; coming back starts awake.
  const appActive = useAppActive();
  const active = wanted && appActive;
  const [asleep, setAsleep] = useState(false);
  const [touches, setTouches] = useState(0);
  const warm = thermal !== 'nominal';

  // A recording that ends wakes the screen, so the next one starts awake.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) setAsleep(false);
  }

  // Every change of the dark state reaches the native side once; leaving gives the brightness back.
  const shown = useRef(false);
  useEffect(() => {
    const dark = active && asleep;
    if (dark === shown.current) return;
    shown.current = dark;
    setNative(dark);
  }, [active, asleep, setNative]);

  useEffect(
    () => () => {
      if (shown.current) setNative(false);
      shown.current = false;
    },
    [setNative],
  );

  useEffect(() => {
    if (!active || asleep) return;
    const wait = idleMs !== undefined ? idleMs : warm ? ECONOMY_WARM_IDLE_MS : ECONOMY_IDLE_MS;
    const timer = setTimeout(() => {
      setAsleep(true);
      sessionSummary.note('economy');
    }, wait);
    return () => clearTimeout(timer);
  }, [active, asleep, warm, touches, idleMs]);

  const wake = useCallback(() => {
    setAsleep(false);
    setTouches((n) => n + 1);
  }, []);

  return { asleep: active && asleep, wake };
}
