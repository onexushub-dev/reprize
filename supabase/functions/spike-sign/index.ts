// Spike 1 of the sharing design (docs/superpowers/specs/2026-11-16-recording-sharing-design.md, §10): hands out
// presigned R2 URLs so a diagnostics build can test background uploads. Not a product endpoint: every key lives under
// `spike/`, URLs last one hour and the dev bucket deletes objects after two days.
//
// Secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, SPIKE_KEY.
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const MAX_FILES = 60;
const URL_SECONDS = 3600;

function env(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === '') throw new Error(`missing secret ${name}`);
  return value;
}

const accountId = env('R2_ACCOUNT_ID');
const bucket = env('R2_BUCKET');
const spikeKey = env('SPIKE_KEY');
const r2 = new AwsClient({
  accessKeyId: env('R2_ACCESS_KEY_ID'),
  secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  service: 's3',
  region: 'auto',
});

async function presign(key: string, method: 'PUT' | 'HEAD'): Promise<string> {
  const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(URL_SECONDS));
  const signed = await r2.sign(new Request(url, { method }), { aws: { signQuery: true } });
  return signed.url;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (req.headers.get('x-spike-key') !== spikeKey) return json({ error: 'forbidden' }, 403);

  let count = 0;
  try {
    const body = await req.json();
    count = Number(body.count);
  } catch {
    return json({ error: 'body' }, 400);
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_FILES) return json({ error: 'count' }, 400);

  const run = crypto.randomUUID();
  const items = [];
  for (let i = 1; i <= count; i++) {
    const key = `spike/${run}/${String(i).padStart(2, '0')}.mp4`;
    items.push({ key, put: await presign(key, 'PUT'), head: await presign(key, 'HEAD') });
  }
  return json({ run, expiresIn: URL_SECONDS, items });
});
