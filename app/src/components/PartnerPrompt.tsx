import { router } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { kv } from '../data/mmkv';
import { useT } from '../i18n/useT';
import { partner } from '../partner';
import { payments } from '../payments';
import { colors, fonts, radius } from '../theme/tokens';
import { CloseIcon } from './icons';

const DISMISSED_KEY = 'partner.promptDismissed';

function wasDismissed(): boolean {
  try {
    return kv.getString(DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

const proActive = () => payments.getSnapshot().proActive;

/** First use: an iPhone install cannot carry the referral code, so the setup screen asks once, until answered or dismissed. */
export function PartnerPrompt() {
  const { t } = useT();
  const attribution = useSyncExternalStore(partner.subscribe, partner.current);
  const pro = useSyncExternalStore(payments.subscribe, proActive);
  const [dismissed, setDismissed] = useState(wasDismissed);

  if (attribution !== null || pro || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      kv.set(DISMISSED_KEY, 'true');
    } catch {
      // asked again at the next launch at worst
    }
  };

  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="link" style={styles.main} onPress={() => router.push('/partner')}>
        <Text style={styles.text}>{t('partner.promptText')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('partner.promptDismiss')} hitSlop={8} style={styles.close} onPress={dismiss}>
        <CloseIcon color={colors.muted} size={16} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.card, minHeight: 44 },
  main: { flex: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  text: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.text },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
