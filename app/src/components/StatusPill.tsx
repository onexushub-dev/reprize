import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../theme/tokens';

type Props = { text: string; tone: 'on' | 'ok' | 'idle' };

/**
 * A dot and a short status: accent when the device is connected, grey otherwise; `ok` is the triggers panel's green
 * (the Bluetooth remote's sheet, 2026-11-22, so "Conectado" reads the same in both).
 */
export function StatusPill({ text, tone }: Props) {
  const tint = tone === 'on' ? colors.accent : tone === 'ok' ? colors.ok : undefined;
  return (
    <View accessible accessibilityLabel={text} style={styles.pill}>
      <View style={[styles.dot, { backgroundColor: tint === undefined ? colors.muted : tint }]} />
      <Text style={[styles.text, tint !== undefined && { color: tint }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.soft },
});
