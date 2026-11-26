import { act, fireEvent, render, screen } from '@testing-library/react-native';

import Devices from '../devices';
import { colors } from '../../theme/tokens';
import { learnRemoteAtPress, resetRemoteLinkForTests } from '../../devices/bluetoothRemote';
import { clearRemotePress, isRemoteSheetOpen, markRemotePress } from '../../devices/remoteTest';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
// What iOS shows connected over Bluetooth; nothing known by default (a classic remote, or none learnt).
jest.mock('../../../modules/replay-camera', () => ({ bluetoothConnected: jest.fn(async () => undefined) }));
// The camera under the sheet: on unless a test opens the app fresh.
jest.mock('../../session/SessionContext', () => ({ useSession: jest.fn(() => ({ state: { camera: 'on' } })) }));
jest.mock('../../data/mmkv', () => {
  let prefs: any = {};
  return {
    __reset: () => (prefs = {}),
    repo: {
      getPrefs: () => prefs,
      setPrefs: jest.fn((p: object) => (prefs = { ...prefs, ...p })),
    },
  };
});

const { repo } = jest.requireMock('../../data/mmkv');
const { router } = jest.requireMock('expo-router');

// The setup screen under the sheet is the one listening; a press it hears reaches the sheet through remoteTest.
const press = async () => {
  await act(async () => {
    if (!repo.getPrefs().remoteTestedAt) repo.setPrefs({ remoteTestedAt: Date.now() });
    markRemotePress();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  resetRemoteLinkForTests();
  jest.useFakeTimers();
  jest.requireMock('../../data/mmkv').__reset();
  clearRemotePress();
});

afterEach(() => jest.useRealTimers());

test('first time: tells how to pair the remote, step by step, and tells the setup screen to keep listening', async () => {
  await render(<Devices />);
  expect(screen.getByText('Controle Bluetooth')).toBeTruthy();
  expect(screen.queryByText('Seus controles')).toBeNull();
  expect(screen.getByText('Ligue o controle e deixe em modo de pareamento.')).toBeTruthy();
  expect(screen.getByText('No iPhone abra Ajustes > Bluetooth e toque no nome dele.')).toBeTruthy();
  expect(screen.getByText('Volte ao Reprize e aperte um botão do controle.')).toBeTruthy();
  expect(screen.getByText('Aperte um botão do controle…')).toBeTruthy();
  expect(isRemoteSheetOpen()).toBe(true);
});

test('a press shows the remote as connected, in the list (2026-11-22: no first-time ✓ screen in between)', async () => {
  await render(<Devices />);
  await press();
  expect(screen.getByText('Seus controles')).toBeTruthy();
  expect(screen.getByLabelText('Controle, Conectado')).toBeTruthy();
  expect(screen.queryByText('Aperte um botão do controle…')).toBeNull();
});

test('the ✕ at the top closes the sheet, as on the camera panels', async () => {
  const { router } = jest.requireMock('expo-router');
  router.back.mockClear();
  await render(<Devices />);
  await fireEvent.press(screen.getByRole('button', { name: 'Fechar' }));
  expect(router.back).toHaveBeenCalledTimes(1);
});

test('used in a previous launch by a remote iOS never showed: its row in the list, waiting for a press (never "Pareado")', async () => {
  repo.setPrefs({ remoteTestedAt: 123 });
  await render(<Devices />);
  await act(async () => {});
  expect(screen.queryByText(/Pareado/)).toBeNull();
  expect(screen.getByText('Seus controles')).toBeTruthy();
  expect(screen.getByLabelText('Controle, Em espera · aperte um botão')).toBeTruthy();
  expect(screen.queryByText('Ligue o controle e deixe em modo de pareamento.')).toBeNull();
  await act(async () => markRemotePress());
  expect(screen.getByLabelText('Controle, Conectado')).toBeTruthy();
});

test('after 15 seconds without a press it adds the troubleshooting note and keeps the steps', async () => {
  await render(<Devices />);
  expect(screen.queryByText(/Confira se o controle aparece/)).toBeNull();
  await act(async () => jest.advanceTimersByTime(15_000));
  expect(screen.getByText(/Confira se o controle aparece como Conectado/)).toBeTruthy();
  expect(screen.getByText('Ligue o controle e deixe em modo de pareamento.')).toBeTruthy();
});

test('"Esquecer" asks first, explains how to remove it in Ajustes, then goes back to the first state', async () => {
  repo.setPrefs({ remoteTestedAt: 123 });
  const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
  await render(<Devices />);
  await fireEvent.press(screen.getByRole('button', { name: 'Esquecer Controle' }));
  expect(repo.getPrefs().remoteTestedAt).toBe(123);
  expect(alert.mock.calls[0][1]).toMatch(/Ajustes > Bluetooth/);
  const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  await act(async () => buttons.find((b) => b.text === 'Esquecer')!.onPress!());
  expect(repo.getPrefs().remoteTestedAt).toBeUndefined();
  expect(screen.getByText('Ligue o controle e deixe em modo de pareamento.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Esquecer Controle' })).toBeNull();
  alert.mockRestore();
});

