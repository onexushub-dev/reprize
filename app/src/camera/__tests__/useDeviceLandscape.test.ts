import { act, renderHook } from '@testing-library/react-native';

import { getDeviceGravity, getDeviceUpright } from '../../../modules/replay-camera';
import { isLandscape, turnFromGravity, useDeviceLandscape, useLandscapeTurn } from '../useDeviceLandscape';

jest.mock('../../../modules/replay-camera', () => ({
  getDeviceUpright: jest.fn(() => 'portrait'),
  getDeviceGravity: jest.fn(() => null),
}));

const upright = getDeviceUpright as jest.Mock;
const gravity = getDeviceGravity as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  upright.mockReset();
  upright.mockReturnValue('portrait');
  gravity.mockReset();
  gravity.mockReturnValue(null);
});
afterEach(() => jest.useRealTimers());

test('only the two sideways positions count as landscape', () => {
  expect(isLandscape('landscapeLeft')).toBe(true);
  expect(isLandscape('landscapeRight')).toBe(true);
  expect(isLandscape('portrait')).toBe(false);
  expect(isLandscape('portraitUpsideDown')).toBe(false);
});

test('a phone already on its side is landscape at once', async () => {
  upright.mockReturnValue('landscapeRight');
  const { result } = await renderHook(() => useDeviceLandscape(true));
  expect(result.current).toBe(true);
});

test('turning the phone changes the layout only after two matching reads', async () => {
  const { result } = await renderHook(() => useDeviceLandscape(true));
  expect(result.current).toBe(false);
  await act(async () => jest.advanceTimersByTime(300)); // first read, still upright
  upright.mockReturnValue('landscapeLeft');
  await act(async () => jest.advanceTimersByTime(300));
  expect(result.current).toBe(false);
  await act(async () => jest.advanceTimersByTime(300));
  expect(result.current).toBe(true);
});

test('a tilt in passing does not flip the layout', async () => {
  const { result } = await renderHook(() => useDeviceLandscape(true));
  await act(async () => jest.advanceTimersByTime(300));
  upright.mockReturnValue('landscapeLeft');
  await act(async () => jest.advanceTimersByTime(300));
  upright.mockReturnValue('portrait');
  await act(async () => jest.advanceTimersByTime(900));
  expect(result.current).toBe(false);
});

test('inactive means portrait layout and no reading', async () => {
  upright.mockReturnValue('landscapeLeft');
  const { result } = await renderHook(() => useDeviceLandscape(false));
  await act(async () => jest.advanceTimersByTime(1000));
  expect(result.current).toBe(false);
  expect(upright).not.toHaveBeenCalled();
});

describe('from gravity, only a phone truly on its side turns the controls (2026-11-20)', () => {
  const g = (x: number, y: number, z = 0) => ({ x, y, z });

  test('upright, leaning back or tilted halfway stays upright', () => {
    expect(turnFromGravity(0, g(0, -1))).toBe(0);
    // Leaning back on a tripod, a little to the side: the native position called this landscape.
    expect(turnFromGravity(0, g(0.25, -0.2, -0.95))).toBe(0);
    expect(turnFromGravity(0, g(0.7, -0.7))).toBe(0);
    expect(turnFromGravity(0, g(-0.75, -0.5))).toBe(0);
  });

  test('on its side turns toward the side, home button right (x < 0) clockwise', () => {
    expect(turnFromGravity(0, g(-0.98, -0.1))).toBe(90);
    expect(turnFromGravity(0, g(0.95, 0.2))).toBe(-90);
  });

  test('once turned, it stands back up only when the top edge carries more than the side', () => {
    expect(turnFromGravity(90, g(-0.7, -0.6))).toBe(90);
    expect(turnFromGravity(90, g(-0.6, -0.7))).toBe(0);
  });

  test('lying flat keeps what is shown', () => {
    expect(turnFromGravity(90, g(-0.1, 0.05, -1))).toBe(90);
    expect(turnFromGravity(0, g(-0.2, 0.1, -1))).toBe(0);
  });

  test('the hook follows gravity where the build gives it, ignoring the native position', async () => {
    upright.mockReturnValue('landscapeLeft');
    gravity.mockReturnValue(g(-0.3, -0.25, -0.9));
    const { result } = await renderHook(() => useLandscapeTurn(true));
    expect(result.current).toBe(0);
    gravity.mockReturnValue(g(-0.97, -0.1));
    await act(async () => jest.advanceTimersByTime(900));
    expect(result.current).toBe(90);
  });
});
