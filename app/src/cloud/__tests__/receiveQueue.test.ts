import type { DownloadEntry, DownloadItem } from '../../../modules/replay-camera/src/ReplayCamera.types';
import type { Clip, Session } from '../../data/schema';
import type { OpenedClip } from '../receivedClip';
import { createReceiveQueue, downloadId, type OpenResult } from '../receiveQueue';

const clip = (position: number, ready = true): OpenedClip => ({
  position,
  bytes: 10,
  durationMs: 30000,
  edit: { number: position },
  ready,
  video: ready ? `u/${position}.mp4` : undefined,
  focus: ready && position === 1 ? `u/${position}.focus.json` : undefined,
});

const active = (clips: OpenedClip[]): OpenResult => ({
  state: 'active',
  shareId: 'sh',
  kind: 'recording',
  title: null,
  sport: null,
  from: 'Ana',
  expiresAt: 'x',
  total: 3,
  clips,
});

/** A stand-in for the system's background downloads: files stay `running` until the test finishes them. */
function fakeNative() {
  const files = new Map<string, DownloadEntry>();
  const native = {
    available: () => true,
    start: jest.fn((items: DownloadItem[], paused: boolean) => {
      for (const i of items) {
        files.set(i.id, { id: i.id, url: i.url, path: i.path, status: paused ? 'paused' : 'running', bytes: 0, received: 0, attempts: 0, queuedAt: 0 });
      }
    }),
    state: () => [...files.values()],
    pause: jest.fn(() => {
      for (const e of files.values()) if (e.status === 'running') e.status = 'paused';
    }),
    resume: jest.fn(() => {
      for (const e of files.values()) if (e.status === 'paused') e.status = 'running';
    }),
    remove: jest.fn((ids: string[]) => ids.forEach((id) => files.delete(id))),
  };
  const end = (position: number, kind: 'video' | 'focus' | 'ball', ok = true) => {
    const id = downloadId('sh', position, kind);
    const entry = files.get(id);
    if (entry !== undefined) entry.status = ok ? 'done' : 'failed';
    return { id, ok };
  };
  return { native, files, end };
}

function setup(options: { opened?: OpenResult; now?: number } = {}) {
  const session: Session = {
    id: 's1',
    sport: 'quadra',
    startedAt: 0,
    endedAt: 0,
    received: { shareId: 'sh', code: 'c', receivedAt: 0, expiresAt: 10_000, total: 3 },
  };
  const clips: Clip[] = [];
  let opened: OpenResult = options.opened || active([clip(1), clip(2), clip(3, false)]);
  const later: (() => void)[] = [];
  const stored = new Map<string, OpenedClip[]>();
  const { native, files, end } = fakeNative();
  const downloaded = jest.fn();
  const open = jest.fn(async () => opened);
  const queue = createReceiveQueue({
    repo: {
      receivedSessions: () => [session],
      getSession: (id) => (id === 's1' ? session : undefined),
      listClips: () => clips,
      addReceivedClip: (input) => {
        const made = { ...input, id: `k${clips.length}` };
        clips.push(made);
        return made;
      },
    },
    open,
    native,
    meta: { get: (id) => stored.get(id), set: (id, value) => void stored.set(id, value) },
    paths: (_shareId, position) => ({ video: `/r/${position}.mp4`, focus: `/r/${position}.focus.json`, ball: `/r/${position}.ball.json` }),
    now: () => (options.now === undefined ? 1000 : options.now),
    later: (fn) => {
      later.push(fn);
      return () => {};
    },
    log: () => {},
    downloaded,
  });
  return { queue, clips, native, files, end, later, open, stored, downloaded, setOpened: (o: OpenResult) => (opened = o) };
}

test('the uploaded clips and their framing files are queued at once; the rest is asked for again later', async () => {
  const { queue, native, later, stored } = setup();
  await queue.run('s1');
  expect(native.start).toHaveBeenCalledWith(
    [
      { id: 'recv/sh/1/video', url: 'u/1.mp4', path: '/r/1.mp4' },
      { id: 'recv/sh/1/focus', url: 'u/1.focus.json', path: '/r/1.focus.json' },
      { id: 'recv/sh/2/video', url: 'u/2.mp4', path: '/r/2.mp4' },
    ],
    false,
  );
  // The edit data is kept without the URLs (they expire; the files are on their way already).
  expect(stored.get('sh')!.map((c) => [c.position, c.video])).toEqual([
    [1, undefined],
    [2, undefined],
    [3, undefined],
  ]);
  expect(queue.progress('s1')).toMatchObject({ done: 0, total: 3, downloading: true, paused: false });
  expect(later).toHaveLength(1);
});

