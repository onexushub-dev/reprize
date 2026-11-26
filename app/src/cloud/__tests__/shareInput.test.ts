import type { FileProbe } from '../../data/repo';
import type { Clip, Session } from '../../data/schema';
import { attachCover, coverPending, prepJobs, recordingShareInput, uploadItems } from '../shareInput';
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

test('each clip goes in the recording order, as its cut, with its edit on the cut\'s time and only the side files on the phone', () => {
  const clips = [
    clip(1, { number: 4, name: 'Saque', edit: { muted: true, speed: 0.5 }, focus: { v: 1, status: 'ready', file: '/clips/1.focus.json' } }),
    clip(2, { focus: { v: 1, status: 'failed' } }),
  ];
  const files = probe({ '/clips/1.mp4': 15_000_000, '/clips/1.thumb.jpg': 20_000, '/clips/1.focus.json': 900, '/clips/2.mp4': 9_000_000 });
  const { input, local } = recordingShareInput(session, clips, files);

  expect(input).toMatchObject({ kind: 'recording', title: 'Final de domingo', cover: true });
  // Announced: never less than the cut can weigh (the server takes the real size on confirming).
  expect(input.clips.map((c) => [c.position, c.bytes > 15_000_000 || c.bytes > 9_000_000, c.durationMs, c.hasThumb, c.hasFocus, c.hasBall])).toEqual([
    [1, true, 15_000, true, true, false],
    [2, true, 15_000, false, false, false],
  ]);
  // The cut file starts at the cut: the whole of it is the clip; what the sender fixed goes along.
  expect(input.clips[0].edit).toMatchObject({
    number: 4,
    name: 'Saque',
    trim: { startMs: 0, endMs: 15_000 },
    bounds: { startMs: 0, endMs: 15_000 },
    edit: { muted: true, speed: 0.5 },
    locks: { sound: true },
  });
  expect(input.clips[1].edit).toMatchObject({ number: 2 });
  expect(input.clips[1].edit.locks).toBeUndefined();
  // The cut and the framing on its time are made after the link; the still goes as it is.
  expect(local).toEqual([
    { kind: 'video', position: 1, path: '', prep: { kind: 'cut', source: '/clips/1.mp4', startMs: 10_000, endMs: 25_000, muted: true } },
    { kind: 'thumb', position: 1, path: '/clips/1.thumb.jpg' },
    { kind: 'focus', position: 1, path: '', prep: { kind: 'framing', source: '/clips/1.focus.json', startMs: 10_000, endMs: 25_000 } },
    { kind: 'video', position: 2, path: '', prep: { kind: 'cut', source: '/clips/2.mp4', startMs: 10_000, endMs: 25_000, muted: false } },
  ]);
});

test('a clip kept whole and with its sound goes as its own file, nothing made first', () => {
  const { input, local } = recordingShareInput(session, [clip(1, { trim: { startMs: 0, endMs: 30_000 } })], probe({ '/clips/1.mp4': 15_000_000 }));
  expect(input.clips[0].bytes).toBe(15_000_000);
  expect(local).toEqual([{ kind: 'video', position: 1, path: '/clips/1.mp4' }]);
});

test('the files to make are paired with their uploads, in the plan\'s order', () => {
  const local = recordingShareInput(session, [clip(1)], probe({ '/clips/1.mp4': 1 })).local;
  const jobs = prepJobs(
    { uploads: [{ key: 'shares/sh/clips/1/video.mp4', kind: 'video', position: 1, url: 'u', contentType: 'video/mp4' }] },
    local,
  );
  expect(jobs).toEqual([{ id: 'shares/sh/clips/1/video.mp4', kind: 'cut', source: '/clips/1.mp4', startMs: 10_000, endMs: 25_000, muted: false }]);
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
