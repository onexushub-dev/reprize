import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import { track } from '../../analytics';

import Remote from '../remote';

jest.mock('../../../modules/replay-camera', () => ({
  isRemotePreviewSupported: jest.fn(() => true),
  remoteControllerStart: jest.fn(),
  remoteControllerStop: jest.fn(),
  remoteControllerHost: jest.fn(() => null),
  remoteControllerForget: jest.fn(),
  remoteControllerPairWithCode: jest.fn(),
  remoteControllerSave: jest.fn(),
  remoteControllerEndRecording: jest.fn(),
  remoteControllerPairWithLink: jest.fn(),
  remoteControllerStartRecording: jest.fn(),
  remoteControllerPreview: jest.fn(),
  remoteDeviceName: jest.fn(() => 'iPhone XR#1234'),
  remoteSetDeviceName: jest.fn(),
  setRemoteScreenDim: jest.fn(),
  isVoiceSupported: jest.fn(() => true),
  getMicrophonePermission: jest.fn(() => 'granted'),
  getSpeechPermission: jest.fn(() => 'granted'),
  requestMicrophonePermission: jest.fn(() => Promise.resolve(true)),
  requestSpeechPermission: jest.fn(() => Promise.resolve(true)),
  remoteVoiceSetEnabled: jest.fn(),
  addReplayListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('../../data/mmkv', () => {
  let prefs: any = { ...jest.requireActual('../../data/schema').DEFAULT_PREFS };
  return {
    repo: {
      getPrefs: () => prefs,
      setPrefs: jest.fn((patch: any) => {
        prefs = { ...prefs, ...patch };
        return prefs;
      }),
    },
    __resetPrefs: () => {
      prefs = { ...jest.requireActual('../../data/schema').DEFAULT_PREFS };
    },
  };
});
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
}));
jest.mock('expo-camera', () => {
  const { View } = jest.requireActual('react-native');
  return {
    CameraView: (props: any) => {
      mockScanner.onBarcodeScanned = props.onBarcodeScanned;
      return jest.requireActual('react').createElement(View, { testID: 'qr-camera' });
    },
    useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
  };
});
jest.mock('../../analytics', () => ({ track: jest.fn(), sessionSummary: { note: jest.fn() } }));
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(() => Promise.resolve()),
  deactivateKeepAwake: jest.fn(),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Heavy: 'heavy', Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

const mockScanner: { onBarcodeScanned?: (e: { data: string }) => void } = {};
const camera = () => jest.requireMock('../../../modules/replay-camera');
const haptics = () => jest.requireMock('expo-haptics');
const NOW = 1_000_000_000;

function emit(name: string, payload: unknown) {
  const calls = camera().addReplayListener.mock.calls.filter((c: any[]) => c[0] === name);
  return act(async () => {
    calls.forEach((c: any[]) => c[1](payload));
  });
}

const paired = () => camera().remoteControllerHost.mockReturnValue({ id: 'h1', name: 'Quadra 1' });

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
  camera().remoteControllerHost.mockReturnValue(null);
  camera().isVoiceSupported.mockReturnValue(true);
  camera().getMicrophonePermission.mockReturnValue('granted');
  camera().getSpeechPermission.mockReturnValue('granted');
  jest.requireMock('../../data/mmkv').__resetPrefs();
});

afterEach(() => jest.useRealTimers());

test('looks for the camera phone while open, and lets go on leaving', async () => {
  paired();
  const view = await render(<Remote />);
  expect(camera().remoteControllerStart).toHaveBeenCalledTimes(1);
  expect(jest.requireMock('expo-keep-awake').activateKeepAwakeAsync).toHaveBeenCalled();
  await view.unmount();
  expect(camera().remoteControllerStop).toHaveBeenCalledTimes(1);
  expect(jest.requireMock('expo-keep-awake').deactivateKeepAwake).toHaveBeenCalled();
});

