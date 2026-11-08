/**
 * How long the remote's button is held to start or end a recording (2026-11-07 spec §5.1): long enough that a pocket
 * or a bump does not do it, short enough to do on purpose.
 */
export const REMOTE_HOLD_MS = 3000;

export type PressReader = {
  /** The button went down. */
  began(): void;
  /** The button came up, after `ms` (from the native side, when it says). */
  ended(ms?: number): void;
  /** Stops a hold being timed (the listener goes away). */
  dispose(): void;
};

/**
 * Tells a press from a hold, from the capture events' `began` / `ended`:
 * - released before `holdMs` → `onPress(ms)`, decided at the release;
 * - still down at `holdMs` → `onHold()` at once (the player hears it while still pressing), and its release is ignored;
 * - an `ended` without its `began` (a hold that started or ended a recording, seen by the next screen's listener) is
 *   ignored.
 */
export function createPressReader(o: {
  onPress: (ms: number | undefined) => void;
  onHold: () => void;
  holdMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}): PressReader {
  const holdMs = o.holdMs === undefined ? REMOTE_HOLD_MS : o.holdMs;
  const setTimer = o.setTimer === undefined ? (fn: () => void, ms: number) => setTimeout(fn, ms) : o.setTimer;
  const clearTimer =
    o.clearTimer === undefined ? (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>) : o.clearTimer;
  let down = false;
  let held = false;
  let timer: unknown;

  const stopTimer = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };

  return {
    began() {
      stopTimer();
      down = true;
      held = false;
      timer = setTimer(() => {
        timer = undefined;
        if (!down) return;
        held = true;
        o.onHold();
      }, holdMs);
    },
    ended(ms) {
      if (!down) return;
      down = false;
      stopTimer();
      if (held) return;
      o.onPress(ms);
    },
    dispose() {
      stopTimer();
      down = false;
    },
  };
}
