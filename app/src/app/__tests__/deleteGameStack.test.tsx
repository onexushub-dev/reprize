import { useEffect } from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { router, useNavigation } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Alert, Text } from 'react-native';

import Games from '../games';
import SessionSummary from '../session/[id]';
import ClipScreen from '../clip/[id]';

jest.mock('expo-video', () => {
  const mockPlayer = { addListener: () => ({ remove() {} }), play: jest.fn(), pause: jest.fn(), currentTime: 0, playbackRate: 1, muted: false };
  return { useVideoPlayer: () => mockPlayer, VideoView: () => null };
});
jest.mock('expo-file-system', () => ({ File: class { delete() {} }, Directory: class { list() { return []; } }, Paths: { cache: '' } }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-media-library', () => ({ requestPermissionsAsync: jest.fn(async () => ({ granted: true })), Asset: { create: jest.fn(async () => ({})) } }));
jest.mock('../../share/captureOverlay', () => ({ captureOverlay: jest.fn(async () => '/tmp/overlay.png') }));
jest.mock('../../../modules/replay-camera', () => ({
  exportClip: jest.fn(async () => ({ path: '/e.mp4', durationMs: 30000 })),
  createThumbnail: jest.fn(async () => '/t.jpg'),
  findContentStart: jest.fn(async () => 0),
  isFocusSupported: () => false,
}));
jest.mock('../../components/TrimBar', () => ({ TrimBar: () => null }));
jest.mock('../../focus/appBallQueue', () => ({
  ballQueue: { request: jest.fn(), cancel: jest.fn(), progress: jest.fn(() => undefined), subscribe: jest.fn(() => () => {}) },
  ballAvailable: jest.fn(() => false),
  probeBallOnce: jest.fn(),
  checkSportOnce: jest.fn(),
}));
jest.mock('../../focus/appFocusQueue', () => ({ focusEveryMs: () => 200, focusQueue: { ensure: jest.fn(), openRecording: jest.fn(() => () => {}) } }));
jest.mock('../../session/SessionContext', () => ({ useSession: () => ({ reset: jest.fn(), state: {} }) }));
jest.mock('../../data/mmkv', () => {
  const { createRepo } = jest.requireActual('../../data/repo');
  const store = new Map<string, string>();
  const gone = new Set<string>();
  let n = 0;
  const repo = createRepo(
    { getString: (k: string) => store.get(k), set: (k: string, v: string) => void store.set(k, v), delete: (k: string) => void store.delete(k), keys: () => [...store.keys()] },
    { exists: (p: string) => !gone.has(p), sizeBytes: () => 1000 },
    () => `id${++n}`,
  );
  return { repo, removeFile: (p: string) => void gone.add(p) };
});

const { repo } = jest.requireMock('../../data/mmkv');


function seed(startedAt: number) {
  const s = repo.startSession('quadra', startedAt, { paid: false });
  repo.endSession(s.id, startedAt + 1000);
  return s;
}
const Setup = () => <Text>SETUP</Text>;
type StackNavigation = { getState: () => { routes: { name: string }[] } | undefined };
const spy: { navigation?: StackNavigation } = {};
const stackNow = () => {
  const state = spy.navigation && spy.navigation.getState();
  return state ? state.routes.map((r) => r.name) : undefined;
};
const GamesSpy = () => {
  const navigation = useNavigation();
  useEffect(() => {
    spy.navigation = navigation;
  });
  return <Games />;
};

// A game that has just ended got to its summary by replacing the setup, so the stack is only [session]. Deleting it must
// still leave Minhas gravações with the setup under it; before, it was the only screen and back did nothing.
async function deleteFreshGame() {
  const s = seed(1_000_000);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await renderRouter(
    { index: Setup, setup: Setup, games: GamesSpy, 'session/[id]': SessionSummary, 'clip/[id]': ClipScreen },
    { initialUrl: '/setup' },
  );
  await act(async () => router.replace(`/session/${s.id}`));
  spy.navigation = undefined;
  fireEvent.press(screen.getByRole('button', { name: 'Apagar gravação' }));
  const buttons = alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  await act(async () => buttons.find((x) => x.text === 'Apagar')!.onPress!());
  await act(async () => {});
  return { names: stackNow(), canGoBack: router.canGoBack() };
}

test('a game just recorded: deleting it leaves Minhas gravações with the setup underneath', async () => {
  expect(await deleteFreshGame()).toEqual({ names: ['setup', 'games'], canGoBack: true });
});