test('without a pair it says which iPhone is which and explains the steps', async () => {
  await render(<Remote />);
  expect(screen.getByText('ESTE IPHONE É O CONTROLE')).toBeTruthy();
  expect(screen.getByText('No celular que vai filmar, abra o Reprize e toque em “Celular” para começar o pareamento.')).toBeTruthy();
  expect(screen.getByText('Aponte a câmera deste celular para o código QR que aparece lá.')).toBeTruthy();
  expect(screen.getByText('Não consegue ler o QR? Digite aqui o código de 6 números:')).toBeTruthy();
  expect(screen.queryByText(/tile/i)).toBeNull();
});

test('an incomplete code is not sent, and Conectar says what is missing', async () => {
  await render(<Remote />);
  await fireEvent.changeText(screen.getByLabelText('Código de 6 números'), '042 51');
  expect(camera().remoteControllerPairWithCode).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Conectar' }));
  expect(camera().remoteControllerPairWithCode).not.toHaveBeenCalled();
  expect(screen.getByText('Digite os 6 números do código.')).toBeTruthy();
});

test('the sixth digit connects by itself, and the button shows it is working', async () => {
  await render(<Remote />);
  await fireEvent.changeText(screen.getByLabelText('Código de 6 números'), '042 517');
  expect(camera().remoteControllerPairWithCode).toHaveBeenCalledWith('042517');
  expect(camera().remoteControllerPairWithCode).toHaveBeenCalledTimes(1);
  const busy = screen.getByRole('button', { name: 'Conectando…' });
  expect(busy).toBeDisabled();
  await emit('onRemotePairing', { phase: 'failed', reason: 'expired' });
  expect(screen.getByRole('button', { name: 'Conectar' })).toBeTruthy();
});

test('a code that never gets an answer stops spinning and says the camera was not found', async () => {
  await render(<Remote />);
  await fireEvent.changeText(screen.getByLabelText('Código de 6 números'), '042517');
  await act(async () => {
    jest.advanceTimersByTime(12_000);
  });
  expect(screen.getByRole('button', { name: 'Conectar' })).toBeTruthy();
  expect(
    screen.getByText('Não encontrei o celular da câmera. Chegue mais perto e confira se o Reprize está aberto lá.'),
  ).toBeTruthy();
});

test('when the camera was not found, one tap tries the same code again', async () => {
  await render(<Remote />);
  await fireEvent.changeText(screen.getByLabelText('Código de 6 números'), '042517');
  await emit('onRemotePairing', { phase: 'failed', reason: 'notFound' });
  await fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
  expect(camera().remoteControllerPairWithCode).toHaveBeenCalledTimes(2);
  expect(camera().remoteControllerPairWithCode).toHaveBeenLastCalledWith('042517');
});

test('an expired code offers no retry, only a new code', async () => {
  await render(<Remote />);
  await fireEvent.changeText(screen.getByLabelText('Código de 6 números'), '042517');
  await emit('onRemotePairing', { phase: 'failed', reason: 'expired' });
  expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
});

test('a failed pairing by code says why', async () => {
  await render(<Remote />);
  await emit('onRemotePairing', { phase: 'failed', reason: 'notFound' });
  expect(
    screen.getByText('Não encontrei o celular da câmera. Chegue mais perto e confira se o Reprize está aberto lá.'),
  ).toBeTruthy();
  await emit('onRemotePairing', { phase: 'failed', reason: 'expired' });
  expect(screen.getByText('Código vencido. Peça um novo no celular da câmera.')).toBeTruthy();
  await emit('onRemotePairing', { phase: 'failed', reason: 'locked' });
  expect(screen.getByText('Muitas tentativas. Gere um novo código.')).toBeTruthy();
});

test('after pairing by code the screen switches to the connection', async () => {
  await render(<Remote />);
  camera().remoteControllerHost.mockReturnValue({ id: 'h1', name: 'Quadra 1' });
  await emit('onRemotePairing', { phase: 'paired', peer: { id: 'h1', name: 'Quadra 1' } });
  expect(screen.getByText('Procurando Quadra 1…')).toBeTruthy();
});

test('connected and waiting for the game', async () => {
  paired();
  await render(<Remote />);
  expect(screen.getByText('Procurando Quadra 1…')).toBeTruthy();
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  await emit('onRemoteState', { recording: false, clipCount: 0 });
  expect(screen.getByText('Controle conectado.')).toBeTruthy();
});

