import { useSyncExternalStore } from 'react';

import { repo } from '../data/mmkv';
import { payments } from '../payments';
import { sessionPlan } from '../payments/rules';
import { markExempt } from '../payments/watermarkRule';
import type { Plan } from '../payments/types';

import type { ExportTier } from './exportOptions';

/*
 * Every value here is read through the snapshot of useSyncExternalStore, never by calling the store in the hook body.
 * The React Compiler (app.json: experiments.reactCompiler) memoizes a call to a module-level store once per mount when
 * nothing reactive feeds it: `payments.unlockOption()` in the body was read on the first render only, so a PRO bought
 * on the clip or recording screen never reached them (2026-11-13, store build). Snapshots are primitives, so they
 * compare by value and re-render only on a real change.
 */

/** The plan a stored session ran with; any read failure is free. */
function recordedPlan(sessionId: string): Plan {
  try {
    return sessionPlan(repo.getSession(sessionId) ?? {});
  } catch {
    return 'free';
  }
}

function proActiveNow(): boolean {
  return payments.unlockOption().kind === 'pro';
}

function nextPlanNow(): Plan {
  return payments.nextPlan();
}

/**
 * The single place that says which plan applies. With a session, the plan it was recorded with (fixed at its start);
 * without one, the plan the next start would get. Re-renders on the payments store and on the repo (spent Passes,
 * sessions).
 */
export function usePlan(sessionId?: string): Plan {
  // The next plan depends on both stores (a Pass spent lives in the repo), so the repo snapshot reads it again too.
  useSyncExternalStore(payments.subscribe, nextPlanNow);
  return useSyncExternalStore(repo.subscribe, () => (sessionId === undefined ? nextPlanNow() : recordedPlan(sessionId)));
}

/** True while Pro is active. Re-renders when it changes. */
export function useProActive(): boolean {
  return useSyncExternalStore(payments.subscribe, proActiveNow);
}

/**
 * The plan to watch and export a recording that is already made: Pro unlocks every recording while it lasts, otherwise
 * the plan the recording was made with (a Single Pass spent on it later makes it paid). A recording being made keeps
 * `usePlan`, which is fixed at its start.
 */
export function useViewPlan(sessionId: string | undefined): Plan {
  const pro = useProActive();
  const own = usePlan(sessionId);
  return pro ? 'paid' : own;
}

/**
 * How a received recording may leave the app (sharing design §2 decisions 8–10): `pro` like one of the person's own;
 * `courtesy` (one spent on it) in Full HD with the mark; `locked` until a courtesy is spent or Pro bought. Undefined for
 * a recording made on this phone.
 */
export type ReceivedAccess = 'pro' | 'courtesy' | 'locked';

function receivedStateNow(sessionId: string | undefined): 'own' | 'courtesy' | 'locked' {
  if (sessionId === undefined) return 'own';
  try {
    const session = repo.getSession(sessionId);
    if (session === undefined || session.received === undefined) return 'own';
    return session.received.courtesy === true ? 'courtesy' : 'locked';
  } catch {
    return 'own';
  }
}

export function useReceivedAccess(sessionId: string | undefined): ReceivedAccess | undefined {
  const pro = useProActive();
  const state = useSyncExternalStore(repo.subscribe, () => receivedStateNow(sessionId));
  if (state === 'own') return undefined;
  return pro ? 'pro' : state;
}

/**
 * The tier a clip is previewed and exported with. A received recording without Pro shows and leaves as a courtesy (the
 * paid look, Full HD, with the mark), whether or not one is spent yet: watching is free, the gate is on Save and Send.
 * `noMark` (`useMarkExempt`): a paid export under the rule of its day leaves without the app mark (`legacy`).
 */
export function exportTierOf(plan: Plan, access: ReceivedAccess | undefined, noMark = false): ExportTier {
  if (access !== undefined && access !== 'pro') return 'courtesy';
  return plan === 'paid' && noMark ? 'legacy' : plan;
}

/** Whether this recording's paid exports keep the old rule (no app mark); any read failure keeps the mark. */
function markExemptNow(sessionId: string | undefined): boolean {
  try {
    const session = sessionId === undefined ? undefined : repo.getSession(sessionId);
    return markExempt(payments.getSnapshot(), session);
  } catch {
    return false;
  }
}

/**
 * True when a paid export of this recording keeps the rule of its day and leaves without the app mark: a Pro bought
 * before the mark went on every plan, or the recording's own Pass or paid start from before it
 * (`payments/watermarkRule.ts`). Re-renders on the payments store and on the repo.
 */
export function useMarkExempt(sessionId: string | undefined): boolean {
  useSyncExternalStore(payments.subscribe, () => markExemptNow(sessionId));
  return useSyncExternalStore(repo.subscribe, () => markExemptNow(sessionId));
}
