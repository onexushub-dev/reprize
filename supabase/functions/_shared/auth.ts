// Who is calling: the user behind the Authorization bearer token, checked with Supabase Auth.
import { createClient, type User } from 'npm:@supabase/supabase-js@2';

import { env } from './r2.ts';

export const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

export async function caller(req: Request): Promise<User | null> {
  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (jwt === '') return null;
  const { data, error } = await db.auth.getUser(jwt);
  if (error || data.user === null) return null;
  return data.user;
}
