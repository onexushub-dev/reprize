import type { Clip } from '../data/schema';
import { readEdit } from '../share/editing';

export type ToolId = 'focus' | 'speed' | 'sound' | 'zoom' | 'rotate';

/** The clip's choices when edit mode opened, so Cancelar can put them back. */
export type EditSnapshot = { clipId: string; edit: Clip['edit']; trim: Clip['trim'] };

export function beginEdit(clip: Clip): EditSnapshot {
  return { clipId: clip.id, edit: clip.edit, trim: clip.trim };
}

function sameZoom(a: ReturnType<typeof readEdit>['zoom'], b: ReturnType<typeof readEdit>['zoom']): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.scale === b.scale && a.cx === b.cx && a.cy === b.cy;
}

/** Whether anything the player sees in the result differs from the snapshot (defaults count as unset). */
export function hasChanges(snapshot: EditSnapshot, clip: Clip): boolean {
  const a = readEdit(snapshot.edit);
  const b = readEdit(clip.edit);
  return (
    snapshot.trim.startMs !== clip.trim.startMs ||
    snapshot.trim.endMs !== clip.trim.endMs ||
    a.speed !== b.speed ||
    a.muted !== b.muted ||
    a.rotation !== b.rotation ||
    a.framing !== b.framing ||
    !sameZoom(a.zoom, b.zoom)
  );
}

/** What to store to undo the edit session: the clip's `edit` and `trim` exactly as they were. */
export function restorePatch(snapshot: EditSnapshot): { edit: Clip['edit']; trim: Clip['trim'] } {
  return { edit: snapshot.edit, trim: snapshot.trim };
}

// The last tool opened, for this run of the app only.
let last: ToolId = 'focus';

export function lastTool(): ToolId {
  return last;
}

export function rememberTool(id: ToolId): void {
  last = id;
}
