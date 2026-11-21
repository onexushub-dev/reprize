// Creates a share (a recording or a single clip) and hands out the upload URLs
// (docs/superpowers/specs/2026-11-16-recording-sharing-design.md, §2 decisions 2, 3 and 12, §5.2, §5.4).
//
// One light request: the link exists at once and the phone uploads the files afterwards, in the background, with the
// presigned PUT URLs returned here. The URLs last until the share expires (24 hours).
//
// Refused when: not signed in (401), not PRO on RevenueCat (403 not_pro), the liability notice of the current version
// not accepted (403 notice), too many shares in 24 hours (429), a malformed body (400). The PRO check needs
// REVENUECAT_SECRET_KEY; without it the function answers 503 pro_check.
//
// Files in R2, under shares/<share id>/:
//   cover.mp4, cover.jpg                    the web preview (HD, no sound, watermark) and its still
//   clips/<n>/video.mp4                     the original clip file
//   clips/<n>/thumb.jpg, focus.json, ball.json
import { caller, db } from '../_shared/auth.ts';
import { json, presign } from '../_shared/r2.ts';
import { proStatus } from '../_shared/revenuecat.ts';

const NOTICE_VERSION = 1;
const LINK_BASE = 'https://reprizeapp.com/v/';
const LIFETIME_SECONDS = 24 * 60 * 60;
const MAX_CLIPS = 200;
const MAX_CLIP_BYTES = 1536 * 1024 * 1024;
const MAX_EDIT_CHARS = 4096;
const MAX_SHARES_PER_DAY = 30;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

type ClipIn = {
  position: number;
  bytes: number;
  durationMs: number;
  checksum: string | null;
  edit: Record<string, unknown>;
  hasThumb: boolean;
  hasFocus: boolean;
  hasBall: boolean;
};
type ShareIn = {
  kind: 'recording' | 'clip';
  title: string | null;
  sport: string | null;
  /** How long the recording ran (ms); null when not sent. */
  recordedMs: number | null;
  cover: boolean;
  clips: ClipIn[];
};
type Upload = { key: string; kind: string; position: number | null; url: string; contentType: string };

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

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length <= max ? text : undefined;
}

/** The body, checked; null when something is off. */
function parse(body: Record<string, unknown>): ShareIn | null {
  const kind = body.kind;
  if (kind !== 'recording' && kind !== 'clip') return null;
  const title = optionalText(body.title, 80);
  const sport = optionalText(body.sport, 30);
  if (title === undefined || sport === undefined) return null;
  const recordedMs = body.recordedMs === undefined || body.recordedMs === null ? null : body.recordedMs;
  if (recordedMs !== null && !isInt(recordedMs, 0, 24 * 60 * 60 * 1000)) return null;
  if (!Array.isArray(body.clips) || body.clips.length < 1 || body.clips.length > MAX_CLIPS) return null;
  if (kind === 'clip' && body.clips.length !== 1) return null;
  const clips: ClipIn[] = [];
  const seen = new Set<number>();
  for (const raw of body.clips) {
    if (typeof raw !== 'object' || raw === null) return null;
    const c = raw as Record<string, unknown>;
    if (!isInt(c.position, 1, 999) || seen.has(c.position)) return null;
    seen.add(c.position);
    if (!isInt(c.bytes, 1, MAX_CLIP_BYTES) || !isInt(c.durationMs, 1, 10 * 60 * 1000)) return null;
    const checksum = optionalText(c.checksum, 128);
    if (checksum === undefined) return null;
    const edit = c.edit === undefined || c.edit === null ? {} : c.edit;
    if (typeof edit !== 'object' || Array.isArray(edit) || JSON.stringify(edit).length > MAX_EDIT_CHARS) return null;
    clips.push({
      position: c.position,
      bytes: c.bytes,
      durationMs: c.durationMs,
      checksum,
      edit: edit as Record<string, unknown>,
      hasThumb: c.hasThumb === true,
      hasFocus: c.hasFocus === true,
      hasBall: c.hasBall === true,
    });
  }
  clips.sort((a, b) => a.position - b.position);
  return { kind, title, sport, recordedMs: recordedMs as number | null, cover: body.cover !== false, clips };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const user = await caller(req);
  if (user === null) return json({ error: 'sign_in' }, 401);

  let input: ShareIn | null = null;
  try {
    input = parse(await req.json());
  } catch {
    input = null;
  }
  if (input === null) return json({ error: 'body' }, 400);

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
    .gte('created_at', since);
  if (recent.error) return json({ error: 'server' }, 500);
  if ((recent.count || 0) >= MAX_SHARES_PER_DAY) return json({ error: 'too_many' }, 429);

  const pro = await proStatus(user.id);
  if (pro === 'unavailable') return json({ error: 'pro_check' }, 503);
  if (pro === 'free') return json({ error: 'not_pro' }, 403);

  const code = newCode();
  const expiresAt = new Date(Date.now() + LIFETIME_SECONDS * 1000).toISOString();
  const created = await db
    .from('shares')
    .insert({
      owner: user.id,
      kind: input.kind,
      title: input.title,
      sport: input.sport,
      token_hash: `\\x${await sha256Hex(code)}`,
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
    has_focus: c.hasFocus,
    has_ball: c.hasBall,
  }));
  const clipsInsert = await db.from('share_clips').insert(clipRows);
  if (clipsInsert.error) {
    console.error('create-share clips', shareId, clipsInsert.error.message);
    await db.from('shares').delete().eq('id', shareId);
    return json({ error: 'server' }, 500);
  }

  // Order of the queue (§5.4): thumbnails, the cover, then the clips with their framing files.
  const prefix = `shares/${shareId}`;
  const plan: Omit<Upload, 'url'>[] = [];
  for (const c of input.clips) {
    if (c.hasThumb) plan.push({ key: `${prefix}/clips/${c.position}/thumb.jpg`, kind: 'thumb', position: c.position, contentType: 'image/jpeg' });
  }
  if (input.cover) {
    plan.push({ key: `${prefix}/cover.jpg`, kind: 'coverImage', position: null, contentType: 'image/jpeg' });
    plan.push({ key: `${prefix}/cover.mp4`, kind: 'cover', position: null, contentType: 'video/mp4' });
  }
  for (const c of input.clips) {
    plan.push({ key: `${prefix}/clips/${c.position}/video.mp4`, kind: 'video', position: c.position, contentType: 'video/mp4' });
    if (c.hasFocus) plan.push({ key: `${prefix}/clips/${c.position}/focus.json`, kind: 'focus', position: c.position, contentType: 'application/json' });
    if (c.hasBall) plan.push({ key: `${prefix}/clips/${c.position}/ball.json`, kind: 'ball', position: c.position, contentType: 'application/json' });
  }
  const uploads: Upload[] = [];
  for (const item of plan) uploads.push({ ...item, url: await presign(item.key, 'PUT', LIFETIME_SECONDS) });

  return json({ shareId, code, url: `${LINK_BASE}${code}`, expiresAt, uploads });
});
