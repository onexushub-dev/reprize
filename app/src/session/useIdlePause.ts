import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppActive } from './useAppActive';

/**
 * On the setup screen, how long without a touch or a remote press before the preview pauses and the screen dims
 * (2026-11-08 spec §3.2): enough to place the phone and check the framing; after it, the screen costs battery and heat
 * while the player warms up.
 */
export const SETUP_IDLE_MS = 35_000;
/** The warning shows this long before the pause, counting down. */
export const SETUP_WARN_MS = 5_000;

/** What brought the camera back. */
export type ResumeCause = 'toque' | 'controle';

export type IdlePause = {
  /** The camera is paused for inactivity. */
  paused: boolean;
  /** Seconds left before the pause while the warning shows (5 … 1); undefined otherwise. */
  warning: number | undefined;
  /** A touch or a remote press: resumes a paused camera, or starts the wait again (and hides the warning). */
  activity(cause: ResumeCause): void;
};

/**
 * Pauses after `idleMs` with no `activity()` while `active` and the app is on screen, warning `warnMs` before with a countdown; anything that
 * ends `active` (a recording starting, a sheet opening, the screen leaving) also ends the pause and the warning, so
 * whatever comes next finds the camera on.
 */
export function useIdlePause(
  wanted: boolean,
  o: {
    idleMs?: number;
    warnMs?: number;
    onPause?: () => void;
    onResume?: (cause: ResumeCause | 'fim') => void;
  } = {},
): IdlePause {
  // Minimised or behind another app, the wait stops (and a pause ends): coming back starts it again from zero.
  const appActive = useAppActive();
  const active = wanted && appActive;
  const idleMs = o.idleMs === undefined ? SETUP_IDLE_MS : o.idleMs;
  const warnMs = o.warnMs === undefined ? SETUP_WARN_MS : Math.min(o.warnMs, idleMs);
  const [paused, setPaused] = useState(false);
  const [warning, setWarning] = useState<number | undefined>(undefined);
  const pausedRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const callbacks = useRef(o);
  useEffect(() => {
    callbacks.current = o;
  });

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const arm = useCallback(() => {
    clear();
    // A warning left from before (the wait restarting after a sheet closed) goes at once.
    timers.current.push(setTimeout(() => setWarning(undefined), 0));
    // One timer per second of the countdown, then the pause.
    for (let left = Math.ceil(warnMs / 1000); left >= 1; left--) {
      timers.current.push(setTimeout(() => setWarning(left), idleMs - left * 1000));
    }
    timers.current.push(
      setTimeout(() => {
        timers.current = [];
        setWarning(undefined);
        pausedRef.current = true;
        setPaused(true);
        const fn = callbacks.current.onPause;
        if (fn !== undefined) fn();
      }, idleMs),
    );
  }, [idleMs, warnMs]);

  const resume = useCallback((cause: ResumeCause | 'fim') => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    setPaused(false);
    const fn = callbacks.current.onResume;
    if (fn !== undefined) fn(cause);
  }, []);

  useEffect(() => {
    if (!active) {
      clear();
      resume('fim');
      return;
    }
    arm();
    return clear;
  }, [active, arm, resume]);

  const activity = useCallback(
    (cause: ResumeCause) => {
      if (!active) return;
      if (pausedRef.current) resume(cause);
      setWarning(undefined);
      arm();
    },
    [active, arm, resume],
  );

  // Not active (a recording, a sheet, another screen): no warning, whatever a timer left behind.
  return { paused, warning: active ? warning : undefined, activity };
}
