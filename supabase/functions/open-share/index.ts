// The app opens a shared link (sharing design §3.2 steps 2-3, §5.5): registers who opened it and hands out what the
// recipient's app downloads, the clips' videos and framing files, with their edit data. Only clips whose video is
// fully in R2 come with URLs (confirmed by the sender's phone, or found here by size); the app asks again for the rest
// while the sender's phone is still uploading.
//
// A group link (docs/superpowers/specs/2026-11-22-multi-recording-share-design.md §4.3) answers only its list of
// recordings, cheap whatever their size; the app then opens each recording with the group's code and that recording's
// id, which answers exactly as a single recording does. A recording of a group is never reachable without the code.
//
// POST { code: string, shareId?: string, deviceId?: string, groups?: true }, with the user's access token when signed
// in (optional).
// The opener is registered as a member of the share (of a group and of each of its recordings): by account when signed
// in, else by the phone's id (an install that opened the link before signing in; joined to the account when that phone
// opens it signed in).
// Answers
//   { state: 'active', shareId, kind, title, sport, from, expiresAt, total, recordedMs, clips: [{ position, bytes,
//     durationMs, edit, ready, video?, focus?, ball?, thumb? }] }
//   { state: 'active', kind: 'group', shareId, from, expiresAt, total, recordings: [{ shareId, title, sport, total,
//     bytes, recordedMs }] }
//   { state: 'own' }  the sender's own link
//   { state: 'update' }  a group link opened by an app that does not send `groups: true` (from before group links)
//   { state: 'expired' | 'off' | 'removed' }, 404 { state: 'not_found' }
// URLs are presigned GETs valid until the share expires.
import { caller, db } from '../_shared/auth.ts';
import { json, objectSize, presign } from '../_shared/r2.ts';
import { CODE, firstName, sha256Hex } from '../_shared/shares.ts';

const DEVICE = /^[0-9A-Za-z-]{8,64}$/;
const UUID = /^[0-9a-f-]{36}$/;

type ShareRow = {
  id: string;
  owner: string;
  kind: string;
  title: string | null;
  sport: string | null;
  clip_count: number;
  recorded_ms: number | null;
  total_bytes: number | null;
  state: string;
  expires_at: string;
};
const COLUMNS = 'id, owner, kind, title, sport, clip_count, recorded_ms, total_bytes, state, expires_at';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let code = '';
  let childId: string | null = null;
  let deviceId: string | null = null;
  let groups = false;
  try {
    const body = await req.json();
    code = typeof body.code === 'string' ? body.code : '';
    childId = typeof body.shareId === 'string' && UUID.test(body.shareId) ? body.shareId : null;
    deviceId = typeof body.deviceId === 'string' && DEVICE.test(body.deviceId) ? body.deviceId : null;
    groups = body.groups === true;
  } catch {
    return json({ error: 'body' }, 400);
  }
  if (!CODE.test(code)) return json({ state: 'not_found' }, 404);
  const user = await caller(req);

  const found = await db
    .from('shares')
    .select(COLUMNS)
    .eq('token_hash', `\\x${await sha256Hex(code)}`)
    .maybeSingle();
  if (found.error) return json({ error: 'server' }, 500);
  const share = found.data as ShareRow | null;
  if (share === null) return json({ state: 'not_found' }, 404);
  if (user !== null && user.id === share.owner) return json({ state: 'own' });
  // A reported link is down until reviewed, whatever else it is (a removed one may also have expired or been
  // turned off since): the page says why. For a group, the report is on the group and takes every recording down.
  const reported = await db
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('share_id', share.id)
    .in('state', ['open', 'removed']);
  if (reported.error) return json({ error: 'server' }, 500);
  if ((reported.count || 0) > 0) return json({ state: 'removed' });
  if (share.state === 'off') return json({ state: 'off' });
  if (share.state === 'expired' || Date.parse(share.expires_at) <= Date.now()) return json({ state: 'expired' });

  if (share.kind !== 'group') {
    await register([share.id], user === null ? null : user.id, deviceId);
    return await recordingAnswer(share, await firstName(share.owner));
  }

  // An app from before group links reads any active answer as one recording's: it is told to update instead, and
  // nothing is registered (it would count as an opening that showed nothing).
  if (!groups) return json({ state: 'update' });

  const children = await db.from('shares').select(COLUMNS).eq('group_id', share.id).order('group_position');
  if (children.error) return json({ error: 'server' }, 500);
  const recordings = (children.data || []) as ShareRow[];

  if (childId !== null) {
    const child = recordings.find((r) => r.id === childId);
    if (child === undefined) return json({ state: 'not_found' }, 404);
    await register([share.id, child.id], user === null ? null : user.id, deviceId);
    // The group's expiry and state are the link's: a recording follows them.
    return await recordingAnswer({ ...child, state: share.state, expires_at: share.expires_at }, await firstName(share.owner));
  }

  await register([share.id, ...recordings.map((r) => r.id)], user === null ? null : user.id, deviceId);
  return json({
    state: 'active',
    kind: 'group',
    shareId: share.id,
    from: await firstName(share.owner),
    expiresAt: share.expires_at,
    total: share.clip_count,
    recordings: recordings.map((r) => ({
      shareId: r.id,
      title: r.title,
      sport: r.sport,
      total: r.clip_count,
      bytes: Number(r.total_bytes || 0),
      recordedMs: r.recorded_ms,
    })),
  });
});

