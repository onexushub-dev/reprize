import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../theme/tokens';

type Tone = 'accent' | 'danger' | 'muted';

const TONES: Record<Tone, { ground: string }> = {
  accent: { ground: 'rgba(255,176,0,0.14)' },
  danger: { ground: '#3A1414' },
  muted: { ground: colors.border },
};

/**
 * A sheet's title with its icon on the same line (2026-11-20: no icon alone on a line above the text). The title stays
 * on one line, shrinking a little on narrow phones.
 */
export function SheetTitle({ icon, title, tone = 'accent' }: { icon: ReactNode; title: string; tone?: Tone }) {
  return (
    <View style={styles.root}>
      <View style={[styles.icon, { backgroundColor: TONES[tone].ground }]}>{icon}</View>
      <Text accessibilityRole="header" style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 19, color: colors.text },
});
