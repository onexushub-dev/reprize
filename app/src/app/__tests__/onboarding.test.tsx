import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { requestPermissions } from '../../../modules/replay-camera';
import { track } from '../../analytics';
import { repo } from '../../data/mmkv';
import { setLocale } from '../../i18n';
import { SLIDES } from '../../onboarding/slides';
import Onboarding from '../onboarding';

const { router } = jest.requireMock('expo-router');

jest.mock('../../../modules/replay-camera', () => ({ requestPermissions: jest.fn(async () => true) }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('../../data/mmkv', () => ({ repo: { setPrefs: jest.fn() } }));
jest.mock('../../analytics', () => ({ track: jest.fn() }));

const allow = requestPermissions as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  setLocale('pt-BR');
  jest.clearAllMocks();
  allow.mockResolvedValue(true);
});
afterEach(() => jest.useRealTimers());

const next = () => screen.getByLabelText('Próxima etapa');
const previous = () => screen.getByLabelText('Etapa anterior');
const run = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

test('opens on the Record story, with only the bars on top: no step names and no logo', async () => {
  await render(<Onboarding />);
  expect(screen.getByText('GRAVE.')).toBeTruthy();
  expect(screen.getByText('Grave o jogo com o celular parado.')).toBeTruthy();
  for (const label of ['1 Grave', '2 Salve', '3 Edite', '4 Envie']) expect(screen.queryByText(label)).toBeNull();
  expect(screen.queryByLabelText('Reprize')).toBeNull();
  expect(screen.getByText('Começar gravação')).toBeTruthy();
});

test('the Pro Save story has no supporting line and no tabs, only the Apple Watch card', async () => {
  await render(<Onboarding />);
  await fireEvent.press(next());
  await fireEvent.press(next());
  expect(screen.getByText('Salve pelo pulso com o PRO.')).toBeTruthy();
  expect(screen.getByText('Apple Watch')).toBeTruthy();
  expect(screen.queryByLabelText('Formas de salvar o lance')).toBeNull();
});

test('the Edit story does not talk about PRO', async () => {
  await render(<Onboarding />);
  for (let i = 0; i < 3; i++) await fireEvent.press(next());
  expect(screen.getByText('EDITE.')).toBeTruthy();
  expect(screen.getByText('O clipe é cortado automaticamente no momento do lance.')).toBeTruthy();
  expect(screen.queryByText('PRO')).toBeNull();
});

test('a tap on the right edge goes forward and one on the left goes back', async () => {
  await render(<Onboarding />);
  await fireEvent.press(next());
  expect(screen.getByText('SALVE.')).toBeTruthy();
  await fireEvent.press(next());
  expect(screen.getByText('Salve pelo pulso com o PRO.')).toBeTruthy();
  await fireEvent.press(next());
  expect(screen.getByText('EDITE.')).toBeTruthy();
  await fireEvent.press(previous());
  expect(screen.getByText('Salve pelo pulso com o PRO.')).toBeTruthy();
});

test('the stories move on by themselves', async () => {
  await render(<Onboarding />);
  await run(SLIDES[0].ms + 100);
  expect(screen.getByText('Salve o lance sem parar o jogo.')).toBeTruthy();
});

test('holding a finger down freezes the story and lifting it lets it go on, without a tap', async () => {
  await render(<Onboarding />);
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  await user.longPress(next(), { duration: 60_000 });
  // The hold lasted longer than the slide: it did not move on while the finger was down, and it was not a tap either.
  expect(screen.getByText('GRAVE.')).toBeTruthy();
  await run(SLIDES[0].ms - 500);
  expect(screen.getByText('GRAVE.')).toBeTruthy();
  await run(1000);
  expect(screen.getByText('SALVE.')).toBeTruthy();
});

test('a quick press is a tap, not a hold', async () => {
  await render(<Onboarding />);
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  await user.press(next());
  expect(screen.getByText('SALVE.')).toBeTruthy();
  await user.press(previous());
  expect(screen.getByText('GRAVE.')).toBeTruthy();
});

