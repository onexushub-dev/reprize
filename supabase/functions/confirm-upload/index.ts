// Confirms that clips of a share reached R2 (sharing design §5.4): the phone calls it after its upload queue finished a
// clip's video. For each position the function checks the object exists with the size the share was created with and
// marks the clip `done`; a different size marks it `failed` (the phone sends it again).
//
// Body: { shareId: string, positions: number[] } (at most 200). Only the share's owner may call it, while the share is
// active. Answer: { done: number[], missing: number[], failed: number[] }.
import { caller, db } from '../_shared/auth.ts';
import { json, objectSize } from '../_shared/r2.ts';

const MAX_POSITIONS = 200;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const user = await caller(req);
  if (user === null) return json({ error: 'sign_in' }, 401);

  let shareId = '';
  let positions: number[] = [];
  try {
    const body = await req.json();
    shareId = typeof body.shareId === 'string' ? body.shareId : '';
    positions = Array.isArray(body.positions) ? body.positions : [];
  } catch {
    return json({ error: 'body' }, 400);
  }
  const valid = positions.every((p) => Number.isInteger(p) && p >= 1 && p <= 999);
  if (!/^[0-9a-f-]{36}$/.test(shareId) || positions.length === 0 || positions.length > MAX_POSITIONS || !valid) {
    return json({ error: 'body' }, 400);
  }

  const share = await db.from('shares').select('id, owner, state, expires_at').eq('id', shareId).maybeSingle();
  if (share.error) return json({ error: 'server' }, 500);
  if (share.data === null || share.data.owner !== user.id) return json({ error: 'not_found' }, 404);
  if (share.data.state !== 'active' || Date.parse(share.data.expires_at) <= Date.now()) return json({ error: 'expired' }, 410);

  const clips = await db
    .from('share_clips')
    .select('position, bytes, upload_state')
    .eq('share_id', shareId)
    .in('position', positions);
  if (clips.error) return json({ error: 'server' }, 500);

  const done: number[] = [];
  const missing: number[] = [];
  const failed: number[] = [];
  for (const clip of clips.data || []) {
    if (clip.upload_state === 'done') {
      done.push(clip.position);
      continue;
    }
    try {
      const size = await objectSize(`shares/${shareId}/clips/${clip.position}/video.mp4`);
      if (size === null) missing.push(clip.position);
      else if (size === Number(clip.bytes)) done.push(clip.position);
      else failed.push(clip.position);
    } catch (e) {
      console.error('confirm-upload head', shareId, clip.position, String(e));
      missing.push(clip.position);
    }
  }
  if (done.length > 0) {
    const marked = await db.from('share_clips').update({ upload_state: 'done' }).eq('share_id', shareId).in('position', done);
    if (marked.error) return json({ error: 'server' }, 500);
  }
  if (failed.length > 0) {
    await db.from('share_clips').update({ upload_state: 'failed' }).eq('share_id', shareId).in('position', failed);
  }
  return json({ done, missing, failed });
});
