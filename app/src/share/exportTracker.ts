import {
  addReplayListener,
  cancelExport,
  exportClip as nativeExportClip,
  type ExportClipOptions,
  type ExportedClip,
} from '../../modules/replay-camera';

type ProgressEvent = { exportId: string; progress: number };

/**
 * The exports one screen runs (2026-11-23): each gets an id, its progress comes from the native side, and Cancelar stops
 * every running one at once instead of waiting for it to finish.
 */
export type ExportTracker = {
  /** `exportClip` with a fresh `exportId`, tracked while it runs. */
  exportClip(o: ExportClipOptions): Promise<ExportedClip>;
  /** How many exports run now. */
  running(): number;
  /** The running exports' progress added up (0..running()); one with no event yet counts 0. */
  runningProgress(): number;
  /** Whether any progress has arrived: a build without it, or a cached look, never sends one. */
  known(): boolean;
  /** Stops every running export at once, and any started after it until `reset` (a tap while the mark is drawn). */
  cancelAll(): void;
  /** A new Salvar/Enviar: exports may start again. */
  reset(): void;
  /** Called on every progress event and every export that ends. */
  subscribe(listener: () => void): () => void;
  dispose(): void;
};

type Deps = {
  exportClip?: (o: ExportClipOptions) => Promise<ExportedClip>;
  listen?: (cb: (e: ProgressEvent) => void) => { remove(): void };
  cancel?: (id: string) => void;
  newId?: () => string;
};

let counter = 0;

/** The native progress events; nothing to hear where the module has no listener (tests, web). */
function listenNative(cb: (e: ProgressEvent) => void): { remove(): void } {
  if (typeof addReplayListener !== 'function') return { remove: () => {} };
  return addReplayListener('onExportProgress', cb);
}

export function createExportTracker(deps: Deps = {}): ExportTracker {
  const run = deps.exportClip !== undefined ? deps.exportClip : nativeExportClip;
  const cancel =
    deps.cancel !== undefined
      ? deps.cancel
      : (id: string) => {
          if (typeof cancelExport === 'function') cancelExport(id);
        };
  const newId =
    deps.newId !== undefined
      ? deps.newId
      : () => {
          counter += 1;
          return `x${Date.now().toString(36)}-${counter}`;
        };
  const listen = deps.listen !== undefined ? deps.listen : listenNative;
  const progress = new Map<string, number>();
  const listeners = new Set<() => void>();
  let heard = false;
  let stopped = false;
  const changed = () => listeners.forEach((l) => l());

  const subscription = listen((e) => {
    if (!progress.has(e.exportId)) return;
    progress.set(e.exportId, Math.max(0, Math.min(1, e.progress)));
    heard = true;
    changed();
  });

  return {
    async exportClip(o) {
      if (stopped) throw Object.assign(new Error('export cancelled'), { code: 'CANCELLED' });
      const exportId = newId();
      progress.set(exportId, 0);
      try {
        return await run({ ...o, exportId });
      } finally {
        progress.delete(exportId);
        changed();
      }
    },
    running: () => progress.size,
    runningProgress: () => {
      let sum = 0;
      progress.forEach((p) => {
        sum += p;
      });
      return sum;
    },
    known: () => heard,
    cancelAll() {
      stopped = true;
      Array.from(progress.keys()).forEach((id) => cancel(id));
    },
    reset() {
      stopped = false;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      subscription.remove();
      listeners.clear();
    },
  };
}

/** An export stopped by Cancelar (the native code `CANCELLED`), not a failure. */
export function isCancelled(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'CANCELLED';
}
