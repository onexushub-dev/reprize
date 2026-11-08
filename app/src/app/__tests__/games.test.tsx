import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { setLocale } from '../../i18n';
import Games from '../games';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), dismissTo: jest.fn() } }));
jest.mock('../../session/SessionContext', () => ({ useSession: jest.fn() }));
jest.mock('../../components/useClipThumbnail', () => ({ useClipThumbnail: () => undefined }));
jest.mock('../../payments', () => ({
  payments: { subscribe: () => () => {}, version: () => 0, restore: jest.fn(), showPaywall: jest.fn(), unlockOption: jest.fn(() => ({ kind: 'none' })) },
}));
jest.mock('../../data/mmkv', () => ({
  repo: {
    listSessions: jest.fn(),
    sessionStats: jest.fn(),
    deleteSession: jest.fn(() => ['/c1.mp4']),
    getPrefs: jest.fn(() => ({})),
    subscribe: () => () => {},
    version: () => 0,
  },
  removeFile: jest.fn(),
}));

const { repo } = jest.requireMock('../../data/mmkv');
const { payments } = jest.requireMock('../../payments');
const { router } = jest.requireMock('expo-router');
const { useSession } = jest.requireMock('../../session/SessionContext');

const clip = { id: 'c1', sessionId: 's1', createdAt: 1, source: 'screen', path: '/c1.mp4', durationMs: 1, trim: { startMs: 0, endMs: 1 } };

beforeEach(() => {
  jest.clearAllMocks();
  useSession.mockReturnValue({ reset: jest.fn(), state: { phase: 'idle' } });
});

test('lists games with their label and clipe count', async () => {
  repo.listSessions.mockReturnValue([
    { session: { id: 's1', sport: 'futevolei', startedAt: 0, name: 'Final do torneio' }, clips: 3, firstClip: clip },
  ]);
  repo.sessionStats.mockReturnValue({ clips: 3, bytes: 1, recordedMs: 74 * 60_000 });
  await render(<Games />);
  expect(screen.getByText('Final do torneio')).toBeTruthy();
  expect(screen.getByText('3 clipes · 1h14')).toBeTruthy();
});

test('tapping a game opens its summary', async () => {
  repo.listSessions.mockReturnValue([{ session: { id: 's1', sport: 'outro', startedAt: 0 }, clips: 1, firstClip: clip }]);
  repo.sessionStats.mockReturnValue({ clips: 1, bytes: 1, recordedMs: 60_000 });
  await render(<Games />);
  await fireEvent.press(screen.getByRole('button', { name: /1 clipe/ }));
  expect(router.push).toHaveBeenCalledWith('/session/s1');
});

test('empty state', async () => {
  repo.listSessions.mockReturnValue([]);
  await render(<Games />);
  expect(screen.getByText('Nenhuma gravação ainda')).toBeTruthy();
  expect(screen.getByText('Comece uma gravação e os lances que você salvar aparecem aqui.')).toBeTruthy();
});

test('an English phone sees the list in English', async () => {
  setLocale('en');
  try {
    repo.listSessions.mockReturnValue([
      { session: { id: 's1', sport: 'futevolei', startedAt: new Date(2026, 9, 17, 18, 40).getTime() }, clips: 1, firstClip: clip },
    ]);
    repo.sessionStats.mockReturnValue({ clips: 1, bytes: 1, recordedMs: 74 * 60_000 });
    await render(<Games />);
    expect(screen.getByText('MY RECORDINGS')).toBeTruthy();
    expect(screen.getByText('1 clip · 1h 14m')).toBeTruthy();
    expect(screen.getByText(/^Footvolley · 10\/17, 6:40\sPM$/)).toBeTruthy();
  } finally {
    setLocale('pt-BR');
  }
});

const oneGame = (plan: object = {}) => {
  repo.listSessions.mockReturnValue([{ session: { id: 's1', sport: 'outro', startedAt: 0, ...plan }, clips: 7, firstClip: clip }]);
  repo.sessionStats.mockReturnValue({ clips: 7, bytes: 1, recordedMs: 60_000 });
};

test.each([
  ['free', { paid: false }],
  ['paid', { paid: true }],
  ['older Pass', { passTransactionId: 'tx-1' }],
])('no game shows bloqueado on the %s plan', async (_name, plan) => {
  oneGame(plan);
  await render(<Games />);
  expect(screen.queryByText(/bloqueado/)).toBeNull();
});

