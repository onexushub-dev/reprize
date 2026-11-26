import * as Application from 'expo-application';
import { AppState, Platform } from 'react-native';

import { track } from '../analytics';
import { kv } from '../data/mmkv';
import { payments, paymentsClient } from '../payments';
import { codeFromReferrer } from './code';
import { type ApplyResult, type Attribution, createPartnerStore, type PartnerSource } from './store';

export type { ApplyResult, Attribution, PartnerSource } from './store';

const OWNER_KEY = 'partner.owner';
const ANONYMOUS_PREFIX = '$RCAnonymousID:';
/** Tolerance between this phone's clock and the store's purchase dates. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

function readOwner(): { id: string; appliedAt: number } | null {
  try {
    const raw = kv.getString(OWNER_KEY);
    return raw === undefined ? null : (JSON.parse(raw) as { id: string; appliedAt: number });
  } catch {
    return null;
  }
}

/**
 * The attribution belongs to the install but RevenueCat attributes belong to a customer: they are written only for the
 * customer who applied the code, or the account an anonymous customer signed in to (RevenueCat moves its purchases there).
 */
async function writeAttributes(a: Attribution): Promise<void> {
  if (!a.offering) return;
  const id = await paymentsClient.appUserId();
  if (id === null) return;
  const owner = readOwner();
  const same = owner?.appliedAt === a.appliedAt;
  if (same && owner.id !== id && !owner.id.startsWith(ANONYMOUS_PREFIX)) return;
  if (!same || owner.id !== id) {
    try {
      kv.set(OWNER_KEY, JSON.stringify({ id, appliedAt: a.appliedAt }));
    } catch {
      // claimed again at the next write
    }
  }
  await paymentsClient.setPartner(a.code, a.source, a.offering, a.appliedAt);
}

/** App-wide partner attribution: valid codes are written to RevenueCat as customer attributes (and again at every start). */
export const partner = createPartnerStore({
  kv,
  directory: () => paymentsClient.partners(),
  now: () => Date.now(),
  onValid: (a) => void writeAttributes(a).catch(() => {}),
});

/** A code is reported once per launch: a start and a link can both confirm the same one. */
const announced = new Set<string>();
function announce(code: string, source: PartnerSource): void {
  if (announced.has(code)) return;
  announced.add(code);
  track('partner_code_applied', { code, source });
}

/** A code from a link, the install referrer or the typed field. Reports the result; a customer who has PRO never applies one. */
export async function applyPartnerCode(raw: string, source: PartnerSource): Promise<ApplyResult> {
  // A fresh read, not getSnapshot(): at a cold start the store still holds the empty snapshot, and a subscriber opening a
  // partner link must not get a code (it would also re-attribute their renewals to the partner).
  const { proActive } = await payments.refresh();
  const result = await partner.apply(raw, source, { blocked: proActive });
  if (result === 'applied') {
    const code = partner.current()?.code;
    if (code) announce(code, source);
  } else if (result === 'invalid' || result === 'locked') {
    track('partner_code_rejected', { source, reason: result });
  }
  return result;
}

const REFERRER_KEY = 'partner.referrerChecked';

/** Android: the Play install referrer carries the code from the store link; Google advises reading it once, at the first run. */
async function readInstallReferrer(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    if (kv.getString(REFERRER_KEY) !== undefined) return;
  } catch {
    return;
  }
  let referrer: string | null = null;
  try {
    referrer = await Application.getInstallReferrerAsync();
  } catch {
    // no Play Store, or no referrer: nothing to apply
  }
  try {
    kv.set(REFERRER_KEY, 'true');
  } catch {
    // read again next time at worst
  }
  const code = codeFromReferrer(referrer);
  if (code !== null) await applyPartnerCode(code, 'install_referrer');
}

/** Fresh from the SDK: unlike the store's snapshot, a failed read is null rather than "no PRO". */
async function readPro(): Promise<boolean | null> {
  try {
    return (await paymentsClient.getSnapshot()).proActive;
  } catch {
    return null;
  }
}

/** Confirms a code that waited for the directory (offline) and reports it once it is valid. */
async function confirmAndAnnounce(): Promise<void> {
  const hadPending = partner.pending();
  const before = partner.current();
  await partner.start({ pro: await readPro() });
  const now = partner.current();
  if (hadPending && now?.status === 'valid' && (before?.status !== 'valid' || before.code !== now.code)) {
    announce(now.code, now.source);
  }
}

/** The app is used again with a code still waiting: asks the directory again, so the player need not restart the app. */
export async function refreshPartner(): Promise<void> {
  if (!partner.pending()) return;
  try {
    await confirmAndAnnounce();
  } catch {
    // the partner discount is an extra: it never stops the app
  }
}

/** Locks a code when the customer's first PRO purchase came after it: from then on the attribution cannot move. */
function settlePurchases(): void {
  const a = partner.active();
  const { proActive, proSince } = payments.getSnapshot();
  if (a && proActive && proSince !== undefined && proSince >= a.appliedAt - CLOCK_SKEW_MS) partner.lock();
}

let listening = false;

/** Once: PRO arriving from the SDK, and the app coming back to the front, both lock a code after a purchase and retry a waiting code. */
function listen(): void {
  if (listening) return;
  listening = true;
  payments.subscribe(settlePurchases);
  AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    void (async () => {
      try {
        await payments.refresh();
        settlePurchases();
        await refreshPartner();
      } catch {
        // never reaches the app
      }
    })();
  });
}

/** Once per launch, from the root layout: locks a code after a purchase, confirms a waiting code, reads the install referrer. Never throws. */
export async function startPartner(): Promise<void> {
  try {
    listen();
    // Purchases first: a purchase made on a tier must be locked before the directory can move the attribution.
    await payments.refresh();
    settlePurchases();
    await confirmAndAnnounce();
    await readInstallReferrer();
  } catch {
    // the partner discount is an extra: it never stops the app
  }
}
