import { StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n/useT';
import type { ApplyResult } from '../partner';
import { colors, fonts } from '../theme/tokens';
import { Button } from './Button';
import { CheckIcon, CloseIcon } from './icons';

type Props = {
  result: ApplyResult;
  /** The partner's display name; only shown when the code was applied. */
  name?: string;
  /** The discount of the partner's price tier; only shown when the code was applied. */
  discountPercent?: number;
  onActivate: () => void;
  onClose: () => void;
};

/** What a referral code did: applied (with the way to the discount), waiting for a connection, not found, or not valid for this player. */
export function PartnerResult({ result, name, discountPercent, onActivate, onClose }: Props) {
  const { t } = useT();
  if (result === 'applied') {
    return (
      <View style={styles.box}>
        <View testID="partner-badge" style={styles.badge}>
          <CheckIcon size={64} />
        </View>
        <Text style={styles.title}>{t('partner.appliedTitle')}</Text>
        <Text style={styles.text}>{t('partner.appliedText', { name: name ?? '', percent: discountPercent ?? 0 })}</Text>
        <Button label={t('partner.activate')} onPress={onActivate} />
        <Button label={t('partner.later')} variant="secondary" onPress={onClose} />
      </View>
    );
  }
  if (result === 'pending') {
    // Not an error: the code is kept and confirmed when the connection returns.
    return (
      <View style={styles.box}>
        <Text style={styles.text}>{t('partner.pendingText')}</Text>
        <Button label={t('common.close')} variant="secondary" onPress={onClose} />
      </View>
    );
  }
  return (
    <View style={styles.box}>
      <View testID="partner-badge" style={[styles.badge, styles.badgeBad]}>
        <CloseIcon color={colors.ground} size={56} />
      </View>
      <Text style={styles.warning}>{result === 'locked' ? t('partner.lockedText') : t('partner.invalidText')}</Text>
      <Button label={t('common.close')} variant="secondary" onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 16, alignItems: 'stretch' },
  badge: {
    alignSelf: 'center',
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeBad: { backgroundColor: colors.warning },
  title: { fontFamily: fonts.bodyBold, fontSize: 20, lineHeight: 28, color: colors.accent, textAlign: 'center' },
  text: { fontFamily: fonts.bodySemi, fontSize: 16, lineHeight: 23, color: colors.text, textAlign: 'center' },
  warning: { fontFamily: fonts.bodySemi, fontSize: 16, lineHeight: 23, color: colors.warning, textAlign: 'center' },
});
