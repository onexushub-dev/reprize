// Deletes the R2 files of shares that were turned off or are past their 24 hours, then marks them cleaned
// (docs/superpowers/specs/2026-11-16-recording-sharing-design.md §5.5). Called every 10 minutes by pg_cron (see the
// sharing migration). The bucket's lifecycle rule (2 days) is the safety net if this stops running.
//
// Secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, CRON_KEY. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY come with every Edge Function.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const BATCH = 50;

function env(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === '') throw new Error(`missing secret ${name}`);
  return value;
}

const cronKey = env('CRON_KEY');
const base = `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${env('R2_BUCKET')}`;
const r2 = new AwsClient({
  accessKeyId: env('R2_ACCESS_KEY_ID'),
  secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  service: 's3',
  region: 'auto',
});
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

function unescapeXml(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

/** Every object key under this prefix (ListObjectsV2, 1000 a page). */
async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token = '';
  for (;;) {
    const url = new URL(base);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', prefix);
    if (token !== '') url.searchParams.set('continuation-token', token);
    const response = await r2.fetch(url.toString());
    if (!response.ok) throw new Error(`list ${prefix}: HTTP ${response.status}`);
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(unescapeXml(match[1]));
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    if (next === null) break;
    token = unescapeXml(next[1]);
  }
  return keys;
}

async function deleteKey(key: string): Promise<void> {
  const path = key.split('/').map(encodeURIComponent).join('/');
  const response = await r2.fetch(`${base}/${path}`, { method: 'DELETE' });
  // 404: already gone, which is what we want.
  if (!response.ok && response.status !== 404) throw new Error(`delete ${key}: HTTP ${response.status}`);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-key') !== cronKey) return json({ error: 'forbidden' }, 403);

  const { data, error } = await db.rpc('shares_to_clean', { p_limit: BATCH });
  if (error) return json({ error: error.message }, 500);
  const ids = (data || []) as string[];

  const cleaned: string[] = [];
  const failed: { id: string; error: string }[] = [];
  let files = 0;
  for (const id of ids) {
    try {
      const keys = await listKeys(`shares/${id}/`);
      for (const key of keys) await deleteKey(key);
      files += keys.length;
      cleaned.push(id);
    } catch (e) {
      failed.push({ id, error: String(e) });
    }
  }

  if (cleaned.length > 0) {
    const marked = await db.rpc('mark_shares_cleaned', { p_ids: cleaned });
    if (marked.error) return json({ error: marked.error.message, cleaned: 0, files, failed }, 500);
  }
  if (failed.length > 0) console.error('expire-shares failures', JSON.stringify(failed));
  return json({ cleaned: cleaned.length, files, failed: failed.length });
});
