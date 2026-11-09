import { applyEdit, storedEdit, clampZoom, contentFloor, cropRect, MAX_ZOOM, nextRotation, outputMs, panZoom, pinchZoom, raiseToFloor, readEdit, turnedSize } from '../editing';

test('a clip with no edit plays at normal speed, with sound and no zoom', () => {
  expect(readEdit(undefined)).toEqual({ speed: 1, muted: false, zoom: undefined, rotation: 0, framing: 'focus', focus: true });
});

test('clips saved with the old slow motion switch read as 0.5x', () => {
  expect(readEdit({ slowmo: true, muted: false }).speed).toBe(0.5);
  expect(readEdit({ slowmo: false, muted: true })).toMatchObject({ speed: 1, muted: true });
});

test('a chosen speed wins over the old switch', () => {
  expect(readEdit({ slowmo: true, speed: 2, muted: false }).speed).toBe(2);
});

test('the result lasts the cut divided by the speed', () => {
  const trim = { startMs: 10_000, endMs: 22_000 };
  expect(outputMs(trim, 1)).toBe(12_000);
  expect(outputMs(trim, 2)).toBe(6_000);
  expect(outputMs(trim, 0.5)).toBe(24_000);
});

test('zoom never goes below 1x or above the maximum', () => {
  expect(clampZoom({ scale: 0.4, cx: 0.5, cy: 0.5 }).scale).toBe(1);
  expect(clampZoom({ scale: 99, cx: 0.5, cy: 0.5 }).scale).toBe(MAX_ZOOM);
});

test('the zoom window stays inside the video', () => {
  expect(clampZoom({ scale: 2, cx: 0, cy: 1 })).toEqual({ scale: 2, cx: 0.25, cy: 0.75 });
  expect(clampZoom({ scale: 1, cx: 0.9, cy: 0.1 })).toEqual({ scale: 1, cx: 0.5, cy: 0.5 });
});

test('the crop is the visible part of the video, in 0..1', () => {
  expect(cropRect({ scale: 2, cx: 0.25, cy: 0.75 })).toEqual({ x: 0, y: 0.5, width: 0.5, height: 0.5 });
});

test('pinching scales the zoom from where it was', () => {
  expect(pinchZoom({ scale: 2, cx: 0.5, cy: 0.5 }, 1.5)).toEqual({ scale: 3, cx: 0.5, cy: 0.5 });
  expect(pinchZoom({ scale: 3, cx: 0.5, cy: 0.5 }, 0.1).scale).toBe(1);
});

test('dragging moves the window the opposite way, scaled by the zoom', () => {
  // fingers move a quarter of the width to the right: the picture follows, so the window moves left
  expect(panZoom({ scale: 2, cx: 0.5, cy: 0.5 }, 0.25, 0)).toEqual({ scale: 2, cx: 0.375, cy: 0.5 });
});

test('dragging does nothing without zoom', () => {
  expect(panZoom({ scale: 1, cx: 0.5, cy: 0.5 }, 0.3, 0.3)).toEqual({ scale: 1, cx: 0.5, cy: 0.5 });
});

test('pinching keeps the point under the fingers where it is', () => {
  // fingers at the right edge of the picture: the right edge stays under them while zooming in
  const zoomed = pinchZoom({ scale: 1, cx: 0.5, cy: 0.5 }, 2, { x: 1, y: 0.5 });
  expect(zoomed).toEqual({ scale: 2, cx: 0.75, cy: 0.5 });
});

test('pinching with fingers in the middle zooms around the centre', () => {
  expect(pinchZoom({ scale: 1, cx: 0.3, cy: 0.6 }, 2, { x: 0.5, y: 0.5 }).scale).toBe(2);
});

test('no rotation by default', () => {
  expect(readEdit(undefined).rotation).toBe(0);
  expect(readEdit({ speed: 1, muted: false, rotation: 90 }).rotation).toBe(90);
});

test('turning goes a quarter at a time and wraps around', () => {
  expect(nextRotation(0)).toBe(90);
  expect(nextRotation(270)).toBe(0);
});

