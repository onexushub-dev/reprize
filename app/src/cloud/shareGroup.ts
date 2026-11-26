import { track } from '../analytics';
import { countBucket, recordingsBucket } from '../analytics/session';
import { files, repo } from '../data/mmkv';
import type { Session, SessionShare } from '../data/schema';
import { uploadQueue } from './appUploadQueue';
import { shareablePick } from './sharePick';
import { forgetShareGroups, saveShareGroup, shareGroup, shareGroups, type ShareGroup } from './shareGroups';
import { sharePrep } from './appSharePrep';
import { prepJobs, recordingShareInput, uploadItems } from './shareInput';
import { REUSE_MARGIN_MS, waitBucket } from './shareRecording';
import { createShareGroup, type ShareRefusal, turnOffShare } from './shares';
import { saveUploadPlan, setPrepJobs } from './uploadPlan';

/** The link's order: the recordings as they were played, the first match first. */
export function linkOrder(sessionIds: string[]): string[] {
  const startedAt = (id: string) => {
    const session = repo.getSession(id);
    return session === undefined ? 0 : session.startedAt;
  };
  return [...sessionIds].sort((a, b) => startedAt(a) - startedAt(b));
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** The group is still on: not turned off and not expired. */
export function groupLive(group: ShareGroup, now: number = Date.now()): boolean {
  return group.state === 'active' && group.expiresAt > now;
}

/**
 * The live group link of exactly these recordings, if it is still worth showing again (more than a few minutes left)
 * and every recording still points at it.
 */
export function liveGroupFor(sessionIds: string[], now: number = Date.now()): ShareGroup | undefined {
  return shareGroups().find((group) => {
    if (!groupLive(group, now) || group.expiresAt - now < REUSE_MARGIN_MS) return false;
    const ids = group.recordings.map((r) => r.sessionId);
    if (!sameSet(ids, sessionIds)) return false;
    return group.recordings.every((r) => {
      const session = repo.getSession(r.sessionId);
      return session !== undefined && session.shared !== undefined && session.shared.groupId === group.groupId;
    });
  });
}

/** The live group link the recording is in, if any. */
export function liveGroupOf(sessionId: string, now: number = Date.now()): ShareGroup | undefined {
  const session = repo.getSession(sessionId);
  const shared = session ? session.shared : undefined;
  if (shared === undefined || shared.groupId === undefined) return undefined;
  const group = shareGroup(shared.groupId);
  return group !== undefined && groupLive(group, now) ? group : undefined;
}

export type ShareGroupResult = { ok: true; group: ShareGroup } | { ok: false; reason: ShareRefusal };

/**
 * Makes one link for several recordings (multi-recording share design §5.2): one request for all of them, then each
 * recording keeps its own share (`Session.shared` with the group's id and link) and upload plan, and the group keeps the
 * plan of its cover (the first recording's first clip, made on the sheet). The live link of exactly these recordings
 * is returned as it is. The notice must have been accepted before.
 */
export async function shareRecordings(sessionIds: string[], now: () => number = Date.now): Promise<ShareGroupResult> {
  const ordered = linkOrder(sessionIds);
  const live = liveGroupFor(ordered, now());
  if (live !== undefined) return { ok: true, group: live };

  const parts = ordered.map((id) => ({ id, session: repo.getSession(id), clips: repo.listClips(id) }));
  const picked = parts.map((p) => ({ session: p.session as Session, clips: p.clips.length }));
  if (parts.some((p) => p.session === undefined) || ordered.length < 2 || !shareablePick(picked).ok) return { ok: false, reason: 'failed' };

  const shares = parts.map((p) => recordingShareInput(p.session as Session, p.clips, files, repo.sessionStats(p.id).recordedMs));
  const tapped = now();
  const result = await createShareGroup({ kind: 'group', recordings: shares.map((s) => ({ ...s.input, cover: false })) });
  const waitMs = now() - tapped;
  if (!result.ok) {
    track('share_failed', { reason: result.reason });
    return result;
  }
  const created = result.group;
  const createdAt = now();
  const expiresAt = Date.parse(created.expiresAt);
  const count = parts.length;
  const recordings = parts.map((p, i) => ({ sessionId: p.id, shareId: created.recordings[i].shareId, clips: p.clips.length }));

  // The cover first: its plan waits for the file the sheet makes.
  saveUploadPlan(created.shareId, {
    expiresAt,
    items: uploadItems({ ...created, uploads: created.cover }, []),
    group: { id: created.shareId, position: 0, count },
  });
  parts.forEach((p, i) => {
    const own = created.recordings[i];
    saveUploadPlan(own.shareId, {
      expiresAt,
      items: uploadItems({ ...created, shareId: own.shareId, uploads: own.uploads }, shares[i].local),
      group: { id: created.shareId, position: i + 1, count },
    });
    setPrepJobs(own.shareId, prepJobs({ uploads: own.uploads }, shares[i].local));
    const shared: SessionShare = {
      shareId: own.shareId,
      url: created.url,
      createdAt,
      expiresAt,
      clips: p.clips.length,
      state: 'active',
      groupId: created.shareId,
    };
    repo.setShared(p.id, shared);
  });
  const group: ShareGroup = { groupId: created.shareId, url: created.url, createdAt, expiresAt, recordings, state: 'active' };
  saveShareGroup(group, createdAt);
  // A new link always starts sending: a "Pausar envio" left from before does not hold it.
  uploadQueue.setManualPause(false);
  uploadQueue.sync();
  // The cuts and framing files, made right away in the link's order, each upload starting as its file is ready.
  void sharePrep.run();
  const clips = recordings.reduce((total, r) => total + r.clips, 0);
  track('share_created', { clips: countBucket(clips), wait: waitBucket(waitMs), recordings: recordingsBucket(count), picked: 'no' });
  return { ok: true, group };
}

/**
 * Encerrar compartilhamento of a group link: the server turns off the group with every recording in it, the phone stops
 * their uploads and keeps the link only as turned off. False when the server could not be reached.
 */
export async function turnOffGroupShare(groupId: string): Promise<boolean> {
  const group = shareGroup(groupId);
  if (group === undefined) return true;
  if (!(await turnOffShare(groupId))) return false;
  uploadQueue.forget(groupId);
  for (const recording of group.recordings) {
    uploadQueue.forget(recording.shareId);
    const session = repo.getSession(recording.sessionId);
    const shared = session ? session.shared : undefined;
    if (shared !== undefined && shared.groupId === groupId) repo.setShared(recording.sessionId, { ...shared, state: 'off' });
  }
  saveShareGroup({ ...group, state: 'off' });
  track('share_turned_off');
  return true;
}

/** TEMP(diag-sharing): turns off every live group link on the server (best effort) and forgets them all. */
export async function clearAllGroups(now: number = Date.now()): Promise<void> {
  for (const group of shareGroups()) {
    if (groupLive(group, now)) await turnOffShare(group.groupId);
    uploadQueue.forget(group.groupId);
    group.recordings.forEach((r) => uploadQueue.forget(r.shareId));
  }
  forgetShareGroups();
}
