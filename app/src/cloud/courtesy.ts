import { supabase } from '../account/supabase';
import { kv } from '../data/mmkv';
import { diag } from '../diag/diagLog';

/** Courtesy recordings per account, lifetime (sharing design §2 decision 9; 1 since 2026-11-18). */
export const COURTESIES = 1;

/*
 * The last answer the server gave for each account, kept on the phone (2026-11-21): Ajustes and the unlock sheet draw it
 * on their first frame and ask the server again behind it, instead of waiting for the network and then pushing the rest
 * of the screen down.
 */
const KNOWN = 'courtesy.left.';

/** The courtesies this account had left the last time the server said; undefined before the first answer. */
export function knownCourtesies(accountId: string): number | undefined {
  try {
    const raw = kv.getString(KNOWN + accountId);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

function remember(accountId: string, left: number): void {
  try {
    kv.set(KNOWN + accountId, String(left));
  } catch {
    // Only the first frame of Ajustes depends on it.
  }
}

/** How many courtesies the account has left; null when the server could not say. */
export async function courtesiesLeft(accountId: string): Promise<number | null> {
  const { data, error } = await supabase().from('profiles').select('courtesies_used').eq('id', accountId).maybeSingle();
  if (error) {
    diag(`recebidas: cortesias FALHOU (${error.message})`);
    return null;
  }
  // No profile row yet: nothing spent.
  const used = data === null ? 0 : Number(data.courtesies_used);
  const left = Math.max(0, COURTESIES - used);
  remember(accountId, left);
  return left;
}

/** Why the server did not spend one. `not_member`: this account and phone never opened the link. */
export type CourtesyRefusal = 'sign_in' | 'exhausted' | 'not_member' | 'failed';
export type CourtesyResult = { ok: true; remaining: number } | { ok: false; reason: CourtesyRefusal };

/**
 * Spends a courtesy on a received recording (`use_courtesy`, one transaction on the server). A recording that already
 * had one comes back ok without spending another. `deviceId` lets the server count a link this phone opened signed out.
 */
export async function spendCourtesy(shareId: string, deviceId: string, accountId?: string): Promise<CourtesyResult> {
  const { data, error } = await supabase().rpc('use_courtesy', { p_share: shareId, p_device: deviceId });
  if (error) {
    diag(`recebidas: usar cortesia FALHOU (${error.message})`);
    return { ok: false, reason: 'failed' };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row === undefined || row === null) return { ok: false, reason: 'failed' };
  const answer = row as { allowed: boolean; remaining: number; reason: string };
  diag(`recebidas: cortesia ${answer.reason} (restam ${answer.remaining})`);
  if (accountId !== undefined && (answer.allowed || answer.reason === 'exhausted')) remember(accountId, Number(answer.remaining));
  if (answer.allowed) return { ok: true, remaining: Number(answer.remaining) };
  if (answer.reason === 'sign_in' || answer.reason === 'exhausted' || answer.reason === 'not_member') return { ok: false, reason: answer.reason };
  return { ok: false, reason: 'failed' };
}
