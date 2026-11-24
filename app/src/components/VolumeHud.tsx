import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { VolumeManager } from 'react-native-volume-manager';

import { useT } from '../i18n/useT';
import { colors } from '../theme/tokens';
import { MutedIcon, SoundIcon } from './icons';

/** How long the level stays up after the last change, before it fades. */
const SHOWN_MS = 1500;

/**
 * The phone's volume, while it changes, over the clip (2026-11-21): iOS showed nothing when the buttons moved it on the
 * clip screen, so it looked broken. It only listens (never sets the volume nor hides the system's), and only while
 * this screen is up: the Bluetooth remote, which reads the volume, listens on the recording screens only.
 */
export function VolumeHud() {
  const { t } = useT();
  const [level, setLevel] = useState<number>();
  const [fade] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let hide: ReturnType<typeof setTimeout> | undefined;
    let sub: { remove: () => void } | undefined;
    try {
      sub = VolumeManager.addVolumeListener(({ volume }) => {
        setLevel(volume);
        fade.stopAnimation();
        fade.setValue(1);
        if (hide !== undefined) clearTimeout(hide);
        hide = setTimeout(() => Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: true }).start(), SHOWN_MS);
      });
    } catch {
      // No volume module (web, tests): nothing to show.
    }
    return () => {
      if (hide !== undefined) clearTimeout(hide);
      if (sub !== undefined) sub.remove();
    };
  }, [fade]);

  if (level === undefined) return null;
  const share = Math.min(Math.max(level, 0), 1);
  return (
    <Animated.View
      pointerEvents="none"
      testID="volume-hud"
      accessibilityLiveRegion="polite"
      accessibilityLabel={t('clip.volumeLevel', { percent: Math.round(share * 100) })}
      style={[styles.wrap, { opacity: fade }]}>
      <View style={styles.pill}>
        {share === 0 ? <MutedIcon size={18} /> : <SoundIcon size={18} />}
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${share * 100}%` }]} />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Under the top row (back, name, Apagar), where iOS would show its own.
  wrap: { alignItems: 'center', marginTop: 58 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(12,12,12,0.8)',
  },
  track: { width: 120, height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.text },
});
