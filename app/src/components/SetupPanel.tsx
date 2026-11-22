import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  type GestureResponderEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';

import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { CloseIcon, InfoIcon } from './icons';
import { ProBadge } from './ProBadge';

/**
 * The camera's setting panels (2026-11-22, after Lens Buddy): each of the three buttons over the record button (clip
 * length → quality → triggers) opens its panel just above them, over the camera. A title, a ✕, then groups of options
 * on a lighter grey, and a note on what the choice means.
 */

/** A step lighter than the surface each time: the panel, its groups, and the options (darker, to stand out). */
const PANEL = '#1A1A1A';
const GROUP = '#242424';
const OPTION = '#121212';
const OFF = '#2C2C2C';
const OK = colors.ok;

type PanelProps = {
  title: string;
  onClose: () => void;
  /**
   * Where it sits: upright, above the button bar (bottom, sides, the most height it may take: it scrolls past that);
   * on its side, beside the column (the caller centres it).
   */
  place: ViewStyle;
  /**
   * The phone on its side: the panel is drawn turned a quarter, so a sideways swipe on it is up or down on the screen
   * (touches come in the screen's own directions).
   */
  turn?: 0 | 90 | -90;
  children: ReactNode;
  testID?: string;
  /**
   * Swiping sideways goes to the next or previous panel (2026-11-22): left → the next setting (clip → quality →
   * triggers), right → the previous one. Without it the panel does not follow a swipe (the trigger test).
   */
  onSwipe?: (to: 'next' | 'previous') => void;
  /** Where this panel sits among those a swipe goes through: drawn as dots by the title. */
  page?: { index: number; count: number };
};

/**
 * Swiping between panels feels like swiping between clips (2026-11-22, the clip screen's numbers): the panel follows the
 * finger, gives only a little where there is nothing on that side, and leaves to one side while the next one comes in
 * from the other. It changes past SWIPE_SHARE of the screen (or SWIPE_MIN points), or on a flick of FLICK_MIN points at
 * FLICK_VX; it takes the touch once it leans sideways by SIDEWAYS, so taps and the vertical scroll keep working.
 */
const SWIPE_START = 12;
const SIDEWAYS = 1.2;
const SWIPE_MIN = 50;
const SWIPE_SHARE = 0.18;
const FLICK_VX = 0.3;
const FLICK_MIN = 16;
const RUBBER = 0.3;
const SLIDE_MS = 220;

/** The side the next panel comes in from (set as the last one leaves; read once by the new one). */
let enterFrom: -1 | 0 | 1 = 0;

type Touch = { x: number; y: number; lastDx: number; lastT: number; vx: number };

export function SetupPanel({ title, onClose, place, turn = 0, children, testID, onSwipe, page }: PanelProps) {
  const { t } = useT();
  const screen = useWindowDimensions();
  // How far the panel leaves to the side: the width it is drawn across (the screen's height when turned).
  const width = turn === 0 ? screen.width : screen.height;
  /** A finger's move from where it went down, in the panel's own directions. */
  const moved = (e: GestureResponderEvent, from: { x: number; y: number }) => {
    const x = e.nativeEvent.pageX - from.x;
    const y = e.nativeEvent.pageY - from.y;
    if (turn === 90) return { dx: y, dy: -x };
    if (turn === -90) return { dx: -y, dy: x };
    return { dx: x, dy: y };
  };
  const [slide] = useState(() => new Animated.Value(enterFrom * width));
  useEffect(() => {
    if (enterFrom === 0) return;
    enterFrom = 0;
    Animated.timing(slide, { toValue: 0, duration: SLIDE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [slide]);
  // Plain touch handlers, no PanResponder: the panel claims the touch only once it leans sideways, so an option under
  // a swipe gives the touch up and is not picked.
  const touch = useRef<Touch | null>(null);
  const open = (dx: number) => page !== undefined && (dx < 0 ? page.index < page.count - 1 : page.index > 0);
  const sideways = (e: GestureResponderEvent) => {
    if (touch.current === null) return false;
    const { dx, dy } = moved(e, touch.current);
    return Math.abs(dx) > SWIPE_START && Math.abs(dx) > SIDEWAYS * Math.abs(dy);
  };
  const settleBack = () => Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 20 }).start();
  const swipe =
    onSwipe === undefined
      ? {}
      : {
          onTouchStart: (e: GestureResponderEvent) => {
            const { pageX, pageY } = e.nativeEvent;
            touch.current = { x: pageX, y: pageY, lastDx: 0, lastT: Date.now(), vx: 0 };
          },
          onMoveShouldSetResponderCapture: sideways,
          onResponderTerminationRequest: () => false,
          onResponderMove: (e: GestureResponderEvent) => {
            const now = touch.current;
            if (now === null) return;
            const { dx } = moved(e, now);
            const at = Date.now();
            if (at > now.lastT) now.vx = (dx - now.lastDx) / (at - now.lastT);
            now.lastDx = dx;
            now.lastT = at;
            slide.setValue(open(dx) ? dx : dx * RUBBER);
          },
          onResponderRelease: (e: GestureResponderEvent) => {
            const now = touch.current;
            touch.current = null;
            if (now === null) return;
            const { dx } = moved(e, now);
            const far = Math.abs(dx) > Math.max(SWIPE_MIN, width * SWIPE_SHARE);
            // A flick in the drag's own direction; a finger pulled back at the end means "stay".
            const flick = Math.abs(now.vx) > FLICK_VX && Math.abs(dx) > FLICK_MIN && Math.sign(now.vx) === Math.sign(dx);
            const backwards = Math.abs(now.vx) > FLICK_VX && Math.sign(now.vx) !== Math.sign(dx);
            if (!((far && !backwards) || flick) || !open(dx)) return settleBack();
            const step = dx < 0 ? 1 : -1;
            Animated.timing(slide, {
              toValue: -step * width,
              duration: SLIDE_MS,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }).start(() => {
              enterFrom = step;
              onSwipe(step === 1 ? 'next' : 'previous');
            });
          },
          onResponderTerminate: () => {
            touch.current = null;
            settleBack();
          },
        };
  return (
    <Animated.View
      testID={testID}
      style={[styles.panel, place, { transform: [{ translateX: slide }] }]}
      {...swipe}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {page === undefined || page.count < 2 ? null : (
          <View style={styles.pages} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {Array.from({ length: page.count }, (_, i) => (
              <View key={i} style={[styles.page, i === page.index && styles.pageOn]} />
            ))}
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          hitSlop={10}
          onPress={onClose}
          style={styles.close}>
          <CloseIcon size={16} color="#D8D8D8" />
        </Pressable>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} bounces={false} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </Animated.View>
  );
}

export function PanelGroup({ label, children, style }: { label?: string; children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.group, style]}>
      {label === undefined ? null : <Text style={styles.groupLabel}>{label}</Text>}
      {children}
    </View>
  );
}

