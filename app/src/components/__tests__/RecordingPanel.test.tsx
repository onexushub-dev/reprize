import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { emitRemoteEnd } from '../../triggers/remoteCommands';
import { RecordingPanel as Recording, REMOTE_END_SIGNAL_MS } from '../RecordingPanel';

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));
jest.mock('../../data/mmkv', () => ({
  repo: {
    listClips: jest.fn(() => [{ id: 'c1' }]),
    deleteSession: jest.fn(() => []),
    getPrefs: jest.fn(() => ({ screenEconomy: true, soundOnSave: true, flashOnSave: false })),
    setPrefs: jest.fn((patch: object) => ({ screenEconomy: true, ...patch })),
  },
  removeFile: jest.fn(),
}));
jest.mock('../../../modules/replay-camera', () => ({
  addReplayListener: jest.fn(() => ({ remove: jest.fn() })),
  setScreenEconomy: jest.fn(),
  getWatchStatus: jest.fn(() => 'unsupported'),
  signalAction: jest.fn(),
}));
jest.mock('../../session/SessionContext', () => ({ useSession: jest.fn() }));
jest.mock('../../devices/bluetoothRemote', () => ({ useRemoteLink: jest.fn(() => undefined) }));

const { useSession } = jest.requireMock('../../session/SessionContext');
const { router } = jest.requireMock('expo-router');
const { repo } = jest.requireMock('../../data/mmkv');
const { setScreenEconomy } = jest.requireMock('../../../modules/replay-camera');
const { useRemoteLink } = jest.requireMock('../../devices/bluetoothRemote');

function session(state: object) {
  const value = {
    state: {
      phase: 'recording',
      sessionId: 's1',
      startedAt: Date.now(),
      clipCount: 0,
      saving: false,
      paused: false,
      thermal: { level: 'nominal', degraded: false },
      ...state,
    },
    trigger: jest.fn(),
    undoLast: jest.fn(),
    stop: jest.fn(async () => 's1'),
    reset: jest.fn(),
  };
  useSession.mockReturnValue(value);
  return value;
}

beforeEach(() => jest.clearAllMocks());

test('the count is shown in a small pill, not over the preview', async () => {
  session({ clipCount: 3 });
  await render(<Recording />);
  expect(screen.getByText('3 clipes')).toBeTruthy();
});

test('tells the player clearly how to save', async () => {
  session({});
  await render(<Recording />);
  const line = screen.getByText('Toque na tela para salvar os últimos 30s');
  // One line on every phone: it shrinks to fit instead of wrapping (2026-11-01, iPhone XR).
  expect(line.props.numberOfLines).toBe(1);
  expect(line.props.adjustsFontSizeToFit).toBe(true);
});

test('tapping the screen saves a clipe', async () => {
  const s = session({});
  await render(<Recording />);
  await fireEvent.press(screen.getByRole('button', { name: /Toque em qualquer lugar/ }));
  expect(s.trigger).toHaveBeenCalledWith('screen');
});

test('the saved card shows as the save starts, with the sound and the torch, before the file is written', async () => {
  session({ clipCount: 3, saving: true, pendingSave: { number: 4, source: 'remote', at: Date.now(), cutMs: 15000 } });
  await render(<Recording />);
  expect(screen.getByText('CLIPE #4 SALVO')).toBeTruthy();
});

test('Desfazer tapped before the file is written undoes the clip once it exists', async () => {
  const at = Date.now();
  const s = session({ clipCount: 0, saving: true, pendingSave: { number: 1, source: 'remote', at, cutMs: 15000 } });
  const view = await render(<Recording />);
  await fireEvent.press(screen.getByRole('button', { name: 'Desfazer' }));
  expect(s.undoLast).not.toHaveBeenCalled();
  session({ clipCount: 1, lastSaved: { clipId: 'c1', number: 1, source: 'remote', at, cutMs: 15000 } });
  const again = jest.requireMock('../../session/SessionContext').useSession();
  await view.rerender(<Recording />);
  expect(again.undoLast).toHaveBeenCalledTimes(1);
});

