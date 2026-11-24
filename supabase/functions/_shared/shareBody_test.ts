// deno test supabase/functions/_shared/
import { deepStrictEqual as assertEquals } from 'node:assert/strict';

import { coverUploads, groupRows, MAX_GROUP_CLIPS, parseGroup, parseShare, plannedUploads } from './shareBody.ts';

const clip = (position: number, extra: Record<string, unknown> = {}) => ({
  position,
  bytes: 1000 + position,
  durationMs: 15000,
  edit: { number: position },
  hasThumb: true,
  ...extra,
});
const recording = (clips: number, extra: Record<string, unknown> = {}) => ({
  kind: 'recording',
  title: 'Final',
  clips: Array.from({ length: clips }, (_, i) => clip(i + 1)),
  ...extra,
});

Deno.test('a recording body is checked as before', () => {
  const ok = parseShare(recording(2, { sport: 'beachTennis', recordedMs: 60000 }));
  assertEquals(ok !== null && ok.clips.length, 2);
  assertEquals(ok !== null && ok.cover, true);
  assertEquals(parseShare(recording(0)), null);
  assertEquals(parseShare({ ...recording(1), kind: 'group' }), null);
  assertEquals(parseShare(recording(2, { clips: [clip(1), clip(1)] })), null);
});

Deno.test('a group holds 2 to 10 recordings, each a recording without a cover of its own', () => {
  const group = parseGroup({ kind: 'group', recordings: [recording(2), recording(3, { kind: 'clip' })] });
  assertEquals(group !== null && group.recordings.length, 2);
  assertEquals(group !== null && group.recordings.every((r) => r.kind === 'recording' && r.cover === false), true);
  assertEquals(parseGroup({ kind: 'group', recordings: [recording(2)] }), null);
  assertEquals(parseGroup({ kind: 'group', recordings: Array.from({ length: 11 }, () => recording(1)) }), null);
  assertEquals(parseGroup({ kind: 'group', recordings: [recording(1), recording(0)] }), null);
  assertEquals(parseGroup({ kind: 'group', recordings: [recording(1), 'x'] }), null);
  assertEquals(parseGroup({ kind: 'recording', recordings: [recording(1), recording(1)] }), null);
});

Deno.test('a group refuses more than 600 clips in all', () => {
  const big = Array.from({ length: 4 }, () => recording(160));
  assertEquals(160 * 4 > MAX_GROUP_CLIPS, true);
  assertEquals(parseGroup({ kind: 'group', recordings: big }), null);
  assertEquals(parseGroup({ kind: 'group', recordings: big.slice(0, 3) }) !== null, true);
});

Deno.test('uploads in queue order: thumbnails, cover, then each video with its framing files', () => {
  const share = parseShare(recording(2, { clips: [clip(1, { hasFocus: true }), clip(2, { hasThumb: false })] }));
  if (share === null) throw new Error('body');
  const keys = plannedUploads('S', share).map((u) => u.key);
  assertEquals(keys, [
    'shares/S/clips/1/thumb.jpg',
    'shares/S/cover.jpg',
    'shares/S/cover.mp4',
    'shares/S/clips/1/video.mp4',
    'shares/S/clips/1/focus.json',
    'shares/S/clips/2/video.mp4',
  ]);
  assertEquals(plannedUploads('S', { ...share, cover: false }).some((u) => u.key.includes('cover')), false);
  assertEquals(coverUploads('G').map((u) => u.key), ['shares/G/cover.jpg', 'shares/G/cover.mp4']);
});

Deno.test('the rows sent to create_share_group keep the order and every clip field', () => {
  const group = parseGroup({ kind: 'group', recordings: [recording(1, { title: 'A' }), recording(2, { title: 'B' })] });
  if (group === null) throw new Error('body');
  const rows = groupRows(group);
  assertEquals(rows.map((r) => r.title), ['A', 'B']);
  assertEquals((rows[1].clips as unknown[]).length, 2);
  assertEquals((rows[0].clips as Record<string, unknown>[])[0].hasThumb, true);
});
