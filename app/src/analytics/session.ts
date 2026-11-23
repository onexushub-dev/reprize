import type { TriggerSource } from '../data/schema';
import type { Analytics } from './core';
import type { CountBucket, DurationBucket, RecordingDurationBucket, RecordingsBucket } from './events';

export type SummaryCounter = 'clip_saved' | 'export' | 'zoom' | 'guide' | 'economy';

export function countBucket(n: number): CountBucket {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  if (n <= 5) return '2-5';
  if (n <= 20) return '6-20';
  return '21+';
}

export function recordingsBucket(count: number): RecordingsBucket {
  if (count <= 1) return '1';
  if (count <= 3) return '2-3';
  if (count <= 6) return '4-6';
  return '7-10';
}

export function durationBucket(ms: number): DurationBucket {
  const minutes = ms / 60_000;
  if (minutes < 1) return '<1m';
  if (minutes < 5) return '1-5m';
  if (minutes <= 30) return '5-30m';
  return '>30m';
}

/** How long a recording ran, in the ranges of `recording_ended`. */
export function recordingDurationBucket(ms: number): RecordingDurationBucket {
  const minutes = ms / 60_000;
  if (minutes < 5) return '<5m';
  if (minutes < 15) return '5-15m';
  if (minutes < 30) return '15-30m';
  if (minutes <= 60) return '30-60m';
  return '>60m';
}

/**
 * Gathers the frequent, low-value things (zooms, guides, economy mode, exports) into one `session_summary` per session,
 * so they cost one event instead of one per gesture. Nothing is sent for a session where nothing was noted.
 */
export function createSessionSummary(a: Pick<Analytics, 'track' | 'isEnabled'>, now: () => number = Date.now) {
  let counts: Record<SummaryCounter, number>;
  let triggers: Map<TriggerSource, number>;
  let startedAt: number;
  let noted: boolean;

  function reset() {
    counts = { clip_saved: 0, export: 0, zoom: 0, guide: 0, economy: 0 };
    triggers = new Map();
    startedAt = now();
    noted = false;
  }
  reset();

  function topTrigger(): TriggerSource | 'none' {
    let best: TriggerSource | 'none' = 'none';
    let most = 0;
    triggers.forEach((n, trigger) => {
      if (n > most) {
        best = trigger;
        most = n;
      }
    });
    return best;
  }

  return {
    /** A new session begins: counters and the clock start over. */
    start: reset,

    /** `trigger` is only meaningful for `clip_saved`: it feeds the most used trigger. */
    note(kind: SummaryCounter, trigger?: TriggerSource): void {
      counts[kind] += 1;
      noted = true;
      if (kind === 'clip_saved' && trigger) triggers.set(trigger, (triggers.get(trigger) ?? 0) + 1);
    },

    /** Sends the summary once (when the app goes to the background) and clears it; empty or opted-out sessions send nothing. */
    flush(): void {
      const send = noted && a.isEnabled();
      const props = {
        clips: countBucket(counts.clip_saved),
        exports: countBucket(counts.export),
        zooms: countBucket(counts.zoom),
        guides: countBucket(counts.guide),
        economy: countBucket(counts.economy),
        top_trigger: topTrigger(),
        duration: durationBucket(now() - startedAt),
      };
      reset();
      if (send) a.track('session_summary', props);
    },
  };
}