test('Continue goes to the next story and Skip jumps to the last one', async () => {
  await render(<Onboarding />);
  await fireEvent.press(screen.getByText('Continuar'));
  expect(screen.getByText('SALVE.')).toBeTruthy();
  await fireEvent.press(screen.getByText('Pular'));
  expect(screen.getByText('ENVIE.')).toBeTruthy();
  expect(screen.queryByText('Pular')).toBeNull();
});

test('the Save story shows its ways, and tapping one opens it', async () => {
  await render(<Onboarding />);
  await fireEvent.press(next());
  expect(screen.getByText('Toque na tela')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Voz'));
  expect(screen.getByText('Diga “salvar”.')).toBeTruthy();
  await run(10_000);
  expect(screen.getByText('Diga “salvar”.')).toBeTruthy();
});

test('the last story explains the camera and asking for it ends the onboarding', async () => {
  await render(<Onboarding />);
  await fireEvent.press(screen.getByText('Pular'));
  expect(screen.getByText('Grátis, sem cadastro e com gravações ilimitadas. A seguir, o Reprize pede acesso à câmera.')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByText('Continuar')));
  expect(repo.setPrefs).toHaveBeenCalledWith({ onboardingDone: true });
  expect(router.replace).toHaveBeenCalledWith('/setup');
});

test('a refused camera keeps the player here with a way to Settings', async () => {
  allow.mockResolvedValue(false);
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  await render(<Onboarding />);
  await fireEvent.press(screen.getByText('Pular'));
  await act(async () => fireEvent.press(screen.getByText('Continuar')));
  expect(repo.setPrefs).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  expect(screen.getByText('Sem câmera não dá para gravar os clipes. Libere em Ajustes.')).toBeTruthy();
  await fireEvent.press(screen.getByText('Abrir Ajustes'));
  expect(openSettings).toHaveBeenCalled();
});

test('is in English on an English phone', async () => {
  setLocale('en');
  await render(<Onboarding />);
  expect(screen.getByText('RECORD.')).toBeTruthy();
  expect(screen.getByText('Record the game with your phone in a fixed spot.')).toBeTruthy();
  await fireEvent.press(screen.getByText('Skip'));
  expect(screen.getByText('SHARE.')).toBeTruthy();
});

describe('analytics', () => {
  const sent = () => (track as jest.Mock).mock.calls.map(([name, props]) => [name, props]);

  test('opening the stories reports step 1 once', async () => {
    await render(<Onboarding />);
    expect(sent()).toEqual([['onboarding_step_viewed', { step: 1 }]]);
  });

  test('each step is reported once, even going on to the second slide of a step and back', async () => {
    await render(<Onboarding />);
    await fireEvent.press(next()); // Save, free ways: step 2
    await fireEvent.press(next()); // Save, Pro ways: still step 2
    await fireEvent.press(previous());
    await fireEvent.press(previous()); // back on step 1
    expect(sent()).toEqual([
      ['onboarding_step_viewed', { step: 1 }],
      ['onboarding_step_viewed', { step: 2 }],
    ]);
  });

  test('Skip reports the step it was pressed on, and the last step then counts as viewed', async () => {
    await render(<Onboarding />);
    await fireEvent.press(next());
    await fireEvent.press(screen.getByText('Pular'));
    expect(sent()).toContainEqual(['onboarding_skipped', { step: 2 }]);
    expect(sent()).toContainEqual(['onboarding_step_viewed', { step: 4 }]);
  });

  test('allowing the camera reports the permission and then the completion', async () => {
    await render(<Onboarding />);
    await fireEvent.press(screen.getByText('Pular'));
    (track as jest.Mock).mockClear();
    await act(async () => fireEvent.press(screen.getByText('Continuar')));
    expect(sent()).toEqual([
      ['permission_result', { kind: 'camera', granted: true }],
      ['onboarding_completed', undefined],
    ]);
  });

  test('a refused camera reports the permission and no completion', async () => {
    allow.mockResolvedValue(false);
    await render(<Onboarding />);
    await fireEvent.press(screen.getByText('Pular'));
    (track as jest.Mock).mockClear();
    await act(async () => fireEvent.press(screen.getByText('Continuar')));
    expect(sent()).toEqual([['permission_result', { kind: 'camera', granted: false }]]);
  });
});
