import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { receiveQueue, startDownload, useReceiveProgress } from '../cloud/receive';
import type { SessionReceived } from '../data/schema';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { Button } from './Button';
import { DownloadIcon } from './icons';
import { hoursLeft } from './shareTime';

/** "320 MB", "1,2 GB". */
export function sizeLabel(bytes: number, locale: string): string {
  if (bytes >= 1_000_000_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1_000_000_000)} GB`;
  }
  return `${new Intl.NumberFormat(locale).format(Math.max(1, Math.round(bytes / 1_000_000)))} MB`;
}

/**
 * On a received recording (sharing design §6), in as little room as it takes, so the clips keep the screen: who sent
 * how many clips and how far the download is, with a thin bar while clips are missing; one more line only when
 * something needs saying (paused, waiting for the sender, the link over). The free unlock is offered on Salvar
 * (2026-11-20: no line for it here). Denunciar is in the recording's menu.
 *
 * The person chooses (multi-recording share design §5.4): a recording of a group link waits for Baixar (with its size
 * and how long the link lasts); while it downloads, Pausar and Cancelar; paused, Continuar and Cancelar. Cancelar
 * takes the clips already downloaded off the phone, after asking.
 */
export function ReceivedBanner({
  sessionId,
  received,
  onDelete,
}: {
  sessionId: string;
  received: SessionReceived;
  /** Apagar gravação, offered when the link is over and nothing of it reached the phone (2026-11-22). */
  onDelete?: () => void;
}) {
  const { t, locale } = useT();
  const progress = useReceiveProgress(sessionId);
  // The clock for how long the link lasts, read again every minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  const missing = progress.done < progress.total;
  const live = progress.state === 'active';
  const headline = received.from
    ? t('received.sentBy', { name: received.from, count: progress.total })
    : t('received.fromUnknown');
  const choice = progress.download;
  let counter: string;
  if (!missing) counter = t('received.here');
  else if (choice === 'waiting') counter = t('received.notDownloadedShort');
  else if (choice === 'paused' || progress.paused) counter = t('received.pausedShort');
  else counter = t('received.counter', { done: progress.done, count: progress.total });
  let status: string | undefined;
  if (!missing) status = undefined;
  else if (progress.state === 'expired') status = t('received.expired');
  else if (progress.state === 'off') status = t('received.off');
  else if (progress.state === 'removed') status = t('received.removed');
  else if (choice === 'waiting') {
    const hours = hoursLeft(received.expiresAt, now);
    status = hours >= 1 ? t('received.chooseHours', { count: hours }) : t('received.chooseLastHour');
  } else if (choice === 'paused') status = t('received.pausedByYou', { done: progress.done, count: progress.total });
  else if (progress.paused) status = t('received.paused', { done: progress.done, count: progress.total });
  else if (!progress.downloading) status = t('received.waiting', { done: progress.done, count: progress.total });
  const initial = received.from ? received.from.trim().charAt(0).toUpperCase() : '';
  const fraction = progress.total > 0 ? progress.done / progress.total : 0;

  function confirmCancel() {
    Alert.alert(t('received.cancelTitle'), t('received.cancelBody'), [
      { text: t('received.cancelKeep'), style: 'cancel' },
      { text: t('received.cancelConfirm'), style: 'destructive', onPress: () => receiveQueue.cancel(sessionId) },
    ]);
  }

  // The link is over (turned off, expired, reported) and no clip came down: without a new link the recording holds
  // nothing, so the card offers to delete it instead of leaving an empty recording behind.
  const over = progress.state === 'off' || progress.state === 'expired' || progress.state === 'removed';
  const empty = over && progress.done === 0 && progress.total > 0;
  const download =
    progress.bytes > 0 ? t('received.downloadSize', { size: sizeLabel(progress.bytes, locale) }) : t('received.download');
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.avatar}>
            <Text style={styles.initial}>{initial}</Text>
          </View>
          <Text style={styles.headline} numberOfLines={1}>
            {headline}
          </Text>
          <Text style={styles.counter}>{counter}</Text>
        </View>
        {empty && onDelete !== undefined ? (
          <>
            <Text style={styles.status}>{t('received.nothingHere')}</Text>
            <Button label={t('games.deleteRecording')} variant="secondary" onPress={onDelete} />
          </>
        ) : null}
        {missing && live && choice !== 'waiting' ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }, choice === 'paused' && styles.fillPaused]} />
          </View>
        ) : null}
        {status !== undefined ? <Text style={styles.status}>{status}</Text> : null}
        {missing && live && choice === 'waiting' ? (
          <Button
            label={download}
            icon={<DownloadIcon color={colors.onAccent} size={20} />}
            onPress={() => startDownload(sessionId)}
          />
        ) : null}
        {missing && live && choice !== 'waiting' ? (
          <View style={styles.actions}>
            {choice === 'paused' ? (
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => startDownload(sessionId)}>
                <Text style={[styles.action, styles.actionMain]}>{t('received.resume')}</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => receiveQueue.setDownload(sessionId, 'paused')}>
                <Text style={styles.action}>{t('received.pause')}</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" hitSlop={8} onPress={confirmCancel}>
              <Text style={styles.action}>{t('received.cancel')}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  card: { gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.card, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  headline: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  counter: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.accent },
  fillPaused: { backgroundColor: colors.muted },
  status: { fontFamily: fonts.body, fontSize: 12, color: colors.soft },
  actions: { flexDirection: 'row', gap: 20, paddingTop: 2 },
  action: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.soft },
  actionMain: { color: colors.accent },
});
