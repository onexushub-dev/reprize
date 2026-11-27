import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '../account/supabase';
import { ballPath } from '../data/ballFile';
import { focusPath } from '../data/focusFile';
import { kv, removeFile, repo } from '../data/mmkv';
import { track } from '../analytics';
import { countBucket, durationBucket, recordingsBucket } from '../analytics/session';
import { diag } from '../diag/diagLog';
import { askTransferNotifications } from './transferNotifications';
import {
  addReplayListener,
  downloadState,
  downloadsAvailable,
  pauseDownloads,
  removeDownloads,
  resumeDownloads,
  startDownloads,
} from '../../modules/replay-camera';
import type { OpenedClip } from './receivedClip';
import { createReceiveQueue, type OpenResult, type ReceiveProgress } from './receiveQueue';
import { receivedDir, receivedVideoPath, removeReceivedFiles } from './receivedPaths';
import { RECORDING_SPORTS } from '../focus/sportCheck';
import type { Session } from '../data/schema';
import { markCameByShare } from './shareAcquisition';
import { onUploadHold, uploadHeld } from './uploadHold';

type GroupOpened = Extract<OpenResult, { kind: 'group' }>;

const DEVICE_KEY = 'reprize:v1:device-id';

/** A random id for this install, so a link opened before signing in counts this phone once (`share_members`). */
export function deviceId(): string {
  const known = kv.getString(DEVICE_KEY);
  if (known !== undefined) return known;
  const id = Crypto.randomUUID();
  kv.set(DEVICE_KEY, id);
  return id;
}

/**
 * One call to `open-share`; `retry` when it failed in a way worth trying again (network, server error). `groups` tells
 * the server this app opens group links (an older app is answered `update` instead of a list it cannot read).
 */
async function openOnce(code: string, shareId?: string): Promise<{ result: OpenResult; retry: boolean }> {
  const body = shareId === undefined ? { code, deviceId: deviceId(), groups: true } : { code, shareId, deviceId: deviceId(), groups: true };
  const { data, error } = await supabase().functions.invoke('open-share', { body });
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
export async function openShare(code: string, shareId?: string): Promise<OpenResult> {
  let attempt = await openOnce(code, shareId);
  for (const wait of RETRY_MS) {
    if (!attempt.retry) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
    attempt = await openOnce(code, shareId);
  }
  return attempt.result;
}


const META_KEY = (shareId: string) => `reprize:v1:received-meta:${shareId}`;

/** The clips' edit data of a received recording, kept so files that arrive while offline still become clips. */
const meta = {
  get(shareId: string): OpenedClip[] | undefined {
    const raw = kv.getString(META_KEY(shareId));
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as OpenedClip[];
    } catch {
      return undefined;
    }
  },
  set(shareId: string, clips: OpenedClip[]): void {
    kv.set(META_KEY(shareId), JSON.stringify(clips));
  },
  forget(shareId: string): void {
    kv.delete(META_KEY(shareId));
  },
};

function paths(shareId: string, position: number): { video: string; focus: string; ball: string } {
  receivedDir(shareId).create({ intermediates: true, idempotent: true });
  const video = receivedVideoPath(shareId, position);
  return { video, focus: focusPath(video), ball: ballPath(video) };
}

/** The app's download queue of received recordings. */
export const receiveQueue = createReceiveQueue({
  repo,
  open: openShare,
  native: {
    available: downloadsAvailable,
    start: (items, paused) => {
      void askTransferNotifications();
      void startDownloads(items, paused);
    },
    state: downloadState,
    pause: pauseDownloads,
    resume: resumeDownloads,
    remove: removeDownloads,
  },
  meta,
  paths,
  exists: (path) => {
    try {
      return new File(`file://${path}`).exists;
    } catch {
      return false;
    }
  },
  removeFile,
  removeShareFiles: removeReceivedFiles,
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

/**
 * The sender's sport for a received recording (2026-11-22): Jogadores and Bola work on it as on one's own recording
 * (Bola needs the sport's model). Unknown or absent: nothing set, the recipient can say it in the editor.
 */
function senderSport(sport: string | null | undefined): Session['ballSport'] {
  const known = RECORDING_SPORTS.find((s) => s === sport);
  return known === undefined ? undefined : { v: 1, verdict: 'allow', sport: known };
}

export type ReceiveResult =
  | { ok: true; kind: 'recording'; sessionId: string }
  | { ok: true; kind: 'group'; count: number; from?: string }
  | { ok: false; state: Exclude<OpenResult['state'], 'active'> };

/**
 * A link opened in the app (sharing design §3.2): the received recording is made the first time (or found again) and
 * its clips start downloading. A group link makes one received recording per recording in it, none downloading until
 * the person chooses (multi-recording share design §5.4). Answers where to go.
 */
export async function receiveShare(code: string): Promise<ReceiveResult> {
  const opened = await openShare(code);
  if (opened.state !== 'active') return { ok: false, state: opened.state };
  if (opened.kind === 'group') return receiveGroup(code, opened);
  let session = repo.receivedSession(opened.shareId);
  if (session === undefined) {
    // Nothing recorded on this phone yet: the person came to the app through this link.
    const newUser = repo.listSessions().every((g) => g.session.received !== undefined);
    if (newUser) markCameByShare();
    track('share_received', { clips: countBucket(opened.total), new_user: newUser, recordings: '1' });
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
        recordedMs: typeof opened.recordedMs === 'number' ? opened.recordedMs : undefined,
      },
    });
    const sport = senderSport(opened.sport);
    if (sport !== undefined) repo.setBallSport(session.id, sport);
    diag(`recebidas: link aberto (${opened.total} clipes)`);
  }
  void receiveQueue.run(session.id);
  return { ok: true, kind: 'recording', sessionId: session.id };
}

