import type { UploadEntry, UploadItem } from '../../modules/replay-camera/src/ReplayCamera.types';
import type { ConfirmResult } from './shares';
import type { UploadPlan } from './uploadPlan';

/** The system background uploader (`BackgroundUpload.swift`). */
export type NativeUploads = {
  start(items: UploadItem[]): void;
  pause(): void;
  resume(cellular: boolean): void;
  remove(ids: string[]): void;
  /** Starts again what was left running with no transfer behind it. */
  restore(): void;
  state(): UploadEntry[];
};

export type UploadQueueDeps = {
  native: NativeUploads;
  plans: {
    shareIds(): string[];
    get(shareId: string): UploadPlan | undefined;
    forget(shareId: string): void;
    confirmed(shareId: string): number[];
    setConfirmed(shareId: string, positions: number[]): void;
  };
  confirm(shareId: string, positions: number[]): Promise<ConfirmResult | null>;
  cellular(): boolean;
  /** "Pausar envio", kept across launches. */
  manualPause: { get(): boolean; set(paused: boolean): void };
  now(): number;
  /** A line for the diagnostics log. */
  log(text: string): void;
  /** Every clip of this share is confirmed (once per share); `clips`: how many. */
  finished?: (shareId: string, clips: number, plan: UploadPlan) => void;
};

/** Why the uploads wait: a recording (or the heat), or the player paused them. */
export type HoldReason = 'recording' | 'you';

/** Where a share's clips are, for the share sheet and the recording ("7 de 12 enviados"). Counts clips, not files. */
export type ShareProgress = {
  state: 'uploading' | 'paused' | 'done' | 'failed' | 'none';
  /** Set while paused. */
  pausedBy?: HoldReason;
  done: number;
  total: number;
  failed: number;
  sentBytes: number;
  totalBytes: number;
};

const VIDEO = /^shares\/([^/]+)\/clips\/(\d+)\/video\.mp4$/;

/** The share and clip position of a clip's video upload, or undefined for any other file. */
export function videoOf(id: string): { shareId: string; position: number } | undefined {
  const match = VIDEO.exec(id);
  return match === null ? undefined : { shareId: match[1], position: Number(match[2]) };
}

/**
 * The upload queue of shared recordings (sharing design §5.4). Plans are kept on the phone; the system uploader does
 * the transfers. Nothing uploads while held (a recording is on: decision 16); held transfers pause and start again
 * from their first byte when released. A share past its expiry is dropped. Each finished clip is confirmed with the
 * server, which checks the size in R2; a clip that arrived with a different size is sent again.
 */
