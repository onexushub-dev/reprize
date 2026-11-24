import type { TriggerSource } from '../data/schema';

type Listener = (source: TriggerSource, at: number) => void;

/**
 * Sources that can fire without the player meaning to: the volume buttons (iOS moves the volume when the camera and
 * its audio come back), the arms-up gesture and the voice. A tap on a screen, the watch or the remote phone is always meant.
 */
const PASSIVE: ReadonlySet<TriggerSource> = new Set<TriggerSource>(['remote', 'gesture', 'voice']);

/** After a save, every other trigger is dropped this long (the save button shows it greyed out, 2026-11-21). */
export const TRIGGER_DEBOUNCE_MS = 3000;

/**
 * One entry point for every way of saving a lance (screen, remote, gesture, watch).
 * Triggers closer than `debounceMs` to the last accepted one are dropped, whatever their source,
 * so a gesture right after a tap doesn't save the same play twice (spec 4.4).
 */
export function createTriggerBus({ debounceMs = TRIGGER_DEBOUNCE_MS, now = Date.now }: { debounceMs?: number; now?: () => number } = {}) {
  const listeners = new Set<Listener>();
  let lastAccepted = -Infinity;
  let quietUntil = -Infinity;

  return {
    fire(source: TriggerSource): boolean {
      const at = now();
      if (PASSIVE.has(source) && at < quietUntil) return false;
      if (at - lastAccepted < debounceMs) return false;
      lastAccepted = at;
      listeners.forEach((fn) => fn(source, at));
      return true;
    },

    /**
     * Ignores the passive sources for `ms` from now: right after a recording starts or the app comes back to the
     * front, a volume change or a movement in front of the camera is a side effect, not a play to save.
     */
    quiet(ms: number): void {
      quietUntil = Math.max(quietUntil, now() + ms);
    },

    subscribe(fn: Listener): () => void {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

export type TriggerBus = ReturnType<typeof createTriggerBus>;
