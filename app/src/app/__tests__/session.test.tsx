import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { sessionSummary, track } from '../../analytics';
import { setLocale } from '../../i18n';
import SessionSummary from '../session/[id]';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), dismissTo: jest.fn() },
  // The stack under the summary: tests that open it from Minhas gravações keep /games in it.
  useNavigation: () => ({ getState: () => ({ routes: [{ name: 'setup' }, { name: 'games' }, { name: 'session/[id]' }] }) }),
  useLocalSearchParams: () => ({ id: 's1' }),
}));
jest.mock('../../analytics', () => ({ track: jest.fn(), sessionSummary: { note: jest.fn() } }));
jest.mock('../../components/useClipThumbnail', () => ({ useClipThumbnail: () => undefined }));
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
  payments: { subscribe: () => () => {}, version: () => 0, nextPlan: jest.fn(() => 'free'), showPaywall: jest.fn(), unlockOption: jest.fn(() => ({ kind: 'none' })) },
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

test('shows the game stats', async () => {
  repo.listClips.mockReturnValue([clip('a', 'gesture', 1), clip('b', 'screen', 2)]);
  repo.sessionStats.mockReturnValue({ clips: 4, bytes: 92_000_000, recordedMs: (2 * 60 + 14) * 60_000 });
  await render(<SessionSummary />);
  expect(screen.getByText('2h14')).toBeTruthy();
  expect(screen.getByText('4')).toBeTruthy();
  expect(screen.getByText('92 MB')).toBeTruthy();
  // The date line is the name field's own text now (the subtitle went with the big title).
  expect(screen.getByLabelText('Nome da gravação').props.placeholder).toBe('Futevôlei · 17/10, 18:40');
});

test('tapping a clipe opens it', async () => {
  repo.listClips.mockReturnValue([clip('a', 'gesture', 1)]);
  repo.sessionStats.mockReturnValue({ clips: 1, bytes: 1, recordedMs: 1 });
  await render(<SessionSummary />);
  await fireEvent.press(screen.getByRole('button', { name: /Clipe 1/ }));
  expect(router.push).toHaveBeenCalledWith('/clip/a');
});

test('re-reads the clipes when one is deleted elsewhere', async () => {
  repo.listClips.mockReturnValue([clip('a', 'gesture', 1), clip('b', 'screen', 2)]);
  repo.sessionStats.mockReturnValue({ clips: 2, bytes: 1, recordedMs: 1 });
  await render(<SessionSummary />);
  expect(screen.getByRole('button', { name: /Clipe 2/ })).toBeTruthy();

  repo.listClips.mockReturnValue([clip('a', 'gesture', 1)]);
  repo.sessionStats.mockReturnValue({ clips: 1, bytes: 1, recordedMs: 1 });
  await act(async () => repo.__change());

  expect(screen.queryByRole('button', { name: /Clipe 2/ })).toBeNull();
});

test('a game with no clipes says so', async () => {
  repo.listClips.mockReturnValue([]);
  repo.sessionStats.mockReturnValue({ clips: 0, bytes: 0, recordedMs: 60_000 });
  await render(<SessionSummary />);
  expect(screen.getByText('Nenhum lance salvo')).toBeTruthy();
  expect(screen.getByText('Salve um lance durante a gravação e ele aparece aqui.')).toBeTruthy();
});

test('Nova gravação resets the session and goes back to setup', async () => {
  const reset = jest.fn();
  useSession.mockReturnValue({ reset, state: { sessionId: 's1' } });
  repo.listClips.mockReturnValue([]);
  repo.sessionStats.mockReturnValue({ clips: 0, bytes: 0, recordedMs: 0 });
  await render(<SessionSummary />);
  await fireEvent.press(screen.getByRole('button', { name: 'Nova gravação' }));
  expect(reset).toHaveBeenCalled();
  expect(router.dismissTo).toHaveBeenCalledWith('/setup');
});