test('while recording it shows the clock and clips, and Salvar asks the camera phone', async () => {
  paired();
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  await emit('onRemoteState', { recording: true, clipCount: 3, startedAt: NOW - (12 * 60 + 34) * 1000 });
  expect(screen.getByText('12:34 · 3 lances')).toBeTruthy();
  expect(screen.getByLabelText('Conectado a Quadra 1')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'SALVAR' }));
  expect(camera().remoteControllerSave).toHaveBeenCalledTimes(1);
  expect(haptics().impactAsync).toHaveBeenCalled();
});

test('a double tap on Salvar asks for one clip only', async () => {
  paired();
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  await emit('onRemoteState', { recording: true, clipCount: 0, startedAt: NOW });
  await fireEvent.press(screen.getByRole('button', { name: 'SALVAR' }));
  await fireEvent.press(screen.getByRole('button', { name: 'SALVAR' }));
  expect(camera().remoteControllerSave).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
  await fireEvent.press(screen.getByRole('button', { name: 'SALVAR' }));
  expect(camera().remoteControllerSave).toHaveBeenCalledTimes(2);
});

async function recording() {
  paired();
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  await emit('onRemoteState', { recording: true, clipCount: 1, startedAt: NOW });
}

test('the tap answers at once, before the camera phone does', async () => {
  await recording();
  expect(screen.getByText('SALVAR')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'SALVAR' }));
  expect(screen.getByText('ENVIANDO…')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'SALVAR' }).props.accessibilityState).toMatchObject({ busy: true });
});

test('saved: the whole screen answers in green, with a vibration, then clears', async () => {
  await recording();
  await fireEvent.press(screen.getByRole('button', { name: 'SALVAR' }));
  await emit('onRemoteResult', { saved: true });
  expect(screen.getByText('SALVO!')).toBeTruthy();
  expect(haptics().notificationAsync).toHaveBeenCalledWith('success');
  expect(screen.queryByText('ENVIANDO…')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(1300);
  });
  expect(screen.queryByText('SALVO!')).toBeNull();
  expect(screen.getByText('SALVAR')).toBeTruthy();
});

test('failed: red, says what to do, vibrates as an error', async () => {
  await recording();
  await fireEvent.press(screen.getByRole('button', { name: 'SALVAR' }));
  await emit('onRemoteResult', { saved: false });
  expect(screen.getByText('NÃO SALVOU')).toBeTruthy();
  expect(screen.getByText('Toque de novo')).toBeTruthy();
  expect(haptics().notificationAsync).toHaveBeenCalledWith('error');
});

test('no answer in four seconds says so instead of spinning forever', async () => {
  await recording();
  await fireEvent.press(screen.getByRole('button', { name: 'SALVAR' }));
  await act(async () => {
    jest.advanceTimersByTime(3800);
  });
  expect(screen.getByText('ENVIANDO…')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(screen.getByText('SEM RESPOSTA')).toBeTruthy();
  expect(screen.getByText('Confira o celular da câmera')).toBeTruthy();
  expect(haptics().notificationAsync).toHaveBeenCalledWith('error');
});

test('an answer that arrives late is still shown', async () => {
  await recording();
  await fireEvent.press(screen.getByRole('button', { name: 'SALVAR' }));
  await act(async () => {
    jest.advanceTimersByTime(4500);
  });
  await emit('onRemoteResult', { saved: true });
  expect(screen.getByText('SALVO!')).toBeTruthy();
});

test('searching and waiting show a pulse and say where they are', async () => {
  paired();
  await render(<Remote />);
  expect(screen.getByLabelText('Reconectando a Quadra 1')).toBeTruthy();
});

test('waiting for the game never turns into "Sem conexão" while the camera phone keeps beating', async () => {
  paired();
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  await emit('onRemoteState', { recording: false, clipCount: 0 });
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    await emit('onRemoteState', { recording: false, clipCount: 0 }); // the beat
  }
  expect(screen.getByText('Controle conectado.')).toBeTruthy();
  expect(screen.queryByText(/Sem conexão/)).toBeNull();
  expect(screen.queryByText(/Sem sinal/)).toBeNull();
});