type OptionProps = {
  label: string;
  selected?: boolean;
  /** A paid choice the player does not have: greyed text; a press opens the paywall (the caller's `onPress`). */
  locked?: boolean;
  /** Read out after the label when locked (the "Pro" mark is drawn by the group around it). */
  lockedHint?: string;
  icon?: (color: string) => ReactNode;
  /** A second, smaller line under the label (the quality's frame rate). */
  sub?: string;
  small?: boolean;
  onPress: () => void;
};

/** One choice in a row of them (clip length, sound, flash): amber when picked. */
export function PanelOption({ label, selected = false, locked = false, lockedHint, icon, sub, small = false, onPress }: OptionProps) {
  const color = selected ? colors.onAccent : locked ? '#9A9A9A' : colors.text;
  const a11y = [label, sub, locked ? lockedHint : undefined].filter((part) => part !== undefined).join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.option, small && styles.optionSmall, selected && styles.optionSelected]}>
      {icon === undefined ? null : icon(color)}
      {sub === undefined ? (
        <Text style={[styles.optionText, small && styles.optionTextSmall, { color }]}>{label}</Text>
      ) : (
        <View style={styles.optionLines}>
          <Text numberOfLines={1} style={[styles.optionText, small && styles.optionTextSmall, { color }]}>
            {label}
          </Text>
          <Text numberOfLines={1} style={[styles.optionSub, { color }]}>
            {sub}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * The paid choices together under one outline and one "Pro" mark (no badge per option). `flex`: its share of the row
 * (the number of choices in it, so every choice has the same width).
 */
export function ProGroup({ label, children, flex = 3 }: { label: string; children: ReactNode; flex?: number }) {
  return (
    <View style={[styles.proGroup, { flex }]}>
      {children}
      <ProBadge label={label} top={-10} right={10} />
    </View>
  );
}

export function PanelInfo({ text }: { text: string }) {
  return (
    <View style={styles.info}>
      <InfoIcon size={18} color={colors.muted} />
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

type CircleProps = {
  icon: (color: string) => ReactNode;
  title: string;
  status: string;
  on?: boolean;
  /** The trigger is on and ready (connected, listening, watching): its status in green with a dot, as for every one. */
  ok?: boolean;
  disabled?: boolean;
  /** A paid trigger on the free plan: its own "Pro" mark on the circle. */
  pro?: string;
  onPress?: () => void;
};

/** A trigger as a round button (amber = on), its name and its live status under it. */
export function TriggerCircle({ icon, title, status, on = false, ok = false, disabled = false, pro, onPress }: CircleProps) {
  const iconColor = on ? colors.onAccent : disabled || pro !== undefined ? '#8A8A8A' : colors.text;
  const body = (
    <>
      <View style={[styles.circle, on && styles.circleOn]}>
        {icon(iconColor)}
        {pro === undefined ? null : <ProBadge label={pro} top={-4} right={-10} />}
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={styles.triggerTitle}>
        {title}
      </Text>
      <View style={styles.statusRow}>
        {ok ? <View style={styles.okDot} /> : null}
        <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85} style={[styles.status, ok && { color: OK }]}>
          {status}
        </Text>
      </View>
    </>
  );

  // Nothing to do on a tap (a watch already connected, a voice this phone cannot hear): a status, not a button.
  if (disabled || onPress === undefined) {
    return (
      <View accessible accessibilityLabel={`${title}, ${status}`} style={[styles.trigger, disabled && styles.disabled]}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${status}`}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={styles.trigger}>
      {body}
    </Pressable>
  );
}

type ChoiceProps = { glyph: string; sub: string; selected: boolean; pro?: string; lockedHint?: string; onPress: () => void };

/** One of two big round choices (the quality): its name inside the circle, a detail under it. */
export function BigChoice({ glyph, sub, selected, pro, lockedHint, onPress }: ChoiceProps) {
  const label = [glyph, sub, pro === undefined ? undefined : lockedHint].filter((part) => part !== undefined).join(', ');
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={styles.choice}>
      <View style={[styles.choiceCircle, selected && styles.circleOn]}>
        <Text numberOfLines={1} style={[styles.choiceGlyph, selected && { color: colors.onAccent }]}>
          {glyph}
        </Text>
        {pro === undefined ? null : <ProBadge label={pro} top={-4} right={-6} />}
      </View>
      <Text style={styles.choiceSub}>{sub}</Text>
    </Pressable>
  );
}

/** The three dots between two round choices: one or the other. */
export function ChoiceDots() {
  return (
    <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.dot} />
      <View style={styles.dot} />
      <View style={styles.dot} />
    </View>
  );
}

/** A full-width outlined action at the end of a panel (Testar gatilhos). */
export function PanelAction({ label, icon, onPress, filled = false }: { label: string; icon?: ReactNode; onPress: () => void; filled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.action, filled && styles.actionFilled]}>
      {icon}
      <Text style={[styles.actionText, filled && { color: colors.onAccent }]}>{label}</Text>
    </Pressable>
  );
}

export const panelColors = { GROUP, OPTION, OK } as const;

const styles = StyleSheet.create({
  panel: {
    paddingTop: 18,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 14,
    backgroundColor: PANEL,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: -8 },
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, fontFamily: fonts.displayBold, fontSize: 34, lineHeight: 36, color: colors.text, textTransform: 'uppercase' },
  pages: { flexDirection: 'row', gap: 5 },
  page: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4A4A4A' },
  pageOn: { width: 16, backgroundColor: colors.accent },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#3A3A3A', alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { gap: 14 },
  group: { backgroundColor: GROUP, borderRadius: 14, padding: 12, gap: 10 },
  groupLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.muted },
  option: {
    flex: 1,
    minWidth: 0,
    height: 50,
    borderRadius: 10,
    backgroundColor: OPTION,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 6,
  },
  optionSmall: { minHeight: 36, height: undefined, paddingVertical: 5, gap: 5 },
  optionSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  optionText: { fontFamily: fonts.bodyBold, fontSize: 17 },
  optionTextSmall: { fontSize: 14 },
  optionLines: { alignItems: 'center', flexShrink: 1 },
  optionSub: { fontFamily: fonts.bodySemi, fontSize: 12, opacity: 0.8 },
  proGroup: {
    flex: 3,
    minWidth: 0,
    flexDirection: 'row',
    gap: 6,
    padding: 5,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: 'rgba(255,176,0,0.55)',
  },
  info: { backgroundColor: GROUP, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  trigger: { flex: 1, minWidth: 0, alignItems: 'center', gap: 7 },
  disabled: { opacity: 0.5 },
  // A little smaller (2026-11-22) to make room for the other phone as a remote.
  // The phone remote is one of the triggers again (2026-11-22): a little smaller so the panel fits without scrolling.
  circle: { width: 56, height: 56, borderRadius: 28, backgroundColor: OFF, alignItems: 'center', justifyContent: 'center' },
  circleOn: { backgroundColor: colors.accent },
  triggerTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: -3, maxWidth: '100%', paddingHorizontal: 4 },
  okDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: OK },
  status: { fontFamily: fonts.bodySemi, fontSize: 12.5, lineHeight: 15, color: colors.muted, flexShrink: 1, textAlign: 'center' },
  choice: { width: 120, alignItems: 'center', gap: 8 },
  choiceCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: OFF, alignItems: 'center', justifyContent: 'center' },
  choiceGlyph: { fontFamily: fonts.displayBold, fontSize: 24, color: colors.text, textTransform: 'uppercase', letterSpacing: 0.5 },
  choiceSub: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.muted },
  dots: { flexDirection: 'row', gap: 4, marginTop: 42 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#8A8A8A' },
  action: {
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionFilled: { backgroundColor: colors.accent, borderRadius: 14 },
  actionText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.accent },
});