test('typing a name and submitting renames the game', async () => {
  repo.listClips.mockReturnValue([]);
  repo.sessionStats.mockReturnValue({ clips: 0, bytes: 0, recordedMs: 0 });
  await render(<SessionSummary />);
  const input = screen.getByLabelText('Nome da gravação');
  await fireEvent.changeText(input, 'Final do torneio');
  await fireEvent(input, 'submitEditing');
  expect(repo.renameSession).toHaveBeenCalledWith('s1', 'Final do torneio');
});

test('a named game shows its name in the name field, with no big title above it (2026-11-02: room for the clips)', async () => {
  repo.getSession.mockReturnValue({ id: 's1', sport: 'futevolei', startedAt: 0, name: 'Final do torneio', paid: true });
  repo.listClips.mockReturnValue([]);
  repo.sessionStats.mockReturnValue({ clips: 0, bytes: 0, recordedMs: 0 });
  await render(<SessionSummary />);
  expect(screen.getByLabelText('Nome da gravação').props.value).toBe('Final do torneio');
  expect(screen.queryByText('GRAVAÇÃO ENCERRADA')).toBeNull();
  expect(screen.queryByRole('header')).toBeNull();
});

test('an unnamed game shows no "Gravação encerrada" title: the name field, with its date and time, opens the screen', async () => {
  repo.getSession.mockReturnValue({ id: 's1', sport: 'futevolei', startedAt: 0, paid: true });
  repo.listClips.mockReturnValue([]);
  repo.sessionStats.mockReturnValue({ clips: 0, bytes: 0, recordedMs: 0 });
  await render(<SessionSummary />);
  expect(screen.queryByText('GRAVAÇÃO ENCERRADA')).toBeNull();
  expect(screen.getByLabelText('Nome da gravação').props.placeholder).toMatch(/\d/);
  expect(screen.getByRole('button', { name: 'Apagar gravação' })).toBeTruthy();
  expect(screen.queryByText('Opcional. Ajuda a achar a gravação depois.')).toBeNull(); // the field speaks for itself
});

test('the footer has no "Postar um clipe": sharing happens inside the clip', async () => {
  repo.listClips.mockReturnValue([clip('a', 'gesture', 1), clip('b', 'screen', 2)]);
  repo.sessionStats.mockReturnValue({ clips: 2, bytes: 1, recordedMs: 1 });
  await render(<SessionSummary />);
  expect(screen.queryByRole('button', { name: 'Postar um clipe' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Nova gravação' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Apagar gravação' })).toBeTruthy();
});

test('swiping back from the game that just ended resets it, as Nova gravação does', async () => {
  const reset = jest.fn();
  useSession.mockReturnValue({ reset, state: { sessionId: 's1' } });
  repo.listClips.mockReturnValue([]);
  repo.sessionStats.mockReturnValue({ clips: 0, bytes: 0, recordedMs: 0 });
  const view = await render(<SessionSummary />);
  expect(reset).not.toHaveBeenCalled();
  await act(async () => view.unmount()); // the screen leaves the stack: a swipe back, Android's back, a dismiss
  expect(reset).toHaveBeenCalled();
});

test('leaving a past game never touches the current session', async () => {
  const reset = jest.fn();
  useSession.mockReturnValue({ reset, state: { sessionId: 'other' } });
  repo.listClips.mockReturnValue([]);
  repo.sessionStats.mockReturnValue({ clips: 0, bytes: 0, recordedMs: 0 });
  const view = await render(<SessionSummary />);
  await act(async () => view.unmount());
  expect(reset).not.toHaveBeenCalled();
});

test('Nova gravação from a past game goes back to the existing setup without touching the current session', async () => {
  const reset = jest.fn();
  useSession.mockReturnValue({ reset, state: { sessionId: 'other' } });
  repo.listClips.mockReturnValue([]);
  repo.sessionStats.mockReturnValue({ clips: 0, bytes: 0, recordedMs: 0 });
  await render(<SessionSummary />);
  await fireEvent.press(screen.getByRole('button', { name: 'Nova gravação' }));
  expect(reset).not.toHaveBeenCalled();
  expect(router.dismissTo).toHaveBeenCalledWith('/setup');
});