test('a dropped link says it is reconnecting, a silent one says there is no signal', async () => {
  paired();
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  await emit('onRemoteState', { recording: false, clipCount: 0 });
  await emit('onRemoteStatus', { side: 'remote', link: 'searching', peerName: 'Quadra 1' });
  expect(screen.getByText('Reconectando a Quadra 1…')).toBeTruthy();
  expect(screen.queryByText(/Sem conexão/)).toBeNull();
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  await act(async () => {
    jest.advanceTimersByTime(13_000);
  });
  expect(screen.getByText('Sem sinal de Quadra 1')).toBeTruthy();
});

test('without a pair the checklist of what both phones need is on screen', async () => {
  await render(<Remote />);
  expect(screen.getByText('Para conectar, confira:')).toBeTruthy();
  expect(screen.getByText(/Bluetooth ligado nos dois celulares/)).toBeTruthy();
});

test('Bluetooth not allowed for the app sends the player to Settings', async () => {
  paired();
  const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'denied', reason: 'unauthorized' });
  expect(screen.getByText('Libere o Bluetooth para o Reprize nos Ajustes para usar o controle.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Abrir Ajustes' }));
  expect(open).toHaveBeenCalled();
});

test('Bluetooth off asks to turn it on', async () => {
  paired();
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'denied', reason: 'off' });
  expect(screen.getByText('Ligue o Bluetooth para usar o controle (Central de Controle ou Ajustes).')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Abrir Ajustes' })).toBeNull();
});

test('when the camera phone forgot this remote, it says so and offers to pair again', async () => {
  paired();
  await render(<Remote />);
  camera().remoteControllerHost.mockReturnValue(null);
  await emit('onRemotePairing', { phase: 'failed', reason: 'denied' });
  expect(screen.getByText('Este controle não está mais pareado')).toBeTruthy();
  expect(screen.getByLabelText('Código de 6 números')).toBeTruthy();
});

test('Fechar goes back', async () => {
  await render(<Remote />);
  await fireEvent.press(screen.getByRole('button', { name: 'Fechar' }));
  expect(jest.requireMock('expo-router').router.back).toHaveBeenCalled();
});

test('Fechar still leaves when there is nothing to go back to (opened straight from the QR code)', async () => {
  const { router } = jest.requireMock('expo-router');
  router.canGoBack.mockReturnValueOnce(false);
  await render(<Remote />);
  await fireEvent.press(screen.getByRole('button', { name: 'Fechar' }));
  expect(router.back).not.toHaveBeenCalled();
  expect(router.replace).toHaveBeenCalledWith('/');
});

test('without a pair the phone can be renamed', async () => {
  await render(<Remote />);
  expect(screen.getByLabelText('Nome deste celular').props.value).toBe('iPhone XR#1234');
});

test('connected before any state arrives it already says connected, not searching', async () => {
  paired();
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  expect(screen.getByText('Controle conectado.')).toBeTruthy();
  expect(screen.queryByText('Procurando Quadra 1…')).toBeNull();
});

