import { receivedClip, type OpenedClip } from '../receivedClip';

const opened = (edit: Record<string, unknown>): OpenedClip => ({ position: 3, bytes: 10, durationMs: 30000, edit, ready: true, video: 'u' });

test("a received clip keeps the sender's cut, number, name, edit and framing", () => {
  const clip = receivedClip(
    's1',
    opened({
      number: 7,
      name: 'Saque',
      createdAt: 1234,
      source: 'voice',
      trim: { startMs: 10000, endMs: 25000 },
      bounds: { startMs: 5000, endMs: 30000 },
      contentStartMs: 120,
      shortSide: 2160,
      edit: { muted: false, speed: 0.5, framing: 'ball' },
      focus: { startMs: 8000, endMs: 27000 },
      ball: { startMs: 10000, endMs: 25000, sport: 'beachTennis', rules: 'r2' },
    }),
    { video: '/r/3.mp4', focus: '/r/3.focus.json', ball: '/r/3.ball.json' },
    99,
  );
  expect(clip).toEqual({
    sessionId: 's1',
    createdAt: 1234,
    source: 'voice',
    path: '/r/3.mp4',
    durationMs: 30000,
    trim: { startMs: 10000, endMs: 25000 },
    bounds: { startMs: 5000, endMs: 30000 },
    sharePosition: 3,
    number: 7,
    contentStartMs: 120,
    shortSide: 2160,
    name: 'Saque',
    edit: { muted: false, speed: 0.5, framing: 'ball' },
    focus: { v: 1, status: 'ready', file: '/r/3.focus.json', startMs: 8000, endMs: 27000 },
    ball: { v: 1, status: 'ready', startMs: 10000, endMs: 25000, file: '/r/3.ball.json', sport: 'beachTennis', rules: 'r2' },
  });
});

test('missing or broken edit data falls back to the whole clip, its place in the share and no framing', () => {
  const clip = receivedClip('s1', opened({ trim: { startMs: 9, endMs: 2 }, source: 'nope' }), { video: '/r/3.mp4' }, 99);
  expect(clip).toEqual({
    sessionId: 's1',
    createdAt: 99,
    source: 'screen',
    path: '/r/3.mp4',
    durationMs: 30000,
    trim: { startMs: 0, endMs: 30000 },
    sharePosition: 3,
    number: 3,
  });
});
