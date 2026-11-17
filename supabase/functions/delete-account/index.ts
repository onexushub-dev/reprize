// Deletes the signed-in person's account (App Store guideline 5.1.1(v); sharing design, Phase 1).
//
// 1. Checks the caller's session (Authorization: Bearer <access token>).
// 2. Apple accounts: the app sends a fresh authorization code; it is exchanged for a refresh token and revoked at Apple,
//    so the app disappears from the person's "Sign in with Apple" list. The code must belong to the same Apple user.
// 3. Deletes the R2 files of the person's shares (the bucket's 2-day lifecycle rule is the safety net).
// 4. Deletes the auth user; profiles, shares, members and notice acceptances go with it (on delete cascade).
//
// Secrets: R2_* (see _shared/r2.ts). Apple revocation: APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (the .p8
// contents), APPLE_CLIENT_IDS (comma-separated bundle ids). Without them the Apple step is skipped (appleRevoked: false).
import { createClient, type User } from 'npm:@supabase/supabase-js@2';
import { importPKCS8, SignJWT } from 'npm:jose@5.9.6';

import { deleteShareFiles, env, json } from '../_shared/r2.ts';

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const apple = {
  teamId: Deno.env.get('APPLE_TEAM_ID') || '',
  keyId: Deno.env.get('APPLE_KEY_ID') || '',
  privateKey: (Deno.env.get('APPLE_PRIVATE_KEY') || '').replaceAll('\\n', '\n'),
  clientIds: (Deno.env.get('APPLE_CLIENT_IDS') || '').split(',').map((s) => s.trim()).filter((s) => s !== ''),
};

type Body = { appleCode?: unknown; appleClientId?: unknown };

function appleSub(user: User): string | null {
  const identities = user.identities || [];
  const identity = identities.find((i) => i.provider === 'apple');
  if (identity === undefined) return null;
  const data = identity.identity_data || {};
  return typeof data.sub === 'string' ? data.sub : identity.id;
}

async function clientSecret(clientId: string): Promise<string> {
  const key = await importPKCS8(apple.privateKey, 'ES256');
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: apple.keyId })
    .setIssuer(apple.teamId)
    .setSubject(clientId)
    .setAudience('https://appleid.apple.com')
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(key);
}

function payloadOf(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1] || '';
  const text = atob(part.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
  return JSON.parse(text);
}

/** Exchanges the code and revokes the refresh token. Throws when the code is not this person's or Apple refuses. */
async function revokeApple(code: string, clientId: string, expectedSub: string): Promise<void> {
  const secret = await clientSecret(clientId);
  const tokenResponse = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, code, grant_type: 'authorization_code' }),
  });
  if (!tokenResponse.ok) throw new Error(`apple token: HTTP ${tokenResponse.status} ${await tokenResponse.text()}`);
  const tokens = await tokenResponse.json();
  // The id_token comes straight from Apple over TLS: reading its subject is enough to match the person.
  if (typeof tokens.id_token !== 'string' || payloadOf(tokens.id_token).sub !== expectedSub) {
    throw new Error('apple code belongs to another Apple account');
  }
  if (typeof tokens.refresh_token !== 'string') throw new Error('apple token: no refresh token');
  const revokeResponse = await fetch('https://appleid.apple.com/auth/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      token: tokens.refresh_token,
      token_type_hint: 'refresh_token',
    }),
  });
  if (!revokeResponse.ok) throw new Error(`apple revoke: HTTP ${revokeResponse.status}`);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (jwt === '') return json({ error: 'sign_in' }, 401);
  const { data: who, error: whoError } = await db.auth.getUser(jwt);
  if (whoError || who.user === null) return json({ error: 'sign_in' }, 401);
  const user = who.user;

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    // An empty body is fine: no Apple step.
  }

  // Apple: revoke before deleting, so a refused code stops the deletion and the person can try again.
  let appleRevoked = false;
  const sub = appleSub(user);
  if (sub !== null) {
    const configured = apple.teamId !== '' && apple.keyId !== '' && apple.privateKey !== '' && apple.clientIds.length > 0;
    const code = typeof body.appleCode === 'string' ? body.appleCode : '';
    const clientId = typeof body.appleClientId === 'string' ? body.appleClientId : '';
    if (configured) {
      if (code === '' || !apple.clientIds.includes(clientId)) return json({ error: 'apple_code' }, 400);
      try {
        await revokeApple(code, clientId, sub);
        appleRevoked = true;
      } catch (e) {
        console.error('delete-account apple', user.id, String(e));
        return json({ error: 'apple_revoke' }, 502);
      }
    } else {
      console.warn('delete-account: Apple secrets missing, revocation skipped', user.id);
    }
  }

  // Files of the person's shares. A failure here does not stop the deletion: the lifecycle rule removes them in 2 days.
  let files = 0;
  let filesFailed = 0;
  const { data: shares, error: sharesError } = await db
    .from('shares')
    .select('id')
    .eq('owner', user.id)
    .is('files_deleted_at', null);
  if (sharesError) console.error('delete-account shares', user.id, sharesError.message);
  for (const share of shares || []) {
    try {
      files += await deleteShareFiles(share.id);
    } catch (e) {
      filesFailed += 1;
      console.error('delete-account files', share.id, String(e));
    }
  }

  const { error: deleteError } = await db.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error('delete-account user', user.id, deleteError.message);
    return json({ error: 'delete' }, 500);
  }
  return json({ deleted: true, appleRevoked, files, filesFailed });
});