test('after a save the button is clean again: no loading look, only a thin discreet marker for the 3 s gap', async () => {
  await recording();
  await fireEvent.press(screen.getByRole('button', { name: 'SALVAR' }));
  expect(screen.getByTestId('cooldown')).toBeTruthy();
  await emit('onRemoteResult', { saved: true });
  await act(async () => {
    jest.advanceTimersByTime(1300);
  });
  expect(screen.getByText('SALVAR')).toBeTruthy();
  expect(screen.queryByText('ENVIANDO…')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(screen.queryByTestId('cooldown')).toBeNull();
});

test('a tap inside the 3 s gap does not save and gives a light tap back', async () => {
  await recording();
  await fireEvent.press(screen.getByRole('button', { name: 'SALVAR' }));
  haptics().impactAsync.mockClear();
  await fireEvent.press(screen.getByRole('button', { name: 'SALVAR' }));
  expect(camera().remoteControllerSave).toHaveBeenCalledTimes(1);
  expect(haptics().impactAsync).toHaveBeenCalledWith('light');
});

test('holding "Segure para encerrar a gravação" asks the camera phone to end the recording', async () => {
  await recording();
  const hold = screen.getByRole('button', { name: 'Segure para encerrar a gravação' });
  await fireEvent(hold, 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(camera().remoteControllerEndRecording).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  expect(camera().remoteControllerEndRecording).toHaveBeenCalledTimes(1);
});

test('letting go early does not end the recording', async () => {
  await recording();
  const hold = screen.getByRole('button', { name: 'Segure para encerrar a gravação' });
  await fireEvent(hold, 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  await fireEvent(hold, 'pressOut');
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(camera().remoteControllerEndRecording).not.toHaveBeenCalled();
});

test('the end-recording button is only there while recording', async () => {
  paired();
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  await emit('onRemoteState', { recording: false, clipCount: 0 });
  expect(screen.queryByRole('button', { name: 'Segure para encerrar a gravação' })).toBeNull();
});

test('"Tentar reconexão" starts the search over', async () => {
  paired();
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  await emit('onRemoteState', { recording: true, clipCount: 2, startedAt: NOW });
  await act(async () => {
    jest.advanceTimersByTime(13_000);
  });
  camera().remoteControllerStop.mockClear();
  camera().remoteControllerStart.mockClear();
  await fireEvent.press(screen.getByRole('button', { name: 'Tentar reconexão' }));
  expect(camera().remoteControllerStop).toHaveBeenCalledTimes(1);
  expect(camera().remoteControllerStart).toHaveBeenCalledTimes(1);
  // While it tries, the button says so and a second tap does nothing.
  const busy = screen.getByRole('button', { name: 'Reconectando…' });
  expect(busy).toBeDisabled();
  await fireEvent.press(busy);
  expect(camera().remoteControllerStart).toHaveBeenCalledTimes(1);
  // After a few seconds it can be tapped again.
  await act(async () => {
    jest.advanceTimersByTime(6_000);
  });
  expect(screen.getByRole('button', { name: 'Tentar reconexão' })).toBeEnabled();
});

test('"Esquecer esta câmera" says whose pairing goes away, asks first, then forgets and goes back to asking for a code', async () => {
  paired();
  const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
  await render(<Remote />);
  expect(screen.getByText('Desfaz o pareamento com Quadra 1 neste celular.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Esquecer esta câmera' }));
  expect(alert).toHaveBeenCalledTimes(1);
  expect(alert.mock.calls[0][0]).toBe('Esquecer Quadra 1?');
  expect(String(alert.mock.calls[0][1])).toContain('Quadra 1 também remove este controle');
  expect(camera().remoteControllerForget).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  await act(async () => buttons.find((b) => b.text === 'Esquecer e parear outra')!.onPress!());
  expect(camera().remoteControllerForget).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Conectar à câmera')).toBeTruthy();
  alert.mockRestore();
});

const LINK = 'reprize://pair?h=host1&s=AAAAAAAAAAAAAAAAAAAAAA&n=Quadra%201';

test('the QR code is read right here and pairs with that camera phone', async () => {
  await render(<Remote />);
  await act(async () => mockScanner.onBarcodeScanned!({ data: LINK }));
  expect(camera().remoteControllerPairWithLink).toHaveBeenCalledWith('host1', 'AAAAAAAAAAAAAAAAAAAAAA', 'Quadra 1');
  expect(screen.getByRole('button', { name: 'Conectando…' })).toBeTruthy();
});

test('a QR code that is not from Reprize is ignored', async () => {
  await render(<Remote />);
  await act(async () => mockScanner.onBarcodeScanned!({ data: 'https://example.com' }));
  expect(camera().remoteControllerPairWithLink).not.toHaveBeenCalled();
});

test('"Iniciar gravação" asks the camera phone to start and shows it is working', async () => {
  paired();
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  await emit('onRemoteState', { recording: false, clipCount: 0 });
  await fireEvent.press(screen.getByRole('button', { name: 'INICIAR GRAVAÇÃO' }));
  expect(camera().remoteControllerStartRecording).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Iniciando…' })).toBeTruthy();
  await emit('onRemoteState', { recording: true, clipCount: 0, startedAt: NOW });
  expect(screen.getByRole('button', { name: 'SALVAR' })).toBeTruthy();
});

test('if the camera phone does not start, it says so', async () => {
  paired();
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  await emit('onRemoteState', { recording: false, clipCount: 0 });
  await fireEvent.press(screen.getByRole('button', { name: 'INICIAR GRAVAÇÃO' }));
  await act(async () => {
    jest.advanceTimersByTime(9000);
    await emit('onRemoteState', { recording: false, clipCount: 0 });
  });
  expect(screen.getByText(/A gravação não começou/)).toBeTruthy();
});

test('"Ver câmera" opens the picture, keeps asking for it, and stops asking when closed', async () => {
  paired();
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  await emit('onRemoteState', { recording: true, clipCount: 1, startedAt: NOW });
  await fireEvent.press(screen.getByRole('button', { name: 'Ver câmera' }));
  expect(camera().remoteControllerPreview).toHaveBeenLastCalledWith(true);
  await act(async () => {
    jest.advanceTimersByTime(2100);
  });
  expect(camera().remoteControllerPreview.mock.calls.filter((c: any[]) => c[0] === true).length).toBeGreaterThanOrEqual(3);
  await emit('onRemoteFrame', { jpeg: '/9j/AAAA' });
  expect(screen.getByLabelText('O que a câmera está vendo')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
  expect(camera().remoteControllerPreview).toHaveBeenLastCalledWith(false);
});

test('the camera side of this same phone saying "searching" does not make the remote look disconnected', async () => {
  paired();
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  await emit('onRemoteState', { recording: true, clipCount: 1, startedAt: NOW });
  // Coming back to the front starts this phone's camera side, which has no remotes of its own.
  await emit('onRemoteStatus', { side: 'camera', link: 'searching', controllers: 0 });
  expect(screen.queryByText('Reconectando a Quadra 1…')).toBeNull();
  expect(screen.getByRole('button', { name: 'SALVAR' })).toBeTruthy();
});

describe('analytics', () => {
  test('a pairing by code reports the code method', async () => {
    await render(<Remote />);
    await fireEvent.changeText(screen.getByLabelText('Código de 6 números'), '042517');
    await emit('onRemotePairing', { phase: 'paired', peer: { id: 'h1', name: 'Quadra 1' } });
    expect(track).toHaveBeenCalledWith('pairing_completed', { method: 'code', kind: 'remote' });
  });

  test('a pairing by QR reports the QR method', async () => {
    await render(<Remote />);
    await act(async () => {
      if (mockScanner.onBarcodeScanned) mockScanner.onBarcodeScanned({ data: LINK });
    });
    await emit('onRemotePairing', { phase: 'paired', peer: { id: 'h1', name: 'Quadra 1' } });
    expect(track).toHaveBeenCalledWith('pairing_completed', { method: 'qr', kind: 'remote' });
  });

  test('a failure and a silent camera phone report their reasons', async () => {
    await render(<Remote />);
    await fireEvent.changeText(screen.getByLabelText('Código de 6 números'), '042517');
    await emit('onRemotePairing', { phase: 'failed', reason: 'expired' });
    expect(track).toHaveBeenCalledWith('pairing_failed', { reason: 'expired' });
    await fireEvent.changeText(screen.getByLabelText('Código de 6 números'), '042518');
    await act(async () => {
      jest.advanceTimersByTime(12_000);
    });
    expect(track).toHaveBeenCalledWith('pairing_failed', { reason: 'notFound' });
  });
});

// The camera phone beats every 5 s while it records; the remote's screen economy waits a minute without a touch.
async function recordFor(ms: number) {
  for (let left = ms; left > 0; left -= 5000) {
    await act(async () => {
      jest.advanceTimersByTime(Math.min(5000, left));
    });
    await emit('onRemoteState', { recording: true, clipCount: 0, startedAt: NOW });
  }
}

test('while the camera records, the screen dims after a minute without a touch and the first touch only lights it up', async () => {
  paired();
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  await emit('onRemoteState', { recording: true, clipCount: 0, startedAt: NOW });
  expect(screen.getByTestId('economy-notice')).toBeTruthy();
  await recordFor(55_000);
  expect(screen.queryByTestId('remote-economy')).toBeNull();
  await recordFor(5_000);
  expect(screen.getByTestId('remote-economy')).toBeTruthy();
  expect(camera().setRemoteScreenDim).toHaveBeenLastCalledWith(true);
  expect(screen.queryByTestId('economy-notice')).toBeNull();

  await act(async () => {
    fireEvent(screen.getByTestId('remote-economy'), 'pressIn');
  });
  expect(screen.queryByTestId('remote-economy')).toBeNull();
  expect(camera().setRemoteScreenDim).toHaveBeenLastCalledWith(false);
  expect(camera().remoteControllerSave).not.toHaveBeenCalled();
});

test('a lost link lights the screen up by itself', async () => {
  paired();
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  await emit('onRemoteState', { recording: true, clipCount: 0, startedAt: NOW });
  await recordFor(60_000);
  expect(screen.getByTestId('remote-economy')).toBeTruthy();
  await emit('onRemoteStatus', { side: 'remote', link: 'searching', peerName: 'Quadra 1' });
  expect(screen.queryByTestId('remote-economy')).toBeNull();
  expect(camera().setRemoteScreenDim).toHaveBeenLastCalledWith(false);
});

test('battery saving can be turned off before the recording, and then the screen stays on', async () => {
  paired();
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  await emit('onRemoteState', { recording: false, clipCount: 0 });
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Economia de bateria, Escurece após 1 min sem toque'));
  });
  expect(jest.requireMock('../../data/mmkv').repo.setPrefs).toHaveBeenCalledWith({ remoteEconomy: false });
  expect(screen.getByText('Economia de bateria desligada')).toBeTruthy();
  expect(screen.getByLabelText('Economia de bateria, Desligada')).toBeTruthy();

  await emit('onRemoteState', { recording: true, clipCount: 0, startedAt: NOW });
  expect(screen.queryByTestId('economy-notice')).toBeNull();
  await recordFor(70_000);
  expect(screen.queryByTestId('remote-economy')).toBeNull();
  expect(camera().setRemoteScreenDim).not.toHaveBeenCalledWith(true);
});

async function connected(recording: boolean) {
  paired();
  await render(<Remote />);
  await emit('onRemoteStatus', { side: 'remote', link: 'connected', peerName: 'Quadra 1' });
  await emit('onRemoteState', recording ? { recording: true, clipCount: 0, startedAt: NOW } : { recording: false, clipCount: 0 });
}

test('voice listens only while the camera records, and says so under SALVAR', async () => {
  await connected(false);
  expect(camera().remoteVoiceSetEnabled).toHaveBeenLastCalledWith(false, 'pt-BR');
  expect(screen.getByLabelText('Salvar por voz, Diga “salvar”')).toBeTruthy();
  await emit('onRemoteState', { recording: true, clipCount: 0, startedAt: NOW });
  expect(camera().remoteVoiceSetEnabled).toHaveBeenLastCalledWith(true, 'pt-BR');
  expect(screen.getByText('ou diga “salvar”')).toBeTruthy();
});

test('a heard command saves like a tap, and a dim screen stays dim', async () => {
  await connected(true);
  await recordFor(60_000);
  expect(screen.getByTestId('remote-economy')).toBeTruthy();
  await emit('onRemoteVoice', { at: NOW });
  expect(camera().remoteControllerSave).toHaveBeenCalledTimes(1);
  expect(haptics().impactAsync).toHaveBeenCalledWith('heavy');
  expect(screen.getByTestId('remote-economy')).toBeTruthy();
  await emit('onRemoteResult', { saved: true });
  expect(screen.getByText('SALVO!')).toBeTruthy();
});

test('a command heard outside a recording saves nothing', async () => {
  await connected(false);
  await emit('onRemoteVoice', { at: NOW });
  expect(camera().remoteControllerSave).not.toHaveBeenCalled();
});

test('voice can be turned off before the recording, and then nothing listens', async () => {
  await connected(false);
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Salvar por voz, Diga “salvar”'));
  });
  expect(jest.requireMock('../../data/mmkv').repo.setPrefs).toHaveBeenCalledWith({ remoteVoice: false });
  expect(screen.getByLabelText('Salvar por voz, Desligada')).toBeTruthy();
  await emit('onRemoteState', { recording: true, clipCount: 0, startedAt: NOW });
  expect(camera().remoteVoiceSetEnabled).not.toHaveBeenCalledWith(true, 'pt-BR');
  expect(screen.queryByText('ou diga “salvar”')).toBeNull();
});