test('a quarter turn swaps the width and height of the video', () => {
  expect(turnedSize({ width: 1920, height: 1080 }, 0)).toEqual({ width: 1920, height: 1080 });
  expect(turnedSize({ width: 1920, height: 1080 }, 90)).toEqual({ width: 1080, height: 1920 });
  expect(turnedSize({ width: 1920, height: 1080 }, 180)).toEqual({ width: 1920, height: 1080 });
  expect(turnedSize({ width: 1920, height: 1080 }, 270)).toEqual({ width: 1080, height: 1920 });
});

describe('the useful start of a clip', () => {
  test('a clip that starts with a long black takes its first picture as the start, a little before it', () => {
    expect(contentFloor(11_000, 57_000)).toBe(10_750);
  });

  test('a black shorter than a second is just the camera starting: nothing to skip', () => {
    expect(contentFloor(0, 57_000)).toBe(0);
    expect(contentFloor(900, 57_000)).toBe(0);
  });

  test('a clip that is black almost to the end is left whole, not cut down to nothing', () => {
    expect(contentFloor(55_000, 57_000)).toBe(0);
  });

  test('a cut that started inside the black moves to the floor and keeps its end', () => {
    expect(raiseToFloor({ startMs: 0, endMs: 54_000 }, 10_750, 57_000)).toEqual({ startMs: 10_750, endMs: 54_000 });
  });

  test('a cut already past the floor is untouched', () => {
    expect(raiseToFloor({ startMs: 20_000, endMs: 54_000 }, 10_750, 57_000)).toEqual({ startMs: 20_000, endMs: 54_000 });
  });

  test('a cut ending inside the black grows to the shortest cut after the floor', () => {
    expect(raiseToFloor({ startMs: 0, endMs: 8_000 }, 10_750, 57_000)).toEqual({ startMs: 10_750, endMs: 13_750 });
  });
});

test('Modo Foco is on unless the player turned it off for the clip', () => {
  expect(readEdit({ muted: false }).focus).toBe(true);
  expect(readEdit({ muted: false, focus: false }).focus).toBe(false);
  expect(readEdit({ muted: false, focus: true }).focus).toBe(true);
});

describe('framing (Modo Foco, Seguir a Bola or neither)', () => {
  test('read from `framing`, else from the old Modo Foco switch', () => {
    expect(readEdit(undefined).framing).toBe('focus');
    expect(readEdit({ muted: false, focus: false }).framing).toBe('none');
    expect(readEdit({ muted: false, framing: 'ball' })).toMatchObject({ framing: 'ball', focus: false });
    expect(readEdit({ muted: false, focus: false, framing: 'focus' })).toMatchObject({ framing: 'focus', focus: true });
  });

  test('the two modes never stay on together, and the old `focus` patch still works', () => {
    const focus = readEdit(undefined);
    expect(applyEdit(focus, { framing: 'ball' })).toMatchObject({ framing: 'ball', focus: false });
    expect(applyEdit(focus, { focus: false })).toMatchObject({ framing: 'none', focus: false });
    const ball = readEdit({ muted: false, framing: 'ball' });
    expect(applyEdit(ball, { focus: true })).toMatchObject({ framing: 'focus', focus: true });
    // Modo Foco off while Seguir a Bola is on leaves Seguir a Bola on
    expect(applyEdit(ball, { focus: false }).framing).toBe('ball');
  });

  test('stored without the defaults', () => {
    expect(storedEdit(readEdit(undefined))).toEqual({ speed: 1, muted: false });
    expect(storedEdit(readEdit({ muted: true, framing: 'ball', rotation: 90 }))).toEqual({
      speed: 1,
      muted: true,
      rotation: 90,
      framing: 'ball',
    });
    // an old "Modo Foco off" is stored the new way
    expect(storedEdit(readEdit({ muted: false, focus: false }))).toEqual({ speed: 1, muted: false, framing: 'none' });
  });
});
