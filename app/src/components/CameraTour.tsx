import { type ReactNode, useState } from 'react';
import { Pressable, type StyleProp, StyleSheet, Text, useWindowDimensions, View, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import type { TourRect } from './CameraBar';

/**
 * One tip of the tour: the control it points at and what it says. `body` takes **bold** parts. Without a target the tip
 * points at nothing: the whole screen dims and the card sits in the middle (the "grave deitado" tip, 2026-11-27).
 */
export type TourStep = {
  key: string;
  target?: TourRect;
  /** The record button is round: its hole is a circle. */
  round?: boolean;
  title: string;
  body: string;
  /**
   * Small labelled chips under the text (the triggers' tip: Apple Watch, Controle, Aceno, Voz). A `highlight` chip is
   * amber with dark text (the Apple Watch, 2026-11-27); its icon should be drawn in `colors.onAccent`.
   */
  chips?: { label: string; icon: ReactNode; highlight?: boolean }[];
  /** Before the count, as "Dica extra · 5 de 5". */
  label?: string;
  /** A drawing above the count. */
  art?: ReactNode;
};

type Props = {
  steps: TourStep[];
  /** "Pular" or "Entendi" on the last tip: the tour is over for good. */
  onDone: () => void;
  /**
   * The tip shown, kept by the caller (2026-11-27): the tour is drawn again when the phone turns, and must come back on
   * the same tip. Without it the tour keeps its own.
   */
  index?: number;
  onIndex?: (index: number) => void;
  /**
   * The phone on its side (2026-11-27): the app stays in portrait, so the card is drawn in a frame turned a quarter to
   * stand upright for the player, beside the bar (`inset` points from the phone's bottom edge), as the panels are. The
   * dim and the ring stay on the screen, around the control where it is.
   */
  turned?: { turn: 90 | -90; inset: number };
};

/** Room around the control inside the amber ring. */
const PAD = 6;
/** Between the card and the control it points at: a little higher (2026-11-22), so the card reads as floating. */
const GAP = 30;
/** A lighter edge than the panels', so the card stands out from the dimmed camera. */
const EDGE = 'rgba(255,255,255,0.28)';
const SIDE = 16;
const CARET = 16;
/** On its side: the card's widest, and the room left on the notch's side (as the panels'). */
const TURNED_WIDTH = 380;
const TURNED_NOTCH = 52;

/**
 * The first-time tour of the camera (2026-11-22, model A on the canvas): the screen dims but one control, ringed in
 * amber, and a card above it says what it is for, one at a time ("1 de 5" … "5 de 5"), with Pular and Próximo. Only
 * explains: the controls stay as they are, nothing is set for the player. A tip without a target dims the whole screen.
 */
export function CameraTour({ steps, onDone, index: shownIndex, onIndex, turned }: Props) {
  const { t } = useT();
  const screen = useWindowDimensions();
  const [ownIndex, setOwnIndex] = useState(0);
  const index = shownIndex ?? ownIndex;
  const setIndex = (next: number) => {
    setOwnIndex(next);
    onIndex?.(next);
  };
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const { target } = step;
  const hole =
    target === undefined
      ? undefined
      : { x: target.x - PAD, y: target.y - PAD, width: target.width + PAD * 2, height: target.height + PAD * 2 };
  // A pill's ends are round whichever way it stands (on its side it is taller than wide).
  const r = hole === undefined ? 0 : Math.min(hole.width, hole.height) / 2;
  const centre = target === undefined ? screen.width / 2 : target.x + target.width / 2;
  const caretLeft = Math.max(12, Math.min(screen.width - SIDE * 2 - CARET - 12, centre - SIDE - CARET / 2));
  const count = { n: index + 1, total: steps.length };
  // On its side the frame is short (the phone's width): the drawing of a phone turning is left out, it is already turned.
  const art = turned === undefined ? step.art : undefined;
  // Four chips go two by two, equal (2026-11-27: "Voz" fell alone on a line); fewer stay on one line.
  const chipRows = step.chips === undefined ? [] : step.chips.length > 3 ? pairs(step.chips) : [step.chips];

  function card(place: StyleProp<ViewStyle>, caret: boolean) {
    return (
      <View accessible={false} style={[styles.card, place]} testID="camera-tour-card">
        {caret ? <View testID="camera-tour-caret" style={[styles.caret, { left: caretLeft }]} /> : null}
        {art === undefined ? null : <View style={styles.art}>{art}</View>}
        <Text style={styles.count}>
          {step.label !== undefined ? t('cameraTour.countLabelled', { label: step.label, ...count }) : t('cameraTour.count', count)}
        </Text>
        <Text accessibilityRole="header" style={styles.title}>
          {step.title}
        </Text>
        <Text style={styles.body}>{withBold(step.body)}</Text>
        {chipRows.length === 0 ? null : (
          <View testID="camera-tour-chips" style={styles.chips}>
            {chipRows.map((row) => (
              <View key={row.map((chip) => chip.label).join()} testID="camera-tour-chip-row" style={styles.chipRow}>
                {row.map((chip) => (
                  <View
                    key={chip.label}
                    testID={chip.highlight === true ? 'camera-tour-chip-highlight' : 'camera-tour-chip'}
                    style={[styles.chip, chip.highlight === true && styles.chipHighlight]}>
                    {chip.icon}
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                      style={[styles.chipText, chip.highlight === true && styles.chipTextHighlight]}>
                      {chip.label}
                    </Text>
                  </View>
                ))}
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
          <Pressable accessibilityRole="button" onPress={last ? onDone : () => setIndex(index + 1)} style={styles.next}>
            <Text style={styles.nextText}>{last ? t('cameraTour.done') : t('cameraTour.next')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View testID="camera-tour" style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Svg width={screen.width} height={screen.height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path
          d={hole === undefined ? `M0 0H${screen.width}V${screen.height}H0Z` : dimWithHole(screen.width, screen.height, hole, r)}
          fill="rgba(0,0,0,0.72)"
          fillRule="evenodd"
        />
      </Svg>
      {/* Touches on the dimmed camera do nothing while a tip is open. */}
      <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={() => {}} />
      {hole === undefined ? null : (
        <View
          testID="camera-tour-ring"
          pointerEvents="none"
          style={[styles.ring, { left: hole.x, top: hole.y, width: hole.width, height: hole.height, borderRadius: r }]}
        />
      )}
      {turned !== undefined ? (
        // On its side: upright for the player, beside the bar, in the middle of the turned frame; no caret.
        <View
          testID="camera-tour-frame"
          pointerEvents="box-none"
          style={[
            styles.frame,
            {
              width: screen.height,
              height: screen.width,
              left: (screen.width - screen.height) / 2,
              top: (screen.height - screen.width) / 2,
              transform: [{ rotate: `${turned.turn}deg` }],
            },
          ]}>
          <View
            pointerEvents="box-none"
            style={[
              styles.turnedDock,
              {
                [turned.turn === 90 ? 'right' : 'left']: turned.inset,
                width: Math.min(TURNED_WIDTH, screen.height - turned.inset - TURNED_NOTCH),
              },
            ]}>
            {card(undefined, false)}
          </View>
        </View>
      ) : hole === undefined ? (
        // Pointing at nothing: the card in the middle of the screen.
        <View pointerEvents="box-none" style={styles.middle}>
          {card(styles.cardMiddle, false)}
        </View>
      ) : (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {card([styles.cardAnchored, { bottom: screen.height - hole.y + GAP - CARET / 2 }], true)}
        </View>
      )}
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

/** Two by two: [a, b, c, d] → [[a, b], [c, d]]. */
function pairs<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
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
  frame: { position: 'absolute' },
  turnedDock: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  middle: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'center' },
  // Pointing at a control: pinned above it, 16pt from either edge.
  cardAnchored: { position: 'absolute', left: SIDE, right: SIDE },
  // Pointing at nothing: in the flow of the centring wrapper, so no left/right offset can push it sideways.
  cardMiddle: { marginHorizontal: SIDE },
  art: {
    height: 136,
    borderRadius: 12,
    backgroundColor: colors.ground,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 6,
  },
  count: { fontFamily: fonts.bodyBold, fontSize: 12.5, letterSpacing: 0.4, color: colors.accent, textTransform: 'uppercase' },
  title: { fontFamily: fonts.bodyBold, fontSize: 19, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.muted },
  bold: { fontFamily: fonts.bodyBold, color: colors.text },
  // Equal chips, icon and label in the middle; the padding is tight enough for "Apple Watch" two by two, and "Controle"
  // three in a row, on a 320pt screen without wrapping (the label shrinks a little rather than cut, as a last resort).
  chips: { gap: 8 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 34,
    paddingHorizontal: 6,
    borderRadius: 17,
    backgroundColor: colors.ground,
  },
  chipHighlight: { backgroundColor: colors.accent },
  chipText: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text },
  chipTextHighlight: { color: colors.onAccent },
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
