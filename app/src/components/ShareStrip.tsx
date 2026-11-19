import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useShareProgress } from '../cloud/appUploadQueue';
import type { SessionShare } from '../data/schema';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { hoursLeft } from './shareTime';
import { uploadLine } from './ShareUploadStatus';

/** On a shared recording: "Link ativo", where the upload is and how long the link lasts; a tap opens the share sheet. */
export function ShareStrip({ sessionId, shared, now }: { sessionId: string; shared: SessionShare; now: number }) {
  const { t } = useT();
  const progress = useShareProgress(shared.shareId);
  const hours = hoursLeft(shared.expiresAt, now);
  const parts = [
    progress.state === 'none' ? undefined : uploadLine(t, progress),
    hours >= 1 ? t('sharing.hoursLeft', { count: hours }) : t('sharing.lastHour'),
  ].filter((p): p is string => p !== undefined);
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/share/${sessionId}`)} style={styles.root}>
      <View style={styles.dot} />
      <View style={styles.text}>
        <Text style={styles.title}>{t('sharing.activeLink')}</Text>
        <Text style={styles.detail}>{parts.join(' · ')}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  detail: { fontFamily: fonts.body, fontSize: 13, color: colors.soft },
});
