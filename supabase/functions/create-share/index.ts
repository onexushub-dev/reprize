// Creates a share and hands out the upload URLs: a recording or a single clip
// (docs/superpowers/specs/2026-11-16-recording-sharing-design.md, §2 decisions 2, 3 and 12, §5.2, §5.4), or a group of
// 2 to 10 recordings behind one link (docs/superpowers/specs/2026-11-22-multi-recording-share-design.md §4.2).
//
// One light request: the link exists at once and the phone uploads the files afterwards, in the background, with the
// presigned PUT URLs returned here. The URLs last until the share expires (24 hours).
//
// Refused when: not signed in (401), not PRO on RevenueCat (403 not_pro), the liability notice of the current version
// not accepted (403 notice), too many links in 24 hours (429), a malformed body (400). The PRO check needs
// REVENUECAT_SECRET_KEY; without it the function answers 503 pro_check.
//
// Files in R2, under shares/<share id>/:
//   cover.mp4, cover.jpg                    the web preview (HD, no sound, watermark) and its still
//   clips/<n>/video.mp4                     the original clip file
//   clips/<n>/thumb.jpg, focus.json, ball.json
// A group has only its cover under shares/<group id>/; each of its recordings has its clips under its own id.
//
// Answers
//   recording or clip: { shareId, code, url, expiresAt, uploads }
//   group:             { shareId: <group id>, code, url, expiresAt, cover: uploads, recordings: [{ shareId, uploads }] }
import { caller, db } from '../_shared/auth.ts';
import { json, presign } from '../_shared/r2.ts';
import { proStatus } from '../_shared/revenuecat.ts';
import { coverUploads, type GroupIn, groupRows, parseGroup, parseShare, type PlannedUpload, plannedUploads, type ShareIn } from '../_shared/shareBody.ts';
import { sha256Hex } from '../_shared/shares.ts';

const NOTICE_VERSION = 1;
const LINK_BASE = 'https://reprizeapp.com/v/';
const LIFETIME_SECONDS = 24 * 60 * 60;
/** Links per account in 24 hours: a group counts once, its recordings do not count. */
const MAX_SHARES_PER_DAY = 30;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

type Upload = PlannedUpload & { url: string };

/** 22 base62 characters (about 131 bits), without modulo bias. */
function newCode(): string {
  let code = '';
  while (code.length < 22) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    for (const b of bytes) {
      if (b < 248 && code.length < 22) code += BASE62[b % 62];
    }
  }
  return code;
}

/** Presigning is local work (an HMAC): all of them together. */
function sign(plan: PlannedUpload[]): Promise<Upload[]> {
  return Promise.all(plan.map(async (item) => ({ ...item, url: await presign(item.key, 'PUT', LIFETIME_SECONDS) })));
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const user = await caller(req);
  if (user === null) return json({ error: 'sign_in' }, 401);

  let single: ShareIn | null = null;
  let group: GroupIn | null = null;
  try {
    const body = await req.json();
    if (typeof body === 'object' && body !== null && body.kind === 'group') group = parseGroup(body);
    else if (typeof body === 'object' && body !== null) single = parseShare(body);
  } catch {
    // a body that is not JSON: refused below
  }
  if (single === null && group === null) return json({ error: 'body' }, 400);

  const notice = await db
    .from('notice_acceptances')
    .select('version')
    .eq('account', user.id)
    .eq('version', NOTICE_VERSION)
    .maybeSingle();
  if (notice.error) return json({ error: 'server' }, 500);
  if (notice.data === null) return json({ error: 'notice', version: NOTICE_VERSION }, 403);

  const since = new Date(Date.now() - LIFETIME_SECONDS * 1000).toISOString();
  const recent = await db
    .from('shares')
    .select('id', { count: 'exact', head: true })
    .eq('owner', user.id)
    .is('group_id', null)
    .gte('created_at', since);
  if (recent.error) return json({ error: 'server' }, 500);
  if ((recent.count || 0) >= MAX_SHARES_PER_DAY) return json({ error: 'too_many' }, 429);

  const pro = await proStatus(user.id);
  if (pro === 'unavailable') return json({ error: 'pro_check' }, 503);
  if (pro === 'free') return json({ error: 'not_pro' }, 403);

  const code = newCode();
  const tokenHash = `\\x${await sha256Hex(code)}`;
  const expiresAt = new Date(Date.now() + LIFETIME_SECONDS * 1000).toISOString();

  if (group !== null) return await createGroup(user.id, group, code, tokenHash, expiresAt);
  if (single === null) return json({ error: 'body' }, 400);
  const input = single;

  const created = await db
    .from('shares')
    .insert({
      owner: user.id,
      kind: input.kind,
      title: input.title,
      sport: input.sport,
      token_hash: tokenHash,
      clip_count: input.clips.length,
      recorded_ms: input.recordedMs,
      expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (created.error) {
    console.error('create-share insert', user.id, created.error.message);
    return json({ error: 'server' }, 500);
  }
  const shareId: string = created.data.id;

  const clipRows = input.clips.map((c) => ({
    share_id: shareId,
    position: c.position,
    bytes: c.bytes,
    duration_ms: c.durationMs,
    checksum: c.checksum,
    edit: c.edit,
    has_thumb: c.hasThumb,
    has_focus: c.hasFocus,
    has_ball: c.hasBall,
  }));
  const clipsInsert = await db.from('share_clips').insert(clipRows);
  if (clipsInsert.error) {
    console.error('create-share clips', shareId, clipsInsert.error.message);
    await db.from('shares').delete().eq('id', shareId);
    return json({ error: 'server' }, 500);
  }

  const uploads = await sign(plannedUploads(shareId, input));
  return json({ shareId, code, url: `${LINK_BASE}${code}`, expiresAt, uploads });
});

/**
 * A group, its recordings and their clips, in one transaction (`create_share_group`): either the whole link exists or
 * nothing does. The group's cover is the only cover; each recording uploads under its own id.
 */
async function createGroup(owner: string, group: GroupIn, code: string, tokenHash: string, expiresAt: string): Promise<Response> {
  const created = await db.rpc('create_share_group', {
    p_owner: owner,
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
    p_recordings: groupRows(group),
  });
  if (created.error) {
    console.error('create-share group', owner, created.error.message);
    return json({ error: 'server' }, 500);
  }
  const ids = created.data as { group: string; recordings: string[] };
  if (!ids || typeof ids.group !== 'string' || !Array.isArray(ids.recordings) || ids.recordings.length !== group.recordings.length) {
    console.error('create-share group answer', owner, JSON.stringify(created.data));
    return json({ error: 'server' }, 500);
  }
  const [cover, recordings] = await Promise.all([
    sign(coverUploads(ids.group)),
    Promise.all(
      group.recordings.map(async (recording, i) => ({
        shareId: ids.recordings[i],
        uploads: await sign(plannedUploads(ids.recordings[i], recording)),
      })),
    ),
  ]);
  return json({ shareId: ids.group, code, url: `${LINK_BASE}${code}`, expiresAt, cover, recordings });
}
