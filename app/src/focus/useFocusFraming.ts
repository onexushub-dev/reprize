import type { useVideoPlayer } from 'expo-video';
import { useEffect, useMemo } from 'react';
import { Easing, type SharedValue, useSharedValue, withTiming } from 'react-native-reanimated';

import type { FocusTrack } from '../data/focusFile';
import type { Zoom } from '../share/editing';
import { framingAt } from './framing';

type Player = ReturnType<typeof useVideoPlayer>;

/** The moving framing, read on the UI thread by `ZoomableVideo`. */
export type FocusFollow = {
  scale: SharedValue<number>;
  cx: SharedValue<number>;
  cy: SharedValue<number>;
  /** Jump to the framing of clip time `tMs` (seek, scrub, pause). */
  sync(tMs: number): void;
  /** The framing shown now (for a pinch that takes over). */
  read(): Zoom;
};

const STEP_MS = 100;
/** A time change this far from the expected step is a jump (loop, seek), not playback. */
const JUMP_S = 0.3;

/**
 * Drives the framing from the player's time: each `timeUpdate` (every 0.1 s) glides to where the path will be at the next
 * one, so the picture moves continuously. Undefined when Modo Foco is off or there is no track.
 */
export function useFocusFraming(
  player: Player,
  track: FocusTrack | undefined,
  enabled: boolean,
  fit: 'width' | 'height' = 'width',
): FocusFollow | undefined {
  const scale = useSharedValue(1);
  const cx = useSharedValue(0.5);
  const cy = useSharedValue(0.5);
  const active = enabled && track !== undefined;

  useEffect(() => {
    if (!active || !track) return;
    const set = (z: Zoom) => {
      scale.set(z.scale);
      cx.set(z.cx);
      cy.set(z.cy);
    };
    set(framingAt(track, player.currentTime * 1000, fit));
    let last = player.currentTime;
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      const rate = player.playbackRate > 0 ? player.playbackRate : 1;
      const step = (STEP_MS / 1000) * rate;
      const jumped = Math.abs(currentTime - (last + step)) > JUMP_S;
      last = currentTime;
      // The cut looping back or a seek: be there at once, never pan across the court.
      if (jumped) return set(framingAt(track, currentTime * 1000, fit));
      const z = framingAt(track, (currentTime + step) * 1000, fit);
      const glide = { duration: STEP_MS, easing: Easing.linear };
      scale.set(withTiming(z.scale, glide));
      cx.set(withTiming(z.cx, glide));
      cy.set(withTiming(z.cy, glide));
    });
    return () => sub.remove();
  }, [active, track, player, scale, cx, cy, fit]);

  // One object per track and switch, so the video view keeps following across re-renders.
  return useMemo<FocusFollow | undefined>(() => {
    if (!active || !track) return undefined;
    return {
      scale,
      cx,
      cy,
      sync: (tMs) => {
        const z = framingAt(track, tMs, fit);
        scale.set(z.scale);
        cx.set(z.cx);
        cy.set(z.cy);
      },
      read: () => ({ scale: scale.get(), cx: cx.get(), cy: cy.get() }),
    };
  }, [active, track, scale, cx, cy, fit]);
}
