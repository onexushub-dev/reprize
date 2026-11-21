import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { useShareStatus } from '../cloud/shareStatus';
import type { SessionShare } from '../data/schema';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { Button } from './Button';
import { ClockIcon, CopyIcon, EyeIcon, FilmIcon, ShareIcon } from './icons';
import { hoursLeft } from './shareTime';
import { ShareUploadStatus } from './ShareUploadStatus';

/** How often the open sheet asks who opened the link and whether it was reported. */
const STATUS_EVERY_MS = 15 * 1000;

/**
 * The link of a shared recording (sharing design §3.1, steps 2 and 5): the QR code the athletes scan at the court, how
 * long it lasts, how many phones opened it, Copiar beside the link and Enviar link (the system sheet, where WhatsApp is). A
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

  const opened = status !== undefined && status.opened > 0;
  return (
    <View style={styles.root}>
      <Text style={styles.scan} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
        {t('sharing.scan')}
      </Text>
      <View style={styles.qr} accessible accessibilityLabel={shared.url}>
        <QRCode value={shared.url} size={204} color="#0A0A0A" backgroundColor="#FFFFFF" ecl="M" />
      </View>
      <View style={styles.chips}>
        <View style={styles.chip}>
          <FilmIcon size={14} color={colors.soft} />
          <Text style={styles.chipText}>{t('sharing.clips', { count: shared.clips })}</Text>
        </View>
        <View style={styles.chip}>
          <ClockIcon size={14} color={colors.soft} />
          <Text style={styles.chipText}>{hours >= 1 ? t('sharing.hoursLeftShort', { count: hours }) : t('sharing.lastHour')}</Text>
        </View>
        {status !== undefined ? (
          <View style={[styles.chip, opened && styles.chipOn]}>
            <EyeIcon size={14} color={opened ? colors.accent : colors.soft} />
            <Text style={[styles.chipText, opened && styles.chipTextOn]}>
              {opened ? t('sharing.opened', { count: status.opened }) : t('sharing.openedNone')}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.field}>
        <Text style={styles.url} selectable numberOfLines={1}>
          {shared.url.replace(/^https:\/\//, '')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? t('sharing.copied') : t('sharing.copyA11y')}
          onPress={() => void copy()}
          style={styles.copy}
        >
          <CopyIcon size={15} />
          <Text style={styles.copyText}>{copied ? t('sharing.copied') : t('sharing.copy')}</Text>
        </Pressable>
      </View>
      <View style={styles.send}>
        <Button
          label={t('sharing.send')}
          icon={<ShareIcon color={colors.onAccent} size={20} />}
          onPress={() => void Share.share({ message: t('sharing.message', { url: shared.url }) })}
        />
      </View>
      <ShareUploadStatus shareId={shared.shareId} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 14 },
  scan: { alignSelf: 'stretch', fontFamily: fonts.body, fontSize: 15, color: colors.soft, textAlign: 'center' },
  qr: { padding: 14, borderRadius: radius.card, backgroundColor: '#FFFFFF' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { borderColor: 'rgba(255,176,0,0.4)', backgroundColor: 'rgba(255,176,0,0.14)' },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.soft },
  chipTextOn: { fontFamily: fonts.bodyBold, color: colors.accent },
  field: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 48,
    paddingLeft: 12,
    paddingRight: 6,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  url: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.border,
  },
  copyText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text },
  send: { alignSelf: 'stretch' },
  reported: { alignSelf: 'stretch', gap: 6, padding: 16, borderRadius: radius.card, backgroundColor: colors.warningGround },
  reportedTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.warning },
  reportedBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.text },
});
