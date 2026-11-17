// R2 access shared by the Edge Functions (S3 API, signed with aws4fetch).
// Secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
import { AwsClient } from 'npm:aws4fetch@1.0.20';

export function env(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === '') throw new Error(`missing secret ${name}`);
  return value;
}

const base = `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${env('R2_BUCKET')}`;
const r2 = new AwsClient({
  accessKeyId: env('R2_ACCESS_KEY_ID'),
  secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  service: 's3',
  region: 'auto',
});

function unescapeXml(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

/** Every object key under this prefix (ListObjectsV2, 1000 a page). */
export async function listKeys(prefix: string): Promise<string[]> {
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

export async function deleteKey(key: string): Promise<void> {
  const path = key.split('/').map(encodeURIComponent).join('/');
  const response = await r2.fetch(`${base}/${path}`, { method: 'DELETE' });
  // 404: already gone, which is what we want.
  if (!response.ok && response.status !== 404) throw new Error(`delete ${key}: HTTP ${response.status}`);
}

/** Deletes every file of a share (shares/<id>/...). Returns how many files were deleted. */
export async function deleteShareFiles(shareId: string): Promise<number> {
  const keys = await listKeys(`shares/${shareId}/`);
  for (const key of keys) await deleteKey(key);
  return keys.length;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
