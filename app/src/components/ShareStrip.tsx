import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useShareProgress } from '../cloud/appUploadQueue';
import { shareGroup } from '../cloud/shareGroups';
import { useShareStatus } from '../cloud/shareStatus';
import type { SessionShare } from '../data/schema';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { hoursLeft } from './shareTime';
import { uploadLine } from './ShareUploadStatus';

/**
 * On a shared recording: "Link ativo", where the upload is, how many opened it and how long the link lasts; "Link
 * denunciado" while a report keeps it down. A tap opens the share sheet. In a group link (multi-recording share design
 * §6) it says how many recordings the link holds, shows who opened the link, and opens the group's sheet; the upload
 * is this recording's own.
 */
export function ShareStrip({ sessionId, shared, now }: { sessionId: string; shared: SessionShare; now: number }) {
  const { t } = useT();
  const progress = useShareProgress(shared.shareId);
  const hours = hoursLeft(shared.expiresAt, now);
  const group = shared.groupId === undefined ? undefined : shareGroup(shared.groupId);
  const status = useShareStatus(group === undefined ? shared.shareId : group.groupId, 60 * 1000);
  const reported = status !== undefined && status.report !== 'none';
  const parts = reported
    ? [t(status.report === 'removed' ? 'sharing.removedShort' : 'sharing.reportedShort')]
    : [
        group === undefined ? undefined : t('sharing.recordings', { count: group.recordings.length }),
        progress.state === 'none' ? undefined : uploadLine(t, progress),
        status !== undefined && status.opened > 0 ? t('sharing.opened', { count: status.opened }) : undefined,
        hours >= 1 ? t('sharing.hoursLeft', { count: hours }) : t('sharing.lastHour'),
      ].filter((p): p is string => p !== undefined);
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(group === undefined ? `/share/${sessionId}` : `/share/group?group=${group.groupId}`)} style={styles.root}>
      <View style={[styles.dot, reported && styles.dotReported]} />
      <View style={styles.text}>
        <Text style={styles.title}>{t(reported ? 'sharing.reportedLink' : 'sharing.activeLink')}</Text>
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
  dotReported: { backgroundColor: colors.warning },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  detail: { fontFamily: fonts.body, fontSize: 13, color: colors.soft },
});