export function createUploadQueue(deps: UploadQueueDeps) {
  let recordingHold = false;
  // "Pausar envio" kept from an earlier launch, read on first use (not at import: the store may not be ready then).
  let manual = false;
  let held = false;
  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    manual = deps.manualPause.get();
    held = held || manual;
  };
  const listeners = new Set<() => void>();
  const confirming = new Set<string>();
  /** Shares with clips that finished while their confirmation was on its way: confirmed again right after. */
  const confirmAgain = new Set<string>();
  let version = 0;

  const notify = () => {
    version += 1;
    listeners.forEach((fn) => fn());
  };

  const entriesById = (): Map<string, UploadEntry> => new Map(deps.native.state().map((e) => [e.id, e]));

  function withCellular(items: UploadItem[]): UploadItem[] {
    const cellular = deps.cellular();
    return items.map((item) => ({ ...item, cellular }));
  }

  async function confirmShare(shareId: string): Promise<void> {
    if (confirming.has(shareId)) {
      confirmAgain.add(shareId);
      return;
    }
    const plan = deps.plans.get(shareId);
    if (plan === undefined) return;
    const known = entriesById();
    const confirmed = deps.plans.confirmed(shareId);
    const pending = plan.items
      .map((item) => videoOf(item.id))
      .filter((v): v is { shareId: string; position: number } => v !== undefined)
      .filter((v) => !confirmed.includes(v.position))
      .filter((v) => {
        const entry = known.get(`shares/${shareId}/clips/${v.position}/video.mp4`);
        return entry !== undefined && entry.status === 'done';
      })
      .map((v) => v.position);
    if (pending.length === 0) return;
    confirming.add(shareId);
    try {
      const result = await deps.confirm(shareId, pending);
      if (result === null) return;
      if (result.done.length > 0) {
        const total = plan.items.filter((item) => videoOf(item.id) !== undefined).length;
        const before = deps.plans.confirmed(shareId).length;
        const after = [...new Set([...deps.plans.confirmed(shareId), ...result.done])].sort((a, b) => a - b);
        deps.plans.setConfirmed(shareId, after);
        if (before < total && after.length >= total && deps.finished) deps.finished(shareId, total, plan);
      }
      // Arrived with another size: send those clips again.
      const again = plan.items.filter((item) => {
        const v = videoOf(item.id);
        return v !== undefined && result.failed.includes(v.position);
      });
      deps.log(`envio confirmado: ${result.done.length} ok, ${result.missing.length} ausentes, ${result.failed.length} de novo`);
      if (again.length > 0 && !held) deps.native.start(withCellular(again));
      notify();
    } finally {
      confirming.delete(shareId);
      if (confirmAgain.delete(shareId)) void confirmShare(shareId);
    }
  }

  /** Drops expired shares, starts what the uploader does not know yet, and confirms finished clips. */
  function sync(): void {
    load();
    if (!held) deps.native.restore();
    const known = entriesById();
    const now = deps.now();
    for (const shareId of deps.plans.shareIds()) {
      const plan = deps.plans.get(shareId);
      if (plan === undefined) continue;
      if (plan.expiresAt <= now) {
        deps.native.remove(plan.items.map((item) => item.id));
        deps.plans.forget(shareId);
        deps.log(`envio: link vencido, ${plan.items.length} arquivos esquecidos`);
        continue;
      }
      // An empty path is a file not made yet (the cover while it exports).
      const fresh = plan.items.filter((item) => item.path !== '' && !known.has(item.id));
      if (fresh.length > 0 && !held) {
        deps.native.start(withCellular(fresh));
        deps.log(`envio: ${fresh.length} arquivos começaram`);
      }
      void confirmShare(shareId);
    }
    notify();
  }

  /** Pauses or resumes the transfers when the reasons to wait change. */
  function apply(): void {
    const next = recordingHold || manual;
    if (next === held) {
      notify();
      return;
    }
    held = next;
    if (held) {
      deps.native.pause();
      deps.log(`envio pausado (${manual ? 'pelo usuário' : 'gravação'})`);
      notify();
      return;
    }
    deps.native.resume(deps.cellular());
    deps.log('envio retomado');
    sync();
  }

  return {
    /** True while a recording runs (or the phone is too hot): transfers pause, new ones wait. */
    setHold(next: boolean): void {
      load();
      if (next === recordingHold) return;
      recordingHold = next;
      apply();
    },

    /** "Pausar envio" / "Continuar envio" on the share sheet. */
    setManualPause(paused: boolean): void {
      load();
      if (paused === manual) return;
      manual = paused;
      deps.manualPause.set(paused);
      apply();
    },

    held(): boolean {
      load();
      return held;
    },

    /** Forgets a share's uploads (its link was turned off). */
    forget(shareId: string): void {
      const plan = deps.plans.get(shareId);
      if (plan !== undefined) deps.native.remove(plan.items.map((item) => item.id));
      deps.plans.forget(shareId);
      deps.log('envio: link desligado, arquivos esquecidos');
      notify();
    },

    sync,

    /** A transfer ended: a finished clip is confirmed with the server. */
    handleDone(entry: { id: string; ok: boolean; error?: string }): void {
      const video = videoOf(entry.id);
      deps.log(`envio ${entry.ok ? 'concluído' : 'FALHOU'}: ${entry.id.split('/').slice(2).join('/')}${entry.ok ? '' : ` (${entry.error || '?'})`}`);
      if (entry.ok && video !== undefined) void confirmShare(video.shareId);
      notify();
    },

    handleProgress(): void {
      notify();
    },

    /** Sends again the share's files that gave up (5 attempts, or an answer that ruled out trying again). */
    retry(shareId: string): void {
      load();
      const plan = deps.plans.get(shareId);
      if (plan === undefined || held) return;
      const known = entriesById();
      const failed = plan.items.filter((item) => {
        const entry = known.get(item.id);
        return entry !== undefined && entry.status === 'failed';
      });
      if (failed.length > 0) {
        deps.native.start(withCellular(failed));
        deps.log(`envio: tentar de novo, ${failed.length} arquivos`);
      }
      notify();
    },

    progress(shareId: string): ShareProgress {
      load();
      const plan = deps.plans.get(shareId);
      const none: ShareProgress = { state: 'none', done: 0, total: 0, failed: 0, sentBytes: 0, totalBytes: 0 };
      if (plan === undefined) return none;
      const known = entriesById();
      const confirmed = deps.plans.confirmed(shareId);
      let done = 0;
      let failed = 0;
      let total = 0;
      let sentBytes = 0;
      let totalBytes = 0;
      for (const item of plan.items) {
        const entry = known.get(item.id);
        if (entry !== undefined) {
          totalBytes += entry.bytes;
          sentBytes += entry.status === 'done' ? entry.bytes : entry.sent;
        }
        const video = videoOf(item.id);
        if (video === undefined) continue;
        total += 1;
        if (confirmed.includes(video.position) || (entry !== undefined && entry.status === 'done')) done += 1;
        else if (entry !== undefined && entry.status === 'failed') failed += 1;
      }
      const state: ShareProgress['state'] =
        total > 0 && done === total ? 'done' : held ? 'paused' : failed > 0 && done + failed === total ? 'failed' : 'uploading';
      const pausedBy: HoldReason | undefined = state === 'paused' ? (manual ? 'you' : 'recording') : undefined;
      return { state, pausedBy, done, total, failed, sentBytes, totalBytes };
    },

    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },

    version(): number {
      return version;
    },
  };
}

export type UploadQueue = ReturnType<typeof createUploadQueue>;