test('a saved clipe shows the overlay with its number and source', async () => {
  session({ clipCount: 3, lastSaved: { clipId: 'c3', number: 3, source: 'gesture', at: Date.now(), cutMs: 30000 } });
  await render(<Recording />);
  expect(screen.getByText('CLIPE #3 SALVO')).toBeTruthy();
  expect(screen.getByText('via Gesto · 30s')).toBeTruthy();
});

test('Desfazer undoes the last clipe', async () => {
  const s = session({ clipCount: 1, lastSaved: { clipId: 'c1', number: 1, source: 'screen', at: Date.now(), cutMs: 30000 } });
  await render(<Recording />);
  await fireEvent.press(screen.getByRole('button', { name: 'Desfazer' }));
  expect(s.undoLast).toHaveBeenCalled();
});

test('holding the footer ends the game and opens its summary', async () => {
  const s = session({});
  await render(<Recording />);
  jest.useFakeTimers();
  await fireEvent(screen.getByRole('button', { name: 'Segure para encerrar a gravação' }), 'pressIn');
  await act(async () => jest.advanceTimersByTime(1000));
  jest.useRealTimers();
  expect(s.stop).toHaveBeenCalled();
  expect(router.push).toHaveBeenCalledWith('/session/s1');
});

describe('a quality step (2026-11-08: calm, a few seconds, then a chip)', () => {
  test('says the recording is steady in the quality now in use, never "quente"', async () => {
    session({ thermal: { level: 'serious', degraded: true, quality: '1080p30' } });
    await render(<Recording />);
    expect(screen.getByText('Gravação estável em 1080p/30')).toBeTruthy();
    expect(screen.queryByText(/quente/i)).toBeNull();
  });

  test('then 720p at 30 fps', async () => {
    session({ thermal: { level: 'critical', degraded: true, quality: '720p30' } });
    await render(<Recording />);
    expect(screen.getByText('Gravação estável em 720p/30')).toBeTruthy();
  });

  test('goes away by itself and leaves the quality chip at the top', async () => {
    jest.useFakeTimers();
    session({ thermal: { level: 'serious', degraded: true, quality: '1080p30' } });
    await render(<Recording />);
    await act(async () => jest.advanceTimersByTime(8000));
    expect(screen.queryByTestId('heat-step')).toBeNull();
    expect(screen.getByTestId('quality-chip')).toBeTruthy();
    expect(screen.getByText('1080p/30')).toBeTruthy();
    jest.useRealTimers();
  });

  test('a second step shows again, once', async () => {
    jest.useFakeTimers();
    session({ thermal: { level: 'serious', degraded: true, quality: '1080p30' } });
    const view = await render(<Recording />);
    await act(async () => jest.advanceTimersByTime(8000));
    session({ thermal: { level: 'critical', degraded: true, quality: '720p30' } });
    await view.rerender(<Recording />);
    expect(screen.getByText('Gravação estável em 720p/30')).toBeTruthy();
    jest.useRealTimers();
  });
});

test('an interrupted game shows the paused banner', async () => {
  session({ paused: true });
  await render(<Recording />);
  expect(screen.getByText('Gravação pausada. Volte para o app para continuar.')).toBeTruthy();
});

