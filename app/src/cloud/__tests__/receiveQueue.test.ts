import type { DownloadEntry, DownloadItem } from '../../../modules/replay-camera/src/ReplayCamera.types';
import type { Clip, Session, SessionReceived } from '../../data/schema';
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

function setup(options: { opened?: OpenResult; now?: number; received?: Partial<SessionReceived>; others?: Session[] } = {}) {
  const session: Session = {
    id: 's1',
    sport: 'quadra',
    startedAt: 0,
    endedAt: 0,
    received: { shareId: 'sh', code: 'c', receivedAt: 0, expiresAt: 10_000, total: 3, ...options.received },
  };
  const clips: Clip[] = [];
  let opened: OpenResult = options.opened || active([clip(1), clip(2), clip(3, false)]);
  const later: (() => void)[] = [];
  const stored = new Map<string, OpenedClip[]>();
  const { native, files, end } = fakeNative();
  const downloaded = jest.fn();
  const removeFile = jest.fn();
  const removeShareFiles = jest.fn();
  // Other received recordings (of the same group link, say): no clips of their own.
  let sessions: Session[] = [session, ...(options.others || [])];
  const byId = (id: string) => sessions.find((s) => s.id === id);
  const open = jest.fn(async (_code: string, _shareId?: string) => opened);
  const queue = createReceiveQueue({
    repo: {
      receivedSessions: () => sessions,
      getSession: (id) => byId(id),
      listClips: (id) => (id === 's1' ? clips : []),
      addReceivedClip: (input) => {
        const made = { ...input, id: `k${clips.length}` };
        clips.push(made);
        return made;
      },
      setReceivedDownload: (id, download) => {
        const s = byId(id)!;
        s.received = { ...s.received!, download };
      },
      setReceivedEnded: (id, ended) => {
        const s = byId(id)!;
        s.received = { ...s.received!, ended };
      },
      deleteSession: (id) => {
        sessions = sessions.filter((s) => s.id !== id);
        return [];
      },
      deleteClip: (id) => {
        const at = clips.findIndex((c) => c.id === id);
        if (at >= 0) clips.splice(at, 1);
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
    removeFile,
    removeShareFiles,
    downloaded,
  });
  return {
    queue,
    session,
    clips,
    native,
    files,
    end,
    later,
    open,
    stored,
    downloaded,
    removeFile,
    removeShareFiles,
    sessions: () => sessions,
    setOpened: (o: OpenResult) => (opened = o),
  };
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
  expect(native.remove).toHaveBeenCalledWith(['recv/sh/1/video', 'recv/sh/1/focus', 'recv/sh/1/ball', 'recv/sh/1/thumb']);
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
  // On screen: kept, saying why (closed, with nothing on the phone, it would leave: see "a link that is over").
  queue.opened('s1');
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

describe('the person chooses (multi-recording share design §5.4)', () => {
  const withThumb = (c: OpenedClip): OpenedClip => ({ ...c, thumb: `u/${c.position}.jpg` });

  test("a group's recording waits for Baixar: only the clips' stills come down, and it is opened with the group's code", async () => {
    const { queue, native, open, later } = setup({
      opened: active([withThumb(clip(1)), withThumb(clip(2)), clip(3, false)]),
      received: { download: 'waiting', groupId: 'g1', bytes: 320_000_000 },
    });
    await queue.run('s1');
    expect(open).toHaveBeenCalledWith('c', 'sh');
    expect(native.start).toHaveBeenCalledWith(
      [
        { id: 'recv/sh/1/thumb', url: 'u/1.jpg', path: '/r/1.thumb.jpg' },
        { id: 'recv/sh/2/thumb', url: 'u/2.jpg', path: '/r/2.thumb.jpg' },
      ],
      false,
    );
    // Nothing to wait for: the sender's upload matters only once it downloads.
    expect(later).toHaveLength(0);
    expect(queue.progress('s1')).toMatchObject({ download: 'waiting', bytes: 320_000_000, downloading: false, thumbs: {} });
  });

  test('a still that arrived shows on its place, and the downloader forgets it', async () => {
    const { queue, native } = setup({ opened: active([withThumb(clip(1))]), received: { download: 'waiting' } });
    await queue.run('s1');
    queue.handleDone({ id: 'recv/sh/1/thumb', ok: true });
    expect(native.remove).toHaveBeenLastCalledWith(['recv/sh/1/thumb']);
    expect(queue.progress('s1').thumbs).toEqual({ 1: 'file:///r/1.thumb.jpg' });
  });

  test('once its clips are listed, a recording not downloading asks the server nothing more', async () => {
    const { queue, open } = setup({ received: { download: 'waiting' } });
    await queue.run('s1');
    await queue.run('s1');
    queue.sync();
    expect(open).toHaveBeenCalledTimes(1);
  });

  test('Baixar asks for the clips; Pausar stops the files on their way and keeps what arrived; Continuar asks again', async () => {
    const { queue, native, files, end, clips, open } = setup({ received: { download: 'waiting' } });
    await queue.run('s1');
    queue.setDownload('s1', 'on');
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(open).toHaveBeenCalledTimes(2);
    expect(files.has('recv/sh/1/video')).toBe(true);
    expect(queue.progress('s1')).toMatchObject({ download: 'on', downloading: true });

    end(1, 'video');
    end(1, 'focus');
    queue.setDownload('s1', 'paused');
    // Clip 1 had arrived: it joined the recording before the rest stopped.
    expect(clips.map((c) => c.sharePosition)).toEqual([1]);
    expect(files.has('recv/sh/2/video')).toBe(false);
    expect(queue.progress('s1')).toMatchObject({ download: 'paused', downloading: false, paused: false, done: 1 });

    native.start.mockClear();
    queue.setDownload('s1', 'on');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(native.start).toHaveBeenCalledWith([{ id: 'recv/sh/2/video', url: 'u/2.mp4', path: '/r/2.mp4' }], false);
  });

  test('Cancelar stops the download and takes the clips already here off the phone; the recording waits again', async () => {
    const { queue, session, end, clips, files, removeFile } = setup();
    await queue.run('s1');
    queue.handleDone(end(2, 'video'));
    expect(clips).toHaveLength(1);
    queue.cancel('s1');
    expect(clips).toHaveLength(0);
    expect(removeFile).toHaveBeenCalledWith('/r/2.mp4');
    expect([...files.keys()].filter((id) => !id.endsWith('/thumb'))).toEqual([]);
    expect(session.received!.download).toBe('waiting');
    expect(queue.progress('s1')).toMatchObject({ download: 'waiting', done: 0 });
  });

  test('a group answer where a recording was expected downloads nothing', async () => {
    const { queue, native } = setup({
      opened: { state: 'active', kind: 'group', shareId: 'g1', from: 'Ana', expiresAt: 'x', total: 3, recordings: [] },
    });
    await queue.run('s1');
    expect(native.start).not.toHaveBeenCalled();
    expect(queue.progress('s1').state).toBe('error');
  });
});

describe('a link that is over (2026-11-22: learnt without asking on its own)', () => {
  const sibling = (id: string, shareId: string): Session => ({
    id,
    sport: 'quadra',
    startedAt: 0,
    endedAt: 0,
    received: { shareId, code: 'c', receivedAt: 0, expiresAt: 10_000, total: 2, groupId: 'g1', download: 'waiting' },
  });
  const off: OpenResult = { state: 'off' };

  test('opening a recording not downloading asks about its link once a minute per link, never on its own', async () => {
    const { queue, open } = setup({ received: { download: 'waiting', groupId: 'g1' }, others: [sibling('s2', 'sh2')] });
    // Each recording of the group answers with its own share.
    open.mockImplementation(async (_code: string, shareId?: string) => ({ ...(active([clip(1)]) as object), shareId }) as OpenResult);
    // The link opened: each recording lists its clips once.
    await queue.run('s1');
    await queue.run('s2');
    expect(open).toHaveBeenCalledTimes(2);
    // Back to the front: nothing asked.
    queue.sync();
    await flushAll();
    expect(open).toHaveBeenCalledTimes(2);
    const close = queue.opened('s1');
    await flushAll();
    expect(open).toHaveBeenCalledTimes(3);
    close();
    // The group's next recording, right after: the same link, no second call.
    queue.opened('s2')();
    await flushAll();
    expect(open).toHaveBeenCalledTimes(3);
  });

  test('turned off: every recording of the group learns it from one call; the empty ones leave the phone, not the one on screen', async () => {
    const { queue, open, sessions, removeShareFiles, setOpened } = setup({
      received: { download: 'waiting', groupId: 'g1' },
      others: [sibling('s2', 'sh2'), sibling('s3', 'sh3')],
    });
    setOpened(off);
    const close = queue.opened('s1');
    await flushAll();
    expect(open).toHaveBeenCalledTimes(1);
    expect(sessions().map((s) => s.id)).toEqual(['s1']);
    expect(removeShareFiles.mock.calls.map((c: string[]) => c[0]).sort()).toEqual(['sh2', 'sh3']);
    expect(queue.progress('s1').state).toBe('off');
    expect(sessions()[0].received!.ended).toBe('off');
    // Closed: it goes too, with nothing on the phone.
    close();
    expect(sessions()).toEqual([]);
    expect(removeShareFiles).toHaveBeenCalledWith('sh');
  });

  test('a recording with clips on the phone stays when its link is over, and is never asked about again', async () => {
    const { queue, open, end, sessions, setOpened } = setup();
    await queue.run('s1');
    queue.handleDone(end(1, 'video'));
    queue.handleDone(end(1, 'focus'));
    setOpened(off);
    await queue.run('s1');
    expect(sessions().map((s) => s.id)).toEqual(['s1']);
    expect(sessions()[0].received!.ended).toBe('off');
    open.mockClear();
    await queue.run('s1');
    queue.sync();
    await flushAll();
    expect(open).not.toHaveBeenCalled();
    expect(queue.progress('s1').state).toBe('off');
  });

  test('at launch, empty recordings of expired links leave the phone (local only)', () => {
    const { queue, open, sessions } = setup({ now: 20_000, received: { download: 'waiting' } });
    queue.sync();
    expect(sessions()).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });
});

async function flushAll() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}
