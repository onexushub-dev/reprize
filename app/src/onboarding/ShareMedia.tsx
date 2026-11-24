import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';

import { BackIcon, DownloadIcon, EditIcon, LinkShareIcon, PlayIcon, ShareIcon, TrashIcon } from '../components/icons';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { PHOTOS } from './photos';
import { Photo, useLoop } from './motion';

const SCRIM = 'rgba(12,12,12,0.74)';
const EDGE = 'rgba(255,255,255,0.22)';

/** The strip under the player: the clips of the recording, the first one (the one playing) open, as in ClipStrip. */
const THUMBS = [PHOTOS.play, PHOTOS.focus, PHOTOS.camera, PHOTOS.focus, PHOTOS.play];

/**
 * A QR code drawn for the picture (it opens nothing): the three corner squares, the timing lines and a fixed scatter
 * of modules, on a 21 × 21 grid like a real version-1 code.
 */
const QR_SIZE = 21;
const QR_PATH = (() => {
  const finder = (x: number, y: number, ox: number, oy: number) => {
    const dx = x - ox;
    const dy = y - oy;
    if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return undefined;
    const ring = dx === 0 || dy === 0 || dx === 6 || dy === 6;
    const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
    return ring || core;
  };
  let seed = 7;
  let d = '';
  for (let y = 0; y < QR_SIZE; y++) {
    for (let x = 0; x < QR_SIZE; x++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const corner = [finder(x, y, 0, 0), finder(x, y, QR_SIZE - 7, 0), finder(x, y, 0, QR_SIZE - 7)].find((v) => v !== undefined);
      const quiet = (x === 7 && (y <= 7 || y >= QR_SIZE - 8)) || (y === 7 && (x <= 7 || x >= QR_SIZE - 8)) || (x === QR_SIZE - 8 && y <= 7) || (y === QR_SIZE - 8 && x <= 7);
      let on;
      if (corner !== undefined) on = corner;
      else if (quiet) on = false;
      else if (x === 6 || y === 6) on = (x + y) % 2 === 0;
      else on = seed % 100 < 48;
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return d;
})();

function QrCode({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${QR_SIZE} ${QR_SIZE}`} accessibilityElementsHidden>
      <Rect width={QR_SIZE} height={QR_SIZE} fill={colors.text} />
      <Path d={QR_PATH} fill={colors.ground} />
    </Svg>
  );
}

/**
 * The saved clip's screen as it is (ClipWatch, 2026-11-23): back, the name and the bin on top, the player and the clip
 * strip, Editar first then Salvar and Enviar. Under it, the PRO card for sending the whole recording by link.
 */
export function ShareMedia() {
  const { t } = useT();
  const head = useLoop(3200);
  const headStyle = useAnimatedStyle(() => ({ width: `${head.get() * 100}%` }));

  return (
    <View style={styles.root} pointerEvents="none">
      <View style={styles.frame}>
        <Photo photo={PHOTOS.play} focus={{ x: 0.5, y: 0.56 }} />
        <View style={styles.top}>
          <View style={styles.round}>
            <BackIcon size={20} />
          </View>
          <View style={styles.name}>
            <Text style={styles.nameText} numberOfLines={1}>
              {t('onboarding.clipName')}
            </Text>
          </View>
          <View style={styles.round}>
            <TrashIcon size={18} />
          </View>
        </View>
        <View style={styles.dock}>
          <View style={styles.player}>
            <PlayIcon size={14} />
            <View style={styles.bar}>
              <Animated.View style={[styles.barFill, headStyle]} />
            </View>
          </View>
          <View style={styles.strip}>
            {THUMBS.map((photo, i) => (
              <View key={i} style={[styles.thumb, i === 0 && styles.thumbOn]}>
                <Image source={photo.source} style={styles.thumbImage} resizeMode="cover" />
              </View>
            ))}
          </View>
          <View style={styles.actions}>
            <View style={[styles.action, styles.primary]}>
              <EditIcon size={18} color={colors.onAccent} />
              <Text style={[styles.actionText, { color: colors.onAccent }]}>{t('clip.edit')}</Text>
            </View>
            <View style={styles.action}>
              <DownloadIcon size={18} />
              <Text style={styles.actionText}>{t('clip.save')}</Text>
            </View>
            <View style={styles.action}>
              <ShareIcon size={18} />
              <Text style={styles.actionText}>{t('clip.send')}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.link}>
        <View style={styles.qr}>
          <QrCode size={64} />
        </View>
        <View style={styles.linkText}>
          <View style={styles.linkHead}>
            <View style={styles.linkIcon}>
              <LinkShareIcon size={14} color={colors.accent} />
            </View>
            <Text style={styles.linkTitle} numberOfLines={1}>
              {t('onboarding.linkTitle')}
            </Text>
            <View style={styles.pro}>
              <Text style={styles.proText}>{t('onboarding.pro')}</Text>
            </View>
          </View>
          <Text style={styles.linkBody}>{t('onboarding.linkBody')}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: 10 },
  frame: { flex: 1, minHeight: 200, borderRadius: 18, overflow: 'hidden', backgroundColor: '#111111' },
  top: { position: 'absolute', top: 10, left: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  round: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: SCRIM,
    borderWidth: 1,
    borderColor: EDGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { flex: 1, height: 38, borderRadius: 19, backgroundColor: SCRIM, borderWidth: 1, borderColor: EDGE, paddingHorizontal: 14, justifyContent: 'center' },
  nameText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  dock: { position: 'absolute', left: 10, right: 10, bottom: 10, gap: 8 },
  player: {
    height: 36,
    borderRadius: 18,
    backgroundColor: SCRIM,
    borderWidth: 1,
    borderColor: EDGE,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2, backgroundColor: colors.text },
  strip: { flexDirection: 'row', gap: 4, justifyContent: 'center' },
  thumb: { width: 30, height: 40, borderRadius: 6, overflow: 'hidden', backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: EDGE },
  thumbImage: { width: '100%', height: '100%' },
  thumbOn: { borderWidth: 2, borderColor: colors.accent },
  actions: { flexDirection: 'row', gap: 6 },
  action: {
    flex: 1,
    height: 44,
    borderRadius: radius.button,
    backgroundColor: SCRIM,
    borderWidth: 1,
    borderColor: EDGE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  actionText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // White tile with a quiet margin round the code, as a scannable QR needs.
  qr: { width: 78, height: 78, borderRadius: 12, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  linkText: { flex: 1, gap: 4 },
  linkHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  linkIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,176,0,0.14)', alignItems: 'center', justifyContent: 'center' },
  linkTitle: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: colors.text },
  pro: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: 6, backgroundColor: colors.accent },
  proText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.onAccent },
  linkBody: { fontFamily: fonts.bodySemi, fontSize: 14, lineHeight: 19, color: colors.soft },
});