test('holding a finished game offers to delete it, and deleting removes its files', async () => {
  repo.listSessions.mockReturnValue([
    { session: { id: 's1', sport: 'outro', startedAt: 0, endedAt: 5, name: 'Final' }, clips: 2, firstClip: clip },
  ]);
  repo.sessionStats.mockReturnValue({ clips: 2, bytes: 1, recordedMs: 60_000 });
  const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
  await render(<Games />);
  await fireEvent(screen.getByRole('button', { name: /2 clipes/ }), 'longPress');
  expect(alert).toHaveBeenCalledTimes(1);
  expect(repo.deleteSession).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  await act(async () => buttons.find((b) => b.text === 'Apagar')!.onPress!());
  expect(repo.deleteSession).toHaveBeenCalledWith('s1');
  expect(jest.requireMock('../../data/mmkv').removeFile).toHaveBeenCalledWith('/c1.mp4');
  alert.mockRestore();
});

test('the trash button on a finished game asks to delete it', async () => {
  repo.listSessions.mockReturnValue([
    { session: { id: 's1', sport: 'outro', startedAt: 0, endedAt: 5, name: 'Final' }, clips: 2, firstClip: clip },
  ]);
  repo.sessionStats.mockReturnValue({ clips: 2, bytes: 1, recordedMs: 60_000 });
  const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
  await render(<Games />);
  await fireEvent.press(screen.getByRole('button', { name: /Apagar gravação/ }));
  expect(alert).toHaveBeenCalledTimes(1);
  expect(repo.deleteSession).not.toHaveBeenCalled();
  alert.mockRestore();
});

test('a game still being recorded cannot be deleted from the list', async () => {
  repo.listSessions.mockReturnValue([{ session: { id: 's1', sport: 'outro', startedAt: 0 }, clips: 1, firstClip: clip }]);
  repo.sessionStats.mockReturnValue({ clips: 1, bytes: 1, recordedMs: 0 });
  await render(<Games />);
  expect(screen.queryByRole('button', { name: /Apagar/ })).toBeNull();
});

test('Nova gravação goes back to the setup screen', async () => {
  repo.listSessions.mockReturnValue([]);
  await render(<Games />);
  await fireEvent.press(screen.getByRole('button', { name: 'Nova gravação' }));
  expect(router.dismissTo).toHaveBeenCalledWith('/setup');
});

test('Nova gravação clears a game that has just ended before starting over', async () => {
  repo.listSessions.mockReturnValue([]);
  const reset = jest.fn();
  useSession.mockReturnValue({ reset, state: { phase: 'ended', sessionId: 's1' } });
  await render(<Games />);
  await fireEvent.press(screen.getByRole('button', { name: 'Nova gravação' }));
  expect(reset).toHaveBeenCalled();
});

test('the gallery has no PRO card, even with recordings on the free plan: each recording offers it on its own screen', async () => {
  const freeGame = { session: { id: 's1', sport: 'outro', startedAt: 0, endedAt: 5, paid: false }, clips: 2, firstClip: clip };
  repo.listSessions.mockReturnValue([freeGame]);
  repo.sessionStats.mockReturnValue({ clips: 2, bytes: 1, recordedMs: 60_000 });
  await render(<Games />);
  expect(screen.queryByText('Desbloqueie tudo com o PRO')).toBeNull();
  expect(screen.queryByText('PRO')).toBeNull();
  expect(payments.showPaywall).not.toHaveBeenCalled();
});


test('the recording opened last says so', async () => {
  repo.getPrefs.mockReturnValue({ lastOpenedSessionId: 's2' });
  repo.listSessions.mockReturnValue([
    { session: { id: 's1', sport: 'futevolei', startedAt: new Date(2026, 9, 17, 18, 40).getTime(), endedAt: 1 }, clips: 1, firstClip: clip },
    { session: { id: 's2', sport: 'futevolei', startedAt: new Date(2026, 9, 18, 18, 40).getTime(), endedAt: 2 }, clips: 1, firstClip: clip },
  ]);
  repo.sessionStats.mockReturnValue({ recordedMs: 60_000 });
  await render(<Games />);
  expect(screen.getAllByText('Visto por último')).toHaveLength(1);
  repo.getPrefs.mockReturnValue({});
});
