/** The native `onFocusProgress` event: `done` of `total` analysed pictures of the Jogadores range. Android only. */
export type FocusProgressEvent = { clipPath: string; done: number; total: number };

export type FocusProgress = {
  onNative(e: FocusProgressEvent): void;
  /** The percent for the card and the tag, once a picture is done; undefined = the spinner. */
  percent(clipPath: string | undefined): number | undefined;
  /** The analysis of this clip ended (ready, failed or stopped). */
  clear(clipPath: string): void;
  /** Hears every percent change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
};

/**
 * Jogadores' progress (Marcus, 2026-11-17: as Bola's, so the player sees the phone working). Only Android sends it:
 * on iOS the percent stays undefined and Jogadores shows its spinner as before.
 */
export function createFocusProgress(): FocusProgress {
  const percents = new Map<string, number>();
  const listeners = new Set<() => void>();
  const tell = () => listeners.forEach((l) => l());
  return {
    onNative({ clipPath, done, total }) {
      if (total <= 0 || done <= 0) return;
      const percent = Math.min(100, Math.round((done * 100) / total));
      if (percents.get(clipPath) === percent) return;
      percents.set(clipPath, percent);
      tell();
    },
    percent: (clipPath) => (clipPath === undefined ? undefined : percents.get(clipPath)),
    clear(clipPath) {
      if (percents.delete(clipPath)) tell();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
