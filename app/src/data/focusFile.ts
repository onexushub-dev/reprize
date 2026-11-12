import { File } from 'expo-file-system';

/** Where a clip's Modo Foco framing is kept: next to it, same name, .focus.json. Written by the native analysis. */
export function focusPath(clipPath: string): string {
  return clipPath.replace(/\.[^./]+$/, '') + '.focus.json';
}

/**
 * The people found in each analysed picture of the clip (.people.json, written by the native analysis): a stopped
 * analysis goes on from there, and Bola's pass leaves them for Jogadores.
 */
export function peoplePath(clipPath: string): string {
  return clipPath.replace(/\.[^./]+$/, '') + '.people.json';
}

export type FocusAspect = 'landscape' | 'portrait';

/** One crop rect `[x, y, width, height]` (0..1 of the video, origin top-left) every `stepMs` from `startMs` (clip time). */
export type FocusTrack = { startMs: number; stepMs: number; rects: [number, number, number, number][] };

function isRow(row: unknown): row is [number, number, number, number] {
  return Array.isArray(row) && row.length === 4 && row.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** The track of `aspect` in a focus file's text; anything broken, another version or an empty track gives undefined. */
export function parseFocusFile(text: string, aspect: FocusAspect): FocusTrack | undefined {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof file !== 'object' || file === null) return undefined;
  const f = file as Record<string, unknown>;
  const rows = f[aspect];
  if (f.v !== 1 || typeof f.stepMs !== 'number' || f.stepMs <= 0 || typeof f.startMs !== 'number') return undefined;
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every(isRow)) return undefined;
  return { startMs: f.startMs, stepMs: f.stepMs, rects: rows };
}

/** Reads the file at `path` (a plain path); undefined when it is missing or unreadable. */
export function readFocusFile(path: string, aspect: FocusAspect): FocusTrack | undefined {
  try {
    return parseFocusFile(new File(`file://${path}`).textSync(), aspect);
  } catch {
    return undefined;
  }
}