test('there is no "Esquecer" before the remote was ever used', async () => {
  await render(<Devices />);
  expect(screen.queryByRole('button', { name: 'Esquecer controle' })).toBeNull();
});

test('a sheet as tall as what it holds: a tap above it closes it, as on the other sheets (2026-11-22)', async () => {
  router.back.mockClear();
  await render(<Devices />);
  expect(screen.getByTestId('devices-sheet')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('devices-backdrop'));
  expect(router.back).toHaveBeenCalledTimes(1);
});

test('"Pronto" is always the amber of the app, connected or not (2026-11-22)', async () => {
  const { StyleSheet } = jest.requireActual('react-native');
  await render(<Devices />);
  expect(StyleSheet.flatten(screen.getByRole('button', { name: 'Pronto' }).props.style).backgroundColor).toBe(colors.accent);
});

test('"Pronto" closes the sheet', async () => {
  await render(<Devices />);
  await fireEvent.press(screen.getByRole('button', { name: 'Pronto' }));
  expect(router.back).toHaveBeenCalled();
});

test('closing the sheet hands the volume buttons back to the setup screen alone', async () => {
  const view = await render(<Devices />);
  expect(isRemoteSheetOpen()).toBe(true);
  await view.unmount();
  expect(isRemoteSheetOpen()).toBe(false);
});

