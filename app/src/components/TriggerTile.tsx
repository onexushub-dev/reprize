import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../theme/tokens';

type Props = {
  icon: ReactNode;
  title: string;
  /** Optional second line; without it the title carries the whole action and turns accent when active. */
  status?: string;
  active?: boolean;
  disabled?: boolean;
  /** A paid trigger the player does not have: `lockedHint` is read out after the status (the group around it shows the "Pro" badge). */
  lockedHint?: string;
  onPress?: () => void;
  /** A "?" at the tile's end that opens how to use this way (its own press: the tile's press still toggles). */
  help?: { label: string; onPress: () => void };
  /** Slimmer, for the settings on a phone held on its side (2026-11-20). */
  dense?: boolean;
};

/** One way of saving a lance, with its live status (setup screen). */
export function TriggerTile({ icon, title, status, active = false, disabled = false, lockedHint, onPress, help, dense = false }: Props) {
  const tile = [styles.tile, dense ? styles.dense : null];
  const body = (
    <>
      {icon}
      <View style={styles.text}>
        <Text style={[styles.title, status === undefined && active && { color: colors.accent }]}>{title}</Text>
        {status === undefined ? null : (
          <Text style={[styles.status, active && { color: colors.accent }]}>{status}</Text>
        )}
      </View>
    </>
  );
  const label = [title, status, lockedHint].filter((part) => part !== undefined).join(', ');
  if (!onPress) {
    return (
      <View style={[tile, disabled && styles.disabled]} accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  if (help !== undefined) {
    // Side by side, not nested: VoiceOver reaches a button inside another button only as part of it.
    return (
      <View style={[tile, styles.withHelp, disabled && styles.disabled]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onPress}
          style={styles.main}>
          {body}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={help.label}
          hitSlop={10}
          onPress={help.onPress}
          style={styles.help}>
          <Text style={styles.helpText}>?</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[tile, disabled && styles.disabled]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dense: { minHeight: 46, paddingVertical: 6 },
  disabled: { opacity: 0.5 },
  // minWidth 0: a long title wraps inside the tile instead of running past its edge.
  text: { flex: 1, flexShrink: 1, minWidth: 0 },
  title: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text },
  status: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  withHelp: { paddingRight: 8 },
  main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch' },
  help: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
});
