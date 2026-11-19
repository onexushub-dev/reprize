import { countBucket } from '../analytics/session';
import { track } from '../analytics';
import { files, repo } from '../data/mmkv';
import type { SessionShare } from '../data/schema';
import { recordingShareInput, uploadItems } from './shareInput';
import { createShare, type ShareRefusal, turnOffShare } from './shares';
import { uploadQueue } from './appUploadQueue';
import { plannedShares, saveUploadPlan } from './uploadPlan';

/** A link still shown again instead of making a new one: it has at least this long left. */
const REUSE_MARGIN_MS = 5 * 60 * 1000;

export type ShareRecordingResult = { ok: true; shared: SessionShare } | { ok: false; reason: ShareRefusal };

/** The recording's link, if it is still worth showing again (active, more than a few minutes left). */
export function liveShare(sessionId: string, now: number = Date.now()): SessionShare | undefined {
  const session = repo.getSession(sessionId);
  const shared = session ? session.shared : undefined;
  if (shared === undefined || shared.state !== 'active' || shared.expiresAt - now < REUSE_MARGIN_MS) return undefined;
  return shared;
}

/**
 * Makes the recording's link (sharing design §3.1): one request, then the link is stored on the recording and its
 * uploads are kept for the queue. A live link is returned as it is. The notice must have been accepted before.
 */
export async function shareRecording(sessionId: string, now: () => number = Date.now): Promise<ShareRecordingResult> {
  const live = liveShare(sessionId, now());
  if (live !== undefined) return { ok: true, shared: live };
  const session = repo.getSession(sessionId);
  const clips = repo.listClips(sessionId);
  if (session === undefined || session.endedAt === undefined || clips.length === 0) return { ok: false, reason: 'failed' };

  const { input, local } = recordingShareInput(session, clips, files);
  const result = await createShare(input);
  if (!result.ok) {
    track('share_failed', { reason: result.reason });
    return result;
  }
  const { share } = result;
  const shared: SessionShare = {
    shareId: share.shareId,
    url: share.url,
    createdAt: now(),
    expiresAt: Date.parse(share.expiresAt),
    clips: clips.length,
    state: 'active',
  };
  saveUploadPlan(share.shareId, { expiresAt: shared.expiresAt, items: uploadItems(share, local) });
  repo.setShared(sessionId, shared);
  uploadQueue.sync();
  track('share_created', { clips: countBucket(clips.length) });
  return { ok: true, shared };
}

/**
 * Desligar link (sharing design §8.1): the server turns it off, the phone stops its uploads and keeps the link only as
 * turned off, so the next share makes a new one. False when the server could not be reached.
 */
export async function turnOffRecordingShare(sessionId: string): Promise<boolean> {
  const session = repo.getSession(sessionId);
  const shared = session ? session.shared : undefined;
  if (shared === undefined) return true;
  if (!(await turnOffShare(shared.shareId))) return false;
  uploadQueue.forget(shared.shareId);
  repo.setShared(sessionId, { ...shared, state: 'off' });
  track('share_turned_off');
  return true;
}

/**
 * TEMP(diag-sharing): for testing, every recording goes back to never shared: live links are turned off on the server
 * (best effort, so their files leave the cloud), uploads are cancelled and forgotten, and the link is removed from each
 * recording. Returns how many recordings had a link.
 */
export async function clearAllShares(): Promise<number> {
  let count = 0;
  for (const { session } of repo.listSessions()) {
    const shared = session.shared;
    if (shared === undefined) continue;
    count += 1;
    if (shared.state === 'active' && shared.expiresAt > Date.now()) await turnOffShare(shared.shareId);
    uploadQueue.forget(shared.shareId);
    repo.setShared(session.id, undefined);
  }
  // Plans whose recording was deleted meanwhile.
  for (const shareId of plannedShares()) uploadQueue.forget(shareId);
  return count;
}
