import { cutBytesBound, rebaseFramingText, rebaseRange, shareCutOf, shareLocksOf } from '../shareCut';

const clip = (over: Record<string, unknown> = {}) => ({ durationMs: 30_000, trim: { startMs: 10_000, endMs: 25_000 }, ...over });

test('the cut sent is the clip\'s cut; the whole file unmuted needs no cut', () => {
  expect(shareCutOf(clip())).toEqual({ startMs: 10_000, endMs: 25_000, muted: false, needed: true });
  expect(shareCutOf(clip({ trim: { startMs: 0, endMs: 30_000 } }))).toMatchObject({ needed: false });
  expect(shareCutOf(clip({ trim: { startMs: 0, endMs: 30_000 }, edit: { muted: true } }))).toMatchObject({ muted: true, needed: true });
  // A cut past the file's end is the file's end.
  expect(shareCutOf(clip({ trim: { startMs: 5_000, endMs: 40_000 } }))).toMatchObject({ startMs: 5_000, endMs: 30_000 });
});

test('what the recipient cannot undo: only the silence (the framing and zoom stay theirs to change)', () => {
  expect(shareLocksOf({ edit: { muted: false, framing: 'focus' } })).toEqual({});
  expect(shareLocksOf({ edit: { muted: true, zoom: { scale: 2, cx: 0.5, cy: 0.5 } } })).toEqual({ sound: true });
  expect(shareLocksOf({ edit: undefined })).toEqual({});
});

test('the cut is in whole milliseconds, so the file, the cut and the framings agree exactly', () => {
  expect(shareCutOf(clip({ trim: { startMs: 10_000.4, endMs: 24_999.6 } }))).toMatchObject({ startMs: 10_000, endMs: 25_000 });
});

test('ranges move to the cut file\'s time, inside it', () => {
  const cut = { startMs: 10_000, endMs: 25_000 };
  expect(rebaseRange({ startMs: 8_000, endMs: 27_000 }, cut)).toEqual({ startMs: 0, endMs: 15_000 });
  expect(rebaseRange({ startMs: 10_000, endMs: 25_000 }, cut)).toEqual({ startMs: 0, endMs: 15_000 });
  expect(rebaseRange({ startMs: 12_000, endMs: 20_000 }, cut)).toEqual({ startMs: 2_000, endMs: 10_000 });
});

test('a framing file keeps only its rows inside the cut, on the cut\'s time; other fields stay', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => [i / 100, 0, 0.5, 0.5]);
  const text = JSON.stringify({ v: 1, startMs: 8_000, stepMs: 100, landscape: rows(190), portrait: rows(190), every: 100 });
  const out = JSON.parse(rebaseFramingText(text, { startMs: 10_050, endMs: 12_000 })!);
  // First row at or after 10 050 is at 10 100 (row 21): 50 ms into the cut.
  expect(out.startMs).toBe(50);
  expect(out.stepMs).toBe(100);
  expect(out.every).toBe(100);
  expect(out.landscape[0]).toEqual([0.21, 0, 0.5, 0.5]);
  // Rows up to 12 000 (row 40): 20 of them.
  expect(out.landscape).toHaveLength(20);
  expect(out.portrait).toHaveLength(20);
});

test('a framing file that is broken or misses the cut is not sent', () => {
  expect(rebaseFramingText('{', { startMs: 0, endMs: 1000 })).toBeUndefined();
  const text = JSON.stringify({ v: 1, startMs: 0, stepMs: 100, portrait: [[0, 0, 1, 1]] });
  expect(rebaseFramingText(text, { startMs: 5_000, endMs: 6_000 })).toBeUndefined();
});

test('the size announced for a cut is never less than what it can weigh', () => {
  expect(cutBytesBound(10_000_000)).toBeGreaterThan(10_000_000);
  expect(cutBytesBound(0)).toBeGreaterThan(0);
});
