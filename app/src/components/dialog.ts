/**
 * The app's own confirmation (2026-11-23): one at a time, shown by `GlassDialogHost` (mounted once in the root layout)
 * in the app's glass instead of the iPhone's plain alert.
 */
export type DialogSpec = {
  title: string;
  body?: string;
  /** The quiet button on the left: it only closes. */
  cancel: string;
  /** The amber button on the right: it closes, then runs `onConfirm`. */
  confirm: string;
  onConfirm: () => void;
};

let current: DialogSpec | undefined;
const listeners = new Set<() => void>();

function changed() {
  listeners.forEach((l) => l());
}

export function showDialog(spec: DialogSpec): void {
  current = spec;
  changed();
}

export function closeDialog(): void {
  if (current === undefined) return;
  current = undefined;
  changed();
}

export function currentDialog(): DialogSpec | undefined {
  return current;
}

export function subscribeDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
