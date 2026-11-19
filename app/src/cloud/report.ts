import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '../account/supabase';
import { diag } from '../diag/diagLog';
import { deviceId } from './receive';

/** Why someone reports a link (sharing design §8.3); the server takes it down until it is reviewed. */
export type ReportCategory = 'not_authorized' | 'minor' | 'inappropriate' | 'other';
export const REPORT_CATEGORIES: ReportCategory[] = ['not_authorized', 'minor', 'inappropriate', 'other'];

/** `too_many`: this phone filed too many reports today; `error`: anything else (network, server). */
export type ReportResult = 'ok' | 'too_many' | 'error';

/** Reports a received link (`report-share`), with this phone's id for the server's daily limit. */
export async function reportShare(code: string, category: ReportCategory, details: string): Promise<ReportResult> {
  const body = { code, category, details: details.trim().slice(0, 500), deviceId: deviceId() };
  const { error } = await supabase().functions.invoke('report-share', { body });
  if (!error) {
    diag(`recebidas: denuncia enviada (${category})`);
    return 'ok';
  }
  const status = error instanceof FunctionsHttpError ? error.context.status : 0;
  diag(`recebidas: denuncia FALHOU (${status === 0 ? error.message : `HTTP ${status}`})`);
  if (status === 429) return 'too_many';
  // The link no longer exists: there is nothing left to take down.
  if (status === 404) return 'ok';
  return 'error';
}
