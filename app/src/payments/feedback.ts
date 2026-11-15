import { Alert, Platform } from 'react-native';

import { track } from '../analytics';
import type { PaywallSource } from '../analytics/events';
import type { TFunction } from '../i18n';
import { type Attribution, partner, redeemPartnerOffer } from '../partner';
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
    track('purchase_completed', { offering, ...tag });
    if (code) partner.lock();
  }
  if (outcome === 'restored') track('purchase_restored', { offering });
  if (outcome === 'error') track('purchase_failed', { reason: 'error' });
  if (outcome === 'error') Alert.alert(t('payments.paywallError'));
  return outcome;
}

/** iPhone: the discount is an Apple offer code, so the player chooses between it and the plans at the normal price. */
function chooseOffer(t: TFunction, a: Attribution): Promise<'discount' | 'all' | 'later'> {
  return new Promise((resolve) =>
    Alert.alert(t('partner.offerTitle', { name: a.name }), undefined, [
      { text: t('partner.activate'), onPress: () => resolve('discount') },
      { text: t('partner.offerAll'), onPress: () => resolve('all') },
      { text: t('partner.later'), style: 'cancel', onPress: () => resolve('later') },
    ]),
  );
}

/**
 * Opens the paywall: Pro (`default`) or the Single Pass (`pass`). A cancel is silent; a failure (no key, load error,
 * unreadable purchases) gets a short notice. Returns the outcome. `source` says which screen asked, for the metrics.
 *
 * With a partner discount active, the Pro paywall becomes the partner one on Android and a choice on iPhone (the
 * discount there is an Apple offer code). The Single Pass is never touched.
 */
export async function openPaywall(t: TFunction, source: PaywallSource, offering: Offering = 'default'): Promise<PaywallOutcome> {
  const offer = offering === 'default' ? partner.active() : null;
  if (offer === null) return show(t, source, offering);
  if (Platform.OS === 'android') {
    track('partner_offer_opened', { code: offer.code, via: 'paywall' });
    return show(t, source, 'partner', offer.code);
  }
  if (Platform.OS === 'ios') {
    const choice = await chooseOffer(t, offer);
    if (choice === 'all') return show(t, source, 'default', offer.code);
    if (choice === 'discount') await redeemPartnerOffer(t);
    return 'cancelled';
  }
  return show(t, source, offering);
}

/** Restores purchases and says what happened. */
export async function restorePurchases(t: TFunction): Promise<void> {
  const restored = await payments.restore();
  if (restored === true) Alert.alert(t('payments.restored'));
  else if (restored === false) Alert.alert(t('payments.nothingToRestore'));
}
