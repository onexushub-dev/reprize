import * as Device from 'expo-device';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { TriggerSource } from '../data/schema';
import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { Button } from './Button';
import { CheckIcon } from './icons';
import { screenCornerRadius } from './screenCorner';
import { sourceLabel } from './sourceLabel';

type Props = { number: number; source: TriggerSource; /** The length the clip actually has. */ cutMs: number; onUndo: () => void };

/**
 * Confirmation shown for ~2s after each save: an accent frame around the screen and a compact card,
 * so the camera picture stays visible and the rest of the screen still saves on tap.
 */
export function SavedOverlay({ number, source, cutMs, onUndo }: Props) {
  const { t, locale } = useT();
  const window = useWindowDimensions();
  // The frame follows the screen's own rounded corners (2026-11-22): square, it was cut off at each corner.
  const corner = screenCornerRadius(Device.modelId, Math.max(window.width, window.height));
  return (
    <View testID="saved-frame" pointerEvents="box-none" style={[styles.frame, { borderRadius: corner }]}>
      <View style={styles.card} accessibilityLiveRegion="assertive">
        <View style={styles.row}>
          <View style={styles.badge}>
            <CheckIcon size={28} />
          </View>
          <View style={styles.text}>
            <Text style={styles.title}>{t('recording.savedTitle', { number })}</Text>
            <Text style={styles.via}>{t('recording.savedVia', { source: sourceLabel(source, locale), seconds: Math.round(cutMs / 1000) })}</Text>
          </View>
        </View>
        <Button label={t('recording.undo')} variant="secondary" onPress={onUndo} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: 5,
    borderColor: colors.accent,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: { backgroundColor: 'rgba(12,12,12,0.88)', borderRadius: 20, padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
  title: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 32, color: colors.text },
  via: { fontFamily: fonts.body, fontSize: 14, color: colors.soft },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, lineHeight: 18 },
});
