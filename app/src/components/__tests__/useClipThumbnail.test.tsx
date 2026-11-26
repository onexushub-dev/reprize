import { act, renderHook } from '@testing-library/react-native';

import { useClipThumbnail } from '../useClipThumbnail';

jest.mock('../../../modules/replay-camera', () => ({ createThumbnail: jest.fn() }));
const { createThumbnail } = jest.requireMock('../../../modules/replay-camera');
// The frames already written next to their clips.
const mockOnDisk = new Set<string>();
jest.mock('expo-file-system', () => ({
  File: class {
    exists: boolean;
    constructor(uri: string) {
      this.exists = mockOnDisk.has(uri);
    }
  },
}));

beforeEach(() => jest.clearAllMocks());

test('asks the native module for a frame at the start of the cut and returns a file uri', async () => {
  createThumbnail.mockResolvedValue('/docs/clips/A.jpg');
  const view = await renderHook(() => useClipThumbnail('/docs/clips/A.mp4', 30000));
  await act(async () => {});

  expect(createThumbnail).toHaveBeenCalledWith('/docs/clips/A.mp4', 30000);
  expect(view.result.current).toBe('file:///docs/clips/A.jpg');
});

test('a thumbnail that cannot be made leaves the placeholder', async () => {
  createThumbnail.mockRejectedValue(new Error('no frame'));
  const view = await renderHook(() => useClipThumbnail('/docs/clips/B.mp4', 0));
  await act(async () => {});
  expect(view.result.current).toBeUndefined();
});

test('a frame already written next to the clip shows on the first render, without asking the native module', async () => {
  mockOnDisk.add('file:///docs/clips/C.thumb.jpg');
  const view = await renderHook(() => useClipThumbnail('/docs/clips/C.mp4', 0));
  expect(view.result.current).toBe('file:///docs/clips/C.thumb.jpg');
  expect(createThumbnail).not.toHaveBeenCalled();
});
