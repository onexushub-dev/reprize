import type { Session, SessionReceived } from '../../data/schema';
import { receiveShare, startDownload } from '../receive';

jest.mock('@supabase/supabase-js', () => ({ FunctionsHttpError: class FunctionsHttpError extends Error {} }));
const mockInvoke = jest.fn();
jest.mock('../../account/supabase', () => ({ supabase: () => ({ functions: { invoke: mockInvoke } }) }));
jest.mock('../../../modules/replay-camera', () => ({
  addReplayListener: jest.fn(() => ({ remove: jest.fn() })),
  downloadState: jest.fn(() => []),
  downloadsAvailable: jest.fn(() => false),
  pauseDownloads: jest.fn(),
  removeDownloads: jest.fn(),
  resumeDownloads: jest.fn(),
  startDownloads: jest.fn(),
}));
jest.mock('../../analytics', () => ({ track: jest.fn() }));
jest.mock('../../diag/diagLog', () => ({ diag: jest.fn() }));
jest.mock('../shareAcquisition', () => ({ markCameByShare: jest.fn() }));
jest.mock('../../data/mmkv', () => {
  const store = new Map<string, string>();
  let sessions: Session[] = [];
  return {
    __reset: () => {
      sessions = [];
      store.clear();
    },
    kv: { getString: (k: string) => store.get(k), set: (k: string, v: string) => store.set(k, v), delete: (k: string) => store.delete(k) },
    removeFile: jest.fn(),
    repo: {
      getPrefs: () => ({ sport: 'quadra' }),
      listSessions: () => sessions.map((session) => ({ session, clips: 0 })),
      receivedSessions: () => sessions.filter((s) => s.received !== undefined),
      receivedSession: (shareId: string) => sessions.find((s) => s.received !== undefined && s.received.shareId === shareId),
      getSession: (id: string) => sessions.find((s) => s.id === id),
      listClips: () => [],
      startReceivedSession: jest.fn((input: { sport: string; name?: string; received: SessionReceived; now: number }) => {
        const session = { id: `s${sessions.length + 1}`, sport: input.sport, startedAt: input.now, endedAt: input.now, name: input.name, received: input.received } as Session;
        sessions.push(session);
        return session;
      }),
      setReceivedDownload: jest.fn((id: string, download: SessionReceived['download']) => {
        sessions = sessions.map((s) => (s.id === id && s.received ? { ...s, received: { ...s.received, download } } : s));
      }),
      addReceivedClip: jest.fn(),
      deleteClip: jest.fn(),
      setBallSport: jest.fn(),
    },
  };
});

const { repo, __reset } = jest.requireMock('../../data/mmkv');
const { track } = jest.requireMock('../../analytics');

const GROUP = {
  state: 'active',
  kind: 'group',
  shareId: 'g1',
  from: 'Ana',
  expiresAt: '2026-11-23T20:00:00.000Z',
  total: 9,
  recordings: [
    { shareId: 'r1', title: 'Jogo 1', sport: null, total: 4, bytes: 200_000_000, recordedMs: 600_000 },
    { shareId: 'r2', title: null, sport: null, total: 5, bytes: 300_000_000, recordedMs: null },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  __reset();
});

test('a group link makes one received recording per recording, none downloading, the first on top of the list', async () => {
  mockInvoke.mockResolvedValue({ data: GROUP, error: null });
  await expect(receiveShare('abc')).resolves.toEqual({ ok: true, kind: 'group', count: 2, from: 'Ana' });
  // The app says it reads group links.
  expect(mockInvoke).toHaveBeenCalledWith('open-share', { body: expect.objectContaining({ code: 'abc', groups: true }) });
  const made = repo.startReceivedSession.mock.calls.map((c: [{ name?: string; now: number; received: SessionReceived }]) => c[0]);
  expect(made.map((m: { name?: string }) => m.name)).toEqual(['Jogo 1', undefined]);
  expect(made[0].now).toBeGreaterThan(made[1].now);
  expect(made[0].received).toMatchObject({
    shareId: 'r1',
    code: 'abc',
    from: 'Ana',
    total: 4,
    recordedMs: 600_000,
    groupId: 'g1',
    download: 'waiting',
    bytes: 200_000_000,
  });
  expect(track).toHaveBeenCalledWith('share_received', { clips: '6-20', new_user: true, recordings: '2-3' });
});

test('opened again, the same recordings are found, not made twice', async () => {
  mockInvoke.mockResolvedValue({ data: GROUP, error: null });
  await receiveShare('abc');
  await receiveShare('abc');
  expect(repo.startReceivedSession).toHaveBeenCalledTimes(2);
  expect(track.mock.calls.filter((c: string[]) => c[0] === 'share_received')).toHaveLength(1);
});

test("Baixar on a group's recording says which place of the link was chosen", async () => {
  mockInvoke.mockResolvedValue({ data: GROUP, error: null });
  await receiveShare('abc');
  startDownload('s2');
  expect(track).toHaveBeenCalledWith('share_group_download', { position: 2, recordings: '2-3' });
  expect(repo.setReceivedDownload).toHaveBeenCalledWith('s2', 'on');
});

test("each recording takes the sender's sport, so Jogadores and Bola work on it as on one's own (2026-11-22)", async () => {
  const withSport = { ...GROUP, recordings: [{ ...GROUP.recordings[0], sport: 'beachTennis' }, { ...GROUP.recordings[1], sport: 'nada' }] };
  mockInvoke.mockResolvedValue({ data: withSport, error: null });
  await receiveShare('abc');
  expect(repo.setBallSport).toHaveBeenCalledTimes(1);
  expect(repo.setBallSport).toHaveBeenCalledWith('s1', { v: 1, verdict: 'allow', sport: 'beachTennis' });
});