test('the progress lists every place of the share with its number, and which videos are downloading (2026-11-21)', async () => {
  const { queue } = setup({ opened: active([clip(3, false), clip(1), clip(2)]) });
  await queue.run('s1');
  const progress = queue.progress('s1');
  expect(progress.slots).toEqual([
    { position: 1, number: 1 },
    { position: 2, number: 2 },
    { position: 3, number: 3 },
  ]);
  expect(progress.running.sort()).toEqual([1, 2]);
});

test('a clip joins the recording once its video and its framing file have arrived', async () => {
  const { queue, clips, end, native } = setup();
  await queue.run('s1');
  queue.handleDone(end(1, 'video'));
  expect(clips).toHaveLength(0); // its framing file is still coming down
  queue.handleDone(end(1, 'focus'));
  queue.handleDone(end(2, 'video'));
  expect(clips.map((c) => [c.sharePosition, c.path, c.focus ? c.focus.file : undefined])).toEqual([
    [1, '/r/1.mp4', '/r/1.focus.json'],
    [2, '/r/2.mp4', undefined],
  ]);
  expect(native.remove).toHaveBeenCalledWith(['recv/sh/1/video', 'recv/sh/1/focus', 'recv/sh/1/ball']);
  expect(queue.progress('s1')).toMatchObject({ done: 2, downloading: false });
});

test('a failed framing file does not hold the clip back; a failed video is asked for again with a fresh URL', async () => {
  const { queue, clips, end, native } = setup();
  await queue.run('s1');
  queue.handleDone(end(1, 'video'));
  queue.handleDone(end(1, 'focus', false));
  queue.handleDone(end(2, 'video', false));
  expect(clips.map((c) => [c.sharePosition, c.focus])).toEqual([[1, undefined]]);
  native.start.mockClear();
  await queue.run('s1');
  expect(native.start).toHaveBeenCalledWith([{ id: 'recv/sh/2/video', url: 'u/2.mp4', path: '/r/2.mp4' }], false);
});

test('files on their way are not queued twice', async () => {
  const { queue, native } = setup();
  await queue.run('s1');
  native.start.mockClear();
  await queue.run('s1');
  expect(native.start).not.toHaveBeenCalled();
});

test('files that arrived while the app was closed become clips without the network', async () => {
  const { queue, clips, end, open, setOpened } = setup();
  await queue.run('s1');
  end(1, 'video');
  end(1, 'focus');
  setOpened({ state: 'error' }); // offline now
  open.mockClear();
  await queue.run('s1');
  expect(clips.map((c) => c.sharePosition)).toEqual([1]);
});

test('nothing downloads while a recording is on; the downloads pause and start again when it ends', async () => {
  const { queue, native, files } = setup();
  await queue.run('s1');
  queue.setHold(true);
  expect(native.pause).toHaveBeenCalledTimes(1);
  expect(queue.progress('s1')).toMatchObject({ paused: true, downloading: false });
  queue.setHold(false);
  expect(native.resume).toHaveBeenCalledTimes(1);
  expect([...files.values()].every((e) => e.status === 'running')).toBe(true);
  expect(queue.progress('s1')).toMatchObject({ paused: false, downloading: true });
});

test('a link opened during a recording is queued paused', async () => {
  const { queue, native } = setup();
  queue.setHold(true);
  await queue.run('s1');
  expect(native.start).toHaveBeenCalledWith(expect.any(Array), true);
});

test('an expired link downloads nothing and says so', async () => {
  const { queue, open, native } = setup({ now: 20_000 });
  await queue.run('s1');
  expect(open).not.toHaveBeenCalled();
  expect(native.start).not.toHaveBeenCalled();
  expect(queue.progress('s1').state).toBe('expired');
});

test('a link turned off is reported', async () => {
  const { queue, native } = setup({ opened: { state: 'off' } });
  await queue.run('s1');
  expect(native.start).not.toHaveBeenCalled();
  expect(queue.progress('s1').state).toBe('off');
});

test('the last clip on the phone is reported once, as the whole recording downloaded', async () => {
  const { queue, end, setOpened, downloaded } = setup();
  await queue.run('s1');
  setOpened(active([clip(1), clip(2), clip(3)]));
  await queue.run('s1');
  queue.handleDone(end(1, 'video'));
  queue.handleDone(end(1, 'focus'));
  queue.handleDone(end(2, 'video'));
  expect(downloaded).not.toHaveBeenCalled();
  queue.handleDone(end(3, 'video'));
  expect(downloaded).toHaveBeenCalledTimes(1);
  await queue.run('s1');
  expect(downloaded).toHaveBeenCalledTimes(1);
});

test('files of a recording deleted on this phone are dropped', () => {
  const { queue, native, files } = setup();
  files.set('recv/gone/1/video', { id: 'recv/gone/1/video', url: 'u', path: '/p', status: 'running', bytes: 0, received: 0, attempts: 0, queuedAt: 0 });
  queue.sync();
  expect(native.remove).toHaveBeenCalledWith(['recv/gone/1/video']);
});
