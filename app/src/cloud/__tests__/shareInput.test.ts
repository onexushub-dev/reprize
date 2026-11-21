import type { FileProbe } from '../../data/repo';
import type { Clip, Session } from '../../data/schema';
import { attachCover, coverPending, recordingShareInput, uploadItems } from '../shareInput';
import type { CreatedShare } from '../shares';

const session: Session = { id: 's1', sport: 'quadra', startedAt: 0, endedAt: 1000, name: 'Final de domingo' };

const clip = (n: number, extra: Partial<Clip> = {}): Clip => ({
  id: `c${n}`,
  sessionId: 's1',
  createdAt: n * 100,
  source: 'gesture',
  path: `/clips/${n}.mp4`,
  durationMs: 30000,
  trim: { startMs: 10000, endMs: 25000 },
  ...extra,
});

function probe(sizes: Record<string, number>): FileProbe {
  return { exists: (p) => p in sizes, sizeBytes: (p) => sizes[p] ?? 0 };
}

test('each clip goes in the recording order with its edit and only the side files on the phone', () => {
  const clips = [
    clip(1, { number: 4, name: 'Saque', edit: { muted: true, speed: 0.5 }, focus: { v: 1, status: 'ready', file: '/clips/1.focus.json' } }),
    clip(2, { focus: { v: 1, status: 'failed' } }),
  ];
  const files = probe({ '/clips/1.mp4': 15_000_000, '/clips/1.thumb.jpg': 20_000, '/clips/1.focus.json': 900, '/clips/2.mp4': 9_000_000 });
  const { input, local } = recordingShareInput(session, clips, files);

  expect(input).toMatchObject({ kind: 'recording', title: 'Final de domingo', cover: true });
  expect(input.clips.map((c) => [c.position, c.bytes, c.hasThumb, c.hasFocus, c.hasBall])).toEqual([
    [1, 15_000_000, true, true, false],
    [2, 9_000_000, false, false, false],
  ]);
  expect(input.clips[0].edit).toMatchObject({ number: 4, name: 'Saque', trim: { startMs: 10000, endMs: 25000 }, edit: { muted: true, speed: 0.5 } });
  expect(input.clips[1].edit).toMatchObject({ number: 2 });
  expect(local).toEqual([
    { kind: 'video', position: 1, path: '/clips/1.mp4' },
    { kind: 'thumb', position: 1, path: '/clips/1.thumb.jpg' },
    { kind: 'focus', position: 1, path: '/clips/1.focus.json' },
    { kind: 'video', position: 2, path: '/clips/2.mp4' },
  ]);
});

test('the recording time goes with the link, so the recipient sees its minutes', () => {
  const clips = [clip(1)];
  expect(recordingShareInput(session, clips, probe({ '/clips/1.mp4': 1 }), 754_321.6).input.recordedMs).toBe(754_322);
  expect(recordingShareInput(session, clips, probe({ '/clips/1.mp4': 1 })).input.recordedMs).toBeUndefined();
});

test('a framing file that is not on the phone is not announced', () => {
  const clips = [clip(1, { focus: { v: 1, status: 'ready', file: '/clips/1.focus.json' } })];
  const { input } = recordingShareInput(session, clips, probe({ '/clips/1.mp4': 1 }));
  expect(input.clips[0].hasFocus).toBe(false);
});

test('each upload URL is paired with its file; the cover waits without one; any other upload without a file is left out', () => {
  const share: CreatedShare = {
    shareId: 'sh',
    code: 'abc',
    url: 'https://reprizeapp.com/v/abc',
    expiresAt: '2026-11-18T12:00:00Z',
    uploads: [
      { key: 'shares/sh/clips/1/thumb.jpg', kind: 'thumb', position: 1, url: 'u-thumb', contentType: 'image/jpeg' },
      { key: 'shares/sh/cover.mp4', kind: 'cover', position: null, url: 'u-cover', contentType: 'video/mp4' },
      { key: 'shares/sh/clips/1/video.mp4', kind: 'video', position: 1, url: 'u-video', contentType: 'video/mp4' },
      { key: 'shares/sh/clips/1/focus.json', kind: 'focus', position: 1, url: 'u-focus', contentType: 'application/json' },
    ],
  };
  const items = uploadItems(share, [
    { kind: 'video', position: 1, path: '/clips/1.mp4' },
    { kind: 'thumb', position: 1, path: '/clips/1.thumb.jpg' },
  ]);
  expect(items).toEqual([
    { id: 'shares/sh/clips/1/thumb.jpg', path: '/clips/1.thumb.jpg', url: 'u-thumb', contentType: 'image/jpeg' },
    { id: 'shares/sh/cover.mp4', path: '', url: 'u-cover', contentType: 'video/mp4' },
    { id: 'shares/sh/clips/1/video.mp4', path: '/clips/1.mp4', url: 'u-video', contentType: 'video/mp4' },
  ]);
  expect(coverPending(items)).toBe(true);
  const ready = attachCover(items, { video: '/shares/sh/cover.mp4', image: '/shares/sh/cover.jpg' });
  expect(ready[1].path).toBe('/shares/sh/cover.mp4');
  expect(coverPending(ready)).toBe(false);
});
