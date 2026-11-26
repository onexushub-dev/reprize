import type { UploadItem } from '../../modules/replay-camera/src/ReplayCamera.types';
import { rebaseFramingText } from './shareCut';
import type { PrepJob } from './shareInput';
import type { UploadPlan } from './uploadPlan';

export type SharePrepDeps = {
  /** Every share with uploads kept on the phone, in the order they were made. */
  shares(): string[];
  jobs: { get(shareId: string): PrepJob[]; set(shareId: string, jobs: PrepJob[]): void };
  plan: { get(shareId: string): UploadPlan | undefined; save(shareId: string, plan: UploadPlan): void };
  /** The native passthrough cut; undefined where the platform has none. */
  cut(source: string, out: string, startMs: number, endMs: number, muted: boolean): Promise<unknown> | undefined;
  exists(path: string): boolean;
  readText(path: string): string | undefined;
  writeText(path: string, text: string): void;
  /** Where the file made for a job goes (the share's own folder, emptied when the share is forgotten). */
  outPath(shareId: string, job: PrepJob): string;
  /** The made file is in the plan: the upload queue starts it. */
  sync(): void;
  log(text: string): void;
  /** Runs the work with the extra time iOS gives an app leaving the front (`withBackgroundTime`); absent: just runs it. */
  background?: (work: () => Promise<void>) => Promise<void>;
};

/**
 * Cuts made at the same time (2026-11-22): a cut is mostly the phone copying bytes, so a few together finish a link's
 * files in seconds, while the sender still looks at the QR code or within the extra time iOS gives once they leave.
 */
export const CUTS_AT_ONCE = 3;

/**
 * Makes the files a share sends that are not the clips' own (2026-11-22, `shareCut.ts`): each clip's cut, passthrough
 * and without sound when muted, and its framing files on the cut's time. Right after the link is made and again at
 * launch and each return to the front, `CUTS_AT_ONCE` at a time in the plan's order (the first recordings first), each
 * upload starting as soon as its file is made: nothing is shown to the sender, the QR code is already there. The whole
 * run asks iOS for the extra time an app leaving the front may keep (about 30 s), so the cuts usually end even if the
 * sender goes straight to WhatsApp, and every file reaches the background uploader. A cut iOS stops anyway is made
 * again on the next run. A job whose source is gone drops its upload.
 */
export function createSharePrep(deps: SharePrepDeps) {
  let running = false;
  let again = false;

  /** Puts the made file in the plan (read fresh: the cover may have been attached meanwhile), or drops the upload. */
  function place(shareId: string, id: string, path: string | undefined): void {
    const plan = deps.plan.get(shareId);
    if (plan === undefined) return;
    const items: UploadItem[] =
      path === undefined ? plan.items.filter((item) => item.id !== id) : plan.items.map((item) => (item.id === id ? { ...item, path } : item));
    deps.plan.save(shareId, { ...plan, items });
  }

  function done(shareId: string, id: string): void {
    deps.jobs.set(
      shareId,
      deps.jobs.get(shareId).filter((job) => job.id !== id),
    );
  }

  /** Makes one file; false when the run must stop (a cut that failed or cannot be made here: tried again later). */
  async function make(shareId: string, job: PrepJob): Promise<boolean> {
    const out = deps.outPath(shareId, job);
    if (!deps.exists(job.source)) {
      deps.log(`envio: arquivo de origem sumiu (${job.kind}), envio dele cancelado`);
      place(shareId, job.id, undefined);
      done(shareId, job.id);
      return true;
    }
    if (job.kind === 'framing') {
      const text = deps.readText(job.source);
      const rebased = text === undefined ? undefined : rebaseFramingText(text, job);
      if (rebased === undefined) {
        place(shareId, job.id, undefined);
      } else {
        deps.writeText(out, rebased);
        place(shareId, job.id, out);
      }
      done(shareId, job.id);
      return true;
    }
    const cutting = deps.cut(job.source, out, job.startMs, job.endMs, job.muted);
    if (cutting === undefined) {
      deps.log('envio: corte indisponivel neste aparelho');
      return false;
    }
    try {
      await cutting;
    } catch (e) {
      deps.log(`envio: corte FALHOU (${e instanceof Error ? e.message : String(e)}), tenta de novo depois`);
      return false;
    }
    place(shareId, job.id, out);
    done(shareId, job.id);
    deps.sync();
    return true;
  }

  /** Every job waiting, in the plan's order, made `CUTS_AT_ONCE` at a time; a failed cut stops taking new ones. */
  async function drain(): Promise<void> {
    const waiting: { shareId: string; job: PrepJob }[] = [];
    for (const shareId of deps.shares()) {
      if (deps.plan.get(shareId) === undefined) {
        deps.jobs.set(shareId, []);
        continue;
      }
      for (const job of deps.jobs.get(shareId)) waiting.push({ shareId, job });
    }
    if (waiting.length === 0) return;
    let stop = false;
    let made = 0;
    const worker = async () => {
      while (!stop) {
        const next = waiting.shift();
        if (next === undefined) return;
        if (!(await make(next.shareId, next.job))) {
          stop = true;
          return;
        }
        made += 1;
      }
    };
    await Promise.all(Array.from({ length: CUTS_AT_ONCE }, worker));
    if (made > 0) {
      deps.log(`envio: ${made} arquivos preparados`);
      deps.sync();
    }
  }

  async function run(): Promise<void> {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      if (deps.background !== undefined) await deps.background(drain);
      else await drain();
    } finally {
      running = false;
      if (again) {
        again = false;
        void run();
      }
    }
  }

  return { run };
}

export type SharePrep = ReturnType<typeof createSharePrep>;