/**
 * Each recording of a group link becomes a received recording of its own (made once, found again after), listed in the
 * link's order (the first on top). They download nothing but their clips' stills until the person taps Baixar.
 */
function receiveGroup(code: string, opened: GroupOpened): ReceiveResult {
  const count = opened.recordings.length;
  const from = opened.from || undefined;
  const fresh = opened.recordings.some((r) => repo.receivedSession(r.shareId) === undefined);
  if (fresh) {
    const newUser = repo.listSessions().every((g) => g.session.received !== undefined);
    if (newUser) markCameByShare();
    track('share_received', { clips: countBucket(opened.total), new_user: newUser, recordings: recordingsBucket(count) });
  }
  const now = Date.now();
  opened.recordings.forEach((recording, index) => {
    let session = repo.receivedSession(recording.shareId);
    if (session === undefined) {
      session = repo.startReceivedSession({
        sport: repo.getPrefs().sport,
        name: recording.title || undefined,
        // A millisecond apart, newest first in the list: the link's first recording on top.
        now: now - index,
        received: {
          shareId: recording.shareId,
          code,
          from,
          receivedAt: now,
          expiresAt: Date.parse(opened.expiresAt),
          total: recording.total,
          recordedMs: typeof recording.recordedMs === 'number' ? recording.recordedMs : undefined,
          groupId: opened.shareId,
          download: 'waiting',
          bytes: recording.bytes,
        },
      });
      const sport = senderSport(recording.sport);
      if (sport !== undefined) repo.setBallSport(session.id, sport);
    }
    void receiveQueue.run(session.id);
  });
  diag(`recebidas: link de grupo aberto (${count} gravacoes, ${opened.total} clipes)`);
  return { ok: true, kind: 'group', count, from };
}

/** Baixar on a received recording (and Continuar after Pausar). */
export function startDownload(sessionId: string): void {
  const session = repo.getSession(sessionId);
  const received = session ? session.received : undefined;
  if (received !== undefined && received.groupId !== undefined && received.download === 'waiting') {
    const group = repo.receivedSessions().filter((s) => s.received !== undefined && s.received.groupId === received.groupId);
    const position = [...group].sort((a, b) => b.startedAt - a.startedAt).findIndex((s) => s.id === sessionId) + 1;
    track('share_group_download', { position, recordings: recordingsBucket(group.length) });
  }
  receiveQueue.setDownload(sessionId, 'on');
}

/** Starts what is missing at launch and on every return to the front. Returns the cleanup. */
export function startReceiveQueue(): () => void {
  const sub = AppState.addEventListener('change', (next) => {
    receiveQueue.setForeground(next === 'active');
    if (next === 'active') receiveQueue.sync();
  });
  const events = [
    addReplayListener('onDownloadDone', (e) => receiveQueue.handleDone(e)),
    addReplayListener('onDownloadRetry', (e) => diag(`recebidas: nova tentativa ${e.attempt + 1} (${e.error})`)),
  ];
  // A recording starts or ends (or the phone gets too hot): the downloads pause and start again, as uploads do.
  const hold = onUploadHold((held) => receiveQueue.setHold(held));
  receiveQueue.setHold(uploadHeld());
  receiveQueue.sync();
  return () => {
    sub.remove();
    events.forEach((e) => e.remove());
    hold();
  };
}

const NONE: ReceiveProgress = {
  done: 0,
  total: 0,
  downloading: false,
  paused: false,
  state: 'active',
  slots: [],
  running: [],
  download: 'on',
  bytes: 0,
  thumbs: {},
};
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
