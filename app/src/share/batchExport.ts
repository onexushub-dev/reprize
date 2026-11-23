import { File } from 'expo-file-system';

import type { ExportClipOptions, ExportedClip } from '../../modules/replay-camera/src/ReplayCamera.types';
import type { Clip } from '../data/schema';
import { colors } from '../theme/tokens';
import { clipExportJob, clipShapeOf, type ClipJob, type Orientation } from './clipExport';
import type { ExportTier } from './exportOptions';
import { cachedExport, forgetExport, rememberExport } from './exportCache';

/** How many clips are encoded at once. 2 is faster than 1 but warms the phone more; set to 1 to go back. */
export const EXPORT_CONCURRENCY = 2;

export type BatchResult = {
  /** In the recording's order. */
  done: { clip: Clip; path: string }[];
  failed: { clip: Clip; reason: 'export' | 'missing' }[];
  timing: { totalMs: number; perClipMs: number[]; concurrency: number };
};

type Size = { width: number; height: number };

type BatchOptions = {
  clips: Clip[];
  plan: ExportTier;
  /** One frame for every clip (a compilation); without it each clip keeps its own. */
  orientation?: Orientation;
  concurrency?: number;
  /** Draws and captures the app mark for a look (see `useOverlayCapturer`); its pictures are not removed here. */
  capture: (job: Pick<ClipJob, 'frame' | 'layout' | 'watermark'>) => Promise<string>;
  exportClip: (options: ExportClipOptions) => Promise<ExportedClip>;
  shapeOf?: (clip: Clip) => Promise<Size>;
  fileExists?: (path: string) => boolean;
  onProgress: (done: number, total: number) => void;
  /** Set `cancelled` to stop: clips not started are skipped, and ones finishing meanwhile are removed. */
  signal: { cancelled: boolean };
};

function fileThere(path: string): boolean {
  try {
    return new File(`file://${path}`).exists;
  } catch {
    return false;
  }
}

/**
 * Exports the clips as each one would come out alone (cut, speed, zoom, Modo Foco, turn, bands, mark), a few at a time.
 * A look exported before (here or on the clip screen) is reused. One clip failing never stops the rest.
 */
export async function runBatch(o: BatchOptions): Promise<BatchResult> {
  const started = Date.now();
  const concurrency = o.concurrency !== undefined ? o.concurrency : EXPORT_CONCURRENCY;
  const shapeOf = o.shapeOf !== undefined ? o.shapeOf : clipShapeOf;
  const exists = o.fileExists !== undefined ? o.fileExists : fileThere;
  const done: { index: number; clip: Clip; path: string }[] = [];
  const failed: { index: number; clip: Clip; reason: 'export' | 'missing' }[] = [];
  const perClipMs: number[] = [];
  let finished = 0;
  let next = 0;

  const finish = () => {
    finished += 1;
    o.onProgress(finished, o.clips.length);
  };

  async function one(index: number) {
    const clip = o.clips[index];
    if (!exists(clip.path)) {
      failed.push({ index, clip, reason: 'missing' });
      return finish();
    }
    try {
      const shape = await shapeOf(clip);
      const job = clipExportJob(clip, o.plan, shape, o.orientation);
      const cached = cachedExport(job.key);
      if (cached !== undefined) {
        done.push({ index, clip, path: cached });
        return finish();
      }
      const clockStart = Date.now();
      const overlayPngPath = await o.capture(job);
      const result = await o.exportClip({ clipPath: clip.path, ...job.options, overlayPngPath, background: colors.ground });
      if (o.signal.cancelled) {
        forgetExport(result.path);
        return;
      }
      rememberExport(job.key, result.path);
      perClipMs.push(Date.now() - clockStart);
      done.push({ index, clip, path: result.path });
    } catch {
      // After Cancelar (2026-11-23) a rejection is the stop, not a failure, whatever code the bridge left on it.
      if (o.signal.cancelled) return;
      failed.push({ index, clip, reason: 'export' });
    }
    finish();
  }

  async function worker() {
    while (!o.signal.cancelled && next < o.clips.length) {
      const index = next;
      next += 1;
      await one(index);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, o.clips.length)) }, worker));

  const byIndex = (a: { index: number }, b: { index: number }) => a.index - b.index;
  return {
    done: done.sort(byIndex).map(({ clip, path }) => ({ clip, path })),
    failed: failed.sort(byIndex).map(({ clip, reason }) => ({ clip, reason })),
    timing: { totalMs: Date.now() - started, perClipMs, concurrency },
  };
}
