// What the link page (reprizeapp.com/v/<code>, the site's server) may show about a share (sharing design §3.2 step 1,
// decision 6): title, clip count, who shared it, time left and the cover preview. Never the clips themselves.
//
// GET ?code=<22 characters>. Public: the code is the secret, and only its SHA-256 is stored. Answers
//   { state: 'active', kind, title, sport, clips, from, expiresAt, cover: { video, image } | null }
//   a group (docs/superpowers/specs/2026-11-22-multi-recording-share-design.md §7) adds
//   recordings: [{ title, clips }] in the sender's order; its title and sport are null ("N gravações de Ana").
// Never the clips themselves.
//   { state: 'expired' | 'off' | 'removed' }  (removed: reported, down until reviewed, §8.3)
//   404 { state: 'not_found' }
// The cover URLs are presigned GETs valid for one hour (the page is rendered on each visit).
import { db } from '../_shared/auth.ts';
import { CODE, firstName, sha256Hex } from '../_shared/shares.ts';
import { json, objectSize, presign } from '../_shared/r2.ts';

const COVER_SECONDS = 60 * 60;

Deno.serve(async (req) => {
  if (req.method !== 'GET') return json({ error: 'method' }, 405);
  const code = new URL(req.url).searchParams.get('code') || '';
  if (!CODE.test(code)) return json({ state: 'not_found' }, 404);

  const found = await db
    .from('shares')
    .select('id, owner, kind, title, sport, clip_count, state, expires_at')
    .eq('token_hash', `\\x${await sha256Hex(code)}`)
    .maybeSingle();
  if (found.error) return json({ error: 'server' }, 500);
  const share = found.data;
  if (share === null) return json({ state: 'not_found' }, 404);
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

  const from = await firstName(share.owner);

  // A group lists its recordings by title and clip count only (the page shows the list; the clips stay in the app).
  let recordings: { title: string | null; clips: number }[] | undefined = undefined;
  if (share.kind === 'group') {
    const children = await db.from('shares').select('title, clip_count').eq('group_id', share.id).order('group_position');
    if (children.error) return json({ error: 'server' }, 500);
    recordings = (children.data || []).map((r) => ({ title: r.title, clips: r.clip_count }));
  }

  // The cover exists once the sender's phone uploaded it; until then the page shows the share without a preview.
  let cover: { video: string; image: string } | null = null;
  try {
    const [video, image] = await Promise.all([
      objectSize(`shares/${share.id}/cover.mp4`),
      objectSize(`shares/${share.id}/cover.jpg`),
    ]);
    if (video !== null && image !== null) {
      cover = {
        video: await presign(`shares/${share.id}/cover.mp4`, 'GET', COVER_SECONDS),
        image: await presign(`shares/${share.id}/cover.jpg`, 'GET', COVER_SECONDS),
      };
    }
  } catch (e) {
    console.error('share-page cover', share.id, String(e));
  }

  return json({
    state: 'active',
    kind: share.kind,
    title: share.title,
    sport: share.sport,
    clips: share.clip_count,
    from,
    expiresAt: share.expires_at,
    cover,
    recordings,
  });
});
