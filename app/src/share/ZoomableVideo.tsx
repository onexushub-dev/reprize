import { Image } from 'expo-image';
import { VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { FocusFollow } from '../focus/useFocusFraming';

import { useT } from '../i18n/useT';
import { turned } from '../clip/stage';

import { NO_ZOOM, type Rotation, type Zoom } from './editing';
import { useZoomGesture } from './useZoomGesture';

type Props = {
  player: React.ComponentProps<typeof VideoView>['player'];
  /** The touch area: the whole preview, bigger than the video so a landscape clip is easy to pinch. */
  area: { width: number; height: number };
  /** Where the video sits inside `area`. */
  box: { left: number; top: number; width: number; height: number };
  /** The saved zoom; the live one is kept here so that a pinch redraws only this view, not the whole screen. */
  zoom: Zoom | undefined;
  /** The player's extra clockwise turn; `box` is the shape after turning. */
  rotation: Rotation;
  onCommit: (zoom: Zoom) => void;
  onTap: () => void;
  /** A clear horizontal flick while not zoomed: 1 for left (next), -1 for right (previous). */
  onSwipe?: (step: 1 | -1) => void;
  /** Modo Foco: the picture follows this moving framing until a gesture takes over (then `onCommit` as usual). */
  follow?: FocusFollow;
  /**
   * The picture's own size inside `box`, centred in it; absent = the box. Seguir a Bola: the video as tall as the 9:16
   * box (so wider than it), moved and scaled by `follow`; "the whole video" is then the picture fitted into the box.
   */
  content?: { width: number; height: number };
  /** When `follow` starts: ease from the whole video into the framing over this long (0 = at once). */
  enterMs?: number;
  /** False in watch mode: no zoom by hand. */
  pinch?: boolean;
  /** The screen's own hold (watch mode: 2x while held); replaces the "whole video" peek. */
  onHold?: (down: boolean) => void;
  /** A sideways drag that may change the clip, as it happens (watch mode). */
  onDrag?: (dx: number) => void;
  /** That drag let go without changing the clip. */
  onDragCancel?: () => void;
  /** A still of the clip shown over the video until its first frame is drawn, so a new clip never opens black. */
  poster?: string;
  onFirstFrame?: () => void;
};

/** The video with pinch zoom (around the fingers), drag to move it, and tap. Remount it to start again from `zoom`. */
export function ZoomableVideo({ player, area, box, zoom, rotation, onCommit, onTap, onSwipe, follow, content, enterMs = 0, pinch, onHold, onDrag, onDragCancel, poster, onFirstFrame }: Props) {
  const { t } = useT();
  const [live, setLive] = useState<Zoom>(zoom ?? NO_ZOOM);
  // A gesture on a followed picture takes over from where the framing is, and the picture stops following.
  // Which framing a gesture took over from: a new framing (Modo Foco turned on again) is followed afresh.
  const [detachedFrom, setDetachedFrom] = useState<FocusFollow | undefined>();
  const detachedNow = useRef<FocusFollow | undefined>(undefined);
  const detached = follow !== undefined && detachedFrom === follow;
  // Holding a finger on a followed picture shows the whole video until it lifts.
  const [peek, setPeek] = useState(false);
  const following = follow !== undefined && !detached;
  const panHandlers = useZoomGesture({
    zoom: live,
    baseZoom: following && follow ? follow.read : undefined,
    box,
    onChange: (next) => {
      if (following) {
        detachedNow.current = follow;
        setDetachedFrom(follow);
      }
      setLive(next);
    },
    // A touch that never moved a followed picture changes nothing.
    onCommit: (next) => {
      if (follow !== undefined && detachedNow.current !== follow) return;
      onCommit(next);
    },
    onTap,
    onSwipe,
    onDrag,
    onDragCancel,
    onHold: onHold ? onHold : following ? setPeek : undefined,
    pinch,
  });

  // 0 = the whole video, 1 = the framing: eases in when following starts.
  const blend = useSharedValue(1);
  // Only a new framing eases in: the ease length changing later (the intro ending) must not start it over.
  const enterRef = useRef(enterMs);
  useEffect(() => {
    enterRef.current = enterMs;
  }, [enterMs]);
  useEffect(() => {
    const duration = enterRef.current;
    if (!follow || duration <= 0) return;
    blend.set(0);
    blend.set(withTiming(1, { duration, easing: Easing.out(Easing.quad) }));
  }, [follow, blend]);

  // The picture's transform runs on the UI thread: the live zoom, or Modo Foco's framing while following.
  const liveScale = useSharedValue(live.scale);
  const liveCx = useSharedValue(live.cx);
  const liveCy = useSharedValue(live.cy);
  useEffect(() => {
    liveScale.set(live.scale);
    liveCx.set(live.cx);
    liveCy.set(live.cy);
  }, [live, liveScale, liveCx, liveCy]);
  const source = following && follow && !peek ? follow : { scale: liveScale, cx: liveCx, cy: liveCy };
  const easing = following && follow && !peek;
  const width = content ? content.width : box.width;
  const height = content ? content.height : box.height;
  // The whole video in the box: scale 1, or (a picture bigger than the box) fitted into it.
  const whole = content ? Math.min(box.width / content.width, box.height / content.height) : 1;
  const place = content
    ? { position: 'absolute' as const, left: (box.width - width) / 2, top: (box.height - height) / 2, width, height }
    : StyleSheet.absoluteFill;
  const picture = useAnimatedStyle(() => {
    // While easing in, the framing grows out of the whole video (centred).
    const b = easing ? blend.value : 1;
    const scale = (peek ? whole : source.scale.value) * b + whole * (1 - b);
    const cx = (peek ? 0.5 : source.cx.value) * b + 0.5 * (1 - b);
    const cy = (peek ? 0.5 : source.cy.value) * b + 0.5 * (1 - b);
    return {
      transform: [{ translateX: (0.5 - cx) * width * scale }, { translateY: (0.5 - cy) * height * scale }, { scale }],
    };
  });

  return (
    <View {...panHandlers} accessibilityLabel={t('clip.video')} style={[styles.area, area]}>
      <View pointerEvents="none" style={[styles.box, box]}>
        <Animated.View style={[place, picture]}>
          <VideoView
            player={player}
            contentFit="contain"
            nativeControls={false}
            style={turned({ width, height }, rotation)}
            onFirstFrameRender={onFirstFrame}
          />
          {poster ? <Image source={{ uri: poster }} contentFit="contain" style={turned({ width, height }, rotation)} /> : null}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  area: { position: 'absolute', left: 0, top: 0 },
  box: { position: 'absolute', overflow: 'hidden' },
});
