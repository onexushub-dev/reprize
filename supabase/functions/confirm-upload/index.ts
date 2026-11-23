// Confirms that clips of a share reached R2 (sharing design §5.4): the phone calls it after its upload queue finished a
// clip's video. For each position the function checks the object exists with the size the phone says it sent and marks
// the clip `done`; a different size marks it `failed` (the phone sends it again).
//
// Since 2026-11-22 a clip is sent as its cut (multi-recording share design, "what is sent"), made after the link: the
// share announced an upper bound, and the phone reports the real size here (`sizes`). It is taken when it is not more
// than announced, and becomes the clip's size (and the recording's total). A PUT to R2 is all or nothing, so a stored
// object of the reported size is the whole file. Without `sizes` (an older app) the size must be the one announced.
//
// Body: { shareId: string, positions: number[], sizes?: number[] } (at most 200; `sizes` in the order of `positions`).
// Only the share's owner may call it, while the share is active. Answer: { done: number[], missing: number[],
// failed: number[] }.
import { caller, db } from '../_shared/auth.ts';
import { json, objectSize } from '../_shared/r2.ts';

const MAX_POSITIONS = 200;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const user = await caller(req);
  if (user === null) return json({ error: 'sign_in' }, 401);

  let shareId = '';
  let positions: number[] = [];
  let sizes: number[] | null = null;
  try {
    const body = await req.json();
    shareId = typeof body.shareId === 'string' ? body.shareId : '';
    positions = Array.isArray(body.positions) ? body.positions : [];
    sizes = Array.isArray(body.sizes) ? body.sizes : null;
  } catch {
    return json({ error: 'body' }, 400);
  }
  const valid =
    positions.every((p) => Number.isInteger(p) && p >= 1 && p <= 999) &&
    (sizes === null || (sizes.length === positions.length && sizes.every((n) => Number.isInteger(n) && n >= 0)));
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
  /** The real size of clips sent cut, smaller than announced: kept as the clip's size. */
  const resized: { position: number; bytes: number }[] = [];
  for (const clip of clips.data || []) {
    if (clip.upload_state === 'done') {
      done.push(clip.position);
      continue;
    }
    const announced = Number(clip.bytes);
    const at = positions.indexOf(clip.position);
    const reported = sizes !== null && at >= 0 && sizes[at] > 0 && sizes[at] <= announced ? sizes[at] : null;
    const expected = reported === null ? announced : reported;
    try {
      const size = await objectSize(`shares/${shareId}/clips/${clip.position}/video.mp4`);
      if (size === null) missing.push(clip.position);
      else if (size === expected) {
        done.push(clip.position);
        if (size !== announced) resized.push({ position: clip.position, bytes: size });
      } else failed.push(clip.position);
    } catch (e) {
      console.error('confirm-upload head', shareId, clip.position, String(e));
      missing.push(clip.position);
    }
  }
  if (done.length > 0) {
    const marked = await db.from('share_clips').update({ upload_state: 'done' }).eq('share_id', shareId).in('position', done);
    if (marked.error) return json({ error: 'server' }, 500);
  }
  if (resized.length > 0) await keepSizes(shareId, resized);
  if (failed.length > 0) {
    await db.from('share_clips').update({ upload_state: 'failed' }).eq('share_id', shareId).in('position', failed);
  }
  return json({ done, missing, failed });
});

/** The real sizes of clips sent cut, and the recording's total (what "Baixar · 320 MB" shows); best effort. */
async function keepSizes(shareId: string, resized: { position: number; bytes: number }[]): Promise<void> {
  await Promise.all(
    resized.map((r) => db.from('share_clips').update({ bytes: r.bytes }).eq('share_id', shareId).eq('position', r.position)),
  );
  const all = await db.from('share_clips').select('bytes').eq('share_id', shareId);
  if (all.error) return;
  const total = (all.data || []).reduce((sum, c) => sum + Number(c.bytes), 0);
  const updated = await db.from('shares').update({ total_bytes: total }).eq('id', shareId).select('group_id').maybeSingle();
  // A recording of a group link: the group's total too.
  const groupId = updated.data ? updated.data.group_id : null;
  if (typeof groupId !== 'string') return;
  const recordings = await db.from('shares').select('total_bytes').eq('group_id', groupId);
  if (recordings.error) return;
  const groupTotal = (recordings.data || []).reduce((sum, r) => sum + Number(r.total_bytes || 0), 0);
  await db.from('shares').update({ total_bytes: groupTotal }).eq('id', groupId);
}
