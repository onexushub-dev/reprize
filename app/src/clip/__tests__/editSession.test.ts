import type { Clip } from '../../data/schema';
import { beginEdit, hasChanges, lastTool, rememberTool, restorePatch } from '../editSession';

const clip: Clip = {
  id: 'c1',
  sessionId: 's1',
  createdAt: 1,
  source: 'screen',
  path: '/c1.mp4',
  durationMs: 60000,
  trim: { startMs: 30000, endMs: 60000 },
};

test('nothing changed means no changes', () => {
  const s = beginEdit(clip);
  expect(hasChanges(s, clip)).toBe(false);
  // Storing the defaults explicitly is not a change.
  expect(hasChanges(s, { ...clip, edit: { speed: 1, muted: false, framing: 'none' } })).toBe(false);
});

test.each([
  ['the cut', { trim: { startMs: 40000, endMs: 60000 } }],
  ['the speed', { edit: { speed: 2 as const, muted: false } }],
  ['the sound', { edit: { muted: true } }],
  ['the zoom', { edit: { muted: false, zoom: { scale: 2, cx: 0.5, cy: 0.5 } } }],
  ['the turn', { edit: { muted: false, rotation: 90 as const } }],
  ['Modo Foco', { edit: { muted: false, framing: 'focus' as const } }],
])('changing %s is a change', (_name, patch) => {
  expect(hasChanges(beginEdit(clip), { ...clip, ...patch })).toBe(true);
});

test('the restore patch is the edit and cut exactly as they were (the route test covers a real pinch)', () => {
  const s = beginEdit({ ...clip, edit: { speed: 1, muted: false } });
  expect(restorePatch(s)).toEqual({ edit: { speed: 1, muted: false }, trim: { startMs: 30000, endMs: 60000 } });
});

test('a clip never edited goes back to no edit at all', () => {
  expect(restorePatch(beginEdit(clip))).toEqual({ edit: undefined, trim: { startMs: 30000, endMs: 60000 } });
});

// The screen is keyed by clip id, so a snapshot never outlives its clip; this only pins what is recorded.
test('the snapshot records which clip it was taken from', () => {
  expect(beginEdit(clip).clipId).toBe('c1');
  expect(beginEdit({ ...clip, id: 'c2' }).clipId).toBe('c2');
});

test('the first edit opens on Foco, then on the last tool used', () => {
  expect(lastTool()).toBe('focus');
  rememberTool('speed');
  expect(lastTool()).toBe('speed');
});
