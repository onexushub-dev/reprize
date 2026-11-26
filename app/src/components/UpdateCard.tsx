import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { CloseIcon, DownloadIcon } from './icons';

type Props = {
  /** Distance from the bottom of the screen: the card sits just above the setup sheet. */
  bottom: number;
  onUpdate: () => void;
  onClose: () => void;
};

/** A new version is in the store: a small card over the preview that never blocks the screen. */
export function UpdateCard({ bottom, onUpdate, onClose }: Props) {
  const { t } = useT();
  return (
    <View testID="update-card" accessibilityLiveRegion="polite" style={[styles.card, { bottom }]}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <DownloadIcon color={colors.accent} size={22} />
        </View>
        <View style={styles.text}>
          <Text accessibilityRole="header" style={styles.title}>
            {t('update.title')}
          </Text>
          <Text style={styles.body}>{t('update.body')}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('update.close')} onPress={onClose} style={styles.close}>
          <CloseIcon color={colors.soft} size={18} />
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('update.action')}
        onPress={onUpdate}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
        <Text style={styles.actionText}>{t('update.action')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    gap: 12,
    paddingTop: 14,
    paddingBottom: 14,
    paddingLeft: 14,
    paddingRight: 8,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ground },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.soft },
  close: { width: 44, height: 44, marginTop: -8, alignItems: 'center', justifyContent: 'center' },
  action: { height: 44, marginRight: 6, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  pressed: { opacity: 0.85 },
  actionText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.onAccent },
});
