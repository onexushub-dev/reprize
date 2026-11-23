import { Platform } from 'react-native';

import type { TFunction } from '../i18n';
import { openPaywall } from '../payments/feedback';
import { choosePartnerPlan } from './choosePlan';
import { partner, redeemPartnerOffer } from './index';

/**
 * "Ativar desconto": on iPhone the player picks the plan and Apple's offer code redemption opens; on Android it opens the
 * paywall of the partner's price tier.
 */
export async function activatePartnerDiscount(t: TFunction): Promise<void> {
  if (Platform.OS !== 'ios') {
    await openPaywall(t, 'partner');
    return;
  }
  const attribution = partner.active();
  if (attribution === null) return;
  const choice = await choosePartnerPlan(t, attribution, { showAll: false });
  if (choice === 'annual' || choice === 'monthly') await redeemPartnerOffer(t, choice);
}
