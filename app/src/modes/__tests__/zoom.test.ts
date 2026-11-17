import { clampZoom, formatZoom, hasZoomChoice, lensFor, nextZoomStep, pinchZoom, zoomFromLens } from '../zoom';

const ios = { min: 0.5, max: 5, continuous: true };
const noUltraWide = { min: 1, max: 5, continuous: true };
const twoLenses = { min: 0.5, max: 1, continuous: false };

test('the button goes 0.5 → 1 → 2 → 5 and back to 0.5', () => {
  expect(nextZoomStep(0.5, ios)).toBe(1);
  expect(nextZoomStep(1, ios)).toBe(2);
  expect(nextZoomStep(2, ios)).toBe(5);
  expect(nextZoomStep(5, ios)).toBe(0.5);
});

test('from a pinched value it goes to the next step above it', () => {
  expect(nextZoomStep(1.3, ios)).toBe(2);
  expect(nextZoomStep(2.4, ios)).toBe(5);
  expect(nextZoomStep(0.7, ios)).toBe(1);
});

test('a value a hair off a step still counts as that step (the button shows "1x", so the next tap goes to 2x)', () => {
  expect(nextZoomStep(1.02, ios)).toBe(2);
  expect(nextZoomStep(0.98, ios)).toBe(2);
  expect(nextZoomStep(0.52, ios)).toBe(1);
});

test('a phone without ultra-wide skips 0.5x', () => {
  expect(nextZoomStep(1, noUltraWide)).toBe(2);
  expect(nextZoomStep(5, noUltraWide)).toBe(1);
});

test('two fixed lenses (Android): 0.5 ↔ 1', () => {
  expect(nextZoomStep(0.5, twoLenses)).toBe(1);
  expect(nextZoomStep(1, twoLenses)).toBe(0.5);
});

test('clamps a zoom into the range', () => {
  expect(clampZoom(0.3, ios)).toBe(0.5);
  expect(clampZoom(9, ios)).toBe(5);
  expect(clampZoom(0.5, noUltraWide)).toBe(1);
  expect(clampZoom(3, twoLenses)).toBe(1);
});

test('pinching scales the base zoom and stays in range', () => {
  expect(pinchZoom(1, 2, ios)).toBe(2);
  expect(pinchZoom(2, 0.25, ios)).toBe(0.5);
  expect(pinchZoom(2, 10, ios)).toBe(5);
  expect(pinchZoom(1, 0.5, noUltraWide)).toBe(1);
});

test('formats the value for the button', () => {
  expect(formatZoom(0.5)).toBe('0.5x');
  expect(formatZoom(1)).toBe('1x');
  expect(formatZoom(2)).toBe('2x');
  expect(formatZoom(1.34)).toBe('1.3x');
  expect(formatZoom(4.96)).toBe('5x');
});

test('old lenses map to zoom and back', () => {
  expect(zoomFromLens('ultraWide')).toBe(0.5);
  expect(zoomFromLens('wide')).toBe(1);
  expect(lensFor(0.5)).toBe('ultraWide');
  expect(lensFor(0.99)).toBe('ultraWide');
  expect(lensFor(1)).toBe('wide');
  expect(lensFor(3)).toBe('wide');
});

test('the zoom button is offered only when there is more than one stop', () => {
  // Android with a visible ultra-wide: 0.5x and 1x.
  expect(hasZoomChoice({ min: 0.5, max: 1, continuous: false })).toBe(true);
  // Android whose ultra-wide is hidden from apps (POCO X3 NFC): only 1x.
  expect(hasZoomChoice({ min: 1, max: 1, continuous: false })).toBe(false);
  // iPhone without an ultra-wide still zooms in.
  expect(hasZoomChoice({ min: 1, max: 10, continuous: true })).toBe(true);
});
