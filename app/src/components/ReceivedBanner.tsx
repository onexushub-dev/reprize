import { StyleSheet, Text, View } from 'react-native';

import { useReceiveProgress } from '../cloud/receive';
import type { SessionReceived } from '../data/schema';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { hoursLeft } from './shareTime';

/**
 * On a received recording (sharing design §6): who shared it, how far the download is and, while clips are missing,
 * how long the link still lasts.
 */
export function ReceivedBanner({ sessionId, received, now }: { sessionId: string; received: SessionReceived; now: number }) {
  const { t } = useT();
  const progress = useReceiveProgress(sessionId);
  const from = received.from ? t('received.from', { name: received.from }) : t('received.fromUnknown');
  const missing = progress.done < progress.total;
  let status: string;
  if (!missing) status = t('received.allHere', { count: progress.total });
  else if (progress.state === 'expired') status = t('received.expired');
  else if (progress.state === 'off') status = t('received.off');
  else if (progress.state === 'removed') status = t('received.removed');
  else if (progress.downloading) status = t('received.downloading', { done: progress.done, count: progress.total });
  else status = t('received.waiting', { done: progress.done, count: progress.total });
  const hours = hoursLeft(received.expiresAt, now);
  const live = missing && progress.state === 'active' && received.expiresAt > now;
  return (
    <View style={styles.root}>
      <Text style={styles.from}>{from}</Text>
      <Text style={styles.status}>{status}</Text>
      {live ? (
        <Text style={styles.left}>{hours >= 1 ? t('sharing.hoursLeft', { count: hours }) : t('sharing.lastHour')}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 2, padding: 12, borderRadius: radius.card, backgroundColor: colors.surface },
  from: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.accent },
  status: { fontFamily: fonts.body, fontSize: 13, color: colors.soft },
  left: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
});
