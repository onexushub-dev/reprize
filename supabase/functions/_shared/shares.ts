// Helpers shared by the functions that read a share from its link code.
import { db } from './auth.ts';

export const CODE = /^[0-9A-Za-z]{22}$/;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Who shared it, by first name only (the page is public): the profile's display name, else the name the sign-in
 * provider gave (Google), else nothing.
 */
export async function firstName(owner: string): Promise<string | null> {
  const profile = await db.from('profiles').select('display_name').eq('id', owner).maybeSingle();
  let name = profile.data && profile.data.display_name ? String(profile.data.display_name) : '';
  if (name === '') {
    const { data } = await db.auth.admin.getUserById(owner);
    const meta = (data.user && data.user.user_metadata) || {};
    name = typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : '';
  }
  const first = name.trim().split(/\s+/)[0] || '';
  return first === '' ? null : first.slice(0, 40);
}