test('the first time it is connected it explains voice before iOS asks, once', async () => {
  camera().getMicrophonePermission.mockReturnValue('undetermined');
  camera().getSpeechPermission.mockReturnValue('undetermined');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await connected(false);
  expect(alert).toHaveBeenCalledTimes(1);
  expect(alert.mock.calls[0][0]).toBe('Salvar falando');
  const allow = (alert.mock.calls[0][2] as any[]).find((b) => b.text === 'Permitir');
  await act(async () => {
    allow.onPress();
  });
  expect(camera().requestMicrophonePermission).toHaveBeenCalled();
  expect(camera().requestSpeechPermission).toHaveBeenCalled();
  expect(track).toHaveBeenCalledWith('permission_result', { kind: 'microphone', granted: true });
  expect(track).toHaveBeenCalledWith('permission_result', { kind: 'speech', granted: true });
  expect(jest.requireMock('../../data/mmkv').repo.getPrefs().remoteVoiceAsked).toBe(true);
  expect(screen.getByLabelText('Salvar por voz, Diga “salvar”')).toBeTruthy();
  alert.mockRestore();
});

test('"Agora não" turns voice off', async () => {
  camera().getMicrophonePermission.mockReturnValue('undetermined');
  camera().getSpeechPermission.mockReturnValue('undetermined');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await connected(false);
  const later = (alert.mock.calls[0][2] as any[]).find((b) => b.text === 'Agora não');
  await act(async () => {
    later.onPress();
  });
  expect(screen.getByLabelText('Salvar por voz, Desligada')).toBeTruthy();
  expect(camera().requestMicrophonePermission).not.toHaveBeenCalled();
  alert.mockRestore();
});

