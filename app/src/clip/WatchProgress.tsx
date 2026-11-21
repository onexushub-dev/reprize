import type { useVideoPlayer } from 'expo-video';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { MutedIcon, PauseIcon, PlayIcon, SoundIcon } from '../components/icons';
import { seconds } from '../components/format';
import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';

type Props = {
  player: ReturnType<typeof useVideoPlayer>;
  trim: { startMs: number; endMs: number };
  speed: number;
  playing: boolean;
  onTogglePlay: () => void;
  /** The finger on the bar: where in the clip (kept inside the cut). */
  onSeek: (ms: number) => void;
  onSeekEnd: () => void;
  /** The sound is off: the clip's own (an edit) or the player's mute. */
  muted?: boolean;
  /** The player's mute, at the row's end (2026-11-20, like Photos); none when the clip itself has no sound. */
  onToggleMute?: () => void;
};

/** Watch mode's thin bar over the cut: play/pause, where the video is, drag to move through it. */
export function WatchProgress({ player, trim, speed, playing, onTogglePlay, onSeek, onSeekEnd, muted = false, onToggleMute }: Props) {
  const { t } = useT();
  const [atMs, setAtMs] = useState(trim.startMs);
  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => setAtMs(currentTime * 1000));
    return () => sub.remove();
  }, [player]);

  const [width, setWidth] = useState(0);
  const latest = useRef({ width, trim, onSeek, onSeekEnd });
  useLayoutEffect(() => {
    latest.current = { width, trim, onSeek, onSeekEnd };
  });
  // eslint-disable-next-line react-hooks/refs -- the ref is only read inside pan callbacks, never during render
  const [pan] = useState(() => {
    const at = (x: number) => {
      const { width: w, trim: t } = latest.current;
      const share = w > 0 ? Math.min(Math.max(x / w, 0), 1) : 0;
      return t.startMs + share * (t.endMs - t.startMs);
    };
    // Where the finger landed on the bar, then how far it moved: a move's own `locationX` is relative to whatever view is
    // under the finger (the knob), so it is not used.
    let origin = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        origin = e.nativeEvent.locationX;
        latest.current.onSeek(at(origin));
      },
      onPanResponderMove: (_, g) => latest.current.onSeek(at(origin + g.dx)),
      onPanResponderRelease: () => latest.current.onSeekEnd(),
      onPanResponderTerminate: () => latest.current.onSeekEnd(),
    });
  });

  const span = trim.endMs - trim.startMs;
  const share = span > 0 ? Math.min(Math.max((atMs - trim.startMs) / span, 0), 1) : 0;
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? t('clip.pause') : t('clip.play')}
        onPress={onTogglePlay}
        style={styles.play}>
        {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
      </Pressable>
      <View
        {...pan.panHandlers}
        accessibilityLabel={t('clip.positionInClip')}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={styles.hit}>
        <View pointerEvents="none" style={styles.track}>
          <View style={[styles.fill, { width: `${share * 100}%` }]} />
        </View>
        <View pointerEvents="none" style={[styles.knob, { left: share * width - 7 }]} />
      </View>
      <Text style={styles.time}>{seconds(Math.max(0, atMs - trim.startMs) / speed)}</Text>
      {onToggleMute ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={muted ? t('clip.unmuteWatch') : t('clip.muteWatch')}
          accessibilityState={{ selected: muted }}
          hitSlop={8}
          onPress={onToggleMute}
          style={styles.mute}>
          {muted ? <MutedIcon size={20} /> : <SoundIcon size={20} />}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  play: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hit: { flex: 1, height: 32, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.text },
  knob: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: colors.text, top: 9 },
  mute: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  time: { fontFamily: fonts.body, fontSize: 12, color: colors.soft, minWidth: 34, textAlign: 'right' },
});
