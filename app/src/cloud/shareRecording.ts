import { countBucket } from '../analytics/session';
import { track } from '../analytics';
import { clipNumber } from '../components/format';
import { files, repo } from '../data/mmkv';
import type { SessionShare } from '../data/schema';
import { sharePrep } from './appSharePrep';
import { prepJobs, recordingShareInput, uploadItems } from './shareInput';
import { createShare, type ShareRefusal, turnOffShare } from './shares';
import { uploadQueue } from './appUploadQueue';
import { plannedShares, saveUploadPlan, setPrepJobs } from './uploadPlan';

/** A link still shown again instead of making a new one: it has at least this long left. */
export const REUSE_MARGIN_MS = 5 * 60 * 1000;

export type ShareRecordingResult = { ok: true; shared: SessionShare } | { ok: false; reason: ShareRefusal };

/** The recording's link, if it is still worth showing again (active, more than a few minutes left). */
export function liveShare(sessionId: string, now: number = Date.now()): SessionShare | undefined {
  const session = repo.getSession(sessionId);
  const shared = session ? session.shared : undefined;
  if (shared === undefined || shared.state !== 'active' || shared.expiresAt - now < REUSE_MARGIN_MS) return undefined;
  return shared;
}

export function waitBucket(ms: number): '<2s' | '2-5s' | '5-10s' | '>10s' {
  if (ms < 2000) return '<2s';
  if (ms < 5000) return '2-5s';
  if (ms <= 10000) return '5-10s';
  return '>10s';
}

/**
 * Makes the recording's link (sharing design §3.1): one request, then the link is stored on the recording and its
 * uploads are kept for the queue. A live link is returned as it is. The notice must have been accepted before.
 */
export async function shareRecording(
  sessionId: string,
  now: () => number = Date.now,
  /** Only these clips (picked-clips link, 2026-11-23); absent = the whole recording. */
  clipIds?: readonly string[],
): Promise<ShareRecordingResult> {
  const live = liveShare(sessionId, now());
  if (live !== undefined) return { ok: true, shared: live };
  const session = repo.getSession(sessionId);
  const all = repo.listClips(sessionId);
  // Picked clips keep the number they show in the recording, not their place in the pick.
  const clips =
    clipIds === undefined
      ? all
      : all.flatMap((clip, index) => (clipIds.includes(clip.id) ? [{ ...clip, number: clipNumber(clip, index) }] : []));
  if (session === undefined || session.endedAt === undefined || clips.length === 0) return { ok: false, reason: 'failed' };

  const { input, local } = recordingShareInput(session, clips, files, repo.sessionStats(sessionId).recordedMs);
  const tapped = now();
  const result = await createShare(input);
  const waitMs = now() - tapped;
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
    ...(clipIds === undefined ? {} : { clipIds: clips.map((c) => c.id) }),
  };
  saveUploadPlan(share.shareId, { expiresAt: shared.expiresAt, items: uploadItems(share, local) });
  setPrepJobs(share.shareId, prepJobs(share, local));
  repo.setShared(sessionId, shared);
  // A new link always starts sending: a "Pausar envio" left from before does not hold it.
  uploadQueue.setManualPause(false);
  uploadQueue.sync();
  // The cuts and framing files, made right away, each upload starting as its file is ready.
  void sharePrep.run();
  track('share_created', { clips: countBucket(clips.length), wait: waitBucket(waitMs), recordings: '1', picked: clipIds === undefined ? 'no' : 'yes' });
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
    // A group's recording is turned off with its group (`clearAllGroups`); the server refuses it alone.
    if (shared.groupId === undefined && shared.state === 'active' && shared.expiresAt > Date.now()) await turnOffShare(shared.shareId);
    uploadQueue.forget(shared.shareId);
    repo.setShared(session.id, undefined);
  }
  // Plans whose recording was deleted meanwhile.
  for (const shareId of plannedShares()) uploadQueue.forget(shareId);
  return count;
}
