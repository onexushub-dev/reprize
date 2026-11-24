import type { useVideoPlayer } from 'expo-video';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';

type Props = {
  player: ReturnType<typeof useVideoPlayer>;
  durationMs: number;
  /** Where the useful video starts; the track the cursor moves on begins here. */
  floorMs?: number;
  trim: { startMs: number; endMs: number };
  speed: number;
  /** While a trim handle is dragged the cursor sits on that edge instead of following playback. */
  scrubMs?: number;
  /** The player drags the cursor: where it is now, kept inside the cut. */
  onScrub?: (ms: number) => void;
  onScrubEnd?: () => void;
};

/**
 * The cursor over the trim track: where the video is playing and how many seconds into the result that is.
 * It listens to the player itself, so playback redraws only this view and not the whole screen.
 */
export function Playhead({ player, durationMs, floorMs = 0, trim, speed, scrubMs, onScrub, onScrubEnd }: Props) {
  const { t } = useT();
  const [playingMs, setPlayingMs] = useState(trim.startMs);
  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => setPlayingMs(currentTime * 1000));
    return () => sub.remove();
  }, [player]);

  const at = scrubMs ?? playingMs;
  const [width, setWidth] = useState(0);
  // Pan callbacks read the latest props through this ref (updated after each commit).
  const latest = useRef({ at, width, span: durationMs - floorMs, trim, onScrub, onScrubEnd });
  useLayoutEffect(() => {
    latest.current = { at, width, span: durationMs - floorMs, trim, onScrub, onScrubEnd };
  });
  // eslint-disable-next-line react-hooks/refs -- the ref is only read inside pan callbacks, never during render
  const [pan] = useState(() => {
    let origin = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // Kept to the end of the drag, as the trim handles are.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        origin = latest.current.at;
        latest.current.onScrub?.(origin);
      },
      onPanResponderMove: (_, g) => {
        const { width: w, span, trim: t } = latest.current;
        if (!w) return;
        const ms = Math.min(Math.max(origin + (g.dx / w) * span, t.startMs), t.endMs);
        latest.current.onScrub?.(ms);
      },
      onPanResponderRelease: () => latest.current.onScrubEnd?.(),
      onPanResponderTerminate: () => latest.current.onScrubEnd?.(),
    });
  });
  const span = durationMs - floorMs;
  const share = span > 0 ? Math.min(Math.max((at - floorMs) / span, 0), 1) : 0;
  const elapsed = Math.max(0, (at - trim.startMs) / speed / 1000);

  return (
    <View
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View
        testID="playhead"
        {...pan.panHandlers}
        hitSlop={{ top: 16, bottom: 16 }}
        accessibilityRole="adjustable"
        accessibilityLabel={t('clip.position')}
        style={[styles.hit, { left: `${share * 100}%` }]}>
        <View pointerEvents="none" style={styles.line} />
        <View pointerEvents="none" style={styles.pill}>
          <Text style={styles.time}>{`${elapsed.toFixed(1)}s`}</Text>
        </View>
      </View>
    </View>
  );
}

const PILL = 44;
/** The touch area around the cursor: wide enough for a thumb (the thin line itself is only a mark). */
const HIT = 56;
const styles = StyleSheet.create({
  hit: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: HIT,
    marginLeft: -HIT / 2,
    alignItems: 'center',
  },
  // A little thicker than before (2026-11-20), with a dark edge so it stands out on any frame.
  line: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.35)',
    backgroundColor: colors.text,
  },
  pill: {
    position: 'absolute',
    top: -2,
    width: PILL,
    marginLeft: 0,
    borderRadius: 999,
    backgroundColor: colors.text,
    alignItems: 'center',
    paddingVertical: 1,
  },
  time: { fontFamily: fonts.bodyBold, fontSize: 10, color: colors.ground },
});
