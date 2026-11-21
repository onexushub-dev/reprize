// The app opens a shared link (sharing design §3.2 steps 2-3, §5.5): registers who opened it and hands out what the
// recipient's app downloads, the clips' videos and framing files, with their edit data. Only clips whose video is
// fully in R2 come with URLs (confirmed by the sender's phone, or found here by size); the app asks again for the rest
// while the sender's phone is still uploading.
//
// POST { code: string, deviceId?: string }, with the user's access token when signed in (optional). The opener is
// registered as a member of the share: by account when signed in, else by the phone's id (an install that opened the
// link before signing in; joined to the account when that phone opens it signed in).
// Answers
//   { state: 'active', shareId, kind, title, sport, from, expiresAt, total, recordedMs, clips: [{ position, bytes, durationMs,
//     edit, ready, video?, focus?, ball? }] }
//   { state: 'own' }  the sender's own link
//   { state: 'expired' | 'off' | 'removed' }, 404 { state: 'not_found' }
// URLs are presigned GETs valid until the share expires.
import { caller, db } from '../_shared/auth.ts';
import { json, objectSize, presign } from '../_shared/r2.ts';
import { CODE, firstName, sha256Hex } from '../_shared/shares.ts';

const DEVICE = /^[0-9A-Za-z-]{8,64}$/;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let code = '';
  let deviceId: string | null = null;
  try {
    const body = await req.json();
    code = typeof body.code === 'string' ? body.code : '';
    deviceId = typeof body.deviceId === 'string' && DEVICE.test(body.deviceId) ? body.deviceId : null;
  } catch {
    return json({ error: 'body' }, 400);
  }
  if (!CODE.test(code)) return json({ state: 'not_found' }, 404);
  const user = await caller(req);

  const found = await db
    .from('shares')
    .select('id, owner, kind, title, sport, clip_count, recorded_ms, state, expires_at')
    .eq('token_hash', `\\x${await sha256Hex(code)}`)
    .maybeSingle();
  if (found.error) return json({ error: 'server' }, 500);
  const share = found.data;
  if (share === null) return json({ state: 'not_found' }, 404);
  if (user !== null && user.id === share.owner) return json({ state: 'own' });
  // A reported link is down until reviewed, whatever else it is (a removed one may also have expired or been
  // turned off since): the page says why.
  const reported = await db
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('share_id', share.id)
    .in('state', ['open', 'removed']);
  if (reported.error) return json({ error: 'server' }, 500);
  if ((reported.count || 0) > 0) return json({ state: 'removed' });
  if (share.state === 'off') return json({ state: 'off' });
  if (share.state === 'expired' || Date.parse(share.expires_at) <= Date.now()) return json({ state: 'expired' });

  // Who opened it. A phone that opened it signed out and opens it again signed in moves its row to the account.
  if (user !== null) {
    let joined = false;
    if (deviceId !== null) {
      const moved = await db
        .from('share_members')
        .update({ account: user.id })
        .eq('share_id', share.id)
        .eq('device_id', deviceId)
        .is('account', null)
        .select('id');
      joined = !moved.error && (moved.data || []).length > 0;
    }
    if (!joined) {
      await db.from('share_members').upsert({ share_id: share.id, account: user.id }, { onConflict: 'share_id,account', ignoreDuplicates: true });
    }
  } else if (deviceId !== null) {
    await db.from('share_members').upsert({ share_id: share.id, device_id: deviceId }, { onConflict: 'share_id,device_id', ignoreDuplicates: true });
  }

  const clips = await db
    .from('share_clips')
    .select('position, bytes, duration_ms, edit, has_focus, has_ball, upload_state')
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
  const unconfirmed = (clips.data || []).filter((clip) => clip.upload_state !== 'done');
  await inBatches(unconfirmed, HEADS_AT_ONCE, async (clip) => {
    try {
      const size = await objectSize(`${prefix}/${clip.position}/video.mp4`);
      if (size !== null && size === Number(clip.bytes)) {
        clip.upload_state = 'done';
        confirmed.push(clip.position);
      }
    } catch (e) {
      console.error('open-share head', share.id, clip.position, String(e));
    }
  });
  if (confirmed.length > 0) {
    await db.from('share_clips').update({ upload_state: 'done' }).eq('share_id', share.id).in('position', confirmed);
  }
  // Signing is local work: all of them together.
  const out = await Promise.all(
    (clips.data || []).map(async (clip) => {
      const ready = clip.upload_state === 'done';
      const [video, focus, ball] = await Promise.all([
        ready ? presign(`${prefix}/${clip.position}/video.mp4`, 'GET', seconds) : undefined,
        ready && clip.has_focus ? presign(`${prefix}/${clip.position}/focus.json`, 'GET', seconds) : undefined,
        ready && clip.has_ball ? presign(`${prefix}/${clip.position}/ball.json`, 'GET', seconds) : undefined,
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
      };
    }),
  );

  return json({
    state: 'active',
    shareId: share.id,
    kind: share.kind,
    title: share.title,
    sport: share.sport,
    from: await firstName(share.owner),
    expiresAt: share.expires_at,
    total: share.clip_count,
    recordedMs: share.recorded_ms,
    clips: out,
  });
});

/** How many R2 HEAD requests one open sends at once. */
const HEADS_AT_ONCE = 12;

/** Runs `fn` on every item, `size` at a time. */
async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}
