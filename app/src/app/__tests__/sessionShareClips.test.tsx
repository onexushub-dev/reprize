import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { sessionSummary, track } from '../../analytics';
import { setLocale } from '../../i18n';
import { closeDialog, currentDialog } from '../../components/dialog';
import SessionSummary from '../session/[id]';

// The courtesy sheet signs in (native Apple and Google modules): received recordings have their own tests.
jest.mock('../../account/flags', () => ({ SHARING_ENABLED: true }));
jest.mock('../../components/useCourtesyGate', () => ({ useCourtesyGate: () => ({ ask: async () => true, sheet: null }) }));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), dismissTo: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  // The stack under the summary: tests that open it from Minhas gravações keep /games in it.
  useNavigation: () => ({ getState: () => ({ routes: [{ name: 'setup' }, { name: 'games' }, { name: 'session/[id]' }] }) }),
  useLocalSearchParams: () => ({ id: 's1' }),
}));
jest.mock('../../analytics', () => ({ track: jest.fn(), sessionSummary: { note: jest.fn() } }));
jest.mock('../../components/useClipThumbnail', () => ({ useClipThumbnail: () => undefined }));
const mockOpenRecording = jest.fn((_id: string) => () => {});
jest.mock('../../focus/appFocusQueue', () => ({ focusQueue: { ensure: jest.fn(), openRecording: (id: string) => mockOpenRecording(id) } }));
const mockCapturer = { element: null, capture: jest.fn(), release: jest.fn() };
jest.mock('../../share/OverlayCapturer', () => ({ useOverlayCapturer: () => mockCapturer }));
jest.mock('../../share/batchExport', () => ({ ...jest.requireActual('../../share/batchExport'), runBatch: jest.fn() }));
const mockShapes: Record<string, { width: number; height: number }> = {};
jest.mock('../../share/clipExport', () => ({
  ...jest.requireActual('../../share/clipExport'),
  clipShapeOf: jest.fn(async (c: { id: string }) => mockShapes[c.id] || { width: 1080, height: 1920 }),
}));
jest.mock('../../../modules/replay-camera', () => ({
  isFocusSupported: () => true,
  exportClip: jest.fn(),
  createThumbnail: jest.fn(),
  shareFiles: jest.fn(async () => 'shared'),
  concatVideos: jest.fn(async (_paths: string[], out: string) => ({ path: out, durationMs: 90000 })),
}));
jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  Asset: { create: jest.fn(async () => ({})) },
}));
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(_dir: unknown, name?: string) {
      this.uri = `file:///cache/exports/${name || 'x'}`;
    }
    delete() {}
  },
  Directory: class {},
  Paths: { cache: '/cache' },
}));
jest.mock('../../payments', () => ({
  payments: { subscribe: () => () => {}, version: () => 0, nextPlan: jest.fn(() => 'free'), showPaywall: jest.fn(), unlockOption: jest.fn(() => ({ kind: 'pro' })) },
}));
jest.mock('../../session/SessionContext', () => ({ useSession: jest.fn() }));
jest.mock('../../data/mmkv', () => {
  const listeners = new Set<() => void>();
  let version = 0;
  return {
    repo: {
      getSession: jest.fn(),
      listClips: jest.fn(),
      sessionStats: jest.fn(),
      renameSession: jest.fn(),
      renameClip: jest.fn(),
      getPrefs: jest.fn(() => ({})),
      setPrefs: jest.fn(),
      deleteClip: jest.fn(),
      updateClip: jest.fn(),
      deleteSession: jest.fn(() => ['/a.mp4', '/b.mp4']),
      subscribe: (fn: () => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      version: () => version,
      __change: () => {
        version += 1;
        listeners.forEach((fn) => fn());
      },
    },
    removeFile: jest.fn(),
    // A shared recording shows its upload strip, which reads the stored upload plan.
    kv: { getString: () => undefined, set: jest.fn(), delete: jest.fn(), remove: jest.fn(), getAllKeys: () => [] },
  };
});

const { repo } = jest.requireMock('../../data/mmkv');
const { router } = jest.requireMock('expo-router');
const { payments } = jest.requireMock('../../payments');
const { useSession } = jest.requireMock('../../session/SessionContext');
const { runBatch } = jest.requireMock('../../share/batchExport');
const native = jest.requireMock('../../../modules/replay-camera');
const media = jest.requireMock('expo-media-library');

const clip = (id: string, source: string, createdAt: number) => ({
  id,
  sessionId: 's1',
  createdAt,
  source,
  path: `/${id}.mp4`,
  durationMs: 60000,
  trim: { startMs: 30000, endMs: 60000 },
});

beforeEach(() => {
  jest.clearAllMocks();
  useSession.mockReturnValue({ reset: jest.fn(), state: {} });
  repo.getSession.mockReturnValue({ id: 's1', sport: 'futevolei', startedAt: new Date(2026, 9, 17, 18, 40).getTime(), paid: true });
});


// A link with only the picked clips (picked-clips link design, 2026-11-23).
const ended = { id: 's1', sport: 'futevolei', startedAt: 0, endedAt: 5, name: 'Final do torneio', paid: true };

async function pickTwo() {
  repo.listClips.mockReturnValue([clip('c1', 'screen', 1), clip('c2', 'screen', 2), clip('c3', 'screen', 3)]);
  repo.sessionStats.mockReturnValue({ clips: 3, bytes: 1, recordedMs: 60_000 });
  await render(<SessionSummary />);
  await fireEvent.press(screen.getByRole('button', { name: 'Selecionar clipes' }));
  for (const n of [1, 2]) await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^Clipe ${n}`) }));
}

afterEach(() => closeDialog());

test('picked clips: the link button asks first, then opens the share sheet with those clips', async () => {
  repo.getSession.mockReturnValue(ended);
  await pickTwo();
  await fireEvent.press(screen.getByRole('button', { name: 'Compartilhar 2 clipes por link' }));
  expect(router.push).not.toHaveBeenCalled();
  const dialog = currentDialog()!;
  expect(dialog.title).toBe('Compartilhar 2 clipes dessa gravação?');
  await act(async () => {
    closeDialog();
    dialog.onConfirm();
  });
  expect(router.push).toHaveBeenCalledWith('/share/s1?clips=c1,c2');
});

test('a recording with a live link: the notice, and Ver link opens that link', async () => {
  const shared = { shareId: 'sh', url: 'u', createdAt: 0, expiresAt: Date.now() + 5 * 3_600_000, clips: 3, state: 'active' };
  repo.getSession.mockReturnValue({ ...ended, shared });
  await pickTwo();
  await fireEvent.press(screen.getByRole('button', { name: 'Compartilhar 2 clipes por link' }));
  const dialog = currentDialog()!;
  expect(dialog.title).toBe('Esta gravação já tem um compartilhamento ativo');
  await act(async () => {
    closeDialog();
    dialog.onConfirm();
  });
  expect(router.push).toHaveBeenCalledWith('/share/s1');
});