test('a native error says recording stopped and offers the saved clipes', async () => {
  session({ phase: 'ended', error: 'ENCODER_FAILED', thermalStop: true });
  await render(<Recording />);
  expect(screen.getByText('A gravação parou: celular muito quente')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Ver clipes' }));
  expect(router.push).toHaveBeenCalledWith('/session/s1');
});

test('a clipe saved by voice says so', async () => {
  session({ clipCount: 1, lastSaved: { clipId: 'c1', number: 1, source: 'voice', at: Date.now(), cutMs: 30000 } });
  await render(<Recording />);
  expect(screen.getByText('via Voz · 30s')).toBeTruthy();
});

test('the saved popup tells the length the clip really has, not the length asked for', async () => {
  session({ clipCount: 2, lastSaved: { clipId: 'c2', number: 2, source: 'screen', at: Date.now(), cutMs: 7000 } });
  await render(<Recording clipSeconds={30} />);
  expect(screen.getByText('via Tela · 7s')).toBeTruthy();
  expect(screen.queryByText(/60s guardados/)).toBeNull();
});

test('the hint says the clip length and shows one tag per way that is on, without a line of "ou"', async () => {
  session({ paid: true });
  await render(<Recording clipSeconds={45} gesture={false} voice />);
  expect(screen.getByText('Toque na tela para salvar os últimos 45s')).toBeTruthy();
  expect(screen.getByText('Diga “salvar”')).toBeTruthy();
  expect(screen.getByText('Controle')).toBeTruthy();
  expect(screen.queryByText('Acene')).toBeNull();
  expect(screen.queryByText(/ ou /)).toBeNull();
});

test('the wave tag shows when the gesture is on', async () => {
  session({ paid: true });
  await render(<Recording clipSeconds={30} gesture voice={false} />);
  expect(screen.getByText('Acene')).toBeTruthy();
  expect(screen.queryByText('Diga “salvar”')).toBeNull();
});

test('in a free game the Bluetooth remote has its tag too: it is free', async () => {
  session({ paid: false });
  await render(<Recording clipSeconds={15} gesture voice={false} />);
  expect(screen.getByText('Acene')).toBeTruthy();
  expect(screen.getByText('Controle')).toBeTruthy();
});

test('a remote phone asking to end the recording ends it like the hold button does', async () => {
  const s = session({});
  await render(<Recording />);
  const calls = jest.requireMock('../../../modules/replay-camera').addReplayListener.mock.calls;
  const ask = calls.filter((c: any[]) => c[0] === 'onRemoteStop').pop()[1];
  await act(async () => ask());
  expect(s.stop).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith('/session/s1');
});

describe('the remote held 2 s ends the recording (2026-11-07)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('its sound and torch first, then it ends and stays on the setup screen', async () => {
    const s = session({});
    await render(<Recording />);
    await act(async () => emitRemoteEnd());
    const native = jest.requireMock('../../../modules/replay-camera');
    expect(native.signalAction).toHaveBeenCalledWith('ended', { sound: true, flash: false });
    expect(s.stop).not.toHaveBeenCalled(); // the chime plays before the camera stops
    await act(async () => void jest.advanceTimersByTime(REMOTE_END_SIGNAL_MS));
    expect(s.stop).toHaveBeenCalledTimes(1);
    expect(s.reset).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(repo.deleteSession).not.toHaveBeenCalled(); // it has clips: kept in Minhas gravações
  });

  test('with the screen dark, it lights the screen up before the recording ends', async () => {
    const s = session({});
    await render(<Recording />);
    await act(async () => void jest.advanceTimersByTime(20_000));
    expect(setScreenEconomy).toHaveBeenLastCalledWith(true);
    await act(async () => emitRemoteEnd());
    expect(setScreenEconomy).toHaveBeenLastCalledWith(false);
    expect(s.stop).not.toHaveBeenCalled();
    await act(async () => void jest.advanceTimersByTime(REMOTE_END_SIGNAL_MS));
    expect(s.stop).toHaveBeenCalledTimes(1);
  });

  test('a recording with no clips is deleted', async () => {
    repo.listClips.mockReturnValueOnce([]);
    const s = session({});
    await render(<Recording />);
    await act(async () => emitRemoteEnd());
    await act(async () => void jest.advanceTimersByTime(REMOTE_END_SIGNAL_MS));
    expect(s.stop).toHaveBeenCalled();
    expect(repo.deleteSession).toHaveBeenCalledWith('s1');
  });

  test('a second hold while it ends changes nothing', async () => {
    const s = session({});
    await render(<Recording />);
    await act(async () => emitRemoteEnd());
    await act(async () => emitRemoteEnd());
    await act(async () => void jest.advanceTimersByTime(REMOTE_END_SIGNAL_MS));
    expect(s.stop).toHaveBeenCalledTimes(1);
  });

  test('outside a recording a hold does nothing', async () => {
    const s = session({ phase: 'idle' });
    await render(<Recording />);
    await act(async () => emitRemoteEnd());
    await act(async () => void jest.advanceTimersByTime(REMOTE_END_SIGNAL_MS));
    expect(s.stop).not.toHaveBeenCalled();
  });
});

