import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '../theme/tokens';
import { useReduceMotion } from './useReduceMotion';

/**
 * The two phones of "grave deitado" (design-bola-vertical, 2026-11-27): upright, its video already the whole screen
 * (`framed`: the amber edge says so), and sideways, with Bola's 9:16 window free to move left and right (it glides there, following a ball). Drawings only.
 */
export function PhoneUpright({ framed = false }: { framed?: boolean }) {
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.body, styles.upright]}>
      <View style={[styles.screen, framed ? styles.framed : null]} />
      <View style={[styles.notch, styles.notchTop]} />
    </View>
  );
}

/**
 * Sideways, Foco at work: a ball dot rolls left and right and the 9:16 window (with its < > chevrons) follows it a beat
 * behind, so the window always ends up around the ball. One linear clock (CYCLE_MS) drives both through eased
 * segments: each leg of the window takes 1.2 s, then it rests 0.4 s at the side before turning back. Reduce motion:
 * still, window and ball in the middle.
 */
export const SIDEWAYS_CYCLE_MS = 3200;
// The screen is 120 pt wide (132 minus border and padding); the window is 30 pt with a chevron 4 pt off each side,
// so ±TRAVEL keeps the chevrons on screen and clear of the notch.
const TRAVEL = 26;
const EASE = Easing.inOut(Easing.quad);
const STOPS = [-TRAVEL, -TRAVEL, TRAVEL, TRAVEL, -TRAVEL, -TRAVEL];
const WINDOW_AT = [0, 0.1, 0.475, 0.6, 0.975, 1];
const BALL_AT = [0, 0.04, 0.4, 0.54, 0.9, 1];

export function PhoneSideways() {
  const reduce = useReduceMotion();
  const [clock] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) return;
    clock.setValue(0);
    const loop = Animated.loop(
      Animated.timing(clock, { toValue: 1, duration: SIDEWAYS_CYCLE_MS, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, clock]);
  const along = (at: number[]) =>
    reduce ? undefined : { transform: [{ translateX: clock.interpolate({ inputRange: at, outputRange: STOPS, easing: EASE }) }] };

  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.body, styles.sideways]}>
      <View style={styles.screen}>
        <Animated.View testID="sideways-ball" style={[styles.ball, along(BALL_AT)]} />
        <Animated.View testID="sideways-window" style={[styles.window, along(WINDOW_AT)]}>
          <View style={styles.crop} />
          <Chevron left style={{ left: 0 }} />
          <Chevron style={{ right: 0 }} />
        </Animated.View>
      </View>
      <View style={[styles.notch, styles.notchSide]} />
    </View>
  );
}

function Chevron({ left = false, style }: { left?: boolean; style: { left: number } | { right: number } }) {
  return (
    <Svg width={8} height={10} viewBox="0 0 8 10" fill="none" style={[styles.chevron, style]}>
      <Path
        d={left ? 'M6 1L2 5l4 4' : 'M2 1l4 4-4 4'}
        stroke={colors.accent}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  body: { backgroundColor: '#1F1F1F', borderWidth: 2, borderRadius: 14, padding: 4 },
  upright: { width: 56, height: 104, borderColor: '#4A4A4A' },
  sideways: { width: 132, height: 68, borderColor: '#D9D9D9' },
  screen: { flex: 1, borderRadius: 9, overflow: 'hidden', backgroundColor: colors.surface },
  framed: { borderWidth: 2, borderColor: colors.accent },
  notch: { position: 'absolute', borderRadius: 2, backgroundColor: colors.ground },
  notchTop: { top: 7, left: 18, width: 16, height: 4 },
  notchSide: { left: 7, top: 24, width: 4, height: 16 },
  // Window (30 pt) plus a 4 pt gap and an 8 pt chevron each side, centred on the 120 pt screen.
  window: { position: 'absolute', top: 0, bottom: 0, left: 33, width: 54 },
  crop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 12,
    width: 30,
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: 4,
    backgroundColor: 'rgba(255,176,0,0.12)',
  },
  ball: { position: 'absolute', top: 30, left: 57, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.text },
  chevron: { position: 'absolute', top: '50%', marginTop: -5 },
});

/** The camera tour's "grave deitado" tip: upright → turn → sideways, with Bola's window. */
export function TurnPhoneArt() {
  return (
    <>
      <PhoneUpright />
      <Svg width={40} height={30} viewBox="0 0 40 30" fill="none">
        <Path d="M4 24C8 9 25 4 34 14" stroke={colors.accent} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M35.5 5.5l-1 8.5-8.5-1" stroke={colors.accent} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      <PhoneSideways />
    </>
  );
}
