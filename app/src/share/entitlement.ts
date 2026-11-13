import { useSyncExternalStore } from 'react';

import { repo } from '../data/mmkv';
import { payments } from '../payments';
import { sessionPlan } from '../payments/rules';
import type { Plan } from '../payments/types';

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
