import { Asset } from 'expo-media-library';
import { Directory, File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';

import { concatVideos, exportClip, shareFiles } from '../../modules/replay-camera';
import type { ExportJob } from '../components/ExportProgress';
import type { Clip } from '../data/schema';
import { repo } from '../data/mmkv';
import { sessionSummary, track } from '../analytics';
import { askPhotos } from './askPhotos';
import { useT } from '../i18n/useT';
import { openPaywall } from '../payments/feedback';
import { canCompile } from '../payments/limits';
import type { Plan } from '../payments/types';
import { type BatchResult, runBatch } from './batchExport';
import { clipShapeOf, compilationOrientation } from './clipExport';
import type { ExportTier } from './exportOptions';
import { readEdit, turnedSize } from './editing';
import { createExportTracker, type ExportTracker } from './exportTracker';
import { labelledPaths } from './labelledFile';
import { useOverlayCapturer } from './OverlayCapturer';

/** What the recording screen shows when a batch ends (or could not start). */
export type BatchCard = {
  text: string;
  /** What went wrong, for a person to read out when asked (the native error code and message). */
  detail?: string;
  /** How long the batch took, kept for the tests and diagnostics; no longer shown on the card (2026-11-21). */
  timing?: BatchResult['timing'];
};

function failure(error: unknown): BatchCard {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
  const message = error instanceof Error ? error.message : String(error);
  return { text: '', detail: code === '' ? message : `${code}: ${message}` };
}

function removeQuietly(path: string) {
  try {
    new File(`file://${path}`).delete();
  } catch {
    // already gone
  }
}

/** The batch's share of the way: finished clips plus the running ones' progress, over all of them. */
function batchProgress(step: { done: number; total: number }, running: number): number {
  return step.total === 0 ? 0 : Math.min(1, (step.done + running) / step.total);
}

function compilationPath(): string {
  const file = new File(new Directory(Paths.cache, 'exports'), `compilation-${Date.now()}.mp4`);
  return file.uri.replace(/^file:\/\//, '');
}

/**
 * Save, send or compile several clips of a recording at once. Every clip comes out as it would alone; the work is one
 * batch at a time and stops quietly if the screen is left.
 */
/** `tier`: how the clips leave when it differs from `plan` (a received recording's courtesy); `plan` decides Compilar. */
export function useBatchActions(o: { plan: Plan; tier?: ExportTier; labelOf: (clip: Clip) => string }) {
  const { t } = useT();
  const capturer = useOverlayCapturer();
  const [job, setJob] = useState<ExportJob>();
  const [card, setCard] = useState<BatchCard>();
  const alive = useRef(true);
  const signal = useRef({ cancelled: false });
  const compiled = useRef<string | undefined>(undefined);
  // The running exports (2026-11-23): their progress fills the card's ring, and Cancelar stops them at once.
  const tracker = useRef<ExportTracker | undefined>(undefined);
  useEffect(() => {
    const made = createExportTracker();
    tracker.current = made;
    const off = made.subscribe(() => {
      if (!made.known() || made.running() === 0) return;
      const running = made.runningProgress();
      setJob((j) => (j !== undefined && j.stage === 'preparing' && j.step !== undefined ? { ...j, progress: batchProgress(j.step, running) } : j));
    });
    return () => {
      off();
      // Leaving mid-batch: the phone stops making videos nobody will get.
      made.cancelAll();
      made.dispose();
      tracker.current = undefined;
    };
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      signal.current.cancelled = true;
      if (compiled.current !== undefined) removeQuietly(compiled.current);
    };
  }, []);

  const stopped = () => !alive.current || signal.current.cancelled;
  const idle = () => {
    if (alive.current) setJob(undefined);
  };

  async function runClips(kind: ExportJob['kind'], clips: Clip[], orientation?: 'portrait' | 'landscape') {
    const mine = { cancelled: false };
    signal.current = mine;
    if (tracker.current !== undefined) tracker.current.reset();
    setJob({ kind, stage: 'preparing', step: { done: 0, total: clips.length } });
    try {
      return await runBatch({
        clips,
        plan: o.tier !== undefined ? o.tier : o.plan,
        orientation,
        capture: capturer.capture,
        exportClip: (options) => (tracker.current !== undefined ? tracker.current.exportClip(options) : exportClip(options)),
        onProgress: (done, total) => {
          if (!alive.current) return;
          const made = tracker.current;
          const progress = made !== undefined && made.known() ? batchProgress({ done, total }, made.runningProgress()) : undefined;
          setJob({ kind, stage: 'preparing', step: { done, total }, progress });
        },
        signal: mine,
      });
    } finally {
      capturer.release(removeQuietly);
    }
  }

  function partial(batch: BatchResult, total: number): string {
    return t('batch.partial', { done: batch.done.length, total, names: batch.failed.map((f) => o.labelOf(f.clip)).join(', ') });
  }

  async function grantPhotos(): Promise<boolean> {
    const granted = await askPhotos();
    if (!granted && alive.current) setCard({ text: t('clip.noPhotos') });
    return granted;
  }

  const save = async (clips: Clip[]) => {
    if (job !== undefined || clips.length === 0) return;
    try {
      if (!(await grantPhotos())) return;
      const batch = await runClips('save', clips);
      if (stopped()) return;
      setJob({ kind: 'save', stage: 'delivering' });
      for (const made of batch.done) {
        await Asset.create(`file://${made.path}`);
        repo.updateClip(made.clip.id, { savedAt: Date.now() });
        sessionSummary.note('export');
      }
      if (batch.done.length > 0) track('clip_shared', { destination: 'photos' });
      if (alive.current) {
        setCard({ text: batch.failed.length === 0 ? t('batch.saved', { count: batch.done.length }) : partial(batch, clips.length), timing: batch.timing });
      }
    } catch (error) {
      if (alive.current) setCard({ ...failure(error), text: t('clip.prepareFailed') });
    } finally {
      idle();
    }
  };

  const share = async (clips: Clip[]) => {
    if (job !== undefined || clips.length === 0) return;
    try {
      const batch = await runClips('share', clips);
      if (stopped()) return;
      if (batch.done.length > 0) {
        setJob({ kind: 'share', stage: 'delivering' });
        // Each file named after its clip's label when it has one.
        const named = await labelledPaths(batch.done.map((made) => ({ path: made.path, label: made.clip.name })));
        const outcome = await shareFiles(named);
        if (outcome === 'shared') {
          batch.done.forEach((made) => {
            repo.updateClip(made.clip.id, { sharedAt: Date.now() });
            sessionSummary.note('export');
          });
          track('clip_shared', { destination: 'share_sheet' });
        }
      }
      if (alive.current && batch.failed.length > 0) setCard({ text: partial(batch, clips.length), timing: batch.timing });
    } catch (error) {
      if (alive.current) setCard({ ...failure(error), text: t('clip.prepareFailed') });
    } finally {
      idle();
    }
  };

  const compile = async (clips: Clip[]) => {
    if (job !== undefined) return;
    if (!canCompile(o.plan)) {
      track('pro_feature_blocked', { feature: 'compile' });
      await openPaywall(t, 'locked_feature');
      return;
    }
    if (clips.length < 2) {
      setCard({ text: t('summary.compileNeedsTwo') });
      return;
    }
    try {
      setJob({ kind: 'compile', stage: 'preparing', step: { done: 0, total: clips.length } });
      const shapes = await Promise.all(clips.map(async (clip) => turnedSize(await clipShapeOf(clip), readEdit(clip.edit).rotation)));
      const batch = await runClips('compile', clips, compilationOrientation(shapes));
      if (stopped()) return;
      if (batch.done.length < 2) {
        if (alive.current) setCard({ text: t('batch.compileTooFew') });
        return;
      }
      setJob({ kind: 'compile', stage: 'joining' });
      const joined = await concatVideos(batch.done.map((made) => made.path), compilationPath());
      compiled.current = joined.path;
      if (!alive.current) return;
      // The share sheet already offers "Salvar vídeo" and every app: no card of our own in between.
      setJob({ kind: 'compile', stage: 'delivering' });
      if ((await shareFiles([joined.path])) === 'shared') {
        batch.done.forEach(() => sessionSummary.note('export'));
        track('clip_shared', { destination: 'share_sheet' });
      }
      if (alive.current && batch.failed.length > 0) setCard({ text: partial(batch, clips.length), timing: batch.timing });
    } catch (error) {
      if (alive.current) setCard({ ...failure(error), text: t('clip.prepareFailed') });
    } finally {
      idle();
    }
  };

  const closeCard = useCallback(() => {
    if (compiled.current !== undefined) removeQuietly(compiled.current);
    compiled.current = undefined;
    setCard(undefined);
  }, []);

  /** Stops at once (2026-11-23): clips not started are skipped and the running exports are cancelled. */
  const cancel = () => {
    signal.current.cancelled = true;
    setJob((j) => (j !== undefined && j.stage === 'preparing' ? { ...j, cancelling: true } : j));
    if (tracker.current !== undefined) tracker.current.cancelAll();
  };

  return { job, card, save, share, compile, closeCard, cancel, overlay: capturer.element };
}
