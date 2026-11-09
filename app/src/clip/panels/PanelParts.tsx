import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LockIcon } from '../../components/icons';
import { colors, fonts } from '../../theme/tokens';

/**
 * A tool panel's name and its one plain sentence. `pro`: the "Pro" pill beside the title, on a tool a free export leaves
 * out. `badge`: a plain pill for a new tool ("NOVO").
 */
export function PanelHead({
  title,
  hint,
  right,
  pro,
  badge,
}: {
  title: string;
  hint: string;
  right?: ReactNode;
  pro?: string;
  badge?: string;
}) {
  return (
    <View style={styles.head}>
      <View style={styles.headText}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {pro !== undefined ? (
            <View style={styles.pro} accessibilityLabel={pro}>
              <LockIcon color={colors.onAccent} size={9} />
              <Text style={styles.proText}>{pro}</Text>
            </View>
          ) : null}
          {badge !== undefined ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      {right}
    </View>
  );
}

/** A choice in a panel row: amber when it is the current one. */
export function Choice({
  label,
  a11y,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  a11y?: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ? a11y : label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.choice, selected ? styles.choiceOn : null, disabled ? styles.choiceOff : null]}>
      <Text style={[styles.choiceText, selected ? styles.choiceTextOn : null]}>{label}</Text>
    </Pressable>
  );
}

export const panelStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  note: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  value: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
});

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  proText: { fontFamily: fonts.bodyBold, fontSize: 9, color: colors.onAccent },
  badge: { borderRadius: 999, borderWidth: 1, borderColor: colors.accent, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 9, color: colors.accent, letterSpacing: 0.5 },
  title: { fontFamily: fonts.displayBold, fontSize: 18, letterSpacing: 0.7, textTransform: 'uppercase', color: colors.text },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  choice: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  choiceOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  choiceOff: { opacity: 0.45 },
  choiceText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  choiceTextOn: { color: colors.onAccent },
});
