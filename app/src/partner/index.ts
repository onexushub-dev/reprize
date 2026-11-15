import * as Application from 'expo-application';
import { Alert, AppState, Platform } from 'react-native';

import { track } from '../analytics';
import { kv } from '../data/mmkv';
import type { TFunction } from '../i18n';
import { payments, paymentsClient } from '../payments';
import { codeFromReferrer } from './code';
import { type ApplyResult, createPartnerStore, type PartnerSource } from './store';

export type { ApplyResult, Attribution, PartnerSource } from './store';

/** App-wide partner attribution: valid codes are written to RevenueCat as customer attributes (and again at every start). */
export const partner = createPartnerStore({
  kv,
  directory: () => paymentsClient.partners(),
  now: () => Date.now(),
  onValid: (a) => void paymentsClient.setPartner(a.code, a.source),
});

/** A code from a link, the install referrer or the typed field. Reports the result; a customer who has PRO never applies one. */
export async function applyPartnerCode(raw: string, source: PartnerSource): Promise<ApplyResult> {
  const result = await partner.apply(raw, source, { blocked: payments.getSnapshot().proActive });
  if (result === 'applied') {
    const code = partner.current()?.code;
    if (code) track('partner_code_applied', { code, source });
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

/** Once per launch, from the root layout: confirms a pending code, then reads the install referrer. Never throws. */
export async function startPartner(): Promise<void> {
  try {
    const wasPending = partner.current()?.status === 'pending';
    await partner.start();
    const now = partner.current();
    if (wasPending && now?.status === 'valid') track('partner_code_applied', { code: now.code, source: now.source });
    await readInstallReferrer();
  } catch {
    // the partner discount is an extra: it never stops the app
  }
}

let watching: { remove(): void } | null = null;

/** After Apple's redemption: when the app comes back to the front, a PRO that was not there before is the purchase. */
function watchRedemption(code: string): void {
  watching?.remove();
  watching = AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    void (async () => {
      const before = payments.getSnapshot().proActive;
      const after = await payments.refresh();
      if (before || !after.proActive) return; // not bought (yet): keep waiting for the next return
      watching?.remove();
      watching = null;
      track('purchase_completed', { offering: 'default', partner: code });
      partner.lock();
    })();
  });
}

/** iPhone: opens Apple's offer code redemption with the active partner code filled in. */
export async function redeemPartnerOffer(t: TFunction): Promise<void> {
  const a = partner.active();
  if (!a) return;
  track('partner_offer_opened', { code: a.code, via: 'offer_code' });
  const opened = await paymentsClient.redeemOfferCode(a.code);
  if (!opened) {
    Alert.alert(t('partner.redeemError'));
    return;
  }
  watchRedemption(a.code);
}
