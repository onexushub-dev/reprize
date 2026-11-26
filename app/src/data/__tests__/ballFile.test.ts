import { readyBallFile } from '../ballFile';

// One's own clips keep today's rule exactly (Victor, 2026-11-22: Bola is stable and validated; nothing of it changes).
test("one's own clip: the framing serves only the exact cut it was made for, as before", () => {
  const ball = { v: 1 as const, status: 'ready' as const, startMs: 1_000, endMs: 9_000, file: '/c/1.ball.json' };
  expect(readyBallFile({ ball, trim: { startMs: 1_000, endMs: 9_000 } })).toBe('/c/1.ball.json');
  expect(readyBallFile({ ball, trim: { startMs: 2_000, endMs: 8_000 } })).toBeUndefined();
  expect(readyBallFile({ ball, trim: { startMs: 1_000, endMs: 9_001 } })).toBeUndefined();
  expect(readyBallFile({ ball: { ...ball, status: 'pending' }, trim: { startMs: 1_000, endMs: 9_000 } })).toBeUndefined();
  expect(readyBallFile({ ball: undefined, trim: { startMs: 1_000, endMs: 9_000 } })).toBeUndefined();
});

test("a received clip's framing serves any cut inside what it covers; one's own clip needs its exact cut (2026-11-22)", () => {
  const ball = { v: 1 as const, status: 'ready' as const, startMs: 0, endMs: 14_999.6, file: '/r/3.ball.json' };
  expect(readyBallFile({ ball, trim: { startMs: 0, endMs: 15_000 }, sharePosition: 3 })).toBe('/r/3.ball.json');
  expect(readyBallFile({ ball, trim: { startMs: 2_000, endMs: 9_000 }, sharePosition: 3 })).toBe('/r/3.ball.json');
  expect(readyBallFile({ ball, trim: { startMs: 0, endMs: 15_000 } })).toBeUndefined();
  expect(readyBallFile({ ball: { ...ball, endMs: 15_000 }, trim: { startMs: 0, endMs: 15_000 } })).toBe('/r/3.ball.json');
});
