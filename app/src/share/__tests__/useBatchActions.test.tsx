import { act, renderHook } from '@testing-library/react-native';

import type { Clip } from '../../data/schema';
import { forgetAllExportsForTests } from '../exportCache';
import { useBatchActions } from '../useBatchActions';

jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return true;
    }
    delete() {}
  },
  Directory: class {},
  Paths: { cache: '/cache' },
}));
const mockNative: { emit: (e: unknown) => void } = { emit: () => {} };
jest.mock('../../../modules/replay-camera', () => ({
  exportClip: jest.fn(),
  cancelExport: jest.fn(),
  concatVideos: jest.fn(),
  shareFiles: jest.fn(async () => 'shared'),
  createThumbnail: jest.fn(),
  addReplayListener: jest.fn((event: string, cb: (e: unknown) => void) => {
    if (event === 'onExportProgress') mockNative.emit = cb;
    return { remove: jest.fn() };
  }),
}));
const mockCapture = jest.fn(async () => '/o.png');
jest.mock('../OverlayCapturer', () => ({
  useOverlayCapturer: () => ({ element: null, capture: mockCapture, release: jest.fn() }),
}));
jest.mock('../clipExport', () => ({
  ...jest.requireActual('../clipExport'),
  clipShapeOf: async () => ({ width: 1080, height: 1920 }),
}));
jest.mock('../askPhotos', () => ({ askPhotos: jest.fn(async () => true) }));
jest.mock('expo-media-library', () => ({ Asset: { create: jest.fn(async () => ({})) } }));
jest.mock('../../data/mmkv', () => ({ repo: { updateClip: jest.fn() } }));
jest.mock('../../analytics', () => ({ track: jest.fn(), sessionSummary: { note: jest.fn() } }));
jest.mock('../../payments/feedback', () => ({ openPaywall: jest.fn() }));

const camera = jest.requireMock('../../../modules/replay-camera');

const clipOf = (id: string): Clip =>
  ({ id, sessionId: 's1', createdAt: 1, source: 'screen', path: `/${id}.mp4`, durationMs: 10000, trim: { startMs: 0, endMs: 10000 } }) as Clip;

beforeEach(() => {
  jest.clearAllMocks();
  forgetAllExportsForTests();
});

test('several clips: the card shows the batch progress, and Cancelar stops every running export at once (2026-11-23)', async () => {
  const pending: { id: string; reject: (e: unknown) => void }[] = [];
  camera.exportClip.mockImplementation(
    (o: { exportId: string }) => new Promise((_resolve, reject) => pending.push({ id: o.exportId, reject })),
  );
  const { result } = await renderHook(() => useBatchActions({ plan: 'paid', labelOf: (c) => c.id }));
  let saving: Promise<void> = Promise.resolve();
  await act(async () => {
    saving = result.current.save([clipOf('a'), clipOf('b')]);
  });
  expect(pending).toHaveLength(2);
  expect(result.current.job).toMatchObject({ kind: 'save', stage: 'preparing', step: { done: 0, total: 2 } });
  await act(async () => mockNative.emit({ exportId: pending[0].id, progress: 0.5 }));
  expect(result.current.job).toMatchObject({ progress: 0.25 });
  await act(async () => result.current.cancel());
  expect(result.current.job).toMatchObject({ cancelling: true });
  expect(camera.cancelExport.mock.calls.map((c: string[]) => c[0]).sort()).toEqual([pending[0].id, pending[1].id].sort());
  await act(async () => {
    pending.forEach((p) => p.reject(Object.assign(new Error('export cancelled'), { code: 'CANCELLED' })));
    await saving;
  });
  expect(result.current.job).toBeUndefined();
  expect(result.current.card).toBeUndefined();
});

test('Cancelar while a mark is still being drawn: that clip is never exported (review 2026-11-23)', async () => {
  let drawn: (path: string) => void = () => {};
  mockCapture.mockImplementationOnce(() => new Promise((r) => (drawn = r)));
  camera.exportClip.mockImplementation(() => new Promise(() => {}));
  const { result } = await renderHook(() => useBatchActions({ plan: 'paid', labelOf: (c) => c.id }));
  await act(async () => {
    void result.current.save([clipOf('a')]);
  });
  await act(async () => result.current.cancel());
  await act(async () => drawn('/o.png'));
  expect(camera.exportClip).not.toHaveBeenCalled();
  expect(result.current.job).toBeUndefined();
  expect(result.current.card).toBeUndefined();
});
