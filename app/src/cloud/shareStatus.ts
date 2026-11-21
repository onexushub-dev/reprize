import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { supabase } from '../account/supabase';

/** What the owner sees of a live link: how many phones opened it and whether it was reported (`share_status`). */
export type ShareStatus = { opened: number; report: 'none' | 'open' | 'removed' };

/** The server's answer; null when it could not say (offline, signed out, not the owner). */
export async function fetchShareStatus(shareId: string): Promise<ShareStatus | null> {
  let answer: { data: unknown; error: unknown };
  try {
    answer = await supabase().rpc('share_status', { p_share: shareId });
  } catch {
    return null; // no Supabase in this build
  }
  const { data, error } = answer;
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (row === undefined || row === null) return null;
  const value = row as { opened: number; report: string };
  const report = value.report === 'open' || value.report === 'removed' ? value.report : 'none';
  return { opened: Number(value.opened), report };
}

/**
 * The status of a link, asked again every `everyMs` while the app is in front (a phone opening it, a report coming
 * in). Undefined until the first answer; the last answer stays when one fails.
 */
export function useShareStatus(shareId: string | undefined, everyMs: number): ShareStatus | undefined {
  const [status, setStatus] = useState<{ shareId: string; value: ShareStatus } | undefined>(undefined);
  useEffect(() => {
    if (shareId === undefined) return;
    let alive = true;
    const ask = () => {
      if (AppState.currentState !== 'active') return;
      void fetchShareStatus(shareId).then((value) => {
        if (alive && value !== null) setStatus({ shareId, value });
      });
    };
    ask();
    const timer = setInterval(ask, everyMs);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') ask();
    });
    return () => {
      alive = false;
      clearInterval(timer);
      sub.remove();
    };
  }, [shareId, everyMs]);
  return status !== undefined && status.shareId === shareId ? status.value : undefined;
}
