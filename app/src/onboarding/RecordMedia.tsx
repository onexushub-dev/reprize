import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { GLASS } from '../components/GlassButton';
import { GalleryIcon, GearFilledIcon, MicIcon, RemoteIcon, ResolutionIcon, SaveLastIcon, WaveIcon } from '../components/icons';
import { useT } from '../i18n/useT';
import { formatZoom } from '../modes/zoom';
import { colors, fonts } from '../theme/tokens';
import { PHOTOS } from './photos';
import { Photo, useLoop } from './motion';

/**
 * The camera as it opens (2026-11-23, after the camera bar of 2026-11-22): the zoom on top, the three settings over the
 * picture in the order they are set (clip length → quality → triggers) and, on the black under it, Gravações, the
 * record button and Ajustes.
 */
export function RecordMedia() {
  const { t } = useT();
  const tap = useLoop(3200);
  // A ring spreads out of the record button now and then, as if a finger had just pressed it.
  const ring = useAnimatedStyle(() => {
    const at = tap.get();
    return { opacity: at < 0.3 ? 0 : 0.85 * (1 - (at - 0.3) / 0.7), transform: [{ scale: 0.6 + 0.9 * at }] };
  });
  return (
    <View style={styles.frame} pointerEvents="none">
      <View style={styles.picture}>
        <Photo photo={PHOTOS.camera} />
        <View style={styles.zoomRow}>
          <View style={styles.zoom}>
            <Text style={styles.zoomText}>{formatZoom(1)}</Text>
          </View>
        </View>
        <View style={styles.pills}>
          <View style={styles.pill}>
            <SaveLastIcon size={16} color={colors.text} />
            <Text style={[styles.pillText, styles.pillTextAsWritten]}>15s</Text>
          </View>
          <Arrow />
          <View style={styles.pill}>
            <ResolutionIcon size={15} color={colors.text} />
            <Text style={styles.pillText}>{t('setup.qualityFullHd')}</Text>
          </View>
          <Arrow />
          <View style={styles.pill}>
            <RemoteIcon size={15} color={colors.text} />
            <WaveIcon size={15} color={colors.text} />
            <MicIcon size={15} color={colors.text} />
          </View>
        </View>
      </View>
      <View style={styles.ground}>
        <View style={styles.side}>
          <GalleryIcon size={30} under={GLASS.fill} />
        </View>
        <View style={styles.record}>
          <View style={styles.recordFill} />
          <Animated.View style={[styles.ring, ring]} />
        </View>
        <View style={styles.side}>
          <GearFilledIcon size={24} />
        </View>
      </View>
    </View>
  );
}

/** From one setting to the next, white on a dark edge so it reads over any picture (CameraBar). */
function Arrow() {
  const d = 'M5 12h14M13 6l6 6-6 6';
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24">
      <Path d={d} stroke="rgba(0,0,0,0.6)" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d={d} stroke={colors.text} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, minHeight: 200, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.ground },
  picture: { flex: 1, overflow: 'hidden', backgroundColor: '#111111' },
  zoomRow: { position: 'absolute', top: 12, left: 0, right: 0, alignItems: 'center' },
  zoom: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(12,12,12,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.accent },
  pills: { position: 'absolute', left: 0, right: 0, bottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  pill: {
    height: 36,
    paddingHorizontal: 9,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.text,
    backgroundColor: 'rgba(12,12,12,0.55)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text, textTransform: 'uppercase' },
  pillTextAsWritten: { textTransform: 'none' },
  ground: { height: 80, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', backgroundColor: colors.ground },
  side: { width: 48, height: 48, borderRadius: 24, backgroundColor: GLASS.fill, alignItems: 'center', justifyContent: 'center' },
  // The app's record button: a white ring with a gap, the amber inside.
  record: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 3.5,
    borderColor: colors.text,
    backgroundColor: 'rgba(12,12,12,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordFill: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent },
  ring: { position: 'absolute', width: 60, height: 60, borderRadius: 30, borderWidth: 3, borderColor: colors.onAccent },
});
