// The app opens a shared link (sharing design §3.2 steps 2-3, §5.5): registers who opened it and hands out what the
// recipient's app downloads, the clips' videos and framing files, with their edit data. Only clips whose video is
// fully in R2 come with URLs (confirmed by the sender's phone, or found here by size); the app asks again for the rest
// while the sender's phone is still uploading.
//
// POST { code: string, deviceId?: string }, with the user's access token when signed in (optional). The opener is
// registered as a member of the share: by account when signed in, else by the phone's id (an install that opened the
// link before signing in; joined to the account when that phone opens it signed in).
// Answers
//   { state: 'active', shareId, kind, title, sport, from, expiresAt, total, clips: [{ position, bytes, durationMs,
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
    .select('id, owner, kind, title, sport, clip_count, state, expires_at')
    .eq('token_hash', `\\x${await sha256Hex(code)}`)
    .maybeSingle();
  if (found.error) return json({ error: 'server' }, 500);
  const share = found.data;
  if (share === null) return json({ state: 'not_found' }, 404);
  if (user !== null && user.id === share.owner) return json({ state: 'own' });
  if (share.state === 'off') return json({ state: 'off' });
  if (share.state === 'expired' || Date.parse(share.expires_at) <= Date.now()) return json({ state: 'expired' });
  const reported = await db
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('share_id', share.id)
    .in('state', ['open', 'removed']);
  if (reported.error) return json({ error: 'server' }, 500);
  if ((reported.count || 0) > 0) return json({ state: 'removed' });

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
  const confirmed: number[] = [];
  for (const clip of clips.data || []) {
    if (clip.upload_state === 'done') continue;
    try {
      const size = await objectSize(`${prefix}/${clip.position}/video.mp4`);
      if (size !== null && size === Number(clip.bytes)) {
        clip.upload_state = 'done';
        confirmed.push(clip.position);
      }
    } catch (e) {
      console.error('open-share head', share.id, clip.position, String(e));
    }
  }
  if (confirmed.length > 0) {
    await db.from('share_clips').update({ upload_state: 'done' }).eq('share_id', share.id).in('position', confirmed);
  }
  const out = [];
  for (const clip of clips.data || []) {
    const ready = clip.upload_state === 'done';
    out.push({
      position: clip.position,
      bytes: Number(clip.bytes),
      durationMs: clip.duration_ms,
      edit: clip.edit,
      ready,
      video: ready ? await presign(`${prefix}/${clip.position}/video.mp4`, 'GET', seconds) : undefined,
      focus: ready && clip.has_focus ? await presign(`${prefix}/${clip.position}/focus.json`, 'GET', seconds) : undefined,
      ball: ready && clip.has_ball ? await presign(`${prefix}/${clip.position}/ball.json`, 'GET', seconds) : undefined,
    });
  }

  return json({
    state: 'active',
    shareId: share.id,
    kind: share.kind,
    title: share.title,
    sport: share.sport,
    from: await firstName(share.owner),
    expiresAt: share.expires_at,
    total: share.clip_count,
    clips: out,
  });
});
