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
    expect(screen.getByText('RECORDINGS')).toBeTruthy();
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

test('holding a finished game picks it, and deleting removes its files', async () => {
  repo.listSessions.mockReturnValue([
    { session: { id: 's1', sport: 'outro', startedAt: 0, endedAt: 5, name: 'Final' }, clips: 2, firstClip: clip },
  ]);
  repo.sessionStats.mockReturnValue({ clips: 2, bytes: 1, recordedMs: 60_000 });
  const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
  await render(<Games />);
  await fireEvent(screen.getByRole('button', { name: /2 clipes/ }), 'longPress');
  await fireEvent.press(screen.getByRole('button', { name: 'Apagar 1 gravação' }));
  expect(alert).toHaveBeenCalledTimes(1);
  expect(repo.deleteSession).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  await act(async () => buttons.find((b) => b.text === 'Apagar')!.onPress!());
  expect(repo.deleteSession).toHaveBeenCalledWith('s1');
  expect(jest.requireMock('../../data/mmkv').removeFile).toHaveBeenCalledWith('/c1.mp4');
  alert.mockRestore();
});

test('lifting the finger after holding a recording keeps it picked; the next tap toggles it (2026-11-20)', async () => {
  repo.listSessions.mockReturnValue([
    { session: { id: 's1', sport: 'outro', startedAt: 0, endedAt: 5, name: 'Final' }, clips: 2, firstClip: clip },
  ]);
  repo.sessionStats.mockReturnValue({ clips: 2, bytes: 1, recordedMs: 60_000 });
  await render(<Games />);
  const card = screen.getByRole('button', { name: /2 clipes/ });
  await fireEvent(card, 'pressIn');
  await fireEvent(card, 'longPress');
  await fireEvent.press(screen.getByRole('button', { name: /2 clipes/ })); // the release that follows the hold
  expect(screen.getByRole('button', { name: /2 clipes.*, selecionada$/ })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: /2 clipes/ }));
  expect(screen.getByRole('button', { name: /2 clipes.*, não selecionada$/ })).toBeTruthy();
});

test('Selecionar picks several recordings and deletes them together', async () => {
  repo.listSessions.mockReturnValue([
    { session: { id: 's1', sport: 'outro', startedAt: 0, endedAt: 5, name: 'Final' }, clips: 2, firstClip: clip },
    { session: { id: 's2', sport: 'outro', startedAt: 0, endedAt: 5, name: 'Semi' }, clips: 3, firstClip: clip },
  ]);
  repo.sessionStats.mockReturnValue({ clips: 2, bytes: 1, recordedMs: 60_000 });
  const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
  await render(<Games />);
  await fireEvent.press(screen.getByRole('button', { name: 'Selecionar' }));
  await fireEvent.press(screen.getByRole('button', { name: /^Final/ }));
  await fireEvent.press(screen.getByRole('button', { name: /^Semi/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Apagar 2 gravações' }));
  const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  await act(async () => buttons.find((b) => b.text === 'Apagar')!.onPress!());
  expect(repo.deleteSession).toHaveBeenCalledWith('s1');
  expect(repo.deleteSession).toHaveBeenCalledWith('s2');
  alert.mockRestore();
});

test('a game still being recorded cannot be picked for deleting', async () => {
  repo.listSessions.mockReturnValue([{ session: { id: 's1', sport: 'outro', startedAt: 0 }, clips: 1, firstClip: clip }]);
  repo.sessionStats.mockReturnValue({ clips: 1, bytes: 1, recordedMs: 0 });
  await render(<Games />);
  await fireEvent.press(screen.getByRole('button', { name: 'Selecionar' }));
  await fireEvent.press(screen.getByRole('button', { name: /1 clipe/ }));
  expect(screen.queryByRole('button', { name: /^Apagar/ })).toBeNull();
  expect(router.push).not.toHaveBeenCalled();
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

test('once a recording has been received, a filter tells mine and received apart', async () => {
  const received = { shareId: 'sh1', code: 'c', from: 'Ana', receivedAt: 0, expiresAt: 1, total: 1 };
  repo.listSessions.mockReturnValue([
    { session: { id: 's1', sport: 'outro', startedAt: 0, endedAt: 1, name: 'Meu jogo' }, clips: 1, firstClip: clip },
    { session: { id: 's2', sport: 'outro', startedAt: 0, endedAt: 1, name: 'Jogo da Ana', received }, clips: 1, firstClip: clip },
  ]);
  repo.sessionStats.mockReturnValue({ clips: 1, bytes: 1, recordedMs: 60_000 });
  await render(<Games />);
  expect(screen.getByText('Meu jogo')).toBeTruthy();
  expect(screen.getByText('Jogo da Ana')).toBeTruthy();

  expect(screen.getByText('Compartilhado por Ana')).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: 'Recebidas' }));
  expect(screen.queryByText('Meu jogo')).toBeNull();
  expect(screen.getByText('Jogo da Ana')).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: 'Minhas' }));
  expect(screen.getByText('Meu jogo')).toBeTruthy();
  expect(screen.queryByText('Jogo da Ana')).toBeNull();
});

