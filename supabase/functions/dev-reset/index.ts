// TEMP(dev-reset): wipes everything sharing left behind, for testing on the dev project. Never deploy it to
// production, and never set DEV_RESET there: without DEV_RESET=on the function refuses.
//
// POST with the x-reset-key header (secret RESET_KEY) and a body { phase }:
//   files  deletes up to LIMIT files under shares/ and spike/ in R2; answers how many are left (call again until 0)
//   db     deletes every share (its clips and members go with it) and every report, and sets every account's
//          courtesies back to 0. With { notices: true } the liability notice acceptances go too.
// Accounts, profiles and the phones' own copies are left alone (the app's Diagnóstico button clears those).
//
// Run it with supabase/scripts/reset-sharing.sh.
import { db } from '../_shared/auth.ts';
import { deleteKey, env, json, listKeys } from '../_shared/r2.ts';

const PREFIXES = ['shares/', 'spike/'];
/** Files per call: well inside the function's time limit. */
const LIMIT = 600;
const PARALLEL = 12;

async function deleteFiles(): Promise<Response> {
  let keys: string[] = [];
  for (const prefix of PREFIXES) keys = keys.concat(await listKeys(prefix));
  const now = keys.slice(0, LIMIT);
  let next = 0;
  let failed = 0;
  async function worker() {
    while (next < now.length) {
      const key = now[next];
      next += 1;
      try {
        await deleteKey(key);
      } catch (e) {
        failed += 1;
        console.error('dev-reset delete', key, String(e));
      }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, () => worker()));
  return json({ deleted: now.length - failed, failed, left: keys.length - now.length + failed });
}

async function clearDatabase(notices: boolean): Promise<Response> {
  const reports = await db.from('reports').delete({ count: 'exact' }).not('id', 'is', null);
  if (reports.error) return json({ error: `reports: ${reports.error.message}` }, 500);
  const shares = await db.from('shares').delete({ count: 'exact' }).not('id', 'is', null);
  if (shares.error) return json({ error: `shares: ${shares.error.message}` }, 500);
  const profiles = await db.from('profiles').update({ courtesies_used: 0 }, { count: 'exact' }).gt('courtesies_used', 0);
  if (profiles.error) return json({ error: `profiles: ${profiles.error.message}` }, 500);
  let accepted = 0;
  if (notices) {
    const gone = await db.from('notice_acceptances').delete({ count: 'exact' }).not('account', 'is', null);
    if (gone.error) return json({ error: `notices: ${gone.error.message}` }, 500);
    accepted = gone.count || 0;
  }
  return json({ shares: shares.count || 0, reports: reports.count || 0, courtesiesReset: profiles.count || 0, notices: accepted });
}

Deno.serve(async (req) => {
  if (Deno.env.get('DEV_RESET') !== 'on') return json({ error: 'off' }, 403);
  if (req.method !== 'POST' || req.headers.get('x-reset-key') !== env('RESET_KEY')) return json({ error: 'forbidden' }, 403);
  let body: { phase?: unknown; notices?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (body.phase === 'files') return await deleteFiles();
  if (body.phase === 'db') return await clearDatabase(body.notices === true);
  return json({ error: 'phase' }, 400);
});
