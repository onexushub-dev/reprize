import type { Clip, Session } from '../../data/schema';
import { liveGroupFor, liveGroupOf, shareRecordings, turnOffGroupShare } from '../shareGroup';
import { MAX_GROUP_CLIPS, shareablePick } from '../sharePick';
import { shareGroup } from '../shareGroups';
import { uploadPlan } from '../uploadPlan';

jest.mock('../../data/mmkv', () => {
  const store = new Map<string, string>();
  return {
    kv: {
      getString: (key: string) => store.get(key),
      set: (key: string, value: string) => store.set(key, value),
      delete: (key: string) => store.delete(key),
      clearAll: () => store.clear(),
    },
    files: { exists: (path: string) => path.endsWith('.mp4'), sizeBytes: () => 1000 },
    repo: { getSession: jest.fn(), listClips: jest.fn(), sessionStats: jest.fn(() => ({ recordedMs: 60_000 })), setShared: jest.fn() },
  };
});
jest.mock('../shares', () => ({ createShareGroup: jest.fn(), turnOffShare: jest.fn(), createShare: jest.fn() }));
jest.mock('../appUploadQueue', () => ({ uploadQueue: { setManualPause: jest.fn(), sync: jest.fn(), forget: jest.fn() } }));
jest.mock('../appSharePrep', () => ({ sharePrep: { run: jest.fn() } }));
jest.mock('../../analytics', () => ({ track: jest.fn() }));

const { kv, repo } = jest.requireMock('../../data/mmkv');
const { createShareGroup, turnOffShare } = jest.requireMock('../shares');
const { uploadQueue } = jest.requireMock('../appUploadQueue');
const { track } = jest.requireMock('../../analytics');

const NOW = Date.parse('2026-11-22T20:00:00Z');
const EXPIRES = '2026-11-23T20:00:00.000Z';

const session = (id: string, startedAt: number, over: Partial<Session> = {}): Session => ({
  id,
  sport: 'outro',
  startedAt,
  endedAt: startedAt + 1,
  ...over,
});
const clipOf = (sessionId: string, n: number): Clip =>
  ({ id: `${sessionId}-c${n}`, sessionId, createdAt: n, source: 'screen', path: `/${sessionId}/${n}.mp4`, durationMs: 15_000, trim: { startMs: 0, endMs: 15_000 } }) as Clip;

let sessions: Record<string, Session>;
const clips: Record<string, Clip[]> = { a: [clipOf('a', 1), clipOf('a', 2)], b: [clipOf('b', 1)] };

const upload = (share: string, file: string, kind: string, position: number | null) => ({
  key: `shares/${share}/${file}`,
  kind,
  position,
  url: `https://r2/${share}/${file}`,
  contentType: 'x',
});
const CREATED = {
  shareId: 'g1',
  code: 'abc',
  url: 'https://reprizeapp.com/v/abc',
  expiresAt: EXPIRES,
  cover: [upload('g1', 'cover.jpg', 'coverImage', null), upload('g1', 'cover.mp4', 'cover', null)],
  recordings: [
    { shareId: 'ra', uploads: [upload('ra', 'clips/1/video.mp4', 'video', 1), upload('ra', 'clips/2/video.mp4', 'video', 2)] },
    { shareId: 'rb', uploads: [upload('rb', 'clips/1/video.mp4', 'video', 1)] },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  kv.clearAll();
  // "b" was played before "a": the link goes in the order they were played.
  sessions = { a: session('a', 2000, { name: 'Jogo 2' }), b: session('b', 1000, { name: 'Jogo 1' }) };
  repo.getSession.mockImplementation((id: string) => sessions[id]);
  repo.listClips.mockImplementation((id: string) => clips[id] || []);
  repo.setShared.mockImplementation((id: string, shared: Session['shared']) => {
    sessions[id] = { ...sessions[id], shared };
  });
  createShareGroup.mockResolvedValue({ ok: true, group: CREATED });
  turnOffShare.mockResolvedValue(true);
});

describe('shareablePick', () => {
  const picked = (id: string, count: number, over: Partial<Session> = {}) => ({ session: session(id, 0, over), clips: count });

  test('1 to 10 own ended recordings with clips can go in one link', () => {
    expect(shareablePick([picked('a', 3)])).toEqual({ ok: true });
    expect(shareablePick(Array.from({ length: 10 }, (_, i) => picked(`s${i}`, 2)))).toEqual({ ok: true });
  });

  test('each refusal says why', () => {
    const received = { shareId: 'x', code: 'c', receivedAt: 0, expiresAt: 1, total: 1 };
    expect(shareablePick([])).toEqual({ ok: false, reason: 'none' });
    expect(shareablePick(Array.from({ length: 11 }, (_, i) => picked(`s${i}`, 1)))).toEqual({ ok: false, reason: 'tooMany' });
    expect(shareablePick([picked('a', 2), picked('b', 2, { received })])).toEqual({ ok: false, reason: 'received' });
    expect(shareablePick([picked('a', 2), picked('b', 0)])).toEqual({ ok: false, reason: 'empty' });
    expect(shareablePick([picked('a', 2), picked('b', 2, { endedAt: undefined })])).toEqual({ ok: false, reason: 'empty' });
    expect(shareablePick([picked('a', MAX_GROUP_CLIPS), picked('b', 1)])).toEqual({ ok: false, reason: 'tooManyClips' });
  });
});

