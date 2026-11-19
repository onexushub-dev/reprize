import type { Clip, Session } from '../../data/schema';
import type { OpenedClip } from '../receivedClip';
import { createReceiveQueue, type OpenResult } from '../receiveQueue';

const clip = (position: number, ready = true): OpenedClip => ({
  position,
  bytes: 10,
  durationMs: 30000,
  edit: { number: position },
  ready,
  video: ready ? `u/${position}.mp4` : undefined,
  focus: ready && position === 1 ? `u/${position}.focus.json` : undefined,
});

function setup(options: { opened?: OpenResult; failVideo?: number; now?: number } = {}) {
  const session: Session = {
    id: 's1',
    sport: 'quadra',
    startedAt: 0,
    endedAt: 0,
    received: { shareId: 'sh', code: 'c', receivedAt: 0, expiresAt: 10_000, total: 3 },
  };
  const clips: Clip[] = [];
  let opened: OpenResult = options.opened || {
    state: 'active',
    shareId: 'sh',
    kind: 'recording',
    title: null,
    sport: null,
    from: 'Ana',
    expiresAt: 'x',
    total: 3,
    clips: [clip(1), clip(2), clip(3, false)],
  };
  const later: (() => void)[] = [];
  const download = jest.fn(async (url: string) => !(options.failVideo !== undefined && url === `u/${options.failVideo}.mp4`));
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
    open: jest.fn(async () => opened),
    download,
    paths: (_shareId, position) => ({ video: `/r/${position}.mp4`, focus: `/r/${position}.focus.json`, ball: `/r/${position}.ball.json` }),
    now: () => (options.now === undefined ? 1000 : options.now),
    later: (fn) => {
      later.push(fn);
      return () => {};
    },
    log: () => {},
  });
  return { queue, clips, download, later, setOpened: (o: OpenResult) => (opened = o) };
}

test('the uploaded clips download with their framing; the rest is asked for again later', async () => {
  const { queue, clips, download, later } = setup();
  await queue.run('s1');
  expect(clips.map((c) => [c.sharePosition, c.path, c.focus ? c.focus.file : undefined])).toEqual([
    [1, '/r/1.mp4', '/r/1.focus.json'],
    [2, '/r/2.mp4', undefined],
  ]);
  expect(download).toHaveBeenCalledTimes(3);
  expect(queue.progress('s1')).toMatchObject({ done: 2, total: 3, downloading: false, state: 'active' });
  expect(later).toHaveLength(1);
});

test('a clip already on the phone is not downloaded again', async () => {
  const { queue, download, setOpened } = setup();
  await queue.run('s1');
  setOpened({
    state: 'active',
    shareId: 'sh',
    kind: 'recording',
    title: null,
    sport: null,
    from: null,
    expiresAt: 'x',
    total: 3,
    clips: [clip(1), clip(2), clip(3)],
  });
  download.mockClear();
  await queue.run('s1');
  expect(download.mock.calls.map((c) => c[0])).toEqual(['u/3.mp4']);
  expect(queue.progress('s1')).toMatchObject({ done: 3, total: 3 });
});

test('a failed video is not stored as a clip', async () => {
  const { queue, clips } = setup({ failVideo: 2 });
  await queue.run('s1');
  expect(clips.map((c) => c.sharePosition)).toEqual([1]);
});

test('an expired link downloads nothing and says so', async () => {
  const { queue, download } = setup({ now: 20_000 });
  await queue.run('s1');
  expect(download).not.toHaveBeenCalled();
  expect(queue.progress('s1').state).toBe('expired');
});

test('a link turned off is reported', async () => {
  const { queue } = setup({ opened: { state: 'off' } });
  await queue.run('s1');
  expect(queue.progress('s1').state).toBe('off');
});

test('asking the server again without anything new to download does not show as downloading', async () => {
  const { queue, setOpened } = setup();
  await queue.run('s1');
  setOpened({ state: 'active', shareId: 'sh', kind: 'recording', title: null, sport: null, from: null, expiresAt: 'x', total: 3, clips: [clip(1), clip(2), clip(3, false)] });
  const seen: boolean[] = [];
  const stop = queue.subscribe(() => seen.push(queue.progress('s1').downloading));
  await queue.run('s1');
  stop();
  expect(seen.every((d) => d === false)).toBe(true);
});
