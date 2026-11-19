import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import type { SessionShare } from '../data/schema';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { Button } from './Button';
import { hoursLeft } from './shareTime';
import { ShareUploadStatus } from './ShareUploadStatus';


/**
 * The link of a shared recording (sharing design §3.1, step 2): the QR code the athletes scan at the court, how long it
 * lasts, Copiar link and Enviar link (the system sheet, where WhatsApp is).
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

  async function copy() {
    await Clipboard.setStringAsync(shared.url);
    setCopied(true);
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
  buttons: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  button: { flex: 1 },
});
