import { Pressable, StyleSheet, Text, View } from 'react-native';

import { uploadQueue, useShareProgress } from '../cloud/appUploadQueue';
import type { ShareProgress } from '../cloud/uploadQueue';
import type { TFunction } from '../i18n';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { CheckIcon, PauseIcon, PlayIcon } from './icons';
import { GlassButton } from './GlassButton';

/** One line for where the clips are: "7 de 12 clipes enviados", paused, all sent, or what did not upload. */
export function uploadLine(t: TFunction, progress: ShareProgress): string {
  if (progress.state === 'done') return t('sharing.allSent', { count: progress.total });
  if (progress.state === 'paused') return progress.pausedBy === 'you' ? t('sharing.pausedByYou') : t('sharing.paused');
  if (progress.state === 'failed') return t('sharing.notSent', { count: progress.failed });
  return t('sharing.sent', { done: progress.done, count: progress.total });
}

/**
 * The upload of a shared recording on the share sheet (sharing design §5.4): a round Pausar / Continuar button beside
 * how many clips went up and the percentage, the bar under them, and Tentar de novo for clips that gave up. Uploads
 * use mobile data whenever there is no Wi-Fi (2026-11-20: the switch is gone).
 */
export function ShareUploadStatus({ shareId }: { shareId: string }) {
  const progress = useShareProgress(shareId);
  return <UploadStatusCard progress={progress} onRetry={() => uploadQueue.retry(shareId)} />;
}

/**
 * The card of ShareUploadStatus for any progress: one recording's, or a group link's together (`count` then says how
 * many recordings went up, under the clips).
 */
export function UploadStatusCard({
  progress,
  onRetry,
  recordings,
}: {
  progress: ShareProgress;
  onRetry: () => void;
  recordings?: { done: number; count: number };
}) {
  const { t } = useT();
  if (progress.state === 'none') return <Text style={styles.note}>{t('sharing.uploadNote')}</Text>;
  if (progress.state === 'done') {
    return (
      <View style={[styles.root, styles.doneRow]}>
        <View style={styles.doneDot}>
          <CheckIcon size={16} />
        </View>
        <View style={styles.text}>
          <Text style={styles.line}>
            {recordings === undefined ? uploadLine(t, progress) : t('sharing.groupAllSent', { count: recordings.count })}
          </Text>
          <Text style={styles.sub}>{t('sharing.allSentNote')}</Text>
        </View>
      </View>
    );
  }
  const fraction = progress.totalBytes > 0 ? Math.min(1, progress.sentBytes / progress.totalBytes) : 0;
  const byYou = progress.state === 'paused' && progress.pausedBy === 'you';
  // A pause for a recording ends by itself when the recording ends: no button then.
  const canToggle = !(progress.state === 'paused' && progress.pausedBy === 'recording');
  const sent =
    recordings === undefined
      ? t('sharing.sent', { done: progress.done, count: progress.total })
      : t('sharing.recordingsSent', { done: recordings.done, count: recordings.count });
  const sub =
    progress.state === 'paused' || progress.state === 'failed'
      ? uploadLine(t, progress)
      : recordings === undefined
        ? t('sharing.keepGoing')
        : t('sharing.sent', { done: progress.done, count: progress.total });
  return (
    <View style={styles.root}>
      <View style={styles.head}>
        {canToggle ? (
          <GlassButton
            accessibilityRole="button"
            accessibilityLabel={byYou ? t('sharing.resumeUpload') : t('sharing.pauseUpload')}
            onPress={() => uploadQueue.setManualPause(!byYou)}
            style={styles.toggle}
          >
            {byYou ? <PlayIcon color={colors.accent} size={18} /> : <PauseIcon size={16} />}
          </GlassButton>
        ) : null}
        <View style={styles.text}>
          <Text style={styles.line}>{sent}</Text>
          <Text style={styles.sub}>{sub}</Text>
        </View>
        <Text style={styles.pct}>{`${Math.round(fraction * 100)}%`}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }, progress.state === 'paused' && styles.fillPaused]} />
      </View>
      {progress.failed > 0 && progress.state !== 'paused' ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={onRetry}>
          <Text style={styles.retry}>{t('sharing.retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignSelf: 'stretch', gap: 12, padding: 14, borderRadius: radius.card, backgroundColor: colors.surface },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  line: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  pct: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.muted },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.accent },
  fillPaused: { backgroundColor: colors.muted },
  retry: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.accent },
  doneRow: { flexDirection: 'row', alignItems: 'center' },
  doneDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted, textAlign: 'center' },
});
