// Deletes the R2 files of shares that were turned off or are past their 24 hours, then marks them cleaned
// (docs/superpowers/specs/2026-11-16-recording-sharing-design.md §5.5). Called every 10 minutes by pg_cron (see the
// sharing migration). The bucket's lifecycle rule (2 days) is the safety net if this stops running.
//
// Secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, CRON_KEY. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY come with every Edge Function.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { deleteShareFiles, env, json } from '../_shared/r2.ts';

const BATCH = 50;

const cronKey = env('CRON_KEY');
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

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
      files += await deleteShareFiles(id);
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
