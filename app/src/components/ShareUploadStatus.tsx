import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { uploadQueue, useShareProgress } from '../cloud/appUploadQueue';
import { setUploadOnCellular, uploadOnCellular } from '../cloud/uploadPlan';
import type { ShareProgress } from '../cloud/uploadQueue';
import type { TFunction } from '../i18n';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';

/** One line for where the clips are: "7 de 12 clipes enviados", paused, all sent, or what did not upload. */
export function uploadLine(t: TFunction, progress: ShareProgress): string {
  if (progress.state === 'done') return t('sharing.allSent', { count: progress.total });
  if (progress.state === 'paused') return progress.pausedBy === 'you' ? t('sharing.pausedByYou') : t('sharing.paused');
  if (progress.state === 'failed') return t('sharing.notSent', { count: progress.failed });
  return t('sharing.sent', { done: progress.done, count: progress.total });
}

/**
 * The upload of a shared recording on the share sheet (sharing design §5.4): progress, Pausar / Continuar envio,
 * Tentar de novo for clips that gave up, and the mobile data switch.
 */
export function ShareUploadStatus({ shareId }: { shareId: string }) {
  const { t } = useT();
  const progress = useShareProgress(shareId);
  const [cellular, setCellular] = useState(uploadOnCellular);
  if (progress.state === 'none') return <Text style={styles.note}>{t('sharing.uploadNote')}</Text>;
  const fraction = progress.totalBytes > 0 ? Math.min(1, progress.sentBytes / progress.totalBytes) : 0;
  return (
    <View style={styles.root}>
      <Text style={styles.line}>{uploadLine(t, progress)}</Text>
      {progress.state === 'done' ? null : (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
        </View>
      )}
      {progress.state === 'done' || progress.pausedBy === 'recording' ? null : (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => uploadQueue.setManualPause(progress.pausedBy !== 'you')}
        >
          <Text style={styles.retry}>{progress.pausedBy === 'you' ? t('sharing.resumeUpload') : t('sharing.pauseUpload')}</Text>
        </Pressable>
      )}
      {progress.failed > 0 && progress.state !== 'paused' ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => uploadQueue.retry(shareId)}>
          <Text style={styles.retry}>{t('sharing.retry')}</Text>
        </Pressable>
      ) : null}
      {progress.state === 'done' ? null : (
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{t('sharing.cellular')}</Text>
          <Switch
            accessibilityLabel={t('sharing.cellular')}
            value={cellular}
            onValueChange={(on) => {
              setCellular(on);
              setUploadOnCellular(on);
            }}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignSelf: 'stretch', gap: 10, padding: 14, borderRadius: radius.card, backgroundColor: colors.surface },
  line: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.accent },
  retry: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.accent },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.soft },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted, textAlign: 'center' },
});
