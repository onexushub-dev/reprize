import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { GestureSheet, RAISED_HOLD_MS, VoiceSheet } from '../PracticeSheet';

jest.mock('../../../modules/replay-camera', () => {
  const listeners: Record<string, ((e: unknown) => void) | undefined> = {};
  return {
    __listeners: listeners,
    setGestureEnabled: jest.fn(),
    setVoiceEnabled: jest.fn(),
    signalSaved: jest.fn(),
    addReplayListener: jest.fn((event: string, fn: (e: unknown) => void) => {
      listeners[event] = fn;
      return {
        remove: () => {
          if (listeners[event] === fn) listeners[event] = undefined;
        },
      };
    }),
  };
});

const cam = jest.requireMock('../../../modules/replay-camera');
const emit = (event: string, body: unknown) =>
  act(async () => {
    const fn = cam.__listeners[event];
    if (fn) fn(body);
  });
const status = () => screen.getByTestId('practice-status');

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe('the gesture', () => {
  test('open, the camera looks for the gesture; closed, it stops and nothing is heard', async () => {
    const { rerender } = await render(<GestureSheet visible onClose={jest.fn()} />);
    expect(cam.setGestureEnabled).toHaveBeenLastCalledWith(true);
    expect(screen.getByText('Acene com os dois braços acima da cabeça, de um lado para o outro.')).toBeTruthy();
    await rerender(<GestureSheet visible={false} onClose={jest.fn()} />);
    expect(cam.setGestureEnabled).toHaveBeenLastCalledWith(false);
    expect(cam.__listeners.onTrigger).toBeUndefined();
  });

  test('arms up asks for the wave, and goes back once they come down', async () => {
    await render(<GestureSheet visible onClose={jest.fn()} />);
    expect(status()).toHaveTextContent(/Afaste-se alguns passos/);
    await emit('onGestureDebug', { people: 1, isX: false, raised: true, orientation: 0 });
    expect(status()).toHaveTextContent('Braços levantados: agora acene');
    await act(async () => void jest.advanceTimersByTime(RAISED_HOLD_MS + 10));
    expect(status()).toHaveTextContent(/Afaste-se alguns passos/);
  });

  test('recognized, it says so with the save chime and stays until "Testar de novo"', async () => {
    await render(<GestureSheet visible onClose={jest.fn()} />);
    await emit('onTrigger', { source: 'gesture', at: 1 });
    expect(status()).toHaveTextContent('Gesto reconhecido');
    expect(cam.signalSaved).toHaveBeenCalledWith({ sound: true, flash: false });
    await emit('onGestureDebug', { people: 1, isX: true, orientation: 0 });
    await act(async () => void jest.advanceTimersByTime(60_000));
    expect(status()).toHaveTextContent('Gesto reconhecido');
    await emit('onTrigger', { source: 'gesture', at: 2 }); // a second one while it shows: no second chime
    expect(cam.signalSaved).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole('button', { name: 'Testar de novo' }));
    expect(status()).toHaveTextContent(/Afaste-se alguns passos/);
    await emit('onTrigger', { source: 'gesture', at: 3 });
    expect(status()).toHaveTextContent('Gesto reconhecido');
    expect(cam.signalSaved).toHaveBeenCalledTimes(2);
  });

  test('other triggers are not the gesture', async () => {
    await render(<GestureSheet visible onClose={jest.fn()} />);
    await emit('onTrigger', { source: 'voice', at: 1 });
    expect(status()).toHaveTextContent(/Afaste-se alguns passos/);
    expect(cam.signalSaved).not.toHaveBeenCalled();
  });

  test('Fechar closes', async () => {
    const onClose = jest.fn();
    await render(<GestureSheet visible onClose={onClose} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('the voice', () => {
  test('with the permission it listens in the app language, and the command recognized stays until "Testar de novo"', async () => {
    const { rerender } = await render(
      <VoiceSheet visible onClose={jest.fn()} locale="pt-BR" speech="granted" onAllow={jest.fn()} />,
    );
    expect(cam.setVoiceEnabled).toHaveBeenLastCalledWith(true, expect.anything());
    expect(screen.getByText('Diga “salvar” em voz alta.')).toBeTruthy();
    expect(status()).toHaveTextContent('Diga “salvar” agora.');
    await emit('onTrigger', { source: 'voice', at: 1 });
    expect(status()).toHaveTextContent('Comando reconhecido');
    expect(cam.signalSaved).toHaveBeenCalledWith({ sound: true, flash: false });
    await fireEvent.press(screen.getByRole('button', { name: 'Testar de novo' }));
    expect(status()).toHaveTextContent('Diga “salvar” agora.');
    await rerender(<VoiceSheet visible={false} onClose={jest.fn()} locale="pt-BR" speech="granted" onAllow={jest.fn()} />);
    expect(cam.setVoiceEnabled).toHaveBeenLastCalledWith(false, expect.anything());
  });

  test('without the permission it asks for it and does not listen', async () => {
    const onAllow = jest.fn();
    await render(<VoiceSheet visible onClose={jest.fn()} locale="pt-BR" speech="undetermined" onAllow={onAllow} />);
    expect(cam.setVoiceEnabled).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    expect(onAllow).toHaveBeenCalled();
  });

  test('the gesture is not the voice', async () => {
    await render(<VoiceSheet visible onClose={jest.fn()} locale="pt-BR" speech="granted" onAllow={jest.fn()} />);
    await emit('onTrigger', { source: 'gesture', at: 1 });
    expect(status()).toHaveTextContent('Diga “salvar” agora.');
  });
});
