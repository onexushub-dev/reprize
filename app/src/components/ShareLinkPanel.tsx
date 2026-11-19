import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { useShareStatus } from '../cloud/shareStatus';
import type { SessionShare } from '../data/schema';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { Button } from './Button';
import { hoursLeft } from './shareTime';
import { ShareUploadStatus } from './ShareUploadStatus';

/** How often the open sheet asks who opened the link and whether it was reported. */
const STATUS_EVERY_MS = 15 * 1000;

/**
 * The link of a shared recording (sharing design §3.1, steps 2 and 5): the QR code the athletes scan at the court, how
 * long it lasts, how many phones opened it, Copiar link and Enviar link (the system sheet, where WhatsApp is). A
 * reported link is down (§8.3): the sheet says so instead of offering the QR code.
 */
export function ShareLinkPanel({ shared }: { shared: SessionShare }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  const hours = hoursLeft(shared.expiresAt, now);
  const status = useShareStatus(shared.shareId, STATUS_EVERY_MS);
  const reported = status !== undefined && status.report !== 'none';

  async function copy() {
    await Clipboard.setStringAsync(shared.url);
    setCopied(true);
  }

  if (reported) {
    return (
      <View style={styles.root}>
        <View style={styles.reported}>
          <Text style={styles.reportedTitle}>{t(status.report === 'removed' ? 'sharing.removedTitle' : 'sharing.reportedTitle')}</Text>
          <Text style={styles.reportedBody}>{t(status.report === 'removed' ? 'sharing.removedBody' : 'sharing.reportedBody')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.scan}>{t('sharing.scan')}</Text>
      <View style={styles.qr} accessible accessibilityLabel={shared.url}>
        <QRCode value={shared.url} size={232} color="#0A0A0A" backgroundColor="#FFFFFF" ecl="M" />
      </View>
      <Text style={styles.meta}>
        {t('sharing.clips', { count: shared.clips })} · {hours >= 1 ? t('sharing.hoursLeft', { count: hours }) : t('sharing.lastHour')}
      </Text>
      {status !== undefined ? (
        <Text style={styles.opened}>{status.opened === 0 ? t('sharing.openedNone') : t('sharing.opened', { count: status.opened })}</Text>
      ) : null}
      <Text style={styles.url} selectable numberOfLines={1}>
        {shared.url.replace(/^https:\/\//, '')}
      </Text>
      <View style={styles.buttons}>
        <View style={styles.button}>
          <Button label={copied ? t('sharing.copied') : t('sharing.copy')} variant="secondary" onPress={() => void copy()} />
        </View>
        <View style={styles.button}>
          <Button label={t('sharing.send')} onPress={() => void Share.share({ message: t('sharing.message', { url: shared.url }) })} />
        </View>
      </View>
      <ShareUploadStatus shareId={shared.shareId} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 14 },
  scan: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.soft, textAlign: 'center' },
  qr: { padding: 16, borderRadius: radius.card, backgroundColor: '#FFFFFF' },
  meta: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text, textAlign: 'center' },
  url: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: 'center' },
  opened: { fontFamily: fonts.body, fontSize: 14, color: colors.soft, textAlign: 'center' },
  reported: { alignSelf: 'stretch', gap: 6, padding: 16, borderRadius: radius.card, backgroundColor: colors.warningGround },
  reportedTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.warning },
  reportedBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.text },
  buttons: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  button: { flex: 1 },
});
