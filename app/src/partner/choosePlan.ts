import { Alert } from 'react-native';

import type { TFunction } from '../i18n';
import type { Attribution } from './store';

export type PartnerPlanChoice = 'annual' | 'monthly' | 'all' | 'later';

let choosing = false;

/**
 * iPhone: the discount is an Apple offer code per plan, so the player picks the plan first. `showAll` adds the plans at the
 * normal price. A second tap while the choice is open answers `later` and stacks nothing.
 */
export async function choosePartnerPlan(t: TFunction, a: Attribution, opts: { showAll: boolean }): Promise<PartnerPlanChoice> {
  if (choosing) return 'later';
  choosing = true;
  const percent = a.discountPercent ?? 0;
  try {
    return await new Promise<PartnerPlanChoice>((resolve) =>
      Alert.alert(t('partner.offerTitle', { name: a.name }), undefined, [
        { text: t('partner.planAnnual', { percent }), onPress: () => resolve('annual') },
        { text: t('partner.planMonthly', { percent }), onPress: () => resolve('monthly') },
        ...(opts.showAll ? [{ text: t('partner.offerAll'), onPress: () => resolve('all') }] : []),
        { text: t('partner.later'), style: 'cancel' as const, onPress: () => resolve('later') },
      ]),
    );
  } finally {
    choosing = false;
  }
}
