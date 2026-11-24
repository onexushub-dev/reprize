import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { setLocale } from '../../i18n';
import { CaptureGuard } from '../CaptureGuard';

jest.mock('../../../modules/replay-camera', () => {
  const shield: { onShieldState?: (e: { nativeEvent: unknown }) => void } = {};
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    __shield: shield,
    // No JSX in a mock factory: the JSX runtime is outside its scope.
    CaptureShieldView: (p: { onShieldState: (e: { nativeEvent: unknown }) => void; children: unknown }) => {
      shield.onShieldState = p.onShieldState;
      return createElement(View, { testID: 'shield' }, p.children);
    },
  };
});
jest.mock('../../analytics', () => ({ track: jest.fn() }));
jest.mock('../../diag/diagLog', () => ({ diag: jest.fn() }));

const { __shield: shield } = jest.requireMock('../../../modules/replay-camera');
const { track } = jest.requireMock('../../analytics');
const MESSAGE = 'Este lance não pode ser capturado. Para guardar, toque em Salvar.';

async function report(capturing: boolean, screenshots: number) {
  await act(async () => shield.onShieldState({ nativeEvent: { protected: true, capturing, canvas: 'Canvas', screenshots } }));
}

beforeEach(() => {
  jest.clearAllMocks();
  setLocale('pt-BR');
});

test('an own recording plays as before: no shield, no message', async () => {
  await render(
    <CaptureGuard active={false} onCapturing={jest.fn()}>
      <Text>video</Text>
    </CaptureGuard>,
  );
  expect(screen.getByText('video')).toBeTruthy();
  expect(screen.queryByTestId('shield')).toBeNull();
  expect(screen.queryByText(MESSAGE)).toBeNull();
});

test('a received recording sits in the shield, with the message underneath for captures', async () => {
  await render(
    <CaptureGuard active onCapturing={jest.fn()}>
      <Text>video</Text>
    </CaptureGuard>,
  );
  expect(screen.getByTestId('shield')).toBeTruthy();
  expect(screen.getByText('video')).toBeTruthy();
  expect(screen.getAllByText(MESSAGE)).toHaveLength(1);
});

test('a screen recording pauses the clip and covers it until it ends', async () => {
  const onCapturing = jest.fn();
  await render(
    <CaptureGuard active onCapturing={onCapturing}>
      <Text>video</Text>
    </CaptureGuard>,
  );
  await report(false, 0);
  await report(true, 0);
  expect(onCapturing).toHaveBeenLastCalledWith(true);
  expect(screen.getAllByText(MESSAGE)).toHaveLength(2);
  expect(track).toHaveBeenCalledWith('capture_blocked', { kind: 'recording' });

  await report(false, 0);
  expect(onCapturing).toHaveBeenLastCalledWith(false);
  expect(screen.getAllByText(MESSAGE)).toHaveLength(1);
});

test('a screenshot is counted once', async () => {
  await render(
    <CaptureGuard active onCapturing={jest.fn()}>
      <Text>video</Text>
    </CaptureGuard>,
  );
  await report(false, 0);
  await report(false, 1);
  await report(false, 1);
  expect(track).toHaveBeenCalledTimes(1);
  expect(track).toHaveBeenCalledWith('capture_blocked', { kind: 'screenshot' });
});

test('quiet (a system sheet over the screen, or the screen leaving) takes the message away, the shield stays', async () => {
  await render(
    <CaptureGuard active quiet onCapturing={jest.fn()}>
      <Text>video</Text>
    </CaptureGuard>,
  );
  expect(screen.getByTestId('shield')).toBeTruthy();
  expect(screen.queryByText(MESSAGE)).toBeNull();
});
