import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '../account/supabase';
import { ballPath } from '../data/ballFile';
import { focusPath } from '../data/focusFile';
import { kv, repo } from '../data/mmkv';
import { track } from '../analytics';
import { countBucket, durationBucket } from '../analytics/session';
import { diag } from '../diag/diagLog';
import { createReceiveQueue, type OpenResult, type ReceiveProgress } from './receiveQueue';
import { markCameByShare } from './shareAcquisition';

const DEVICE_KEY = 'reprize:v1:device-id';

/** A random id for this install, so a link opened before signing in counts this phone once (`share_members`). */
export function deviceId(): string {
  const known = kv.getString(DEVICE_KEY);
  if (known !== undefined) return known;
  const id = Crypto.randomUUID();
  kv.set(DEVICE_KEY, id);
  return id;
}

/** One call to `open-share`; `retry` when it failed in a way worth trying again (network, server error). */
async function openOnce(code: string): Promise<{ result: OpenResult; retry: boolean }> {
  const { data, error } = await supabase().functions.invoke('open-share', { body: { code, deviceId: deviceId() } });
  if (!error) return { result: data as OpenResult, retry: false };
  let status = 0;
  if (error instanceof FunctionsHttpError) {
    status = error.context.status;
    try {
      const body = await error.context.json();
      if (body.state === 'not_found') return { result: { state: 'not_found' }, retry: false };
    } catch {
      // not JSON
    }
  }
  diag(`recebidas: abrir FALHOU (${status === 0 ? error.message : `HTTP ${status}`})`);
  // A 4xx other than not found will not change by asking again; a network error or a 5xx may.
  return { result: { state: 'error' }, retry: status === 0 || status >= 500 };
}

const RETRY_MS = [800, 2000];

/**
 * Opens a link on the server (`open-share`): registers this phone or account and lists what to download. A failure
 * is tried again twice: a link tapped in another app often opens Reprize while it is still coming back to the front,
 * and its first request can fail before the network is ready.
 */
export async function openShare(code: string): Promise<OpenResult> {
  let attempt = await openOnce(code);
  for (const wait of RETRY_MS) {
    if (!attempt.retry) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
    attempt = await openOnce(code);
  }
  return attempt.result;
}

function plain(file: File | Directory): string {
  return decodeURIComponent(file.uri.replace(/^file:\/\//, ''));
}

async function download(url: string, path: string): Promise<boolean> {
  try {
    const dest = new File(`file://${path}`);
    if (dest.exists) dest.delete();
    await File.downloadFileAsync(url, dest);
    return true;
  } catch {
    return false;
  }
}

function paths(shareId: string, position: number): { video: string; focus: string; ball: string } {
  const dir = new Directory(Paths.document, 'received', shareId);
  dir.create({ intermediates: true, idempotent: true });
  const video = plain(new File(dir, `${position}.mp4`));
  return { video, focus: focusPath(video), ball: ballPath(video) };
}

/** The app's download queue of received recordings. */
export const receiveQueue = createReceiveQueue({
  repo,
  open: openShare,
  download,
  paths,
  now: Date.now,
  later: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
  log: diag,
  downloaded: (session) => {
    const received = session.received;
    if (received === undefined) return;
    track('share_downloaded', { clips: countBucket(received.total), duration: durationBucket(Date.now() - received.receivedAt) });
  },
});

export type ReceiveResult = { ok: true; sessionId: string } | { ok: false; state: Exclude<OpenResult['state'], 'active'> };

/**
 * A link opened in the app (sharing design §3.2): the received recording is made the first time (or found again) and
 * its clips start downloading. Answers where to go.
 */
export async function receiveShare(code: string): Promise<ReceiveResult> {
  const opened = await openShare(code);
  if (opened.state !== 'active') return { ok: false, state: opened.state };
  let session = repo.receivedSession(opened.shareId);
  if (session === undefined) {
    // Nothing recorded on this phone yet: the person came to the app through this link.
    const newUser = repo.listSessions().every((g) => g.session.received !== undefined);
    if (newUser) markCameByShare();
    track('share_received', { clips: countBucket(opened.total), new_user: newUser });
    session = repo.startReceivedSession({
      sport: repo.getPrefs().sport,
      name: opened.title || undefined,
      now: Date.now(),
      received: {
        shareId: opened.shareId,
        code,
        from: opened.from || undefined,
        receivedAt: Date.now(),
        expiresAt: Date.parse(opened.expiresAt),
        total: opened.total,
      },
    });
    diag(`recebidas: link aberto (${opened.total} clipes)`);
  }
  void receiveQueue.run(session.id);
  return { ok: true, sessionId: session.id };
}

/** Starts what is missing at launch and on every return to the front. Returns the cleanup. */
export function startReceiveQueue(): () => void {
  const sub = AppState.addEventListener('change', (next) => {
    receiveQueue.setForeground(next === 'active');
    if (next === 'active') receiveQueue.sync();
  });
  receiveQueue.sync();
  return () => sub.remove();
}

const NONE: ReceiveProgress = { done: 0, total: 0, downloading: false, state: 'active' };
const snapshots = new Map<string, { version: number; value: ReceiveProgress }>();

function snapshot(sessionId: string | undefined): ReceiveProgress {
  if (sessionId === undefined) return NONE;
  const version = receiveQueue.version();
  const cached = snapshots.get(sessionId);
  if (cached !== undefined && cached.version === version) return cached.value;
  const value = receiveQueue.progress(sessionId);
  snapshots.set(sessionId, { version, value });
  return value;
}

/** A received recording's download progress, kept up to date. */
export function useReceiveProgress(sessionId: string | undefined): ReceiveProgress {
  return useSyncExternalStore(receiveQueue.subscribe, () => snapshot(sessionId));
}
