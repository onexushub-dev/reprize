import type { Lens, ZoomRange } from '../../modules/replay-camera/src/ReplayCamera.types';

/**
 * The zoom every app start opens at: 1x, the wide lens, even on phones with an ultra-wide (2026-11-05). The player can
 * still go to 0.5x with the button or a pinch; that choice lasts until the app is closed (registry: withoutSavedZoom).
 */
export const DEFAULT_ZOOM = 1;

/** The stops the zoom button goes through. */
export const ZOOM_STEPS = [0.5, 1, 2, 5] as const;

/** A value this close above a step still counts as being on it (a pinch that landed near 1x). */
const STEP_TOLERANCE = 0.05;

export function clampZoom(zoom: number, range: ZoomRange): number {
  return Math.min(Math.max(zoom, range.min), range.max);
}

/** The next stop above `current` inside the range; after the last one, back to the first. */
export function nextZoomStep(current: number, range: ZoomRange): number {
  const steps = ZOOM_STEPS.filter((s) => s >= range.min - 1e-9 && s <= range.max + 1e-9);
  const next = steps.find((s) => s > current + STEP_TOLERANCE);
  if (next !== undefined) return next;
  return steps.length > 0 ? steps[0] : clampZoom(current, range);
}

/**
 * Whether the zoom button has anything to change: false on an Android phone that hides its ultra-wide from apps
 * (POCO X3 NFC, 2026-11-17), where 1x is the only stop.
 */
export function hasZoomChoice(range: ZoomRange): boolean {
  return ZOOM_STEPS.filter((s) => s >= range.min - 1e-9 && s <= range.max + 1e-9).length > 1;
}

/** A two-finger pinch: the zoom when the fingers started, times how much the distance between them grew. */
export function pinchZoom(base: number, ratio: number, range: ZoomRange): number {
  return clampZoom(base * ratio, range);
}

/** "0.5x", "1x", "1.3x": what the button and the bubble show. */
export function formatZoom(zoom: number): string {
  const rounded = Math.round(zoom * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}x`;
}

/** The two lenses the app had before zoom: ultra-wide is 0.5x, wide is 1x. */
export function zoomFromLens(lens: Lens): number {
  return lens === 'ultraWide' ? 0.5 : 1;
}

/** The physical lens that frames `zoom` (what Android still opens, and what the old session options carry). */
export function lensFor(zoom: number): Lens {
  return zoom < 1 ? 'ultraWide' : 'wide';
}
