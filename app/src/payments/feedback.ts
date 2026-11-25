import { Alert } from 'react-native';

import { track } from '../analytics';
import type { PaywallSource } from '../analytics/events';
import type { TFunction } from '../i18n';
import { partner, refreshPartner } from '../partner';
import type { PaywallOutcome } from './client';
import type { Offering } from './types';
import { payments } from '.';

/**
 * Opens `offering` and reports it. `code` is the partner whose discount is in play: it tags the events, and a purchase
 * locks the attribution.
 */
async function show(t: TFunction, source: PaywallSource, offering: Offering, code?: string): Promise<PaywallOutcome> {
  const tag = code ? { partner: code } : {};
  track('paywall_viewed', { source, offering, ...tag });
  const outcome = await payments.showPaywall(offering);
  if (outcome === 'purchased') {
    track('purchase_completed', { offering, source, ...tag });
    if (code) partner.lock();
  }
  if (outcome === 'restored') track('purchase_restored', { offering });
  if (outcome === 'error') track('purchase_failed', { reason: 'error' });
  if (outcome === 'error') Alert.alert(t('payments.paywallError'));
  return outcome;
}

/**
 * Opens the paywall: Pro (`default`) or the Single Pass (`pass`). A cancel is silent; a failure (no key, load error,
 * unreadable purchases) gets a short notice. Returns the outcome. `source` says which screen asked, for the metrics.
 *
 * The partner discount shows only in the partner flow (`source` `partner`: "Ativar desconto" after a valid code, typed or
 * from a link): there the Pro paywall becomes the paywall of the partner's price tier, on both stores. Every other way into
 * Pro keeps the normal price; the code still records who referred the customer. The Single Pass is never touched.
 */
export async function openPaywall(t: TFunction, source: PaywallSource, offering: Offering = 'default'): Promise<PaywallOutcome> {
  const partnerFlow = source === 'partner' && offering === 'default';
  if (partnerFlow) await refreshPartner(); // a code applied offline may be valid by now
  // A PRO customer never sees the discount: the code may have been applied before their purchases had loaded.
  const attribution = partnerFlow ? partner.active() : null;
  const offer = attribution !== null && !payments.getSnapshot().proActive ? attribution : null;
  if (offer === null) return show(t, source, offering);
  track('partner_offer_opened', { code: offer.code, via: 'paywall', offering: offer.offering });
  return show(t, source, offer.offering ?? 'default', offer.code);
}

/** Restores purchases and says what happened. */
export async function restorePurchases(t: TFunction): Promise<void> {
  const restored = await payments.restore();
  if (restored === true) Alert.alert(t('payments.restored'));
  else if (restored === false) Alert.alert(t('payments.nothingToRestore'));
}