/**
 * Who opened it, on each of these shares (a group and its recordings: courtesies and row-level security read the
 * membership per recording). A phone that opened it signed out and opens it again signed in moves its rows to the
 * account; the upserts leave rows already there alone.
 */
async function register(shareIds: string[], account: string | null, deviceId: string | null): Promise<void> {
  if (account !== null) {
    if (deviceId !== null) {
      await db
        .from('share_members')
        .update({ account })
        .in('share_id', shareIds)
        .eq('device_id', deviceId)
        .is('account', null);
    }
    await db
      .from('share_members')
      .upsert(shareIds.map((id) => ({ share_id: id, account })), { onConflict: 'share_id,account', ignoreDuplicates: true });
  } else if (deviceId !== null) {
    await db
      .from('share_members')
      .upsert(shareIds.map((id) => ({ share_id: id, device_id: deviceId })), { onConflict: 'share_id,device_id', ignoreDuplicates: true });
  }
}

/** One recording's clips, with presigned GETs for those whose video is in R2 (and their thumbnails). */
async function recordingAnswer(share: ShareRow, from: string | null): Promise<Response> {
  const clips = await db
    .from('share_clips')
    .select('position, bytes, duration_ms, edit, has_thumb, has_focus, has_ball, upload_state')
    .eq('share_id', share.id)
    .order('position');
  if (clips.error) return json({ error: 'server' }, 500);

  const seconds = Math.max(60, Math.floor((Date.parse(share.expires_at) - Date.now()) / 1000));
  const prefix = `shares/${share.id}/clips`;
  // A clip whose video is in R2 with its full size counts as uploaded even if the sender's phone has not confirmed it
  // yet (it confirms with the sender's session, which may be signed out or offline right then): marked here.
  // 2026-11-21 (90-clip test): one HEAD after the other made every open take ~10 s while the sender was still
  // uploading, so the receiver saw new clips late. Now a dozen at a time.
  const confirmed: number[] = [];
  const resized: { position: number; bytes: number }[] = [];
  const unconfirmed = (clips.data || []).filter((clip) => clip.upload_state !== 'done');
  await inBatches(unconfirmed, HEADS_AT_ONCE, async (clip) => {
    try {
      const size = await objectSize(`${prefix}/${clip.position}/video.mp4`);
      // A clip sent cut (2026-11-22) is smaller than announced; a PUT to R2 is all or nothing, so any stored object up
      // to the announced size is the whole file. Its real size is kept.
      if (size !== null && size > 0 && size <= Number(clip.bytes)) {
        clip.upload_state = 'done';
        confirmed.push(clip.position);
        if (size !== Number(clip.bytes)) {
          clip.bytes = size;
          resized.push({ position: clip.position, bytes: size });
        }
      }
    } catch (e) {
      console.error('open-share head', share.id, clip.position, String(e));
    }
  });
  if (confirmed.length > 0) {
    await db.from('share_clips').update({ upload_state: 'done' }).eq('share_id', share.id).in('position', confirmed);
  }
  if (resized.length > 0) {
    await Promise.all(
      resized.map((r) => db.from('share_clips').update({ bytes: r.bytes }).eq('share_id', share.id).eq('position', r.position)),
    );
  }
  // Signing is local work: all of them together. The thumbnail is sent first by the sender's phone; its URL is given
  // whether or not it has arrived yet (the app shows nothing until it loads).
  const out = await Promise.all(
    (clips.data || []).map(async (clip) => {
      const ready = clip.upload_state === 'done';
      const [video, focus, ball, thumb] = await Promise.all([
        ready ? presign(`${prefix}/${clip.position}/video.mp4`, 'GET', seconds) : undefined,
        ready && clip.has_focus ? presign(`${prefix}/${clip.position}/focus.json`, 'GET', seconds) : undefined,
        ready && clip.has_ball ? presign(`${prefix}/${clip.position}/ball.json`, 'GET', seconds) : undefined,
        clip.has_thumb ? presign(`${prefix}/${clip.position}/thumb.jpg`, 'GET', seconds) : undefined,
      ]);
      return {
        position: clip.position,
        bytes: Number(clip.bytes),
        durationMs: clip.duration_ms,
        edit: clip.edit,
        ready,
        video,
        focus,
        ball,
        thumb,
      };
    }),
  );

  return json({
    state: 'active',
    shareId: share.id,
    kind: share.kind,
    title: share.title,
    sport: share.sport,
    from,
    expiresAt: share.expires_at,
    total: share.clip_count,
    recordedMs: share.recorded_ms,
    clips: out,
  });
}

/** How many R2 HEAD requests one open sends at once. */
const HEADS_AT_ONCE = 12;

/** Runs `fn` on every item, `size` at a time. */
async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}
