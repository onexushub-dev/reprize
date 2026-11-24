import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import type { TourRect } from './CameraBar';

/** One tip of the tour: the control it points at and what it says. `body` takes **bold** parts. */
export type TourStep = {
  key: string;
  target: TourRect;
  /** The record button is round: its hole is a circle. */
  round?: boolean;
  title: string;
  body: string;
  /** Small labelled chips under the text (the triggers' tip: Controle, Aceno, Voz). */
  chips?: { label: string; icon: ReactNode }[];
};

type Props = {
  steps: TourStep[];
  /** "Pular" or "Entendi" on the last tip: the tour is over for good. */
  onDone: () => void;
};

/** Room around the control inside the amber ring. */
const PAD = 6;
/** Between the card and the control it points at: a little higher (2026-11-22), so the card reads as floating. */
const GAP = 30;
/** A lighter edge than the panels', so the card stands out from the dimmed camera. */
const EDGE = 'rgba(255,255,255,0.28)';
const SIDE = 16;
const CARET = 16;

/**
 * The first-time tour of the camera (2026-11-22, model A on the canvas): the screen dims but one control, ringed in
 * amber, and a card above it says what it is for, one at a time ("1 de 4" … "4 de 4"), with Pular and Próximo. Only
 * explains: the controls stay as they are, nothing is set for the player.
 */
export function CameraTour({ steps, onDone }: Props) {
  const { t } = useT();
  const screen = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const { target } = step;
  const hole = {
    x: target.x - PAD,
    y: target.y - PAD,
    width: target.width + PAD * 2,
    height: target.height + PAD * 2,
  };
  const r = step.round === true ? hole.width / 2 : hole.height / 2;
  const centre = target.x + target.width / 2;
  const caretLeft = Math.max(12, Math.min(screen.width - SIDE * 2 - CARET - 12, centre - SIDE - CARET / 2));
  return (
    <View testID="camera-tour" style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Svg width={screen.width} height={screen.height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path d={dimWithHole(screen.width, screen.height, hole, r)} fill="rgba(0,0,0,0.72)" fillRule="evenodd" />
      </Svg>
      {/* Touches on the dimmed camera do nothing while a tip is open. */}
      <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={() => {}} />
      <View
        pointerEvents="none"
        style={[styles.ring, { left: hole.x, top: hole.y, width: hole.width, height: hole.height, borderRadius: r }]}
      />
      <View
        accessible={false}
        style={[styles.card, { bottom: screen.height - hole.y + GAP - CARET / 2 }]}
        testID="camera-tour-card">
        <View style={[styles.caret, { left: caretLeft }]} />
        <Text style={styles.count}>{t('cameraTour.count', { n: index + 1, total: steps.length })}</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {step.title}
        </Text>
        <Text style={styles.body}>{withBold(step.body)}</Text>
        {step.chips === undefined ? null : (
          <View style={styles.chips}>
            {step.chips.map((chip) => (
              <View key={chip.label} style={styles.chip}>
                {chip.icon}
                <Text style={styles.chipText}>{chip.label}</Text>
              </View>
            ))}
          </View>
        )}
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onDone} style={styles.skip}>
            <Text style={styles.skipText}>{t('cameraTour.skip')}</Text>
          </Pressable>
          <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {steps.map((s, i) => (
              <View key={s.key} style={[styles.dot, i === index && styles.dotOn]} />
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={last ? onDone : () => setIndex(index + 1)}
            style={styles.next}>
            <Text style={styles.nextText}>{last ? t('cameraTour.done') : t('cameraTour.next')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** The whole screen with a rounded hole (even-odd fill: the hole stays clear). */
export function dimWithHole(width: number, height: number, hole: TourRect, radius: number): string {
  const { x, y } = hole;
  const w = hole.width;
  const h = hole.height;
  const rr = Math.min(radius, w / 2, h / 2);
  return (
    `M0 0H${width}V${height}H0Z ` +
    `M${x + rr} ${y}H${x + w - rr}A${rr} ${rr} 0 0 1 ${x + w} ${y + rr}V${y + h - rr}A${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h}` +
    `H${x + rr}A${rr} ${rr} 0 0 1 ${x} ${y + h - rr}V${y + rr}A${rr} ${rr} 0 0 1 ${x + rr} ${y}Z`
  );
}

/** "**Full HD**: …" → the starred part in bold white. */
function withBold(text: string): ReactNode[] {
  return text.split('**').map((part, i) =>
    i % 2 === 1 ? (
      <Text key={i} style={styles.bold}>
        {part}
      </Text>
    ) : (
      part
    ),
  );
}

const styles = StyleSheet.create({
  ring: { position: 'absolute', borderWidth: 2, borderColor: colors.accent },
  card: {
    position: 'absolute',
    left: SIDE,
    right: SIDE,
    backgroundColor: '#1A1A1A',
    borderWidth: 1.5,
    borderColor: EDGE,
    borderRadius: 18,
    padding: 16,
    gap: 8,
    shadowColor: '#000000',
    shadowOpacity: 0.7,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
  },
  caret: {
    position: 'absolute',
    bottom: -CARET / 2,
    width: CARET,
    height: CARET,
    backgroundColor: '#1A1A1A',
    borderRightWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: EDGE,
    transform: [{ rotate: '45deg' }],
  },
  count: { fontFamily: fonts.bodyBold, fontSize: 12.5, letterSpacing: 0.4, color: colors.accent, textTransform: 'uppercase' },
  title: { fontFamily: fonts.bodyBold, fontSize: 19, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.muted },
  bold: { fontFamily: fonts.bodyBold, color: colors.text },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    backgroundColor: colors.ground,
  },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  skip: { minHeight: 40, justifyContent: 'center' },
  skipText: { fontFamily: fonts.bodySemi, fontSize: 14.5, color: '#8A8A8A' },
  dots: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4A4A4A' },
  dotOn: { width: 16, backgroundColor: colors.accent },
  next: {
    height: 40,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: colors.accent,
    justifyContent: 'center',
  },
  nextText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.onAccent },
});
