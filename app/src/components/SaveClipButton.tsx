import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors } from '../theme/tokens';
import { CheckIcon, SaveLastIcon } from './icons';

type Props = {
  /** How far back a save reaches: shown in the icon and read out. */
  seconds: number;
  label: string;
  onPress: () => void;
  /** Just saved: another save is dropped for a moment, so the button is greyed out and does nothing. */
  cooling?: boolean;
};

const SIZE = 74;
/** The amber stroke runs over the white ring: same centre, same width. */
const STROKE = 4;
const RADIUS = SIZE / 2 - STROKE / 2;
const LENGTH = 2 * Math.PI * RADIUS;
const DRAW_MS = 500;
const CHECK_MS = 800;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * The recording screen's save button (2026-11-21): a white ring with the amber disc, the "back 15 s" mark in it. A press
 * draws an amber stroke round the ring, then the mark turns into a ✓ for a moment (option C): the clip is kept.
 */
export function SaveClipButton({ seconds, label, onPress, cooling = false }: Props) {
  const [drawn] = useState(() => new Animated.Value(0));
  const [done, setDone] = useState(false);
  // From the press to the end of the ✓: the stroke and the ✓ show over the grey.
  const [animating, setAnimating] = useState(false);
  const back = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (back.current !== null) clearTimeout(back.current);
    },
    [],
  );

  function press() {
    onPress();
    if (back.current !== null) clearTimeout(back.current);
    back.current = null;
    setDone(false);
    setAnimating(true);
    drawn.stopAnimation();
    drawn.setValue(0);
    Animated.timing(drawn, { toValue: 1, duration: DRAW_MS, easing: Easing.linear, useNativeDriver: false }).start(
      ({ finished }) => {
        if (!finished) {
          setAnimating(false);
          return;
        }
        setDone(true);
        back.current = setTimeout(() => {
          back.current = null;
          setDone(false);
          setAnimating(false);
          drawn.setValue(0);
        }, CHECK_MS);
      },
    );
  }

  // The stroke and the ✓ show first; the grey takes over once they are gone, until the wait is over.
  const grey = cooling && !animating;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: cooling }}
      disabled={cooling}
      onPress={press}
      style={({ pressed }) => [styles.ring, grey && styles.ringGrey, pressed && styles.pressed]}>
      <Svg pointerEvents="none" width={SIZE} height={SIZE} style={styles.stroke}>
        <AnimatedCircle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={colors.accent}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${LENGTH} ${LENGTH}`}
          strokeDashoffset={drawn.interpolate({ inputRange: [0, 1], outputRange: [LENGTH, 0] })}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </Svg>
      <View testID={done ? 'save-done' : undefined} style={[styles.fill, done && styles.fillDone, grey && styles.fillGrey]}>
        {done ? <CheckIcon size={32} /> : <SaveLastIcon seconds={seconds} size={40} color={grey ? colors.muted : colors.onAccent} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ring: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: STROKE,
    borderColor: colors.text,
    backgroundColor: 'rgba(12,12,12,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { transform: [{ scale: 0.94 }] },
  // Over the border: the SVG sits on the button's outer edge, not inside the border.
  stroke: { position: 'absolute', top: -STROKE, left: -STROKE },
  fill: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  fillDone: { backgroundColor: colors.text },
  ringGrey: { borderColor: colors.border },
  fillGrey: { backgroundColor: colors.surface },
});
