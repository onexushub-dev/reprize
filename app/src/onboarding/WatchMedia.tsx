import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { CameraIcon } from '../components/icons';
import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { useLoop } from './motion';

/**
 * Reprize open on the Apple Watch during a recording, as targets/watch/ContentView draws it: the time and the clip
 * count on top, the camera and Stop side by side, and Save filling the rest. Save is pressed now and then.
 */
export function WatchMedia() {
  const { t } = useT();
  // On a short phone the picture is lower than the watch: shrink it to fit, never past its own size.
  const [scale, setScale] = useState(1);
  const press = useLoop(2600);
  const pressStyle = useAnimatedStyle(() => {
    const at = press.get();
    const down = at > 0.45 && at < 0.58;
    return { transform: [{ scale: down ? 0.94 : 1 }], opacity: down ? 0.85 : 1 };
  });

  return (
    <View
      style={styles.stage}
      pointerEvents="none"
      onLayout={(event) => setScale(Math.min(1, (event.nativeEvent.layout.height - 24) / BODY_HEIGHT))}>
      <View style={styles.strap} />
      <View style={[styles.body, { transform: [{ scale }] }]}>
        <View style={styles.crown} />
        <View style={styles.button} />
        <View style={styles.screen}>
          <View style={styles.header}>
            <Text style={styles.time}>12:08</Text>
            <Text style={styles.count}>{t('summary.clips', { count: 1 })}</Text>
          </View>
          <View style={styles.controls}>
            <View style={[styles.capsule, styles.camera]}>
              <CameraIcon size={16} />
            </View>
            <View style={[styles.capsule, styles.stop]}>
              <Text style={styles.stopText}>{t('onboarding.watchStop')}</Text>
            </View>
          </View>
          <Animated.View style={[styles.save, pressStyle]}>
            <Text style={styles.saveText} numberOfLines={1} adjustsFontSizeToFit>
              {t('clip.save')}
            </Text>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const ground = '#0A0A0A';
const BODY_HEIGHT = 196;

const styles = StyleSheet.create({
  stage: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  // The band runs off the top and the bottom of the picture.
  strap: { position: 'absolute', top: -20, bottom: -20, width: 112, borderRadius: 30, backgroundColor: '#1E1E1E', borderWidth: 1, borderColor: '#2A2A2A' },
  body: {
    width: 164,
    height: BODY_HEIGHT,
    borderRadius: 46,
    padding: 7,
    backgroundColor: '#2B2B2B',
    borderWidth: 1.5,
    borderColor: '#4A4A4A',
    shadowColor: '#000000',
    shadowOpacity: 0.6,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  crown: { position: 'absolute', right: -6, top: 50, width: 7, height: 30, borderRadius: 3, backgroundColor: '#3A3A3A', borderWidth: 1, borderColor: '#555555' },
  button: { position: 'absolute', right: -4, top: 98, width: 5, height: 40, borderRadius: 2, backgroundColor: '#333333' },
  screen: { flex: 1, borderRadius: 40, backgroundColor: ground, padding: 5, gap: 4, overflow: 'hidden' },
  header: { height: 22, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 16, marginTop: 4 },
  time: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.text, fontVariant: ['tabular-nums'] },
  count: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.accent },
  controls: { flexDirection: 'row', gap: 4 },
  capsule: { flex: 1, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  camera: { backgroundColor: 'rgba(255,255,255,0.2)' },
  stop: { backgroundColor: 'rgba(255,59,48,0.35)' },
  stopText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.text },
  save: { flex: 1, marginTop: 4, borderRadius: 30, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  saveText: { fontFamily: fonts.displayBold, fontSize: 30, letterSpacing: 0.5, color: ground },
});
