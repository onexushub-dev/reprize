import type { Clip } from '../../data/schema';
import { exportCover } from '../cover';

// The cover gets everything through its deps; the native module is only loaded by the export job code.
jest.mock('../../../modules/replay-camera', () => ({ createThumbnail: jest.fn(async () => '/t.jpg') }));

const clip: Clip = {
  id: 'c1',
  sessionId: 's1',
  createdAt: 0,
  source: 'gesture',
  path: '/clips/1.mp4',
  durationMs: 30000,
  trim: { startMs: 10000, endMs: 25000 },
  edit: { muted: false, speed: 1 },
};

test('the cover is the first clip as the free plan exports it: with the mark, never with sound, plus a still', async () => {
  const exportClip = jest.fn(async () => ({ path: '/cache/cover.mp4', durationMs: 15000 }));
  const capture = jest.fn(async (_job: { watermark: boolean }) => '/cache/mark.png');
  const still = jest.fn(async () => '/cache/cover.thumb.jpg');
  const made = await exportCover(clip, {
    shapeOf: async () => ({ width: 1920, height: 1080 }),
    capture,
    exportClip,
    still,
  });
  expect(made).toEqual({ video: '/cache/cover.mp4', image: '/cache/cover.thumb.jpg' });
  expect(capture.mock.calls[0][0]).toMatchObject({ watermark: true });
  expect(exportClip).toHaveBeenCalledWith(
    expect.objectContaining({ clipPath: '/clips/1.mp4', muted: true, watermark: true, overlayPngPath: '/cache/mark.png', startMs: 10000, endMs: 25000 }),
  );
  expect(still).toHaveBeenCalledWith('/cache/cover.mp4', 1000);
});
