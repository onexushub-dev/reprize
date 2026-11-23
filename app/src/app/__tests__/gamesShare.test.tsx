import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { closeDialog, currentDialog } from '../../components/dialog';
import Games from '../games';

// Compartilhar from Minhas gravações (multi-recording share design §3.1): 1 to 10 recordings in one link.
jest.mock('../../account/flags', () => ({ SHARING_ENABLED: true }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), dismissTo: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock('../../session/SessionContext', () => ({ useSession: jest.fn(() => ({ reset: jest.fn(), state: { phase: 'idle' } })) }));
jest.mock('../../components/useClipThumbnail', () => ({ useClipThumbnail: () => undefined }));
jest.mock('../../payments', () => ({
  payments: { subscribe: () => () => {}, version: () => 0, restore: jest.fn(), showPaywall: jest.fn(), unlockOption: jest.fn(() => ({ kind: 'pro' })) },
}));
jest.mock('../../data/mmkv', () => ({
  repo: {
    listSessions: jest.fn(),
    sessionStats: jest.fn(() => ({ clips: 2, bytes: 1, recordedMs: 60_000 })),
    deleteSession: jest.fn(() => []),
    getPrefs: jest.fn(() => ({})),
    getSession: jest.fn(),
    subscribe: () => () => {},
    version: () => 0,
  },
  removeFile: jest.fn(),
}));

const { repo } = jest.requireMock('../../data/mmkv');
const { router } = jest.requireMock('expo-router');

const clip = { id: 'c1', sessionId: 's1', createdAt: 1, source: 'screen', path: '/c1.mp4', durationMs: 1, trim: { startMs: 0, endMs: 1 } };
const game = (id: string, name: string, over: Record<string, unknown> = {}, clips = 2) => ({
  session: { id, sport: 'outro', startedAt: 0, endedAt: 5, name, ...over },
  clips,
  firstClip: clip,
});

beforeEach(() => {
  jest.clearAllMocks();
  closeDialog();
});

async function pick(names: string[]) {
  await render(<Games />);
  await fireEvent.press(screen.getByRole('button', { name: 'Selecionar' }));
  for (const name of names) await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
}

/** The question asked before a link is made (the app's glass dialog): its title, its text, and Compartilhar pressed. */
async function confirm() {
  const dialog = currentDialog();
  expect(dialog).toBeDefined();
  const { title, body } = dialog!;
  expect(dialog!.confirm).toBe('Compartilhar');
  await act(async () => {
    closeDialog();
    dialog!.onConfirm();
  });
  return { title, body };
}

test('one recording: asked first, then its own share sheet', async () => {
  repo.listSessions.mockReturnValue([game('s1', 'Final'), game('s2', 'Semi')]);
  await pick(['Final']);
  await fireEvent.press(screen.getByRole('button', { name: 'Compartilhar' }));
  expect(router.push).not.toHaveBeenCalled();
  const { title, body } = await confirm();
  expect(title).toBe('Compartilhar esta gravação?');
  expect(body).toBe('Vamos criar um link com 2 clipes. Quem tiver o link pode ver e baixar por 24 horas.');
  expect(router.push).toHaveBeenCalledWith('/share/s1');
});

test('two or more: asked first, then the group sheet with the picked recordings', async () => {
  repo.listSessions.mockReturnValue([game('s1', 'Final'), game('s2', 'Semi'), game('s3', 'Quartas')]);
  await pick(['Final', 'Quartas']);
  expect(screen.getByRole('button', { name: 'Compartilhar' })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Compartilhar' }));
  const { title, body } = await confirm();
  expect(title).toBe('Compartilhar 2 gravações?');
  expect(body).toBe('Vamos criar um único link com as 2 gravações (4 clipes). Quem tiver o link pode ver e baixar por 24 horas.');
  expect(router.push).toHaveBeenCalledWith('/share/group?ids=s1,s3');
});

test('Cancelar on the question: no link, still selecting', async () => {
  repo.listSessions.mockReturnValue([game('s1', 'Final')]);
  await pick(['Final']);
  await fireEvent.press(screen.getByRole('button', { name: 'Compartilhar' }));
  expect(currentDialog()).toMatchObject({ cancel: 'Cancelar' });
  await act(async () => closeDialog());
  expect(router.push).not.toHaveBeenCalled();
  expect(screen.getByText('1 gravação selecionada')).toBeTruthy();
});

test('a recording whose link is still live opens it without asking', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const shared = { shareId: 'sh', url: 'u', createdAt: 0, expiresAt: Date.now() + 3600_000, clips: 2, state: 'active' };
  repo.listSessions.mockReturnValue([game('s1', 'Final', { shared })]);
  await pick(['Final']);
  await fireEvent.press(screen.getByRole('button', { name: 'Compartilhar' }));
  expect(alert).not.toHaveBeenCalled();
  expect(currentDialog()).toBeUndefined();
  expect(router.push).toHaveBeenCalledWith('/share/s1');
  alert.mockRestore();
});

test('more than 10 cannot be shared: the bar says the limit, Apagar still works', async () => {
  repo.listSessions.mockReturnValue(Array.from({ length: 11 }, (_, i) => game(`s${i}`, `Jogo ${String.fromCharCode(65 + i)}`)));
  await render(<Games />);
  await fireEvent.press(screen.getByRole('button', { name: 'Selecionar' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Selecionar todos' }));
  expect(screen.getByRole('button', { name: 'Compartilhar' })).toBeDisabled();
  expect(screen.getByText('Até 10 gravações por link')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Apagar 11 gravações' })).toBeEnabled();
});

test('a received recording in the pick cannot be shared', async () => {
  const received = { shareId: 'sh1', code: 'c', from: 'Ana', receivedAt: 0, expiresAt: 1, total: 2 };
  repo.listSessions.mockReturnValue([game('s1', 'Final'), game('s2', 'Da Ana', { received })]);
  await pick(['Final', 'Da Ana']);
  const share = screen.getByRole('button', { name: 'Compartilhar' });
  expect(share).toBeDisabled();
  expect(share.props.accessibilityHint).toBe('Gravações recebidas não podem ser compartilhadas');
  expect(screen.getByText('2 gravações selecionadas')).toBeTruthy();
});