test('a named clip is identified by its name in the recording', async () => {
  repo.listClips.mockReturnValue([{ ...clip('a', 'gesture', 1), name: 'Ace no fundo' }, clip('b', 'screen', 2)]);
  repo.sessionStats.mockReturnValue({ clips: 2, bytes: 1, recordedMs: 1 });
  await render(<SessionSummary />);
  expect(screen.getByText('Ace no fundo')).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Clipe 1 · Ace no fundo/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Clipe 2,/ })).toBeTruthy();
});

describe('free recording', () => {
  const oldLockedClip = (id: string, createdAt: number) => ({ ...clip(id, 'screen', createdAt), locked: true });
  const setup = (tier: string) => {
    // The recording's own plan: 'pass' is an older session that holds a Pass and has no `paid` flag.
    const plan = tier === 'free' ? { paid: false } : tier === 'pass' ? { passTransactionId: 'tx-1' } : { paid: true };
    repo.getSession.mockReturnValue({ id: 's1', sport: 'futevolei', startedAt: 0, ...plan });
    repo.listClips.mockReturnValue([clip('a', 'gesture', 1), oldLockedClip('b', 2)]);
    repo.sessionStats.mockReturnValue({ clips: 2, bytes: 1, recordedMs: 1 });
  };

  // The sheet waits for its slide-out before a paywall (iOS): give it that time.
  const afterSheet = () => act(async () => void (await new Promise((r) => setTimeout(r, 900))));

  test('the free plan shows a short card; tapping it opens the PRO sheet, with no "continue" since nothing is exported', async () => {
    setup('free');
    await render(<SessionSummary />);
    expect(screen.getByText('Seus clipes com qualidade PRO')).toBeTruthy();
    expect(screen.getByText('Full HD, som, Modo Foco e sem marca d’água.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Seus clipes com qualidade PRO/ }));
    expect(screen.getByText('Libere a qualidade PRO nesta gravação')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Assinar o PRO' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Só para esta gravação' })).toBeTruthy();
    expect(screen.queryByText('Continuar no plano grátis')).toBeNull();
    expect(payments.showPaywall).not.toHaveBeenCalled(); // nothing opens before the player picks
  });

  test('from the card, "Assinar o PRO" opens the PRO paywall (monthly and annual)', async () => {
    setup('free');
    await render(<SessionSummary />);
    await fireEvent.press(screen.getByRole('button', { name: /^Seus clipes com qualidade PRO/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Assinar o PRO' }));
    await afterSheet();
    expect(payments.showPaywall).toHaveBeenCalledWith('default');
    expect(track).toHaveBeenCalledWith('paywall_viewed', { source: 'upgrade_card', offering: 'default' });
  });

  test('from the card, "Só para esta gravação" opens the Single Pass paywall', async () => {
    setup('free');
    await render(<SessionSummary />);
    await fireEvent.press(screen.getByRole('button', { name: /^Seus clipes com qualidade PRO/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Só para esta gravação' }));
    await afterSheet();
    expect(payments.showPaywall).toHaveBeenCalledWith('pass');
    expect(track).toHaveBeenCalledWith('paywall_viewed', { source: 'upgrade_card', offering: 'pass' });
  });

  test('with Pro active a recording made on the free plan has no card: Pro unlocks it', async () => {
    setup('free');
    payments.unlockOption.mockReturnValue({ kind: 'pro' });
    await render(<SessionSummary />);
    expect(screen.queryByText('Seus clipes com qualidade PRO')).toBeNull();
    payments.unlockOption.mockReturnValue({ kind: 'none' });
  });

  test.each(['pass', 'pro'])('on the %s plan there is no card', async (tier) => {
    setup(tier);
    await render(<SessionSummary />);
    expect(screen.queryByText('Seus clipes com qualidade PRO')).toBeNull();
    expect(screen.queryByText('Liberar')).toBeNull();
  });

  test.each(['free', 'pass', 'pro'])('on the %s plan any clipe opens, even an old one stored with locked: true', async (tier) => {
    setup(tier);
    await render(<SessionSummary />);
    await fireEvent.press(screen.getByRole('button', { name: /^Clipe 2,/ }));
    expect(router.push).toHaveBeenCalledWith('/clip/b');
    expect(payments.showPaywall).not.toHaveBeenCalled();
  });

  test('no clipe is labeled as blocked', async () => {
    setup('free');
    await render(<SessionSummary />);
    expect(screen.queryByText(/bloqueado/i)).toBeNull();
  });
});

function lastAlertButtons(alert: jest.SpyInstance) {
  return alert.mock.calls[alert.mock.calls.length - 1][2] as { text: string; onPress?: () => void }[];
}

test('Selecionar clipes: pick some, delete them after confirming', async () => {
  repo.listClips.mockReturnValue([clip('a', 'gesture', 1), clip('b', 'screen', 2), clip('c', 'screen', 3)]);
  repo.sessionStats.mockReturnValue({ clips: 3, bytes: 1, recordedMs: 1 });
  const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
  await render(<SessionSummary />);
  await fireEvent.press(screen.getByRole('button', { name: 'Selecionar clipes' }));
  expect(screen.getByText('Toque nos clipes')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: /^Clipe 1/ }));
  await fireEvent.press(screen.getByRole('button', { name: /^Clipe 3/ }));
  expect(screen.getByText('2 selecionados')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Apagar 2 clipes' }));
  expect(repo.deleteClip).not.toHaveBeenCalled();
  await act(async () => lastAlertButtons(alert).find((b) => b.text === 'Apagar')!.onPress!());
  expect(repo.deleteClip.mock.calls.map((c: string[]) => c[0])).toEqual(['a', 'c']);
  expect(jest.requireMock('../../data/mmkv').removeFile).toHaveBeenCalledWith('/a.mp4');
  expect(screen.queryByText('2 selecionados')).toBeNull();
  alert.mockRestore();
});

test('holding a clip starts the selection with it picked; Cancelar leaves it', async () => {
  repo.listClips.mockReturnValue([clip('a', 'gesture', 1), clip('b', 'screen', 2)]);
  repo.sessionStats.mockReturnValue({ clips: 2, bytes: 1, recordedMs: 1 });
  await render(<SessionSummary />);
  await fireEvent(screen.getByRole('button', { name: /^Clipe 2/ }), 'longPress');
  expect(screen.getByText('1 selecionado')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar seleção' }));
  expect(screen.getByRole('button', { name: 'Selecionar clipes' })).toBeTruthy();
});

test('lifting the finger after holding a clip keeps it picked; the next tap toggles it', async () => {
  repo.listClips.mockReturnValue([clip('a', 'gesture', 1), clip('b', 'screen', 2)]);
  repo.sessionStats.mockReturnValue({ clips: 2, bytes: 1, recordedMs: 1 });
  await render(<SessionSummary />);
  const card = screen.getByRole('button', { name: /^Clipe 2/ });
  await fireEvent(card, 'pressIn');
  await fireEvent(card, 'longPress');
  await fireEvent.press(screen.getByRole('button', { name: /^Clipe 2/ })); // the release that follows the hold
  expect(screen.getByText('1 selecionado')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: /^Clipe 2/ }));
  expect(screen.queryByText('1 selecionado')).toBeNull();
});

test('Apagar gravação removes the game and its clips after confirming, and goes to the list', async () => {
  repo.listClips.mockReturnValue([clip('a', 'gesture', 1), clip('b', 'screen', 2)]);
  repo.sessionStats.mockReturnValue({ clips: 2, bytes: 1, recordedMs: 1 });
  const reset = jest.fn();
  useSession.mockReturnValue({ reset, state: { sessionId: 's1' } });
  const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
  await render(<SessionSummary />);
  await fireEvent.press(screen.getByRole('button', { name: 'Apagar gravação' }));
  expect(repo.deleteSession).not.toHaveBeenCalled();
  await act(async () => lastAlertButtons(alert).find((b) => b.text === 'Apagar')!.onPress!());
  expect(repo.deleteSession).toHaveBeenCalledWith('s1');
  expect(jest.requireMock('../../data/mmkv').removeFile).toHaveBeenCalledTimes(2);
  expect(reset).toHaveBeenCalled();
  expect(router.dismissTo).toHaveBeenCalledWith('/games');
  alert.mockRestore();
});

test('deleting the last clip removes the game too and goes back to the list', async () => {
  repo.listClips.mockReturnValue([clip('a', 'gesture', 1)]);
  repo.sessionStats.mockReturnValue({ clips: 1, bytes: 1, recordedMs: 1 });
  const reset = jest.fn();
  useSession.mockReturnValue({ reset, state: { sessionId: 's1' } });
  await render(<SessionSummary />);
  expect(repo.deleteSession).not.toHaveBeenCalled();
  repo.listClips.mockReturnValue([]);
  repo.sessionStats.mockReturnValue({ clips: 0, bytes: 0, recordedMs: 1 });
  await act(async () => repo.__change());
  expect(repo.deleteSession).toHaveBeenCalledWith('s1');
  expect(reset).toHaveBeenCalled();
  expect(router.dismissTo).toHaveBeenCalledWith('/games');
});

test('a game recorded without any clip still opens as an empty summary', async () => {
  repo.listClips.mockReturnValue([]);
  repo.sessionStats.mockReturnValue({ clips: 0, bytes: 0, recordedMs: 1 });
  await render(<SessionSummary />);
  await act(async () => repo.__change());
  expect(repo.deleteSession).not.toHaveBeenCalled();
  expect(router.dismissTo).not.toHaveBeenCalled();
});

test('an English phone sees the selection and delete texts in English', async () => {
  setLocale('en');
  try {
    repo.listClips.mockReturnValue([clip('a', 'gesture', 1), clip('b', 'screen', 2)]);
    repo.sessionStats.mockReturnValue({ clips: 2, bytes: 1, recordedMs: 1 });
    const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    await render(<SessionSummary />);
    await fireEvent.press(screen.getByRole('button', { name: 'Select clips' }));
    await fireEvent.press(screen.getByRole('button', { name: /^Clip 1/ }));
    expect(screen.getByText('1 selected')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete 1 clip' }));
    expect(alert).toHaveBeenLastCalledWith('Delete 1 clip?', "This can't be undone.", expect.any(Array));
    alert.mockRestore();
  } finally {
    await act(async () => setLocale('pt-BR'));
  }
});

describe('batch: save, send or compile the picked clips', () => {
  const done = (o: { clips: { id: string }[] }) => o.clips.map((clip) => ({ clip, path: `/exports/${clip.id}.mp4` }));
  const timing = { totalMs: 1000, perClipMs: [], concurrency: 2 };
  const three = () => {
    repo.listClips.mockReturnValue([clip('a', 'gesture', 1), clip('b', 'screen', 2), clip('c', 'screen', 3)]);
    repo.sessionStats.mockReturnValue({ clips: 3, bytes: 1, recordedMs: 1 });
  };
  const pick = async (...numbers: number[]) => {
    await fireEvent.press(screen.getByRole('button', { name: 'Selecionar clipes' }));
    for (const n of numbers) await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^Clipe ${n}`) }));
  };
  const press = (name: string) => act(async () => fireEvent.press(screen.getByRole('button', { name })));

  beforeEach(() => {
    runBatch.mockImplementation(async (o: { clips: { id: string }[]; onProgress: (d: number, t: number) => void }) => {
      o.onProgress(o.clips.length, o.clips.length);
      return { done: done(o), failed: [], timing };
    });
    Object.keys(mockShapes).forEach((k) => delete mockShapes[k]);
  });

  test('selecting shows Enviar (N) on its own line, then Salvar, Compilar and Apagar, all visible', async () => {
    three();
    await render(<SessionSummary />);
    await pick(1, 3);
    for (const name of ['Enviar (2)', 'Salvar (2)', 'Compilar', 'Apagar 2 clipes']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mais' })).toBeNull();
  });

  test('nothing picked: the actions wait for a pick', async () => {
    three();
    await render(<SessionSummary />);
    await pick();
    expect(screen.getByRole('button', { name: 'Enviar (0)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Salvar (0)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Compilar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apagar' })).toBeDisabled();
  });

  test('Salvar exports the picked clips in order and saves each to Photos', async () => {
    three();
    await render(<SessionSummary />);
    await pick(1, 3);
    await press('Salvar (2)');
    expect(runBatch.mock.calls[0][0].clips.map((c: { id: string }) => c.id)).toEqual(['a', 'c']);
    expect(media.Asset.create.mock.calls.map((c: string[]) => c[0])).toEqual(['file:///exports/a.mp4', 'file:///exports/c.mp4']);
    expect(repo.updateClip).toHaveBeenCalledWith('a', { savedAt: expect.any(Number) });
    expect(screen.getByText('2 clipes salvos na galeria.')).toBeTruthy();
  });

  test('Salvar without access to Photos says so and makes nothing', async () => {
    three();
    media.requestPermissionsAsync.mockResolvedValueOnce({ granted: false });
    await render(<SessionSummary />);
    await pick(1);
    await press('Salvar (1)');
    expect(screen.getByText('Sem acesso às fotos. Libere em Ajustes.')).toBeTruthy();
    expect(runBatch).not.toHaveBeenCalled();
  });

  test('Salvar counts each clip in the session summary and reports one clip_shared for the batch', async () => {
    three();
    await render(<SessionSummary />);
    await pick(1, 3);
    (track as jest.Mock).mockClear();
    (sessionSummary.note as jest.Mock).mockClear();
    await press('Salvar (2)');
    expect((sessionSummary.note as jest.Mock).mock.calls).toEqual([['export'], ['export']]);
    expect((track as jest.Mock).mock.calls).toEqual([['clip_shared', { destination: 'photos' }]]);
  });

  test('Enviar counts each clip and reports one clip_shared, and a dismissed sheet reports none', async () => {
    three();
    await render(<SessionSummary />);
    await pick(1, 2, 3);
    (track as jest.Mock).mockClear();
    (sessionSummary.note as jest.Mock).mockClear();
    await press('Enviar (3)');
    expect((sessionSummary.note as jest.Mock).mock.calls).toHaveLength(3);
    expect((track as jest.Mock).mock.calls).toEqual([['clip_shared', { destination: 'share_sheet' }]]);
    native.shareFiles.mockResolvedValueOnce('cancelled');
    (track as jest.Mock).mockClear();
    await press('Enviar (3)');
    expect(track).not.toHaveBeenCalled();
  });

  test('Enviar opens one share sheet with every picked clip', async () => {
    three();
    await render(<SessionSummary />);
    await pick(1, 2, 3);
    await press('Enviar (3)');
    expect(native.shareFiles).toHaveBeenCalledWith(['/exports/a.mp4', '/exports/b.mp4', '/exports/c.mp4']);
    expect(repo.updateClip).toHaveBeenCalledWith('b', { sharedAt: expect.any(Number) });
  });

  test('a partial failure names the clip that did not come out', async () => {
    three();
    runBatch.mockImplementationOnce(async (o: { clips: { id: string }[] }) => ({
      done: done({ clips: [o.clips[0], o.clips[2]] }),
      failed: [{ clip: o.clips[1], reason: 'export' }],
      timing,
    }));
    await render(<SessionSummary />);
    await pick(1, 2, 3);
    await press('Salvar (3)');
    expect(screen.getByText('2 de 3 prontos. Não saíram: Clipe 2.')).toBeTruthy();
  });

  test('Compilar on the free plan opens the paywall and makes nothing', async () => {
    three();
    repo.getSession.mockReturnValue({ id: 's1', sport: 'futevolei', startedAt: 0, paid: false });
    await render(<SessionSummary />);
    await pick(1, 2);
    await press('Compilar');
    expect(payments.showPaywall).toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('pro_feature_blocked', { feature: 'compile' });
    expect(track).toHaveBeenCalledWith('paywall_viewed', { source: 'locked_feature', offering: 'default' });
    expect(runBatch).not.toHaveBeenCalled();
  });

  test('Compilar with one clip says to pick at least 2', async () => {
    three();
    await render(<SessionSummary />);
    await pick(1);
    await press('Compilar');
    expect(screen.getByText('Escolha pelo menos 2 clipes para compilar.')).toBeTruthy();
    expect(runBatch).not.toHaveBeenCalled();
  });

  test('Compilar joins the exports in order in the majority orientation and opens the share sheet with the video', async () => {
    three();
    mockShapes.a = { width: 1920, height: 1080 };
    mockShapes.b = { width: 1920, height: 1080 };
    mockShapes.c = { width: 1080, height: 1920 };
    await render(<SessionSummary />);
    await pick(1, 2, 3);
    await press('Compilar');
    expect(runBatch.mock.calls[0][0].orientation).toBe('landscape');
    expect(native.concatVideos).toHaveBeenCalledWith(['/exports/a.mp4', '/exports/b.mp4', '/exports/c.mp4'], expect.stringContaining('compilation'));
    expect(native.shareFiles).toHaveBeenCalledTimes(1);
    expect(native.shareFiles).toHaveBeenLastCalledWith([expect.stringContaining('compilation')]);
    expect(screen.queryByText('Compilação pronta')).toBeNull();
  });

  test('a failed join says why: the error code shows under the message', async () => {
    three();
    native.concatVideos.mockRejectedValueOnce(Object.assign(new Error('the clips differ in size or codec'), { code: 'CONCAT_MISMATCH' }));
    await render(<SessionSummary />);
    await pick(1, 2);
    await press('Compilar');
    expect(screen.getByText('Não foi possível preparar o vídeo. Tente de novo.')).toBeTruthy();
    expect(screen.getByText(/CONCAT_MISMATCH/)).toBeTruthy();
  });

  test('Compilar with fewer than 2 clips coming out makes no video', async () => {
    three();
    runBatch.mockImplementationOnce(async (o: { clips: { id: string }[] }) => ({
      done: done({ clips: [o.clips[0]] }),
      failed: [{ clip: o.clips[1], reason: 'export' }],
      timing,
    }));
    await render(<SessionSummary />);
    await pick(1, 2);
    await press('Compilar');
    expect(native.concatVideos).not.toHaveBeenCalled();
    expect(screen.getByText('Sobrou menos de 2 clipes para compilar.')).toBeTruthy();
  });

  test('leaving the screen mid-batch cancels it and says nothing afterwards', async () => {
    three();
    let release: () => void = () => {};
    let signal: { cancelled: boolean } = { cancelled: false };
    runBatch.mockImplementationOnce(
      (o: { clips: { id: string }[]; signal: { cancelled: boolean } }) =>
        new Promise((resolve) => {
          signal = o.signal;
          release = () => resolve({ done: done(o), failed: [], timing });
        }),
    );
    const view = await render(<SessionSummary />);
    await pick(1, 2);
    await press('Salvar (2)');
    await act(async () => view.unmount());
    expect(signal.cancelled).toBe(true);
    await act(async () => release());
    expect(media.Asset.create).not.toHaveBeenCalled();
    expect(mockCapturer.release).toHaveBeenCalled();
  });

  test('a picked clip deleted elsewhere drops out of the selection and the counts', async () => {
    three();
    await render(<SessionSummary />);
    await pick(1, 3);
    repo.listClips.mockReturnValue([clip('a', 'gesture', 1), clip('b', 'screen', 2)]);
    await act(async () => repo.__change());
    expect(screen.getByRole('button', { name: 'Salvar (1)' })).toBeTruthy();
    await press('Salvar (1)');
    expect(runBatch.mock.calls[0][0].clips.map((c: { id: string }) => c.id)).toEqual(['a']);
  });
});
