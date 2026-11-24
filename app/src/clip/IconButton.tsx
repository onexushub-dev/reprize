import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { GlassButton } from '../components/GlassButton';
import { colors } from '../theme/tokens';

export const SCRIM = 'rgba(12,12,12,0.74)';
export const EDGE = 'rgba(255,255,255,0.22)';

/**
 * A round icon button over the video, in the app's glass look with the iPhone's press feedback (`GlassButton`);
 * `loading` shows a spinner in place of the icon while its job runs.
 */
export function IconButton({
  label,
  onPress,
  disabled,
  loading,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <GlassButton
      variant="overlay"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      style={[styles.icon, disabled && !loading ? styles.off : null]}>
      {loading ? <ActivityIndicator color={colors.text} /> : children}
    </GlassButton>
  );
}

const styles = StyleSheet.create({
  icon: { width: 42, height: 42, borderRadius: 21 },
  off: { opacity: 0.4 },
});
