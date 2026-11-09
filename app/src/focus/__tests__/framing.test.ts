import type { FocusTrack } from '../../data/focusFile';
import { framingAt } from '../framing';

const track: FocusTrack = {
  startMs: 1000,
  stepMs: 100,
  rects: [
    [0.1, 0.2, 0.8, 0.8],
    [0.2, 0.1, 0.6, 0.6],
  ],
};

test('on a keyframe the zoom shows exactly its rect', () => {
  const z = framingAt(track, 1000);
  expect(z.scale).toBeCloseTo(1.25, 9);
  expect(z.cx).toBeCloseTo(0.5, 9);
  expect(z.cy).toBeCloseTo(0.6, 9);
});

test('between two keyframes the rect is interpolated', () => {
  const z = framingAt(track, 1050);
  expect(z.scale).toBeCloseTo(1 / 0.7, 6);
  expect(z.cx).toBeCloseTo(0.15 + 0.35, 6);
  expect(z.cy).toBeCloseTo(0.15 + 0.35, 6);
});

test('before the first and after the last keyframe the nearest one is held', () => {
  expect(framingAt(track, 0)).toEqual(framingAt(track, 1000));
  expect(framingAt(track, 99999)).toEqual(framingAt(track, 1100));
});

test('a track with one keyframe holds it everywhere', () => {
  const one: FocusTrack = { startMs: 0, stepMs: 100, rects: [[0.2, 0.2, 0.6, 0.6]] };
  expect(framingAt(one, 5000).cx).toBeCloseTo(0.5, 6);
  expect(framingAt(one, 5000).scale).toBeCloseTo(1 / 0.6, 6);
});

test("Seguir a Bola's 9:16 track is scaled by its height (the picture is as tall as the 9:16 box)", () => {
  const ball: FocusTrack = { startMs: 1000, stepMs: 100, rects: [[0.2, 0.25, 0.1582, 0.5]] };
  expect(framingAt(ball, 1000, 'height')).toEqual({ scale: 2, cx: 0.2791, cy: 0.5 });
});
