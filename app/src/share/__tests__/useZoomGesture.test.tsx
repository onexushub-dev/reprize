import { act, renderHook } from '@testing-library/react-native';

import { NO_ZOOM } from '../editing';
import { useZoomGesture } from '../useZoomGesture';

const touch = { pageX: 100, pageY: 100, locationX: 100, locationY: 100 };
// PanResponder ignores a move whose time it already handled: every event gets a later time.
let clock = 1_000_000;
const event = (touches: object[]) => {
  const now = (clock += 16);
  return {
    nativeEvent: { touches, changedTouches: touches, pageX: 100, pageY: 100, timestamp: now },
    touchHistory: {
      numberActiveTouches: touches.length,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: now,
      touchBank: [
        {
          touchActive: touches.length > 0,
          startPageX: 100,
          startPageY: 100,
          startTimeStamp: now,
          currentPageX: 100,
          currentPageY: 100,
          currentTimeStamp: now,
          previousPageX: 100,
          previousPageY: 100,
          previousTimeStamp: now,
        },
      ],
    },
  } as never;
};

async function setup(withHold: boolean) {
  const calls = { tap: 0, commit: 0, holds: [] as boolean[] };
  const view = await renderHook(() =>
    useZoomGesture({
      zoom: NO_ZOOM,
      box: { left: 0, top: 0, width: 300, height: 200 },
      onChange: () => {},
      onCommit: () => void calls.commit++,
      onTap: () => void calls.tap++,
      onHold: withHold ? (down: boolean) => void calls.holds.push(down) : undefined,
    }),
  );
  return { calls, handlers: view.result.current as any };
}

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

test('holding still shows the whole video until the finger lifts, and is not a tap', async () => {
  const { calls, handlers } = await setup(true);
  await act(async () => void handlers.onResponderGrant(event([touch])));
  await wait(450);
  expect(calls.holds).toEqual([true]);
  await act(async () => void handlers.onResponderRelease(event([])));
  expect(calls.holds).toEqual([true, false]);
  expect(calls.tap).toBe(0);
  expect(calls.commit).toBe(0);
});

test('a quick touch is still a tap, with no hold', async () => {
  const { calls, handlers } = await setup(true);
  await act(async () => void handlers.onResponderGrant(event([touch])));
  await wait(100);
  await act(async () => void handlers.onResponderRelease(event([])));
  await wait(500);
  expect(calls.holds).toEqual([]);
  expect(calls.tap).toBe(1);
});

test('without a hold handler a long touch behaves as before', async () => {
  const { calls, handlers } = await setup(false);
  await act(async () => void handlers.onResponderGrant(event([touch])));
  await wait(450);
  await act(async () => void handlers.onResponderRelease(event([])));
  expect(calls.holds).toEqual([]);
  expect(calls.commit).toBe(1);
});

test('a one-finger flick on a followed picture changes the clip and does not take over the framing', async () => {
  const calls = { change: 0, commit: 0, swipe: [] as number[] };
  const view = await renderHook(() =>
    useZoomGesture({
      zoom: NO_ZOOM,
      baseZoom: () => ({ scale: 1.5, cx: 0.5, cy: 0.5 }),
      box: { left: 0, top: 0, width: 300, height: 200 },
      onChange: () => void calls.change++,
      onCommit: () => void calls.commit++,
      onTap: () => {},
      onSwipe: (step) => void calls.swipe.push(step),
    }),
  );
  const handlers = view.result.current as any;
  const at = (x: number) => ({ pageX: x, pageY: 100, locationX: x, locationY: 100 });
  await act(async () => void handlers.onResponderGrant(event([at(200)])));
  for (const x of [170, 130, 90, 50]) await act(async () => void handlers.onResponderMove(event([at(x)])));
  await act(async () => void handlers.onResponderRelease(event([])));
  expect(calls.swipe).toEqual([1]);
  expect(calls.change).toBe(0);
  expect(calls.commit).toBe(0);
});

test('without pinch (watch mode) two fingers change nothing, and a flick still changes the clip', async () => {
  const calls = { change: 0, commit: 0, swipe: [] as number[] };
  const view = await renderHook(() =>
    useZoomGesture({
      zoom: NO_ZOOM,
      pinch: false,
      box: { left: 0, top: 0, width: 300, height: 200 },
      onChange: () => void calls.change++,
      onCommit: () => void calls.commit++,
      onTap: () => {},
      onSwipe: (step) => void calls.swipe.push(step),
    }),
  );
  const handlers = view.result.current as any;
  const at = (x: number) => ({ pageX: x, pageY: 100, locationX: x, locationY: 100 });
  await act(async () => void handlers.onResponderGrant(event([at(140), at(160)])));
  for (const d of [20, 40, 60]) await act(async () => void handlers.onResponderMove(event([at(140 - d), at(160 + d)])));
  await act(async () => void handlers.onResponderRelease(event([])));
  expect(calls.change).toBe(0);
  expect(calls.commit).toBe(0);
  await act(async () => void handlers.onResponderGrant(event([at(200)])));
  for (const x of [170, 130, 90, 50]) await act(async () => void handlers.onResponderMove(event([at(x)])));
  await act(async () => void handlers.onResponderRelease(event([])));
  expect(calls.swipe).toEqual([1]);
  expect(calls.change).toBe(0);
});

