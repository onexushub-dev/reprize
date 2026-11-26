/**
 * Where each clip's tile sits in the recording's grid, so the clip screen can grow out of it and shrink back into it
 * when dragged down (2026-11-21, like the Photos app). The grid stays under the clip screen (a transparent modal).
 */
export type Rect = { x: number; y: number; width: number; height: number };

type Measurable = { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void };

const tiles = new Map<string, Measurable>();
/** The clip whose tile was just tapped: its screen opens out of the tile. */
let opening: string | undefined;

/** A tile on screen; returns its removal. */
export function registerTile(id: string, node: Measurable): () => void {
  tiles.set(id, node);
  return () => {
    if (tiles.get(id) === node) tiles.delete(id);
  };
}

/** Where the clip's tile is on screen now, or undefined (not in the grid, scrolled away, or no answer soon). */
export function tileRect(id: string): Promise<Rect | undefined> {
  const node = tiles.get(id);
  if (node === undefined) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let done = false;
    const late = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(undefined);
    }, 150);
    node.measureInWindow((x, y, width, height) => {
      if (done) return;
      done = true;
      clearTimeout(late);
      resolve(width > 0 && height > 0 ? { x, y, width, height } : undefined);
    });
  });
}

export function markOpening(id: string): void {
  opening = id;
}

/** Whether this clip's screen should open out of its tile (asked once). */
export function willOpenFromTile(id: string): boolean {
  return opening === id;
}

export function takeOpening(id: string): boolean {
  if (opening !== id) return false;
  opening = undefined;
  return true;
}