test('a stop asked outside a recording is ignored', async () => {
  const s = session({ phase: 'idle' });
  await render(<Recording />);
  const calls = jest.requireMock('../../../modules/replay-camera').addReplayListener.mock.calls;
  const ask = calls.filter((c: any[]) => c[0] === 'onRemoteStop').pop()[1];
  await act(async () => ask());
  expect(s.stop).not.toHaveBeenCalled();
});

test('after saving, no payments note shows', async () => {
  session({ clipCount: 10, lastSaved: { clipId: 'c10', number: 10, source: 'screen', at: Date.now() } });
  await render(<Recording />);
  expect(screen.queryByText(/Último clipe grátis/)).toBeNull();
  expect(screen.queryByText(/Guardado. Libere/)).toBeNull();
});

describe('a recording without any clip', () => {
  test('ending it removes it and opens Minhas gravações', async () => {
    repo.listClips.mockReturnValue([]);
    const s = session({});
    await render(<Recording />);
    jest.useFakeTimers();
    await fireEvent(screen.getByRole('button', { name: 'Segure para encerrar a gravação' }), 'pressIn');
    await act(async () => jest.advanceTimersByTime(1000));
    jest.useRealTimers();
    await act(async () => {});
    expect(repo.deleteSession).toHaveBeenCalledWith('s1');
    expect(s.reset).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/games');
    expect(router.push).not.toHaveBeenCalledWith('/session/s1');
    repo.listClips.mockReturnValue([{ id: 'c1' }]);
  });

  test('stopped by an error, it offers Minhas gravações instead of an empty summary', async () => {
    repo.listClips.mockReturnValue([]);
    const s = session({ phase: 'ended', error: 'ENCODER_FAILED', clipCount: 0 });
    await render(<Recording />);
    await fireEvent.press(screen.getByRole('button', { name: 'Minhas gravações' }));
    expect(repo.deleteSession).toHaveBeenCalledWith('s1');
    expect(s.reset).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/games');
    repo.listClips.mockReturnValue([{ id: 'c1' }]);
  });
});

