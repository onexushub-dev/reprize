import { Platform } from 'react-native';

import type { TFunction } from '../i18n';
import { openPaywall } from '../payments/feedback';
import { redeemPartnerOffer } from './index';

/**
 * "Ativar desconto": on iPhone the discount is Apple's offer code, so it opens the redemption; on Android it opens the
 * partner paywall.
 */
export async function activatePartnerDiscount(t: TFunction): Promise<void> {
  if (Platform.OS === 'ios') await redeemPartnerOffer(t);
  else await openPaywall(t, 'partner');
}