test('with no received recording there is no filter', async () => {
  repo.listSessions.mockReturnValue([{ session: { id: 's1', sport: 'outro', startedAt: 0 }, clips: 1, firstClip: clip }]);
  repo.sessionStats.mockReturnValue({ clips: 1, bytes: 1, recordedMs: 60_000 });
  await render(<Games />);
  expect(screen.queryByRole('button', { name: 'Recebidas' })).toBeNull();
});

test('the date filter shows the recordings of one day, and its chip takes it off', async () => {
  repo.listSessions.mockReturnValue([
    { session: { id: 's2', sport: 'outro', startedAt: new Date(2026, 9, 18, 18, 40).getTime(), endedAt: 1, name: 'Dia 18' }, clips: 1, firstClip: clip },
    { session: { id: 's1', sport: 'outro', startedAt: new Date(2026, 9, 17, 18, 40).getTime(), endedAt: 1, name: 'Dia 17' }, clips: 1, firstClip: clip },
  ]);
  repo.sessionStats.mockReturnValue({ clips: 1, bytes: 1, recordedMs: 60_000 });
  await render(<Games />);
  await fireEvent.press(screen.getByRole('button', { name: 'Filtrar por data' }));
  await fireEvent.press(screen.getByRole('button', { name: /17 de outubro/ }));
  expect(screen.queryByText('Dia 18')).toBeNull();
  expect(screen.getByText('Dia 17')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: /^Tirar o filtro de data: 17 de outubro/ }));
  expect(screen.getByText('Dia 18')).toBeTruthy();
});

test('the date filter is a calendar that goes back to any month and year with recordings (2026-11-21)', async () => {
  repo.listSessions.mockReturnValue([
    { session: { id: 's2', sport: 'outro', startedAt: new Date(2026, 9, 18, 18, 40).getTime(), endedAt: 1, name: 'Outubro' }, clips: 1, firstClip: clip },
    { session: { id: 's1', sport: 'outro', startedAt: new Date(2025, 2, 5, 9, 0).getTime(), endedAt: 1, name: 'Março passado' }, clips: 1, firstClip: clip },
  ]);
  repo.sessionStats.mockReturnValue({ clips: 1, bytes: 1, recordedMs: 60_000 });
  await render(<Games />);
  await fireEvent.press(screen.getByRole('button', { name: 'Filtrar por data' }));
  // Opens on the newest recording's month; a day without recordings can't be picked.
  expect(screen.getByRole('button', { name: /^Outubro de 2026: escolher mês e ano/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: '17 de outubro de 2026' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: /escolher mês e ano/ }));
  await fireEvent.press(screen.getByRole('button', { name: '2025' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Março de 2025' }));
  await fireEvent.press(screen.getByRole('button', { name: /^5 de março de 2025, 1 gravação/ }));
  expect(screen.queryByText('Outubro')).toBeNull();
  expect(screen.getByText('Março passado')).toBeTruthy();
});

test('a received recording shows the minutes that came with the link; an older link shows only its clips', async () => {
  const received = { shareId: 'sh1', code: 'c', from: 'Ana', receivedAt: 0, expiresAt: 1, total: 6 };
  repo.listSessions.mockReturnValue([
    { session: { id: 's1', sport: 'outro', startedAt: 0, endedAt: 1, name: 'Com tempo', received: { ...received, recordedMs: 12 * 60_000 } }, clips: 6, firstClip: clip },
    { session: { id: 's2', sport: 'outro', startedAt: 0, endedAt: 1, name: 'Sem tempo', received }, clips: 6, firstClip: clip },
  ]);
  repo.sessionStats.mockReturnValue({ clips: 6, bytes: 1, recordedMs: 0 });
  await render(<Games />);
  expect(screen.getByText('6 clipes · 12min')).toBeTruthy();
  expect(screen.getByText('6 clipes')).toBeTruthy();
});