describe('screen economy', () => {
  test('after 20 s without a touch the screen goes dark and says a tap wakes it', async () => {
    session({});
    jest.useFakeTimers();
    await render(<Recording />);
    expect(screen.queryByTestId('screen-economy')).toBeNull();
    await act(async () => jest.advanceTimersByTime(20_000));
    expect(screen.getByTestId('screen-economy')).toBeTruthy();
    expect(screen.getByText('Tela em economia para poupar bateria. Toque para acender.')).toBeTruthy();
    expect(screen.queryByText(/Toque na tela para salvar/)).toBeNull();
    expect(setScreenEconomy).toHaveBeenLastCalledWith(true);
    jest.useRealTimers();
  });

  test('a recording that starts with battery saving on says so for a few seconds', async () => {
    session({});
    jest.useFakeTimers();
    await render(<Recording />);
    expect(screen.getByTestId('economy-notice')).toBeTruthy();
    expect(screen.getByText('Economia de bateria ligada')).toBeTruthy();
    expect(screen.getByText('A tela escurece depois de 20 segundos sem toque. Toque para acender.')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(5000));
    expect(screen.queryByTestId('economy-notice')).toBeNull();
    jest.useRealTimers();
  });

  test('with battery saving off there is no notice', async () => {
    session({});
    repo.getPrefs.mockReturnValue({ screenEconomy: false });
    await render(<Recording />);
    expect(screen.queryByTestId('economy-notice')).toBeNull();
    repo.getPrefs.mockReturnValue({ screenEconomy: true });
  });

  test('with Economia de bateria off on the setup screen the screen never goes dark', async () => {
    session({});
    repo.getPrefs.mockReturnValue({ screenEconomy: false });
    jest.useFakeTimers();
    await render(<Recording />);
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(screen.queryByTestId('screen-economy')).toBeNull();
    expect(setScreenEconomy).not.toHaveBeenCalledWith(true);
    jest.useRealTimers();
    repo.getPrefs.mockReturnValue({ screenEconomy: true });
  });

  test('the first tap while dark only wakes the screen: no clip is saved', async () => {
    const s = session({});
    jest.useFakeTimers();
    await render(<Recording />);
    await act(async () => jest.advanceTimersByTime(20_000));
    const surface = screen.getByRole('button', { name: /Toque em qualquer lugar/ });
    await fireEvent(surface, 'touchStart');
    await fireEvent.press(surface);
    expect(s.trigger).not.toHaveBeenCalled();
    expect(screen.queryByTestId('screen-economy')).toBeNull();
    expect(setScreenEconomy).toHaveBeenLastCalledWith(false);
    jest.useRealTimers();
  });

  test('once awake, the next tap saves as usual', async () => {
    const s = session({});
    jest.useFakeTimers();
    await render(<Recording />);
    await act(async () => jest.advanceTimersByTime(20_000));
    const surface = screen.getByRole('button', { name: /Toque em qualquer lugar/ });
    await fireEvent(surface, 'touchStart');
    await fireEvent.press(surface);
    await fireEvent(surface, 'touchStart');
    await fireEvent.press(surface);
    expect(s.trigger).toHaveBeenCalledTimes(1);
    expect(s.trigger).toHaveBeenCalledWith('screen');
    jest.useRealTimers();
  });

  test('battery saving can be turned off mid-recording: no clip, a word on it, the screen stays lit, the choice is kept', async () => {
    const s = session({});
    jest.useFakeTimers();
    await render(<Recording />);
    const toggle = screen.getByRole('switch', { name: 'Economia de bateria' });
    expect(toggle.props.accessibilityState.checked).toBe(true);
    await fireEvent(toggle, 'touchStart');
    await fireEvent.press(toggle);
    expect(s.trigger).not.toHaveBeenCalled();
    expect(repo.setPrefs).toHaveBeenCalledWith({ screenEconomy: false });
    // The same notice, in the same place, as when a recording starts with battery saving on.
    const notice = screen.getByTestId('economy-notice');
    expect(within(notice).getByText('Economia de bateria desligada')).toBeTruthy();
    expect(within(notice).getByText('A tela fica acesa durante a gravação.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Economia de bateria' }).props.accessibilityState.checked).toBe(false);
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(screen.queryByTestId('screen-economy')).toBeNull();
    jest.useRealTimers();
  });

  test('battery saving can be turned on mid-recording: the start notice says so, and the screen goes dark 20 s later', async () => {
    session({});
    repo.getPrefs.mockReturnValue({ screenEconomy: false });
    jest.useFakeTimers();
    await render(<Recording />);
    await fireEvent.press(screen.getByRole('switch', { name: 'Economia de bateria' }));
    expect(repo.setPrefs).toHaveBeenCalledWith({ screenEconomy: true });
    const notice = screen.getByTestId('economy-notice');
    expect(within(notice).getByText('Economia de bateria ligada')).toBeTruthy();
    expect(within(notice).getByText('A tela escurece depois de 20 segundos sem toque. Toque para acender.')).toBeTruthy();
    expect(screen.getAllByText('Economia de bateria ligada')).toHaveLength(1);
    await act(async () => jest.advanceTimersByTime(5000));
    expect(screen.queryByTestId('economy-notice')).toBeNull();
    await act(async () => jest.advanceTimersByTime(15_000));
    expect(screen.getByTestId('screen-economy')).toBeTruthy();
    jest.useRealTimers();
    repo.getPrefs.mockReturnValue({ screenEconomy: true });
  });

  test('the battery saving button is hidden while the screen is dark, so the waking tap cannot flip it', async () => {
    session({});
    jest.useFakeTimers();
    await render(<Recording />);
    await act(async () => jest.advanceTimersByTime(20_000));
    expect(screen.queryByRole('switch', { name: 'Economia de bateria' })).toBeNull();
    jest.useRealTimers();
  });

  test('ending the game is still possible while dark', async () => {
    session({});
    jest.useFakeTimers();
    await render(<Recording />);
    await act(async () => jest.advanceTimersByTime(20_000));
    expect(screen.getByRole('button', { name: 'Segure para encerrar a gravação' })).toBeTruthy();
    jest.useRealTimers();
  });
});

