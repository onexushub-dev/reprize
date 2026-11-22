import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { LandscapeTurn } from '../camera/useDeviceLandscape';
import { useT } from '../i18n/useT';
import { formatZoom } from '../modes/zoom';
import { colors, fonts } from '../theme/tokens';
import { SlidersIcon } from './icons';

type Props = {
  onSettings: () => void;
  onStart: () => void;
  /** The camera is opening or the game is starting: "Gravar" waits. */
  busy: boolean;
  /** Shown waiting (the turning wheel): only once it takes a while, so a quick reopen does not flash. */
  waiting?: boolean;
  error?: string | null;
  /** The quarter turn that stands the buttons' contents upright for the phone on its side. */
  turn: LandscapeTurn;
  /** The zoom, when the camera offers more than one. */
  zoom?: { value: number; onPress: () => void };
};

/**
 * What the setup controls shrink to when the phone is held on its side (2026-11-20): round buttons at the edge, as in
 * the Camera app, with their contents turned upright: Ajustes, Gravar in the middle and the zoom. The camera and its
 * positioning guide stay clear; the settings open on demand.
 */
export function CompactDock({ onSettings, onStart, busy, waiting = busy, error, turn, zoom }: Props) {
  const { t } = useT();
  const upright = { transform: [{ rotate: `${turn}deg` }] };
  return (
    <SafeAreaView edges={['bottom']} pointerEvents="box-none" style={styles.dock}>
      {error ? (
        <View style={styles.error}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      <View pointerEvents="box-none" style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('setup.dockSettings')}
          onPress={onSettings}
          style={styles.side}>
          <View style={upright}>
            <SlidersIcon size={24} />
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('setup.dockRecord')}
          accessibilityState={{ disabled: busy, busy }}
          disabled={busy}
          onPress={onStart}
          style={[styles.record, waiting && styles.busy]}>
          {waiting ? <ActivityIndicator color={colors.text} /> : <View style={styles.recordFill} />}
        </Pressable>
        {zoom ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('setup.zoomA11y', { value: formatZoom(zoom.value) })}
            accessibilityHint={t('setup.zoomHint')}
            onPress={zoom.onPress}
            style={styles.side}>
            <Text style={[styles.zoomText, upright]}>{formatZoom(zoom.value)}</Text>
          </Pressable>
        ) : (
          <View style={styles.spacer} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: 8, paddingBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 36 },
  side: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12,12,12,0.75)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  spacer: { width: 52, height: 52 },
  // As in the Camera app: a white ring with a gap and the disc inside, in the app's amber (2026-11-22; red before).
  record: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: colors.text,
    backgroundColor: 'rgba(12,12,12,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordFill: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.accent },
  busy: { opacity: 0.5 },
  zoomText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.accent },
  error: { backgroundColor: 'rgba(12,12,12,0.85)', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, marginHorizontal: 16 },
  errorText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.warning },
});
