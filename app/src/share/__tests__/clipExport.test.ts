import { Image } from 'react-native';

import { forgetShapes, knownShape, rememberShape } from '../../components/clipShape';
import type { Clip } from '../../data/schema';
import { clipExportJob, clipShapeOf, compilationOrientation } from '../clipExport';

jest.mock('../../data/focusFile', () => ({
  ...jest.requireActual('../../data/focusFile'),
  readFocusFile: jest.fn(() => ({ startMs: 0, stepMs: 100, rects: [[0.25, 0.25, 0.5, 0.5]] })),
}));
jest.mock('../../../modules/replay-camera', () => ({ createThumbnail: jest.fn(async () => '/t.jpg') }));

const { readFocusFile } = jest.requireMock('../../data/focusFile');
const vertical = { width: 1080, height: 1920 };
const landscape = { width: 1920, height: 1080 };
const clip: Clip = {
  id: 'c1',
  sessionId: 's1',
  createdAt: 0,
  source: 'screen',
  path: '/c1.mp4',
  durationMs: 60000,
  trim: { startMs: 30000, endMs: 60000 },
  edit: { muted: false, speed: 2 },
};

beforeEach(() => {
  forgetShapes();
  readFocusFile.mockClear();
});

test('clipExportJob matches what the clip screen exports', () => {
  const job = clipExportJob(clip, 'paid', vertical);
  expect(job.options).toMatchObject({ width: 1080, height: 1920, startMs: 30000, endMs: 60000, speed: 2, rotation: 0 });
  expect(job.options.crop).toBeUndefined();
  expect(job.watermark).toBe(true); // every plan leaves with the app mark (2026-11-23)
  expect(job.frame).toEqual({ width: 1080, height: 1920 });
  // The free plan: an HD frame, the chosen speed, the app mark kept.
  const free = clipExportJob(clip, 'free', vertical);
  expect(free.options).toMatchObject({ width: 720, height: 1280, speed: 2 });
  expect(free.watermark).toBe(true);
});

test('Modo Foco ready: the framing file goes along on a paid export, never on a free one', () => {
  const ready = { ...clip, edit: { muted: false }, focus: { v: 1, status: 'ready', file: '/c.focus.json' } } as Clip;
  expect(clipExportJob(ready, 'paid', vertical).options.focus).toEqual({ path: '/c.focus.json', aspect: 'portrait' });
  expect(clipExportJob(ready, 'free', vertical).options.focus).toBeUndefined();
  readFocusFile.mockReturnValueOnce(undefined);
  expect(clipExportJob(ready, 'paid', vertical).options.focus).toBeUndefined();
});

test('the screen can say it already read the framing, so the file is not read again', () => {
  const ready = { ...clip, edit: { muted: false }, focus: { v: 1, status: 'ready', file: '/c.focus.json' } } as Clip;
  expect(clipExportJob(ready, 'paid', vertical, undefined, true).options.focus).toEqual({ path: '/c.focus.json', aspect: 'portrait' });
  expect(readFocusFile).not.toHaveBeenCalled();
});

test('forced orientation: a vertical clip in a landscape compilation', () => {
  const job = clipExportJob(clip, 'paid', vertical, 'landscape');
  expect(job.frame).toEqual({ width: 1920, height: 1080 });
  expect(job.layout.video.width).toBeLessThan(1920);
});

test('the same look gives the same key, any edit change a new one', () => {
  expect(clipExportJob(clip, 'paid', vertical).key).toBe(clipExportJob(clip, 'paid', vertical).key);
  expect(clipExportJob({ ...clip, edit: { muted: false, speed: 1 } }, 'paid', vertical).key).not.toBe(
    clipExportJob(clip, 'paid', vertical).key,
  );
  expect(clipExportJob({ ...clip, path: '/other.mp4' }, 'paid', vertical).key).not.toBe(clipExportJob(clip, 'paid', vertical).key);
});

test('compilationOrientation: the most clips win, a tie goes to the first clip', () => {
  expect(compilationOrientation([vertical, vertical, landscape])).toBe('portrait');
  expect(compilationOrientation([landscape, vertical])).toBe('landscape');
  expect(compilationOrientation([landscape, landscape, vertical])).toBe('landscape');
});

test('clipShapeOf: a known shape at once, else measured from the thumbnail and remembered', async () => {
  rememberShape('/c1.mp4', vertical);
  await expect(clipShapeOf(clip)).resolves.toEqual(vertical);
  forgetShapes();
  (jest.spyOn(Image, 'getSize') as jest.Mock).mockResolvedValue(landscape);
  await expect(clipShapeOf(clip)).resolves.toEqual(landscape);
  expect(knownShape('/c1.mp4')).toEqual(landscape);
});
