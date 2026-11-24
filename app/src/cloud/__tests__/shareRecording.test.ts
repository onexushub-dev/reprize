import { shareRecording } from '../shareRecording';

jest.mock('../../data/mmkv', () => ({
  repo: { getSession: jest.fn(), listClips: jest.fn(), sessionStats: jest.fn(() => ({ recordedMs: 60_000 })), setShared: jest.fn() },
  files: { exists: jest.fn(() => false), sizeBytes: jest.fn(() => 1000) },
}));
jest.mock('../shares', () => ({ createShare: jest.fn(), turnOffShare: jest.fn() }));
jest.mock('../appUploadQueue', () => ({ uploadQueue: { setManualPause: jest.fn(), sync: jest.fn(), forget: jest.fn() } }));
jest.mock('../appSharePrep', () => ({ sharePrep: { run: jest.fn(async () => {}) } }));
jest.mock('../uploadPlan', () => ({ saveUploadPlan: jest.fn(), setPrepJobs: jest.fn(), plannedShares: jest.fn(() => []) }));
jest.mock('../../analytics', () => ({ track: jest.fn() }));

const { repo } = jest.requireMock('../../data/mmkv');
const { createShare } = jest.requireMock('../shares');
const { track } = jest.requireMock('../../analytics');

const clip = (id: string) => ({ id, sessionId: 's1', createdAt: 1, source: 'screen', path: `/${id}.mp4`, durationMs: 10_000, trim: { startMs: 0, endMs: 10_000 } });

beforeEach(() => {
  jest.clearAllMocks();
  repo.getSession.mockReturnValue({ id: 's1', sport: 'outro', startedAt: 0, endedAt: 5, name: 'Final' });
  repo.listClips.mockReturnValue(['c1', 'c2', 'c3', 'c4', 'c5'].map(clip));
  createShare.mockResolvedValue({
    ok: true,
    share: { shareId: 'sh1', code: 'k', url: 'https://reprizeapp.com/v/k', expiresAt: new Date(10_000_000).toISOString(), uploads: [] },
  });
});

test('picked clips: only those go, in the recording order, each with the number it has there (2026-11-23)', async () => {
  const result = await shareRecording('s1', () => 1000, ['c4', 'c2']);
  expect(result.ok).toBe(true);
  const input = createShare.mock.calls[0][0];
  expect(input.kind).toBe('recording');
  expect(input.clips.map((c: { edit: { number: number } }) => c.edit.number)).toEqual([2, 4]);
  expect(repo.setShared).toHaveBeenCalledWith('s1', expect.objectContaining({ clips: 2, clipIds: ['c2', 'c4'], state: 'active' }));
  expect(track).toHaveBeenCalledWith('share_created', expect.objectContaining({ picked: 'yes' }));
});

test('picked ids that are not in the recording: no link is made', async () => {
  const result = await shareRecording('s1', () => 1000, ['zz']);
  expect(result).toEqual({ ok: false, reason: 'failed' });
  expect(createShare).not.toHaveBeenCalled();
});

test('no pick: the whole recording, as before', async () => {
  await shareRecording('s1', () => 1000);
  expect(createShare.mock.calls[0][0].clips).toHaveLength(5);
  const stored = repo.setShared.mock.calls[0][1];
  expect(stored.clips).toBe(5);
  expect(stored.clipIds).toBeUndefined();
  expect(track).toHaveBeenCalledWith('share_created', expect.objectContaining({ picked: 'no' }));
});
