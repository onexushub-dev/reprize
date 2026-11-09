import type { Clip } from '../data/schema';
import { MIN_CUT_MS } from './trim';

export const SPEEDS = [0.5, 1, 1.5, 2] as const;
export type Speed = (typeof SPEEDS)[number];

/** Pinch zoom: `scale` times, looking at the point (cx, cy) of the video, both in 0..1. */
export type Zoom = { scale: number; cx: number; cy: number };
export const MAX_ZOOM = 4;
export const NO_ZOOM: Zoom = { scale: 1, cx: 0.5, cy: 0.5 };

/** Clockwise degrees the player turned the video, for a clip recorded with the phone's position misread. */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * How the clip is framed (spec 2026-11-09 §4.2): Modo Foco (the default), Seguir a Bola (9:16 following the ball) or
 * neither. One field, so the two modes can never be on together.
 */
export type Framing = 'focus' | 'ball' | 'none';

/** `focus`: `framing === 'focus'`, kept for the callers that only know Modo Foco. */
export type Edit = {
  speed: Speed;
  muted: boolean;
  zoom: Zoom | undefined;
  rotation: Rotation;
  framing: Framing;
  focus: boolean;
};

/**
 * What the editor works with. Clips saved before speeds existed only have the slow motion switch; clips saved before
 * Seguir a Bola only have `focus` (false = neither).
 */
export function readEdit(edit: Clip['edit']): Edit {
  let framing: Framing = 'focus';
  if (edit !== undefined && edit.framing !== undefined) framing = edit.framing;
  else if (edit !== undefined && edit.focus === false) framing = 'none';
  return {
    speed: edit?.speed ?? (edit?.slowmo ? 0.5 : 1),
    muted: edit?.muted ?? false,
    zoom: edit?.zoom,
    rotation: edit?.rotation ?? 0,
    framing,
    focus: framing === 'focus',
  };
}

/**
 * The edit after `patch`. A patch may still say only `focus` (Modo Foco on or off): on sets `framing` to 'focus'; off
 * turns Modo Foco off and leaves Seguir a Bola as it is.
 */
export function applyEdit(edit: Edit, patch: Partial<Edit>): Edit {
  const next = { ...edit, ...patch };
  let framing = next.framing;
  if (patch.framing === undefined && patch.focus !== undefined) {
    if (patch.focus) framing = 'focus';
    else if (edit.framing === 'focus') framing = 'none';
  }
  return { ...next, framing, focus: framing === 'focus' };
}

/** How an edit is stored: defaults left out (Modo Foco on, no turn, no zoom). */
export function storedEdit(edit: Edit): NonNullable<Clip['edit']> {
  return {
    speed: edit.speed,
    muted: edit.muted,
    ...(edit.zoom ? { zoom: edit.zoom } : {}),
    ...(edit.rotation ? { rotation: edit.rotation } : {}),
    ...(edit.framing !== 'focus' ? { framing: edit.framing } : {}),
  };
}

/** How long the result lasts: the cut played at `speed`. */
export function outputMs(trim: { startMs: number; endMs: number }, speed: number): number {
  return (trim.endMs - trim.startMs) / speed;
}

/** 1x..MAX_ZOOM, with the visible window kept inside the video. */
export function clampZoom(zoom: Zoom): Zoom {
  const scale = Math.min(Math.max(zoom.scale, 1), MAX_ZOOM);
  const half = 0.5 / scale;
  return {
    scale,
    cx: Math.min(Math.max(zoom.cx, half), 1 - half),
    cy: Math.min(Math.max(zoom.cy, half), 1 - half),
  };
}

/** The visible part of the video, in 0..1 of its width and height (what the export crops to). */
export function cropRect(zoom: Zoom): { x: number; y: number; width: number; height: number } {
  const size = 1 / zoom.scale;
  return { x: zoom.cx - size / 2, y: zoom.cy - size / 2, width: size, height: size };
}

/**
 * Pinch by `ratio`. `focal` is where the fingers are on the picture (0..1); the point under them stays under them, as
 * in any photo viewer.
 */
export function pinchZoom(base: Zoom, ratio: number, focal: { x: number; y: number } = { x: 0.5, y: 0.5 }): Zoom {
  const scale = Math.min(Math.max(base.scale * ratio, 1), MAX_ZOOM);
  const shift = (f: number, c: number) => c + (f - 0.5) / base.scale - (f - 0.5) / scale;
  return clampZoom({ scale, cx: shift(focal.x, base.cx), cy: shift(focal.y, base.cy) });
}

/** `dx`/`dy`: how far the fingers moved, as a fraction of the video's size on screen. The picture follows them. */
export function panZoom(base: Zoom, dx: number, dy: number): Zoom {
  return clampZoom({ ...base, cx: base.cx - dx / base.scale, cy: base.cy - dy / base.scale });
}

export function nextRotation(rotation: Rotation): Rotation {
  return ((rotation + 90) % 360) as Rotation;
}

/** The video's shape on screen after turning it. */
export function turnedSize(size: { width: number; height: number }, rotation: Rotation) {
  return rotation % 180 === 0 ? size : { width: size.height, height: size.width };
}

/** Black shorter than this is just the camera starting, not part of what to hide. */
const BLACK_START_MS = 1_000;
const LEAD_MS = 250;

/**
 * Where the useful video starts, given the time of its first picture (`contentMs`): a little before it. 0 when the black is
 * short, or when so little picture is left that skipping would leave nothing to cut.
 */
export function contentFloor(contentMs: number, durationMs: number): number {
  if (contentMs < BLACK_START_MS || durationMs - contentMs < MIN_CUT_MS) return 0;
  return contentMs - LEAD_MS;
}

/** Moves a cut that begins in the black to the floor, keeping its end (at least the shortest cut). */
export function raiseToFloor(trim: { startMs: number; endMs: number }, floorMs: number, durationMs: number) {
  if (trim.startMs >= floorMs) return trim;
  return { startMs: floorMs, endMs: Math.min(durationMs, Math.max(trim.endMs, floorMs + MIN_CUT_MS)) };
}