describe('remote gone', () => {
  const title = 'Controle sem conexão';
  const body = 'Aperte um botão do controle. Se não voltar, desligue e ligue o controle.';

  test('2026-11-03: the remote gone for 30 s in a game says so at the top, and goes away when it is back', async () => {
    session({});
    repo.getPrefs.mockReturnValue({ screenEconomy: false }); // a dark screen shows it once woken (next test)
    jest.useFakeTimers();
    useRemoteLink.mockReturnValue('connected');
    const view = await render(<Recording />);
    useRemoteLink.mockReturnValue('missing');
    await view.rerender(<Recording />);
    await act(async () => jest.advanceTimersByTime(5000)); // the start notice is gone
    expect(screen.queryByText(title)).toBeNull(); // a short walk out of range says nothing
    await act(async () => jest.advanceTimersByTime(25_000));
    const notice = screen.getByTestId('remote-lost-notice');
    expect(notice.props.accessibilityRole).toBe('alert');
    expect(screen.getByText(body)).toBeTruthy();
    useRemoteLink.mockReturnValue('connected');
    await view.rerender(<Recording />);
    expect(screen.queryByTestId('remote-lost-notice')).toBeNull();
    jest.useRealTimers();
    useRemoteLink.mockReturnValue(undefined);
    repo.getPrefs.mockReturnValue({ screenEconomy: true });
  });

  test('with the screen dark it waits: the tap that wakes the screen shows it', async () => {
    session({});
    jest.useFakeTimers();
    useRemoteLink.mockReturnValue('connected');
    const view = await render(<Recording />);
    useRemoteLink.mockReturnValue('missing');
    await view.rerender(<Recording />);
    await act(async () => jest.advanceTimersByTime(30_000));
    expect(screen.getByTestId('screen-economy')).toBeTruthy();
    expect(screen.queryByTestId('remote-lost-notice')).toBeNull();
    await fireEvent(screen.getByRole('button', { name: /Toque em qualquer lugar/ }), 'touchStart');
    expect(screen.getByTestId('remote-lost-notice')).toBeTruthy();
    jest.useRealTimers();
    useRemoteLink.mockReturnValue(undefined);
  });

  test('a remote not used in this game (never connected) never shows it', async () => {
    session({});
    jest.useFakeTimers();
    useRemoteLink.mockReturnValue('missing');
    await render(<Recording />);
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(screen.queryByText(title)).toBeNull();
    jest.useRealTimers();
    useRemoteLink.mockReturnValue(undefined);
  });
});

describe('heat tip (only from serious on)', () => {
  const tip = 'Dica para gravar melhor';

  test('nothing at fair', async () => {
    session({ thermal: { level: 'fair', degraded: false } });
    await render(<Recording />);
    expect(screen.queryByText(tip)).toBeNull();
  });

  test('shows once at serious, then goes away by itself', async () => {
    session({ thermal: { level: 'serious', degraded: false } });
    jest.useFakeTimers();
    await render(<Recording />);
    expect(screen.getByText(tip)).toBeTruthy();
    expect(screen.getByText('Sem capinha e fora do sol, o iPhone trabalha mais fresco e mantém a melhor qualidade.')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(8000));
    expect(screen.queryByText(tip)).toBeNull();
    jest.useRealTimers();
  });

  test('does not come back in the same recording', async () => {
    session({ thermal: { level: 'serious', degraded: false } });
    jest.useFakeTimers();
    const view = await render(<Recording />);
    await act(async () => jest.advanceTimersByTime(8000));
    session({ thermal: { level: 'fair', degraded: false } });
    await view.rerender(<Recording />);
    session({ thermal: { level: 'serious', degraded: false } });
    await view.rerender(<Recording />);
    expect(screen.queryByText(tip)).toBeNull();
    jest.useRealTimers();
  });

  test('not next to the quality step, which carries the same advice', async () => {
    session({ thermal: { level: 'serious', degraded: true, quality: '1080p30' } });
    await render(<Recording />);
    expect(screen.queryByText(tip)).toBeNull();
  });
});
