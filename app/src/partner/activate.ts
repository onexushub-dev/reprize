import type { TFunction } from '../i18n';
import { openPaywall } from '../payments/feedback';

/** "Ativar desconto": opens the paywall of the partner's price tier, on both stores. */
export async function activatePartnerDiscount(t: TFunction): Promise<void> {
  await openPaywall(t, 'partner');
}
