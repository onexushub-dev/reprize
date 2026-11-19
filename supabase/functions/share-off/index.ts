// Turns a share's link off (sharing design §3.1 step 5, §8.1): the link stops working at once and the files leave R2
// on the next cleanup run (expire-shares takes shares in the `off` state). Copies already downloaded into a recipient's
// app stay there. Only the owner may call it; turning off a link that is no longer active is not an error.
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

  const share = await db.from('shares').select('owner, state').eq('id', shareId).maybeSingle();
  if (share.error) return json({ error: 'server' }, 500);
  if (share.data === null || share.data.owner !== user.id) return json({ error: 'not_found' }, 404);
  if (share.data.state !== 'active') return json({ state: share.data.state });

  const off = await db.from('shares').update({ state: 'off' }).eq('id', shareId).eq('state', 'active');
  if (off.error) return json({ error: 'server' }, 500);
  return json({ state: 'off' });
});