describe('shareRecordings', () => {
  test('one request for every recording, in the order they were played, none with a cover of its own', async () => {
    const result = await shareRecordings(['a', 'b'], () => NOW);
    expect(result.ok).toBe(true);
    expect(createShareGroup).toHaveBeenCalledTimes(1);
    const body = createShareGroup.mock.calls[0][0];
    expect(body.kind).toBe('group');
    expect(body.recordings.map((r: { title: string }) => r.title)).toEqual(['Jogo 1', 'Jogo 2']);
    expect(body.recordings.every((r: { cover: boolean }) => r.cover === false)).toBe(true);
    expect(body.recordings.map((r: { clips: unknown[] }) => r.clips.length)).toEqual([1, 2]);
  });

  test('each recording keeps its own share under the group link, with its own plan; the group keeps the cover', async () => {
    createShareGroup.mockResolvedValue({
      ok: true,
      group: { ...CREATED, recordings: [{ shareId: 'rb', uploads: CREATED.recordings[1].uploads }, { shareId: 'ra', uploads: CREATED.recordings[0].uploads }] },
    });
    await shareRecordings(['a', 'b'], () => NOW);
    expect(sessions.b.shared).toEqual({
      shareId: 'rb',
      url: 'https://reprizeapp.com/v/abc',
      createdAt: NOW,
      expiresAt: Date.parse(EXPIRES),
      clips: 1,
      state: 'active',
      groupId: 'g1',
    });
    expect(sessions.a.shared).toMatchObject({ shareId: 'ra', groupId: 'g1', clips: 2 });

    const planB = uploadPlan('rb');
    expect(planB).toMatchObject({ expiresAt: Date.parse(EXPIRES), group: { id: 'g1', position: 1, count: 2 } });
    expect(planB!.items.map((i) => [i.id, i.path])).toEqual([['shares/rb/clips/1/video.mp4', '/b/1.mp4']]);
    expect(uploadPlan('ra')).toMatchObject({ group: { id: 'g1', position: 2, count: 2 } });
    // The cover waits for the file the sheet makes.
    const cover = uploadPlan('g1');
    expect(cover).toMatchObject({ group: { id: 'g1', position: 0, count: 2 } });
    expect(cover!.items.map((i) => [i.id, i.path])).toEqual([
      ['shares/g1/cover.jpg', ''],
      ['shares/g1/cover.mp4', ''],
    ]);

    expect(shareGroup('g1')).toEqual({
      groupId: 'g1',
      url: 'https://reprizeapp.com/v/abc',
      createdAt: NOW,
      expiresAt: Date.parse(EXPIRES),
      recordings: [
        { sessionId: 'b', shareId: 'rb', clips: 1 },
        { sessionId: 'a', shareId: 'ra', clips: 2 },
      ],
      state: 'active',
    });
    expect(uploadQueue.setManualPause).toHaveBeenCalledWith(false);
    expect(uploadQueue.sync).toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('share_created', { clips: '2-5', wait: '<2s', recordings: '2-3', picked: 'no' });
  });

  test('the live link of exactly these recordings is shown again instead of a new one', async () => {
    await shareRecordings(['a', 'b'], () => NOW);
    createShareGroup.mockClear();
    const again = await shareRecordings(['b', 'a'], () => NOW + 60_000);
    expect(again).toMatchObject({ ok: true, group: { groupId: 'g1' } });
    expect(createShareGroup).not.toHaveBeenCalled();
    expect(liveGroupFor(['a'], NOW)).toBeUndefined();
    expect(liveGroupOf('a', NOW)).toMatchObject({ groupId: 'g1' });
    // Five minutes from the end it is no longer offered again; a recording shared alone since then leaves it too.
    expect(liveGroupFor(['a', 'b'], Date.parse(EXPIRES) - 60_000)).toBeUndefined();
    sessions.a = { ...sessions.a, shared: { ...sessions.a.shared!, groupId: undefined, shareId: 'solo' } };
    expect(liveGroupFor(['a', 'b'], NOW)).toBeUndefined();
  });

  test('a refusal is passed on and nothing is kept', async () => {
    createShareGroup.mockResolvedValue({ ok: false, reason: 'not_pro' });
    await expect(shareRecordings(['a', 'b'], () => NOW)).resolves.toEqual({ ok: false, reason: 'not_pro' });
    expect(repo.setShared).not.toHaveBeenCalled();
    expect(shareGroup('g1')).toBeUndefined();
    expect(track).toHaveBeenCalledWith('share_failed', { reason: 'not_pro' });
  });

  test('a received recording or one recording alone never makes a group', async () => {
    await expect(shareRecordings(['a'], () => NOW)).resolves.toEqual({ ok: false, reason: 'failed' });
    sessions.b = { ...sessions.b, received: { shareId: 'x', code: 'c', receivedAt: 0, expiresAt: 1, total: 1 } };
    await expect(shareRecordings(['a', 'b'], () => NOW)).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(createShareGroup).not.toHaveBeenCalled();
  });
});

test('Encerrar compartilhamento turns off the group with every recording and forgets their uploads', async () => {
  await shareRecordings(['a', 'b'], () => NOW);
  await expect(turnOffGroupShare('g1')).resolves.toBe(true);
  expect(turnOffShare).toHaveBeenCalledWith('g1');
  expect(uploadQueue.forget.mock.calls.map((c: string[]) => c[0]).sort()).toEqual(['g1', 'ra', 'rb']);
  expect(sessions.a.shared).toMatchObject({ state: 'off', groupId: 'g1' });
  expect(sessions.b.shared).toMatchObject({ state: 'off' });
  expect(shareGroup('g1')).toMatchObject({ state: 'off' });
  expect(liveGroupOf('a', NOW)).toBeUndefined();
});

test('a group the server could not turn off stays on', async () => {
  await shareRecordings(['a', 'b'], () => NOW);
  turnOffShare.mockResolvedValue(false);
  await expect(turnOffGroupShare('g1')).resolves.toBe(false);
  expect(uploadQueue.forget).not.toHaveBeenCalled();
  expect(shareGroup('g1')).toMatchObject({ state: 'active' });
});
