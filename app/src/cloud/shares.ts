import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '../account/supabase';
import { diag } from '../diag/diagLog';

/** Version of the liability notice ("Antes de compartilhar"); the server refuses a share until this one is accepted. */
export const NOTICE_VERSION = 1;

/** One clip of a share, as the server records it. `edit` carries the sender's cut, speed, zoom, rotation and framing. */
export type ShareClipInput = {
  position: number;
  bytes: number;
  durationMs: number;
  checksum?: string;
  edit: Record<string, unknown>;
  hasThumb: boolean;
  hasFocus: boolean;
  hasBall: boolean;
};

export type ShareInput = {
  kind: 'recording' | 'clip';
  title?: string;
  sport?: string;
  /** How long the recording ran (ms): the recipient sees its minutes. */
  recordedMs?: number;
  /** Whether a cover preview (cover.mp4 and cover.jpg) will be uploaded for the web page. */
  cover: boolean;
  clips: ShareClipInput[];
};

/** A file to send: a presigned PUT URL valid until the share expires. */
export type ShareUpload = {
  key: string;
  kind: 'thumb' | 'coverImage' | 'cover' | 'video' | 'focus' | 'ball';
  position: number | null;
  url: string;
  contentType: string;
};

export type CreatedShare = { shareId: string; code: string; url: string; expiresAt: string; uploads: ShareUpload[] };

/**
 * A group link (multi-recording share design §4.2): 2 to 10 recordings, each a recording body without a cover of its
 * own (the group's is the first recording's first clip).
 */
export type GroupShareInput = { kind: 'group'; recordings: ShareInput[] };

/** The group's link and cover uploads, and each recording's own share and uploads, in the order they were sent. */
export type CreatedGroup = {
  shareId: string;
  code: string;
  url: string;
  expiresAt: string;
  cover: ShareUpload[];
  recordings: { shareId: string; uploads: ShareUpload[] }[];
};

export type CreateGroupResult = { ok: true; group: CreatedGroup } | { ok: false; reason: ShareRefusal };

/** Why the server refused; `failed` is anything else (network, server error). */
export type ShareRefusal = 'sign_in' | 'not_pro' | 'notice' | 'too_many' | 'failed';

export type CreateShareResult = { ok: true; share: CreatedShare } | { ok: false; reason: ShareRefusal };

/** Whether the signed-in account accepted the current notice (read through row-level security). */
export async function noticeAccepted(): Promise<boolean> {
  const { data, error } = await supabase()
    .from('notice_acceptances')
    .select('version')
    .eq('version', NOTICE_VERSION)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** Stores the acceptance of the current notice for the signed-in account (once; a repeat is fine). */
export async function acceptNotice(accountId: string): Promise<void> {
  const { error } = await supabase()
    .from('notice_acceptances')
    .upsert({ account: accountId, version: NOTICE_VERSION }, { onConflict: 'account,version', ignoreDuplicates: true });
  if (error) throw error;
}

const REFUSALS: Record<string, ShareRefusal> = {
  sign_in: 'sign_in',
  not_pro: 'not_pro',
  notice: 'notice',
  too_many: 'too_many',
};

/** Asks the server for a share. The link exists at once; the files go up afterwards with the returned URLs. */
export async function createShare(input: ShareInput): Promise<CreateShareResult> {
  const answer = await invokeCreate(input);
  return answer.ok ? { ok: true, share: answer.data as CreatedShare } : answer;
}

/** Asks the server for a group link: one request for every recording, made together or not at all. */
export async function createShareGroup(input: GroupShareInput): Promise<CreateGroupResult> {
  const answer = await invokeCreate(input);
  if (!answer.ok) return answer;
  const group = answer.data as CreatedGroup;
  if (!Array.isArray(group.recordings) || group.recordings.length !== input.recordings.length) {
    diag('envio: criar link de grupo FALHOU (resposta incompleta)');
    return { ok: false, reason: 'failed' };
  }
  return { ok: true, group };
}

async function invokeCreate(body: ShareInput | GroupShareInput): Promise<{ ok: true; data: unknown } | { ok: false; reason: ShareRefusal }> {
  const { data, error } = await supabase().functions.invoke('create-share', { body });
  if (error) {
    let why = error.message;
    if (error instanceof FunctionsHttpError) {
      why = `HTTP ${error.context.status}`;
      try {
        const body = await error.context.json();
        if (typeof body.error === 'string') why += ` ${body.error}`;
        const reason = typeof body.error === 'string' ? REFUSALS[body.error] : undefined;
        diag(`envio: criar link FALHOU (${why})`);
        if (reason !== undefined) return { ok: false, reason };
        return { ok: false, reason: 'failed' };
      } catch {
        // Not JSON: treated as a plain failure.
      }
    }
    diag(`envio: criar link FALHOU (${why})`);
    if (__DEV__) console.warn('[cloud] create-share', error);
    return { ok: false, reason: 'failed' };
  }
  return { ok: true, data };
}

/** What the server found in R2 for these clips (`confirm-upload`); null when the call failed. */
export type ConfirmResult = { done: number[]; missing: number[]; failed: number[] };

/**
 * `sizes`: the size of each file sent, in the order of `positions` (a cut is smaller than the size announced when the
 * link was made: the server takes it, never more than announced).
 */
export async function confirmUploads(shareId: string, positions: number[], sizes?: number[]): Promise<ConfirmResult | null> {
  const body = sizes === undefined ? { shareId, positions } : { shareId, positions, sizes };
  const { data, error } = await supabase().functions.invoke('confirm-upload', { body });
  if (error) {
    if (__DEV__) console.warn('[cloud] confirm-upload', error);
    return null;
  }
  return data as ConfirmResult;
}

/** Turns the link off on the server (`share-off`): it stops working and its files leave the cloud. */
export async function turnOffShare(shareId: string): Promise<boolean> {
  const { error } = await supabase().functions.invoke('share-off', { body: { shareId } });
  if (error) {
    if (__DEV__) console.warn('[cloud] share-off', error);
    return false;
  }
  return true;
}
