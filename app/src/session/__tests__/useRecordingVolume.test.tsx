import { act, renderHook } from '@testing-library/react-native';
import { VolumeManager } from 'react-native-volume-manager';

import { RECORDING_VOLUME, useRecordingVolume } from '../useRecordingVolume';

jest.mock('react-native-volume-manager', () => ({
  VolumeManager: { getVolume: jest.fn(), setVolume: jest.fn(async () => {}) },
}));

const getVolume = VolumeManager.getVolume as jest.Mock;
const setVolume = VolumeManager.setVolume as jest.Mock;
const flush = () => act(async () => {});

beforeEach(() => jest.clearAllMocks());

test('a recording raises a low volume and gives it back when it ends', async () => {
  getVolume.mockResolvedValue({ volume: 0.4 });
  const view = await renderHook(({ on }: { on: boolean }) => useRecordingVolume(on), { initialProps: { on: true } });
  await flush();
  expect(setVolume).toHaveBeenLastCalledWith(RECORDING_VOLUME, { showUI: false, playSound: false });
  await view.rerender({ on: false });
  expect(setVolume).toHaveBeenLastCalledWith(0.4, { showUI: false, playSound: false });
});

test('a volume already loud enough is left alone', async () => {
  getVolume.mockResolvedValue({ volume: 0.9 });
  const view = await renderHook(({ on }: { on: boolean }) => useRecordingVolume(on), { initialProps: { on: true } });
  await flush();
  await view.rerender({ on: false });
  expect(setVolume).not.toHaveBeenCalled();
});

test('nothing happens outside a recording', async () => {
  await renderHook(() => useRecordingVolume(false));
  await flush();
  expect(getVolume).not.toHaveBeenCalled();
});
