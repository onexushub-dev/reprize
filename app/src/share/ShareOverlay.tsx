import { type ComponentRef, forwardRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../theme/tokens';
import { BRAND_HANDLE, BRAND_LOGO, logoAspect } from './brandLogo';
import type { Rect as Box } from './layout';

/**
 * The R is this share of the frame's short side tall, and the handle's text this share, so the mark reads the same in a
 * 720 and in a 1080 export, vertical or landscape. Kept small: the free plan's mark is meant to be discreet (R ~30 px
 * and text ~22 px in a 720 frame).
 */
export const MARK_SHARE = 0.042;
export const HANDLE_SHARE = 0.03;
/** Space between the R and the handle, as a share of the frame's short side. */
const MARK_GAP = 0.014;
/** Room around the logo inside the dark pill, as a share of the frame's short side. */
const PAD_X = 0.021;
const PAD_Y = 0.011;
/** Where the pill sits: the same distance from the right and from the bottom edge of the video image, as a share of the frame's short side (about 32 px in a 720 frame). */
const MARK_MARGIN = 0.045;

type Props = {
  frame: { width: number; height: number };
  layout: { video: Box; top: Box; bottom: Box };
  /** Screen points per frame pixel: 1/PixelRatio for the capture, smaller for the on-screen preview. */
  scale: number;
  /** Draw the mark (the R and @reprize.app). Free exports carry it; paid ones (pass, pro) do not. Bands and layout are unchanged. */
  watermark?: boolean;
};

/**
 * What every exported clip carries: dark bands where the video leaves room (landscape) and, on the free plan, the
 * Reprize R with our Instagram in the video's bottom-right corner, so whoever sees a shared clip knows which app made it
 * and where to find us. No gradient over the video (2026-11-08 spec §2): the mark's own dark pill keeps it readable.
 * The same component draws the preview and, captured to PNG, the export overlay.
 */
export const ShareOverlay = forwardRef<ComponentRef<typeof View>, Props>(function ShareOverlay(
  { frame, layout, scale, watermark = true },
  ref,
) {
  const s = (n: number) => n * scale;
  const unit = Math.min(frame.width, frame.height);
  // The mark belongs to the video image, so it follows its corner whatever its shape
  // (a landscape clip sits in the middle of the frame, with bands above and below).
  const videoRight = layout.video.x + layout.video.width;
  const videoBottom = layout.video.y + layout.video.height;
  const box = (r: Box) => ({
    position: 'absolute' as const,
    left: s(r.x),
    top: s(r.y),
    width: s(r.width),
    height: s(r.height),
  });

  return (
    <View ref={ref} collapsable={false} style={{ width: s(frame.width), height: s(frame.height) }}>
      {layout.top.height > 0 ? <View style={[box(layout.top), styles.band]} /> : null}
      {layout.bottom.height > 0 ? <View style={[box(layout.bottom), styles.band]} /> : null}
      <View testID="share-video-area" style={box(layout.video)} />

      {watermark ? (
        <View
          style={[
            styles.mark,
            {
              bottom: s(frame.height - videoBottom + unit * MARK_MARGIN),
              right: s(frame.width - videoRight + unit * MARK_MARGIN),
              paddingHorizontal: s(unit * PAD_X),
              paddingVertical: s(unit * PAD_Y),
              gap: s(unit * MARK_GAP),
            },
          ]}>
          <Image
            accessibilityLabel="Reprize"
            fadeDuration={0}
            resizeMode="contain"
            source={BRAND_LOGO}
            style={{ height: s(unit * MARK_SHARE), width: s(unit * MARK_SHARE) * logoAspect() }}
          />
          <Text numberOfLines={1} allowFontScaling={false} style={[styles.handle, { fontSize: s(unit * HANDLE_SHARE) }]}>
            {BRAND_HANDLE}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  band: { backgroundColor: colors.ground },
  // Discreet: a lighter pill and a slightly see-through logo.
  mark: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(12,12,12,0.55)',
    borderRadius: 999,
    opacity: 0.85,
  },
  handle: { fontFamily: fonts.bodySemi, color: colors.text, includeFontPadding: false },
});