test('a horizontal drag is followed as it happens, and a short one is let go', async () => {
  const calls = { drag: [] as number[], cancel: 0, swipe: [] as number[] };
  const view = await renderHook(() =>
    useZoomGesture({
      zoom: NO_ZOOM,
      pinch: false,
      box: { left: 0, top: 0, width: 300, height: 200 },
      onChange: () => {},
      onCommit: () => {},
      onTap: () => {},
      onSwipe: (step) => void calls.swipe.push(step),
      onDrag: (dx) => void calls.drag.push(dx),
      onDragCancel: () => void calls.cancel++,
    }),
  );
  const handlers = view.result.current as any;
  const at = (x: number) => ({ pageX: x, pageY: 100, locationX: x, locationY: 100 });
  await act(async () => void handlers.onResponderGrant(event([at(200)])));
  for (const x of [190, 175, 160]) await act(async () => void handlers.onResponderMove(event([at(x)])));
  expect(calls.drag).toEqual([-10, -25, -40]);
  await act(async () => void handlers.onResponderRelease(event([])));
  expect(calls.swipe).toEqual([]);
  expect(calls.cancel).toBe(1);
  // About a fifth of the width or more changes the clip (2026-11-21: was a quarter).
  calls.drag = [];
  await act(async () => void handlers.onResponderGrant(event([at(200)])));
  for (const x of [170, 140, 120]) await act(async () => void handlers.onResponderMove(event([at(x)])));
  await act(async () => void handlers.onResponderRelease(event([])));
  expect(calls.swipe).toEqual([1]);
  expect(calls.cancel).toBe(1);
});

test('a drag that only leans sideways (not flat) still changes the clip (2026-11-21)', async () => {
  const swipes: number[] = [];
  const view = await renderHook(() =>
    useZoomGesture({
      zoom: NO_ZOOM,
      pinch: false,
      box: { left: 0, top: 0, width: 300, height: 200 },
      onChange: () => {},
      onCommit: () => {},
      onTap: () => {},
      onSwipe: (step) => void swipes.push(step),
    }),
  );
  const handlers = view.result.current as any;
  const at = (x: number, y: number) => ({ pageX: x, pageY: y, locationX: x, locationY: y });
  await act(async () => void handlers.onResponderGrant(event([at(100, 100)])));
  // 60 to the right, 40 down: with the old rule (twice as sideways) this stayed put.
  for (const [x, y] of [[120, 113], [140, 127], [160, 140]]) await act(async () => void handlers.onResponderMove(event([at(x, y)])));
  await act(async () => void handlers.onResponderRelease(event([])));
  expect(swipes).toEqual([-1]);
});

test('a drag that starts downward follows the finger and closes when far enough; sideways still pages (2026-11-21)', async () => {
  const downs: [number, number][] = [];
  const ends: boolean[] = [];
  const swipes: number[] = [];
  const view = await renderHook(() =>
    useZoomGesture({
      zoom: NO_ZOOM,
      pinch: false,
      box: { left: 0, top: 0, width: 300, height: 600 },
      onChange: () => {},
      onCommit: () => {},
      onTap: () => {},
      onSwipe: (step) => void swipes.push(step),
      onDown: (dx, dy) => void downs.push([dx, dy]),
      onDownEnd: (close) => void ends.push(close),
    }),
  );
  const handlers = view.result.current as any;
  const at = (x: number, y: number) => ({ pageX: x, pageY: y, locationX: x, locationY: y });
  await act(async () => void handlers.onResponderGrant(event([at(150, 200)])));
  for (const y of [215, 260, 340]) await act(async () => void handlers.onResponderMove(event([at(155, y)])));
  await act(async () => void handlers.onResponderRelease(event([])));
  expect(downs.at(-1)).toEqual([5, 140]);
  expect(ends).toEqual([true]);
  expect(swipes).toEqual([]);
  // A short one settles back.
  await act(async () => void handlers.onResponderGrant(event([at(150, 200)])));
  for (const y of [215, 240]) await act(async () => void handlers.onResponderMove(event([at(150, y)])));
  await act(async () => void handlers.onResponderRelease(event([])));
  expect(ends).toEqual([true, false]);
});
