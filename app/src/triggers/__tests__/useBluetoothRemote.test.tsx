import { act, renderHook } from '@testing-library/react-native';

import { LINK_POLL_MS, useBluetoothRemote } from '../useBluetoothRemote';

jest.mock('../../../modules/replay-camera', () => ({ bluetoothConnected: jest.fn() }));
jest.mock('../../diag/diagLog', () => ({ diag: jest.fn() }));
jest.mock('../useVolumeRemote', () => ({ useVolumeRemote: jest.fn() }));
jest.mock('../../data/mmkv', () => {
  let prefs: Record<string, unknown> = {};
  return {
    __set: (p: Record<string, unknown>) => (prefs = p),
    repo: { getPrefs: () => prefs },
  };
});

const cam = jest.requireMock('../../../modules/replay-camera');
const mmkv = jest.requireMock('../../data/mmkv');
const { useVolumeRemote } = jest.requireMock('../useVolumeRemote');
const shutter = { id: 'AAAA', name: 'AB Shutter3', services: ['battery', 'info'] };
const tick = () => act(async () => void (await jest.advanceTimersByTimeAsync(LINK_POLL_MS)));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mmkv.__set({ remoteBleId: 'AAAA' });
});
afterEach(() => jest.useRealTimers());

test('2026-11-02 society: the link dropping and coming back (out of range and back, or asleep) never saves a clip', async () => {
  const onPress = jest.fn();
  cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter] });
  const { unmount } = await renderHook(() => useBluetoothRemote(true, onPress));
  await tick();
  for (let i = 0; i < 3; i++) {
    cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [] }); // out of range
    await tick();
    cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter] }); // back
    await tick();
  }
  expect(onPress).not.toHaveBeenCalled();
  await act(async () => unmount());
});

test('the remote\'s own presses save, every one, also right after a comeback', async () => {
  const onPress = jest.fn();
  cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter] });
  const { unmount } = await renderHook(() => useBluetoothRemote(true, onPress));
  await tick();
  cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [] });
  await tick();
  cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter] });
  await tick();
  await act(async () => useVolumeRemote.mock.calls.at(-1)[1]()); // the press that woke it got through
  expect(onPress).toHaveBeenCalledTimes(1);
  await act(async () => unmount());
});

test('the drops and comebacks go to the diagnostic log, saying they do not count', async () => {
  const { diag } = jest.requireMock('../../diag/diagLog');
  cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter] });
  const { unmount } = await renderHook(() => useBluetoothRemote(true, jest.fn()));
  await tick();
  cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [] });
  await tick();
  cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter] });
  await tick();
  const lines = diag.mock.calls.map((c: string[]) => c[0]);
  expect(lines.some((l: string) => l.startsWith('controle: conexão caiu'))).toBe(true);
  expect(lines.some((l: string) => l.startsWith('controle: conexão voltou') && l.endsWith('(não conta como clique)'))).toBe(true);
  await act(async () => unmount());
});

test('without a learnt BLE remote it is the volume remote alone (nothing is looked at)', async () => {
  mmkv.__set({});
  const onPress = jest.fn();
  const { unmount } = await renderHook(() => useBluetoothRemote(true, onPress));
  await tick();
  expect(cam.bluetoothConnected).not.toHaveBeenCalled();
  expect(useVolumeRemote).toHaveBeenLastCalledWith(true, expect.any(Function), { onHold: undefined, parkAt: undefined });
  await act(async () => unmount());
});

test('disabled: nothing is looked at', async () => {
  await renderHook(() => useBluetoothRemote(false, jest.fn()));
  await tick();
  expect(cam.bluetoothConnected).not.toHaveBeenCalled();
});
