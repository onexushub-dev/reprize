import { allowedEdit, receivedBallOf, receivedFramingHere } from '../receivedFraming';

test('an edit change keeps out only the sound of a clip sent without it', () => {
  expect(allowedEdit({ muted: false }, { sound: true })).toEqual({});
  expect(allowedEdit({ muted: true }, { sound: true })).toEqual({ muted: true });
  expect(allowedEdit({ muted: false }, {})).toEqual({ muted: false });
});

test("a received clip's Bola is the sender's framing, while the cut stays inside it", () => {
  const ball = { v: 1 as const, status: 'ready' as const, startMs: 0, endMs: 15_000, file: '/r/3.ball.json', sport: 'basquete' as const };
  expect(receivedBallOf({ ball, trim: { startMs: 2_000, endMs: 9_000 } })).toBe(ball);
  expect(receivedBallOf({ ball: { ...ball, status: 'failed' }, trim: { startMs: 0, endMs: 15_000 } })).toBeUndefined();
  expect(receivedBallOf({ ball: { ...ball, endMs: 8_000 }, trim: { startMs: 0, endMs: 15_000 } })).toBeUndefined();
  expect(receivedBallOf({ ball: undefined, trim: { startMs: 0, endMs: 1 } })).toBeUndefined();
});

test('a millisecond or two of rounding between the cut and the framing is the same cut', () => {
  const ball = { v: 1 as const, status: 'ready' as const, startMs: 0, endMs: 14_999, file: '/r/3.ball.json' };
  expect(receivedBallOf({ ball, trim: { startMs: 0, endMs: 15_000 } })).toBe(ball);
});

test('a clip received on Bola where this phone cannot show Bola opens on Jogadores (2026-11-22, iPhone XR)', () => {
  expect(receivedFramingHere('ball', { received: true, ball: false, players: true })).toBe('focus');
  expect(receivedFramingHere('ball', { received: true, ball: false, players: false })).toBe('none');
  // Where Bola works, or on one's own clip, or on another framing: as it came.
  expect(receivedFramingHere('ball', { received: true, ball: true, players: true })).toBeUndefined();
  expect(receivedFramingHere('ball', { received: false, ball: false, players: true })).toBeUndefined();
  expect(receivedFramingHere('focus', { received: true, ball: false, players: true })).toBeUndefined();
});
