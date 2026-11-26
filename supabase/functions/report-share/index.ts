// Reports a shared link (docs/superpowers/specs/2026-11-16-recording-sharing-design.md §8.3). Public: anyone holding
// the link may report it, from the app or from the link page. The link goes down at once (open-share and share-page
// answer "removed" while a report is open) until it is reviewed in the dashboard (supabase/scripts/reports.sql).
//
// POST { code, category, details?, deviceId? }, with the user's access token when the app is signed in (optional).
//   category  not_authorized | minor | inappropriate | other
//   details   optional text, up to 500 characters
//   deviceId  the app's install id; the link page sends x-reporter-key (a hash of the visitor's IP) instead
// Answers { ok: true }, 404 { state: 'not_found' }, 403 { error: 'own' } (the owner turns it off instead),
// 429 { error: 'too_many' } (more than DAILY_LIMIT reports from one phone or browser in 24 hours), 400 { error: 'body' }.
import { caller, db } from '../_shared/auth.ts';
import { json } from '../_shared/r2.ts';
import { CODE, sha256Hex } from '../_shared/shares.ts';

const CATEGORIES = new Set(['not_authorized', 'minor', 'inappropriate', 'other']);
const DEVICE = /^[0-9A-Za-z-]{8,64}$/;
const WEB_KEY = /^[0-9a-f]{16,64}$/;
const DAILY_LIMIT = 10;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let code = '';
  let category = '';
  let details: string | null = null;
  let deviceId: string | null = null;
  try {
    const body = await req.json();
    code = typeof body.code === 'string' ? body.code : '';
    category = typeof body.category === 'string' ? body.category : '';
    if (typeof body.details === 'string' && body.details.trim() !== '') details = body.details.trim().slice(0, 500);
    deviceId = typeof body.deviceId === 'string' && DEVICE.test(body.deviceId) ? body.deviceId : null;
  } catch {
    return json({ error: 'body' }, 400);
  }
  if (!CATEGORIES.has(category)) return json({ error: 'body' }, 400);
  if (!CODE.test(code)) return json({ state: 'not_found' }, 404);

  const webKey = req.headers.get('x-reporter-key') || '';
  const reporterKey = deviceId !== null ? `app:${deviceId}` : WEB_KEY.test(webKey) ? `web:${webKey}` : null;
  if (reporterKey !== null) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent = await db
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .eq('reporter_key', reporterKey)
      .gte('created_at', since);
    if (recent.error) return json({ error: 'server' }, 500);
    if ((recent.count || 0) >= DAILY_LIMIT) return json({ error: 'too_many' }, 429);
  }

  const found = await db.from('shares').select('id, owner').eq('token_hash', `\\x${await sha256Hex(code)}`).maybeSingle();
  if (found.error) return json({ error: 'server' }, 500);
  if (found.data === null) return json({ state: 'not_found' }, 404);
  const share = found.data;
  const user = await caller(req);
  if (user !== null && user.id === share.owner) return json({ error: 'own' }, 403);

  // The same phone or browser reporting the same link again while it waits for review changes nothing.
  if (reporterKey !== null) {
    const again = await db
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .eq('share_id', share.id)
      .eq('reporter_key', reporterKey)
      .eq('state', 'open');
    if (again.error) return json({ error: 'server' }, 500);
    if ((again.count || 0) > 0) return json({ ok: true });
  }

  const inserted = await db.from('reports').insert({
    share_id: share.id,
    reporter: user === null ? null : user.id,
    category,
    reason: details,
    reporter_key: reporterKey,
  });
  if (inserted.error) {
    console.error('report-share insert', share.id, inserted.error.message);
    return json({ error: 'server' }, 500);
  }
  return json({ ok: true });
});
