import { StyleSheet, Text, View } from 'react-native';

import { uploadQueue, useGroupProgress, useShareProgress } from '../cloud/appUploadQueue';
import type { ShareGroup, ShareGroupRecording } from '../cloud/shareGroups';
import { repo } from '../data/mmkv';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { sessionLabel } from './format';
import { CheckIcon } from './icons';
import { uploadLine, UploadStatusCard } from './ShareUploadStatus';

/**
 * The uploads of a group link on its sheet (multi-recording share design §3.1, step 3): the card of all its recordings
 * together ("3 de 5 gravações enviadas", Pausar envio, Tentar de novo), then each recording in the link's order with
 * its own clips ("7 de 12 clipes enviados"), so the sender sees which ones the recipients can already watch.
 */
export function GroupUploadStatus({ group }: { group: ShareGroup }) {
  const ids = group.recordings.map((r) => r.shareId);
  const progress = useGroupProgress(ids);
  return (
    <View style={styles.root}>
      <UploadStatusCard
        progress={progress}
        recordings={{ done: progress.recordingsDone, count: progress.recordings }}
        onRetry={() => ids.forEach((id) => uploadQueue.retry(id))}
      />
      <View style={styles.list} testID="group-recordings">
        {group.recordings.map((recording, index) => (
          <RecordingRow key={recording.shareId} recording={recording} index={index} />
        ))}
      </View>
    </View>
  );
}

function RecordingRow({ recording, index }: { recording: ShareGroupRecording; index: number }) {
  const { t, locale } = useT();
  const progress = useShareProgress(recording.shareId);
  const session = repo.getSession(recording.sessionId);
  const label = session === undefined ? t('sharing.groupRecording', { number: index + 1 }) : sessionLabel(session, undefined, locale);
  const line = progress.state === 'none' ? t('sharing.clips', { count: recording.clips }) : uploadLine(t, progress);
  const done = progress.state === 'done';
  return (
    <View style={[styles.row, index > 0 && styles.rowLine]} accessible accessibilityLabel={`${label}, ${line}`}>
      <View style={[styles.badge, done && styles.badgeDone]}>
        {done ? <CheckIcon size={13} /> : <Text style={styles.badgeText}>{index + 1}</Text>}
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {line}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignSelf: 'stretch', gap: 12 },
  list: { borderRadius: radius.card, backgroundColor: colors.surface, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.border },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.soft },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
});