describe('the remotes the app has learnt (2026-11-22: a list, any one that is on saves)', () => {
  const cam = () => jest.requireMock('../../../modules/replay-camera');
  const shutter = { id: 'AAAA', name: 'AB Shutter3', services: ['battery', 'info'] };
  const selfie = { id: 'CCCC', name: 'Selfie Remote', services: ['hid'] };
  const both = [
    { id: 'AAAA', name: 'AB Shutter3' },
    { id: 'CCCC', name: 'Selfie Remote' },
  ];
  const { StyleSheet } = jest.requireActual('react-native');
  /** The rows of the list, top to bottom, as read out ("Controle, Conectado"). */
  const rows = () => screen.getAllByLabelText(/^Controle, /).map((row) => row.props.accessibilityLabel);

  test('connected over Bluetooth: its row says Conectado, in the green of the triggers panel, without a press', async () => {
    repo.setPrefs({ remoteTestedAt: 1, remoteBleId: 'AAAA', remoteBleName: 'AB Shutter3' }); // kept before the list
    cam().bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter] });
    await render(<Devices />);
    await act(async () => {});
    expect(screen.getByText('Seus controles')).toBeTruthy();
    expect(screen.getByLabelText('Controle, Conectado')).toBeTruthy();
    // A number, never the name iOS gives (a press does not say which remote it was, so a name could be the wrong one).
    expect(screen.queryByText('AB Shutter3')).toBeNull();
    expect(StyleSheet.flatten(screen.getByText('Conectado').props.style).color).toBe(colors.ok);
    expect(screen.getByText(/Qualquer controle conectado salva o lance/)).toBeTruthy();
    expect(cam().bluetoothConnected).toHaveBeenCalledWith(false); // never asks for Bluetooth just to look
  });

  test('gone (asleep, off, out of range, unpaired): "Em espera · aperte um botão", and it comes back on its own', async () => {
    repo.setPrefs({ remoteTestedAt: 1, remotes: [both[0]] });
    cam().bluetoothConnected.mockResolvedValue({ state: 'on', devices: [] });
    await render(<Devices />);
    await act(async () => {});
    expect(screen.getByLabelText('Controle, Em espera · aperte um botão')).toBeTruthy();
    expect(screen.getByText('Ligue o controle e aperte qualquer botão…')).toBeTruthy();
    expect(screen.getByText(/poupar bateria/)).toBeTruthy();
    cam().bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter] });
    await act(async () => void jest.advanceTimersByTime(2500));
    expect(screen.getByLabelText('Controle, Conectado')).toBeTruthy();
    expect(screen.queryByText('Ligue o controle e aperte qualquer botão…')).toBeNull();
  });

  test('two remotes: each its own status; with both on, both are Conectado and both save', async () => {
    repo.setPrefs({ remoteTestedAt: 1, remotes: both });
    cam().bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter] });
    await render(<Devices />);
    await act(async () => {});
    expect(rows()).toEqual(['Controle, Conectado', 'Controle, Em espera · aperte um botão']);
    cam().bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter, selfie] });
    await act(async () => void jest.advanceTimersByTime(2500));
    expect(rows()).toEqual(['Controle, Conectado', 'Controle, Conectado']);
    expect(screen.getByText(/Todos os controles conectados salvam o lance/)).toBeTruthy();
  });

  test('the iPhone Bluetooth off: says so', async () => {
    repo.setPrefs({ remoteTestedAt: 1, remotes: [both[0]] });
    cam().bluetoothConnected.mockResolvedValue({ state: 'off', devices: [] });
    await render(<Devices />);
    await act(async () => {});
    expect(screen.getByLabelText('Controle, Bluetooth desligado')).toBeTruthy();
    expect(screen.getByText(/Central de Controle/)).toBeTruthy();
  });

  test('Esquecer forgets that remote alone; the last one forgotten brings the first-time steps back', async () => {
    repo.setPrefs({ remoteTestedAt: 1, remotes: both });
    cam().bluetoothConnected.mockResolvedValue({ state: 'on', devices: [] });
    const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    await render(<Devices />);
    await act(async () => {});
    // The first row's Esquecer.
    const forgetFirst = async () => {
      alert.mockClear();
      await fireEvent.press(screen.getAllByRole('button', { name: 'Esquecer Controle' })[0]);
      expect(alert.mock.calls[0][0]).toBe('Esquecer Controle?');
      const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
      await act(async () => buttons.find((b) => b.text === 'Esquecer')!.onPress!());
    };
    await forgetFirst();
    expect(screen.getAllByText('Controle')).toHaveLength(1);
    expect(repo.getPrefs().remotes).toEqual([both[1]]);
    expect(repo.getPrefs().remoteTestedAt).toBe(1);
    await forgetFirst();
    expect(screen.queryByText('Seus controles')).toBeNull();
    expect(screen.getByText('Ligue o controle e deixe em modo de pareamento.')).toBeTruthy();
    expect(repo.getPrefs().remoteTestedAt).toBeUndefined();
    alert.mockRestore();
  });

  test('a press the app is still matching to a device flashes nothing before the list (after Esquecer)', async () => {
    let answer: (v: unknown) => void = () => {};
    cam().bluetoothConnected.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    repo.setPrefs({ remotes: [] }); // the last remote forgotten: the first-time steps
    await render(<Devices />);
    await act(async () => {
      repo.setPrefs({ remoteTestedAt: 5 }); // as the setup screen does at a press
      void learnRemoteAtPress();
      markRemotePress();
    });
    expect(screen.queryByText('Controle conectado')).toBeNull();
    // Nor the "used before" layout: the press marks the remote used at once, the sheet keeps its steps until the list.
    expect(screen.queryByRole('button', { name: 'Não funciona? Parear de novo' })).toBeNull();
    expect(screen.queryByText('Controle já usado neste celular')).toBeNull();
    expect(screen.getByText('Ligue o controle e deixe em modo de pareamento.')).toBeTruthy();
    await act(async () => answer({ state: 'on', devices: [shutter] }));
    expect(screen.getByLabelText('Controle, Conectado')).toBeTruthy();
    expect(screen.queryByText('Controle conectado')).toBeNull();
  });

  test('two remotes on at the first press (the Shutter and the Selfie together): both listed, both Conectado', async () => {
    cam().bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter, selfie] });
    await render(<Devices />);
    await act(async () => {
      await learnRemoteAtPress();
      markRemotePress();
    });
    expect(screen.queryByText('Controle conectado')).toBeNull();
    expect(rows()).toEqual(['Controle, Conectado', 'Controle, Conectado']);
  });

  test('adding, a press with no new remote iOS shows: back to the list, the remote shown connected, no puzzle to read', async () => {
    repo.setPrefs({ remoteTestedAt: 1, remotes: [both[0]] });
    cam().bluetoothConnected.mockResolvedValue({ state: 'on', devices: [] });
    await render(<Devices />);
    await act(async () => {});
    await fireEvent.press(screen.getByRole('button', { name: 'Adicionar outro controle' }));
    expect(screen.getByText('Aperte qualquer botão do controle…')).toBeTruthy();
    await act(async () => {
      await learnRemoteAtPress();
      markRemotePress();
    });
    expect(screen.getByText('Seus controles')).toBeTruthy();
    expect(screen.getByLabelText('Controle, Conectado')).toBeTruthy();
  });

  test('Esquecer the last remote, then press it again: straight back to the list, no first-time ✓', async () => {
    repo.setPrefs({ remoteTestedAt: 1, remotes: [both[0]] });
    cam().bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter] });
    const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    await render(<Devices />);
    await act(async () => {});
    await fireEvent.press(screen.getByRole('button', { name: 'Esquecer Controle' }));
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.text === 'Esquecer')!.onPress!());
    expect(screen.queryByText('Seus controles')).toBeNull();
    await act(async () => {
      void learnRemoteAtPress();
      markRemotePress();
    });
    await act(async () => {});
    expect(screen.queryByText('Controle conectado')).toBeNull();
    expect(screen.getByLabelText('Controle, Conectado')).toBeTruthy();
    alert.mockRestore();
  });

  test('a remote iOS hides from apps (the Selfie Remote): its press shows the list with Controle · Conectado', async () => {
    cam().bluetoothConnected.mockResolvedValue({ state: 'on', devices: [] });
    await render(<Devices />);
    await act(async () => {
      void learnRemoteAtPress();
      markRemotePress();
    });
    await act(async () => {});
    expect(screen.queryByText('Controle conectado')).toBeNull();
    expect(screen.getByText('Seus controles')).toBeTruthy();
    expect(screen.getByLabelText('Controle, Conectado')).toBeTruthy();
  });

  test('"Adicionar outro controle": the steps for the new one; once it is learnt the list comes back with it', async () => {
    repo.setPrefs({ remoteTestedAt: 1, remotes: [both[0]] });
    cam().bluetoothConnected.mockResolvedValue({ state: 'on', devices: [] });
    await render(<Devices />);
    await act(async () => {});
    await fireEvent.press(screen.getByRole('button', { name: 'Adicionar outro controle' }));
    expect(screen.getByText('Ligue o novo controle e deixe em modo de pareamento.')).toBeTruthy();
    expect(screen.getByText('Aperte qualquer botão do controle…')).toBeTruthy();
    expect(screen.queryByText('Seus controles')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('Seus controles')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Adicionar outro controle' }));
    // Only the new remote on: a press teaches the app which one it is.
    cam().bluetoothConnected.mockResolvedValue({ state: 'on', devices: [selfie] });
    await act(async () => learnRemoteAtPress());
    expect(screen.getByText('Seus controles')).toBeTruthy();
    expect(rows()).toEqual(['Controle, Em espera · aperte um botão', 'Controle, Conectado']);
  });
});

test('right after the app opens, while the camera starts, it says to wait instead of asking for a press', async () => {
  const { useSession } = jest.requireMock('../../session/SessionContext');
  useSession.mockReturnValue({ state: { camera: 'starting' } });
  const view = await render(<Devices />);
  expect(screen.getByText(/Abrindo a câmera… espere um instante/)).toBeTruthy();
  expect(screen.queryByText('Aperte um botão do controle…')).toBeNull();
  useSession.mockReturnValue({ state: { camera: 'on' } });
  await view.rerender(<Devices />);
  expect(screen.queryByText(/Abrindo a câmera/)).toBeNull();
  expect(screen.getByText('Aperte um botão do controle…')).toBeTruthy();
});
