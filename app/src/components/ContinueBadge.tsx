import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { CloseIcon, RotateIcon } from './icons';

/**
 * "↻ Continuando · Final do torneio" (continue-recording design, 2026-11-23): on the camera while a recording is about
 * to go on or goes on. With `onDrop`, an ✕ gives up continuing (the camera is then ready for a new recording).
 */
export function ContinueBadge({ name, onDrop }: { name: string; onDrop?: () => void }) {
  const { t } = useT();
  return (
    <View style={styles.badge} pointerEvents="box-none">
      <RotateIcon size={16} color={colors.accent} />
      <Text style={styles.text} numberOfLines={1}>
        {t('continue.badge', { name })}
      </Text>
      {onDrop !== undefined ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('continue.drop')} hitSlop={10} onPress={onDrop} style={styles.drop}>
          <CloseIcon size={12} color={colors.soft} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    maxWidth: '100%',
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: 'rgba(12,12,12,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,176,0,0.45)',
  },
  text: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.text },
  drop: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)', marginLeft: 2 },
});