test('a denied permission sends the tile to Settings', async () => {
  camera().getSpeechPermission.mockReturnValue('denied');
  const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  await connected(false);
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Salvar por voz, Negado · libere em Ajustes'));
  });
  expect(settings).toHaveBeenCalled();
  settings.mockRestore();
});

test('without offline recognition on this phone there is no voice tile', async () => {
  camera().isVoiceSupported.mockReturnValue(false);
  await connected(false);
  expect(screen.queryByText('Salvar por voz')).toBeNull();
});

async function holdToEnd() {
  await fireEvent(screen.getByRole('button', { name: 'Segure para encerrar a gravação' }), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
}

test('after the hold it says it is ending at once, and asks again until the camera phone stops', async () => {
  await connected(true);
  await holdToEnd();
  expect(camera().remoteControllerEndRecording).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Encerrando…')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Segure para encerrar a gravação' })).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(1500);
  });
  expect(camera().remoteControllerEndRecording).toHaveBeenCalledTimes(2);
  await emit('onRemoteState', { recording: false, clipCount: 0 });
  expect(screen.getByText('Controle conectado.')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(camera().remoteControllerEndRecording).toHaveBeenCalledTimes(2);
});

test('if the camera phone never stops, it says so and the hold is back', async () => {
  await connected(true);
  await holdToEnd();
  for (let i = 0; i < 2; i++) {
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    await emit('onRemoteState', { recording: true, clipCount: 0, startedAt: NOW });
  }
  expect(screen.getByText('A gravação não encerrou. Confira o celular da câmera e tente de novo.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Segure para encerrar a gravação' })).toBeTruthy();
  const asked = camera().remoteControllerEndRecording.mock.calls.length;
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
  expect(camera().remoteControllerEndRecording).toHaveBeenCalledTimes(asked);
});
