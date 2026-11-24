import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { Button } from './Button';
import { CheckIcon } from './icons';

const POINTS = [1, 2, 3, 4] as const;

/**
 * "Antes de compartilhar" (sharing design §8.4): four points and one box to tick; the button works only with the box
 * ticked. Shown once per account and notice version, before the first link.
 */
export function ShareNotice({ busy, onAgree }: { busy: boolean; onAgree: () => void }) {
  const { t } = useT();
  const [ticked, setTicked] = useState(false);
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{t('sharing.noticeTitle')}</Text>
      {POINTS.map((n) => (
        <View key={n} style={styles.point}>
          <Text style={styles.number}>{n}</Text>
          <View style={styles.pointText}>
            <Text style={styles.pointTitle}>{t(`sharing.notice${n}Title`)}</Text>
            <Text style={styles.pointBody}>{t(`sharing.notice${n}Body`)}</Text>
          </View>
        </View>
      ))}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ticked }}
        accessibilityLabel={t('sharing.noticeCheck')}
        onPress={() => setTicked((v) => !v)}
        style={styles.check}
      >
        <View style={[styles.box, ticked && styles.boxTicked]}>
          {ticked ? <CheckIcon size={16} color={colors.onAccent} /> : null}
        </View>
        <Text style={styles.checkText}>{t('sharing.noticeCheck')}</Text>
      </Pressable>
      <Button label={t('sharing.noticeAgree')} disabled={!ticked || busy} loading={busy} onPress={onAgree} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 16 },
  title: { fontFamily: fonts.displayBold, fontSize: 30, color: colors.text, textTransform: 'uppercase' },
  point: { flexDirection: 'row', gap: 12 },
  number: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.accent, width: 18 },
  pointText: { flex: 1, gap: 2 },
  pointTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.text },
  pointBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.soft },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
  box: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxTicked: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 14, lineHeight: 20, color: colors.text },
});
