import { StyleSheet, Text } from 'react-native';

import { useT } from '../i18n/useT';
import { formatZoom } from '../modes/zoom';
import { colors, fonts } from '../theme/tokens';
import { GlassButton } from './GlassButton';

type Props = {
  value: number;
  onPress: () => void;
  /** The zoom is changing (a pinch, a tap), and a moment after: amber, so the new value stands out. */
  lit?: boolean;
};

/** The camera's zoom, as one round button: it shows only the current value and each tap goes to the next stop. */
export function ZoomButton({ value, onPress, lit = false }: Props) {
  const { t } = useT();
  const text = formatZoom(value);
  return (
    <GlassButton
      variant="overlay"
      accessibilityRole="button"
      accessibilityLabel={t('setup.zoomA11y', { value: text })}
      accessibilityHint={t('setup.zoomHint')}
      onPress={onPress}
      style={[styles.button, lit && styles.lit]}>
      <Text style={[styles.text, lit && styles.litText]}>{text}</Text>
    </GlassButton>
  );
}

// A dark round glass, the value in amber (2026-11-22): the app's glass button over the camera (`GlassButton`).
const styles = StyleSheet.create({
  button: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.accent },
  lit: { backgroundColor: colors.accent, borderColor: colors.accent, borderTopColor: colors.accent },
  litText: { color: colors.onAccent },
});
