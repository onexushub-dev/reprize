import { StyleSheet, Text, View } from 'react-native';

import { useReceiveProgress } from '../cloud/receive';
import type { SessionReceived } from '../data/schema';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';

/**
 * On a received recording (sharing design §6), in as little room as it takes, so the clips keep the screen: who sent
 * how many clips and how far the download is, with a thin bar while clips are missing; one more line only when
 * something needs saying (paused, waiting for the sender, the link over). The free unlock is offered on Salvar
 * (2026-11-20: no line for it here). Denunciar is in the recording's menu.
 */
export function ReceivedBanner({
  sessionId,
  received,
}: {
  sessionId: string;
  received: SessionReceived;
}) {
  const { t } = useT();
  const progress = useReceiveProgress(sessionId);
  const missing = progress.done < progress.total;
  const headline = received.from
    ? t('received.sentBy', { name: received.from, count: progress.total })
    : t('received.fromUnknown');
  let counter: string;
  if (!missing) counter = t('received.here');
  else if (progress.paused) counter = t('received.pausedShort');
  else counter = t('received.counter', { done: progress.done, count: progress.total });
  let status: string | undefined;
  if (!missing) status = undefined;
  else if (progress.state === 'expired') status = t('received.expired');
  else if (progress.state === 'off') status = t('received.off');
  else if (progress.state === 'removed') status = t('received.removed');
  else if (progress.paused) status = t('received.paused', { done: progress.done, count: progress.total });
  else if (!progress.downloading) status = t('received.waiting', { done: progress.done, count: progress.total });
  const initial = received.from ? received.from.trim().charAt(0).toUpperCase() : '';
  const fraction = progress.total > 0 ? progress.done / progress.total : 0;
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
        {missing && progress.state === 'active' ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
          </View>
        ) : null}
        {status !== undefined ? <Text style={styles.status}>{status}</Text> : null}
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
  status: { fontFamily: fonts.body, fontSize: 12, color: colors.soft },
});
