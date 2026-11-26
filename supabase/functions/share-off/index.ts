// Turns a share's link off (sharing design §3.1 step 5, §8.1): the link stops working at once and the files leave R2
// on the next cleanup run (expire-shares takes shares in the `off` state). Copies already downloaded into a recipient's
// app stay there. Only the owner may call it; turning off a link that is no longer active is not an error.
//
// A group (docs/superpowers/specs/2026-11-22-multi-recording-share-design.md §4.4) is turned off with its recordings
// in one update; a recording of a group cannot be turned off on its own (400 group): the link is the unit.
//
// Body: { shareId: string }. Answer: { state: 'off' | 'expired' }.
import { caller, db } from '../_shared/auth.ts';
import { json } from '../_shared/r2.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const user = await caller(req);
  if (user === null) return json({ error: 'sign_in' }, 401);

  let shareId = '';
  try {
    const body = await req.json();
    shareId = typeof body.shareId === 'string' ? body.shareId : '';
  } catch {
    return json({ error: 'body' }, 400);
  }
  if (!/^[0-9a-f-]{36}$/.test(shareId)) return json({ error: 'body' }, 400);

  const share = await db.from('shares').select('owner, state, group_id').eq('id', shareId).maybeSingle();
  if (share.error) return json({ error: 'server' }, 500);
  if (share.data === null || share.data.owner !== user.id) return json({ error: 'not_found' }, 404);
  if (share.data.group_id !== null) return json({ error: 'group' }, 400);
  if (share.data.state !== 'active') return json({ state: share.data.state });

  // The share itself and, for a group, every recording in it (a standalone share has none).
  const off = await db
    .from('shares')
    .update({ state: 'off' })
    .or(`id.eq.${shareId},group_id.eq.${shareId}`)
    .eq('owner', user.id)
    .eq('state', 'active');
  if (off.error) return json({ error: 'server' }, 500);
  return json({ state: 'off' });
});
