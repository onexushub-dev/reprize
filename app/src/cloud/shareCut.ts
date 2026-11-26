import type { Clip } from '../data/schema';
import { readEdit } from '../share/editing';

/**
 * What the sender's edit makes of a shared clip (multi-recording share design, "what is sent", 2026-11-22). The cut and
 * the silence travel in the file itself (`cutClip`, passthrough, never re-encoded): the recipient cannot reach what was
 * cut or turn the sound on. Everything else (Jogadores, Bola, zoom, speed, rotation) arrives as the sender left it and
 * stays the recipient's to change, back to the Original too, as on a clip of their own (Victor, 2026-11-22: the framing
 * is no privacy matter; trying the modes on a received clip is what makes people want PRO).
 */

/** Below this the cut is the whole file (timestamps are not exact to the millisecond). */
const WHOLE_MS = 20;

/** The part of the clip's file that is sent, and whether it is sent without sound. */
export type ShareCut = { startMs: number; endMs: number; muted: boolean; needed: boolean };

export function shareCutOf(clip: Pick<Clip, 'durationMs' | 'trim' | 'edit'>): ShareCut {
  // Whole milliseconds: the cut file's length, the clip's cut and its framings' ranges must agree exactly.
  const startMs = Math.round(Math.max(0, Math.min(clip.trim.startMs, clip.durationMs)));
  const endMs = Math.round(Math.max(startMs, Math.min(clip.trim.endMs, clip.durationMs)));
  const muted = readEdit(clip.edit).muted;
  const needed = muted || startMs > WHOLE_MS || clip.durationMs - endMs > WHOLE_MS;
  return { startMs, endMs, muted, needed };
}

/** What the recipient's editor cannot undo: `sound`, the file has none. */
export type ShareLocks = { sound?: true };

export function shareLocksOf(clip: Pick<Clip, 'edit'>): ShareLocks {
  return readEdit(clip.edit).muted ? { sound: true } : {};
}

/** A range of the clip's time on the cut file's time (which starts at the cut), inside it. */
export function rebaseRange(
  range: { startMs: number; endMs: number },
  cut: Pick<ShareCut, 'startMs' | 'endMs'>,
): { startMs: number; endMs: number } {
  const length = cut.endMs - cut.startMs;
  return {
    startMs: Math.max(0, Math.min(length, range.startMs - cut.startMs)),
    endMs: Math.max(0, Math.min(length, range.endMs - cut.startMs)),
  };
}

function isRow(row: unknown): row is number[] {
  return Array.isArray(row) && row.length === 4 && row.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/**
 * A framing file (Jogadores' .focus.json or Bola's .ball.json: `{ v: 1, startMs, stepMs, <aspect>: rows }`) on the cut
 * file's time: only the rows inside the cut, the first one at or after it. Undefined when the file is unreadable or has
 * no row inside the cut. Pure text work: no picture is analysed again.
 */
export function rebaseFramingText(text: string, cut: Pick<ShareCut, 'startMs' | 'endMs'>): string | undefined {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof file !== 'object' || file === null || Array.isArray(file)) return undefined;
  const f = file as Record<string, unknown>;
  if (typeof f.startMs !== 'number' || typeof f.stepMs !== 'number' || f.stepMs <= 0) return undefined;
  const step = f.stepMs;
  const first = Math.max(0, Math.ceil((cut.startMs - f.startMs) / step));
  const last = Math.floor((cut.endMs - f.startMs) / step);
  if (last < first) return undefined;
  const out: Record<string, unknown> = { ...f, startMs: f.startMs + first * step - cut.startMs };
  let rows = 0;
  for (const [key, value] of Object.entries(f)) {
    if (!Array.isArray(value) || value.length === 0 || !value.every(isRow)) continue;
    const kept = value.slice(first, last + 1);
    out[key] = kept;
    rows = Math.max(rows, kept.length);
  }
  return rows > 0 ? JSON.stringify(out) : undefined;
}

/**
 * An upper bound of the cut file's size, declared when the link is made (the cut is made afterwards): never more than
 * the whole file plus a little for the container. The server takes the real size when the upload is confirmed.
 */
export function cutBytesBound(fileBytes: number): number {
  return Math.max(1, fileBytes) + 64 * 1024;
}
