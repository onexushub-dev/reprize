import { type ReactNode, useState } from 'react';
import {
  Animated,
  type GestureResponderEvent,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from 'react-native';

import { useReduceMotion } from './useReduceMotion';

/**
 * The look of the app's auxiliary buttons (2026-11-22, after the iPhone's Photos): a dark grey body with a fine light
 * rim, brighter along the top as if lit from above. `overlay` is the see-through body for buttons over a video or the
 * camera.
 */
export const GLASS = {
  fill: '#262626',
  overlay: 'rgba(28,28,28,0.72)',
  rim: 'rgba(255,255,255,0.10)',
  rimTop: 'rgba(255,255,255,0.24)',
  /** Laid over the body while the finger is on it. */
  glow: 'rgba(255,255,255,0.16)',
};

/** How the button answers a touch, as on the iPhone: it grows a little and lights up, then settles back with a spring. */
const PRESSED_SCALE = 1.08;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style' | 'children'> & {
  /** Size, shape and place of the button; a background colour here (an "on" state) replaces the body's. */
  style?: StyleProp<ViewStyle>;
  /** `bare`: no body or rim, only the press feedback (an icon that stands on its own, as beside Gravar). */
  variant?: 'solid' | 'overlay' | 'bare';
  children: ReactNode;
};

/**
 * An auxiliary button (back, close, "…", delete, share, filters…) in the app's glass look, with the iPhone's press
 * feedback: a quick grow and glow on touch, a soft spring back on release. Only scale and opacity animate, on the native
 * driver, so the feedback never waits on JavaScript. With Reduce Motion on, it only lights up.
 */
export function GlassButton({ style, variant = 'solid', children, onPressIn, onPressOut, ...rest }: Props) {
  const reduce = useReduceMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const [glow] = useState(() => new Animated.Value(0));
  const flat = StyleSheet.flatten(style) || {};
  const radius = typeof flat.borderRadius === 'number' ? flat.borderRadius : 999;

  const bare = variant === 'bare';

  function press(event: GestureResponderEvent) {
    if (!bare) Animated.timing(glow, { toValue: 1, duration: 90, useNativeDriver: true }).start();
    if (!reduce) Animated.spring(scale, { toValue: PRESSED_SCALE, speed: 50, bounciness: 0, useNativeDriver: true }).start();
    if (onPressIn) onPressIn(event);
  }

  function release(event: GestureResponderEvent) {
    if (!bare) Animated.timing(glow, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    if (!reduce) Animated.spring(scale, { toValue: 1, speed: 14, bounciness: 10, useNativeDriver: true }).start();
    if (onPressOut) onPressOut(event);
  }

  return (
    <AnimatedPressable
      accessibilityRole="button"
      {...rest}
      onPressIn={press}
      onPressOut={release}
      style={[
        bare ? styles.bare : [styles.base, variant === 'overlay' ? styles.overlay : styles.solid],
        style,
        { transform: [{ scale }] },
      ]}>
      {bare ? null : <Animated.View pointerEvents="none" style={[styles.glow, { borderRadius: radius, opacity: glow }]} />}
      {children}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: GLASS.rim,
    borderTopColor: GLASS.rimTop,
  },
  bare: { alignItems: 'center', justifyContent: 'center' },
  solid: { backgroundColor: GLASS.fill },
  overlay: { backgroundColor: GLASS.overlay },
  glow: { position: 'absolute', top: -1, right: -1, bottom: -1, left: -1, backgroundColor: GLASS.glow },
});
