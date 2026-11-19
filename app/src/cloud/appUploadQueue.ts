import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import {
  addReplayListener,
  pauseUploads,
  removeUploads,
  restoreUploads,
  resumeUploads,
  startUploads,
  uploadState,
} from '../../modules/replay-camera';
import { track } from '../analytics';
import { countBucket, durationBucket } from '../analytics/session';
import { diag } from '../diag/diagLog';
import { confirmUploads } from './shares';
import { onUploadHold, uploadHeld } from './uploadHold';
import {
  confirmedPositions,
  forgetUploadPlan,
  plannedShares,
  setConfirmedPositions,
  setUploadsPaused,
  uploadOnCellular,
  uploadPlan,
  uploadsPaused,
} from './uploadPlan';
import { createUploadQueue, type ShareProgress } from './uploadQueue';

/** The app's upload queue, on the system background uploader (sharing design §5.4). */
export const uploadQueue = createUploadQueue({
  native: {
    start: (items) => void startUploads(items),
    pause: pauseUploads,
    resume: resumeUploads,
    remove: removeUploads,
    restore: restoreUploads,
    state: uploadState,
  },
  plans: {
    shareIds: plannedShares,
    get: uploadPlan,
    forget: forgetUploadPlan,
    confirmed: confirmedPositions,
    setConfirmed: setConfirmedPositions,
  },
  confirm: confirmUploads,
  cellular: uploadOnCellular,
  manualPause: { get: uploadsPaused, set: setUploadsPaused },
  now: Date.now,
  log: diag,
  // A link lasts 24 hours from its creation: the plan's expiry says when it was made.
  finished: (_shareId, clips, plan) =>
    track('share_upload_done', { clips: countBucket(clips), duration: durationBucket(Date.now() - (plan.expiresAt - 24 * 60 * 60 * 1000)) }),
});

/**
 * Follows the uploader's events and starts what is waiting: at launch (the uploads of a swiped-away app start again)
 * and each time the app comes back to the front. Returns the cleanup.
 */
export function startUploadQueue(): () => void {
  const subs = [
    addReplayListener('onUploadDone', (e) => uploadQueue.handleDone(e)),
    addReplayListener('onUploadProgress', () => uploadQueue.handleProgress()),
    addReplayListener('onUploadRetry', (e) => diag(`envio: nova tentativa ${e.attempt + 1} (${e.error})`)),
    AppState.addEventListener('change', (next) => {
      if (next === 'active') uploadQueue.sync();
    }),
  ];
  const stopHold = onUploadHold((held) => uploadQueue.setHold(held));
  uploadQueue.setHold(uploadHeld());
  uploadQueue.sync();
  return () => {
    subs.forEach((sub) => sub.remove());
    stopHold();
  };
}

const NO_PROGRESS: ShareProgress = { state: 'none', done: 0, total: 0, failed: 0, sentBytes: 0, totalBytes: 0 };
const snapshots = new Map<string, { version: number; value: ShareProgress }>();

/** The progress as of the queue's current version: the same object until something changes (useSyncExternalStore). */
function progressSnapshot(shareId: string | undefined): ShareProgress {
  if (shareId === undefined) return NO_PROGRESS;
  const version = uploadQueue.version();
  const cached = snapshots.get(shareId);
  if (cached !== undefined && cached.version === version) return cached.value;
  const value = uploadQueue.progress(shareId);
  snapshots.set(shareId, { version, value });
  return value;
}

/** A share's upload progress, kept up to date. */
export function useShareProgress(shareId: string | undefined): ShareProgress {
  return useSyncExternalStore(uploadQueue.subscribe, () => progressSnapshot(shareId));
}
