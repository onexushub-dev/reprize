import { Image } from 'expo-image';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { clipNumber } from '../components/format';
import { useClipThumbnail } from '../components/useClipThumbnail';
import type { Clip } from '../data/schema';
import { useT } from '../i18n/useT';
import { colors } from '../theme/tokens';

/** The other clips' frames, narrow; the open clip's wider, as in Photos. */
const THUMB_W = 30;
const CURRENT_W = 50;
const HEIGHT = 46;
const GAP = 2;

type Props = {
  clips: Clip[];
  currentId: string;
  /** A tap on another clip. */
  onPick: (clip: Clip) => void;
};

/**
 * Where the strip was left, so the next clip's screen (a new one) opens it in the same place and slides it to its own
 * clip, instead of starting over and jumping (2026-11-20). Kept per recording (its first clip).
 */
const last = { key: '', x: 0, width: 0 };

/**
 * The recording's clips as a strip of frames under the player (2026-11-20, like Photos): the open clip in the middle,
 * wider. Sliding only looks through them; a tap on one opens it.
 */
export function ClipStrip({ clips, currentId, onPick }: Props) {
  const { t } = useT();
  const key = clips.length > 0 ? clips[0].id : '';
  const same = key === last.key;
  const [width, setWidth] = useState(() => (same ? last.width : 0));
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const at = clips.findIndex((c) => c.id === currentId);
  // With the open clip in the middle, the strip is scrolled by the narrow frames before it.
  const offset = at <= 0 ? 0 : at * (THUMB_W + GAP);
  // Opens where the last screen left it (same recording), else right on this clip.
  const [start] = useState(() => (same ? last.x : offset));

  useEffect(() => {
    if (width <= 0) return;
    last.key = key;
    last.width = width;
    scroll.current?.scrollTo({ x: offset, animated: start !== offset });
  }, [width, offset, key, start]);

  if (clips.length < 2) return null;
  const side = Math.max(0, width / 2 - CURRENT_W / 2);
  return (
    <View
      testID="clip-strip"
      style={styles.wrap}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w !== width) setWidth(w);
      }}>
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: start, y: 0 }}
        scrollEventThrottle={32}
        onScroll={(e) => {
          last.key = key;
          last.x = e.nativeEvent.contentOffset.x;
        }}
        contentContainerStyle={[styles.row, { paddingHorizontal: side }]}>
        {clips.map((clip, i) => (
          <Thumb
            key={clip.id}
            clip={clip}
            current={i === at}
            label={t('clip.stripItem', { number: clipNumber(clip, i) })}
            onPress={() => (i === at ? undefined : onPick(clip))}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Thumb({ clip, current, label, onPress }: { clip: Clip; current: boolean; label: string; onPress: () => void }) {
  const uri = useClipThumbnail(clip.path, clip.trim.startMs);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: current }}
      onPress={onPress}
      style={[styles.thumb, { width: current ? CURRENT_W : THUMB_W }, current ? styles.current : null]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { height: HEIGHT },
  row: { gap: GAP, alignItems: 'center' },
  thumb: { height: HEIGHT, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.surface },
  current: { borderWidth: 2, borderColor: colors.accent, borderRadius: 6 },
});
