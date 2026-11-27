import { type ComponentRef, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, type LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { sourceLabel } from './sourceLabel';
import { GalleryIcon, GearFilledIcon, MicIcon, PhoneIcon, RemoteIcon, ResolutionIcon, SaveLastIcon, WatchIcon, WaveIcon } from './icons';
import { GLASS, GlassButton } from './GlassButton';

export type CameraPanel = 'clip' | 'quality' | 'triggers' | 'test' | 'phone';
export type TriggerKey = 'remote' | 'watch' | 'voice' | 'wave' | 'phone';

type Props = {
  clipSeconds: number;
  /** "Full HD" or "4K". */
  quality: string;
  /** The phone has no 4K: the quality button only says what it records, nothing to open. */
  qualityFixed: boolean;
  /** The triggers that are on, drawn in their button. */
  triggers: TriggerKey[];
  /** The panel open now: its button is amber (the test and the phone remote belong to the triggers). */
  panel?: CameraPanel;
  onPanel: (panel: 'clip' | 'quality' | 'triggers') => void;
  /** The camera is opening or the game is starting: every button waits. */
  busy: boolean;
  /** Shown waiting (dimmed, the record button turning): only once it takes a while, so a quick reopen does not flash. */
  waiting?: boolean;
  onRecord: () => void;
  onRecordings: () => void;
  onSettings: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
  /**
   * The phone on its side (2026-11-22): the bar stays where it is on the phone, as in the Camera app; only what is in
   * each button turns to stand upright (`spin`, animated by the caller), and the three settings take slots that fit
   * them turned (`turned`). Nothing is laid out again, so nothing moves or flashes.
   */
  spin?: Animated.AnimatedInterpolation<string>;
  turned?: boolean;
  /**
   * On its side with the home bar on the right (2026-11-22): the settings run the other way on the phone, so they still
   * read top to bottom (clip length → quality → triggers), the arrows pointing down.
   */
  reversed?: boolean;
  /** Where the three settings and the record button sit on the screen (the first-time tour points at them). */
  onTargets?: (targets: TourTargets) => void;
};

type SettingKind = 'clip' | 'quality' | 'triggers';

/** A control's place on the screen, in window points. */
export type TourRect = { x: number; y: number; width: number; height: number };
export type TourTargets = Record<SettingKind | 'record', TourRect>;
const TARGET_KINDS = ['clip', 'quality', 'triggers', 'record'] as const;

/** Between the three settings and the black under them; the panels keep the same distance above the settings. */
export const BAR_GAP = 16;

/** How far the row of Gravar sits into the iPhone's home indicator area (points): more = lower, more camera. */
const DOCK_LOWER = 12;

/** The least black under the row of Gravar on any phone (points): it went flush on Android's buttons (2026-11-26). */
const DOCK_GAP = 16;

/**
 * The space under the row of Gravar, down to the screen's edge, from the bottom safe area. On the iPhone that area is
 * the home indicator and the row sits DOCK_LOWER into it. On Android it is the system's buttons or gesture bar, drawn
 * over the app (edge-to-edge): the row stays above it. Always at least DOCK_GAP of black under the row.
 */
export function dockBottom(os: string, bottomInset: number): number {
  const sunk = os === 'ios' ? bottomInset - DOCK_LOWER : bottomInset + DOCK_GAP;
  return Math.max(DOCK_GAP, sunk);
}

/** Until the buttons are measured, a slot as long as the longest of them can be. */
const SLOT_FALLBACK = 128;

/**
 * The camera's controls held upright (2026-11-22, after Lens Buddy): on the black under the picture, three buttons in
 * the order things are set before a game (clip length → quality → triggers), each opening its panel; under them
 * Gravações, the record button and Ajustes.
 */
export function CameraBar(props: Props) {
  const { clipSeconds, quality, qualityFixed, triggers, panel, onPanel, busy, onRecord, onRecordings, onSettings, onLayout, spin, turned = false, reversed = false, onTargets } = props;
  const waiting = props.waiting ?? busy;
  const { t, locale } = useT();
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;

  const active = (kind: 'clip' | 'quality' | 'triggers') => panel === kind || (kind === 'triggers' && (panel === 'test' || panel === 'phone'));
  const tint = (kind: 'clip' | 'quality' | 'triggers') => (active(kind) ? colors.onAccent : colors.text);
  const triggerItems = triggers.map((key) => sourceLabel(TRIGGER_SOURCE[key], locale));
  // The arrows keep pointing from one setting to the next on the phone: they never turn.
  const arrow = <Arrow reversed={reversed} />;
  const upright = spin === undefined ? undefined : { transform: [{ rotate: spin }] };
  // How long each button is, so on its side the column keeps the same distance from the black as upright (a fixed
  // slot left the shorter ones floating further away).
  const [lengths, setLengths] = useState<Partial<Record<SettingKind, number>>>({});
  const measured = Object.values(lengths).filter((n): n is number => n !== undefined);
  const long = measured.length === 0 ? SLOT_FALLBACK : Math.max(...measured);
  // Where each control is on the screen, for the first-time tour: measured after each layout.
  const clipRef = useRef<ComponentRef<typeof View>>(null);
  const qualityRef = useRef<ComponentRef<typeof View>>(null);
  const triggersRef = useRef<ComponentRef<typeof View>>(null);
  const recordRef = useRef<ComponentRef<typeof View>>(null);
  // On its side a button is turned in its slot: the slot is measured (it is not turned) and the button's own size, as
  // laid out, is stood in the middle of it, the other way round (2026-11-27). Measuring the turned button itself gave
  // whatever box the turn had reached, or the platform's own idea of a turned view.
  // Each ref is its own top-level hook: hooks written inside an object literal get memoized by the React Compiler
  // (the object is cached after the first render), so they ran once and the next render had fewer hooks (2026-11-27).
  const clipSlotRef = useRef<ComponentRef<typeof View>>(null);
  const qualitySlotRef = useRef<ComponentRef<typeof View>>(null);
  const triggersSlotRef = useRef<ComponentRef<typeof View>>(null);
  const slotRefs = { clip: clipSlotRef, quality: qualitySlotRef, triggers: triggersSlotRef };
  const sizes = useRef<Partial<Record<SettingKind, { width: number; height: number }>>>({});
  const measureTargets = () => {
    if (onTargets === undefined) return;
    const views = {
      clip: turned ? slotRefs.clip.current : clipRef.current,
      quality: turned ? slotRefs.quality.current : qualityRef.current,
      triggers: turned ? slotRefs.triggers.current : triggersRef.current,
      record: recordRef.current,
    };
    const found: Partial<TourTargets> = {};
    for (const kind of TARGET_KINDS) {
      const view = views[kind];
      if (view === null) return;
      const size = kind === 'record' ? undefined : sizes.current[kind];
      if (turned && kind !== 'record' && size === undefined) return;
      view.measureInWindow((x, y, width, height) => {
        found[kind] =
          turned && size !== undefined
            ? { x: x + (width - size.height) / 2, y: y + (height - size.width) / 2, width: size.height, height: size.width }
            : { x, y, width, height };
        if (TARGET_KINDS.every((k) => found[k] !== undefined)) onTargets(found as TourTargets);
      });
    }
  };
  useEffect(() => {
    measureTargets();
  });
  const measure = (kind: SettingKind) => (e: LayoutChangeEvent) => {
    const width = Math.ceil(e.nativeEvent.layout.width);
    sizes.current[kind] = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
    if (lengths[kind] !== width) setLengths((prev) => ({ ...prev, [kind]: width }));
    measureTargets();
  };
  /** A setting button, turned with the phone: on its side it stands in a slot as tall as the longest button. */
  const slot = (kind: SettingKind, ref: typeof clipRef, pill: ReactNode) => {
    const sized = (
      <View ref={ref} onLayout={measure(kind)}>
        {pill}
      </View>
    );
    return turned ? (
      <View ref={slotRefs[kind]} style={[styles.slot, { height: long }]}>
        <Animated.View style={[styles.slotInner, { width: long }, upright]}>{sized}</Animated.View>
      </View>
    ) : (
      <Animated.View style={upright}>{sized}</Animated.View>
    );
  };
  const pills = (
    <>
        {slot('clip', clipRef, <Pill
          label={`${clipSeconds}s`}
          keepCase
          a11y={t('setup.clipA11y', { seconds: clipSeconds })}
          active={active('clip')}
          disabled={busy}
          onPress={() => onPanel('clip')}>
          <SaveLastIcon size={19} color={tint('clip')} />
        </Pill>)}
        {arrow}
        {slot('quality', qualityRef, <Pill
          label={quality}
          a11y={t('setup.qualityA11y', { quality })}
          active={active('quality')}
          disabled={busy || qualityFixed}
          onPress={() => onPanel('quality')}>
          <ResolutionIcon size={18} color={tint('quality')} />
        </Pill>)}
        {arrow}
        {slot('triggers', triggersRef, <Pill
          label={triggers.length === 0 ? t('setup.triggersTitle') : undefined}
          a11y={t('setup.triggersA11y', { items: triggerItems.length === 0 ? t('setup.triggersNone') : triggerItems.join(', ') })}
          active={active('triggers')}
          disabled={busy}
          onPress={() => onPanel('triggers')}>
          {/* None on: the word alone, centred (an empty icon row took a gap beside it). */}
          {triggers.length === 0 ? null : (
            <View style={styles.triggerIcons}>{triggers.map((key) => TRIGGER_ICON[key](tint('triggers')))}</View>
          )}
        </Pill>)}
    </>
  );
  const buttons = (
    <>
        <GlassButton
          accessibilityLabel={t('setup.myRecordings')}
          disabled={busy}
          onPress={onRecordings}
          style={[styles.side, waiting && styles.busy]}>
          <Animated.View style={upright}>
            <GalleryIcon size={40} under={GLASS.fill} />
          </Animated.View>
        </GlassButton>
        <Pressable
          ref={recordRef}
          onLayout={measureTargets}
          accessibilityRole="button"
          accessibilityLabel={t('setup.dockRecord')}
          accessibilityState={{ disabled: busy, busy }}
          disabled={busy}
          onPress={onRecord}
          style={[styles.record, waiting && styles.recordBusy]}>
          {waiting ? <ActivityIndicator color={colors.text} /> : <View style={styles.recordFill} />}
        </Pressable>
        <GlassButton
          accessibilityLabel={t('setup.settings')}
          disabled={busy}
          onPress={onSettings}
          style={[styles.side, waiting && styles.busy]}>
          <Animated.View style={upright}>
            <GearFilledIcon size={32} />
          </Animated.View>
        </GlassButton>
    </>
  );
  // Upright (2026-11-22, trying it): the black only behind Gravar's row; the three settings float over the camera, so
  // the picture keeps more of the screen.
  return (
    <View onLayout={onLayout} style={styles.bar} testID="camera-bar">
      <View testID="camera-settings" style={[styles.pills, reversed && styles.pillsReversed, waiting && styles.busy]}>
        {pills}
      </View>
      <View testID="camera-dock" style={[styles.ground, { paddingBottom: dockBottom(Platform.OS, bottomInset) }]}>
        <View style={styles.row}>{buttons}</View>
      </View>
    </View>
  );
}

const TRIGGER_SOURCE = { remote: 'remote', watch: 'watch', voice: 'voice', wave: 'gesture', phone: 'phone' } as const;

const TRIGGER_ICON: Record<TriggerKey, (color: string) => ReactNode> = {
  remote: (color) => <RemoteIcon key="remote" size={18} color={color} />,
  watch: (color) => <WatchIcon key="watch" size={18} color={color} />,
  voice: (color) => <MicIcon key="voice" size={18} color={color} />,
  wave: (color) => <WaveIcon key="wave" size={18} color={color} />,
  phone: (color) => <PhoneIcon key="phone" size={18} color={color} />,
};

function Pill({
  label,
  keepCase = false,
  a11y,
  active,
  disabled,
  onPress,
  children,
}: {
  label?: string;
  /** The label as written, not in capitals: the seconds' "s" stays small ("30s", 2026-11-22). */
  keepCase?: boolean;
  a11y: string;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.pill, active && styles.pillActive]}>
      {children}
      {label === undefined ? null : <Text style={[styles.pillText, keepCase && styles.pillTextAsWritten, active && { color: colors.onAccent }]}>{label}</Text>}
    </Pressable>
  );
}

/**
 * The order between the settings (2026-11-22): over the camera now, so white on a dark edge, readable on a bright court
 * or a dark gym alike (the grey one disappeared into the picture).
 */
function Arrow({ reversed }: { reversed: boolean }) {
  const d = 'M5 12h14M13 6l6 6-6 6';
  return (
    <Svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      style={reversed ? styles.arrowReversed : undefined}
      accessibilityElementsHidden
      importantForAccessibility="no">
      <Path d={d} stroke="rgba(0,0,0,0.6)" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d={d} stroke={colors.text} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: BAR_GAP },
  // The space under the row comes from dockBottom (the phone's bottom area).
  ground: { backgroundColor: colors.ground, paddingTop: 10 },
  pills: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8 },
  pill: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.text,
    // Over the picture now (upright) as on its side: a dark glass under the outline keeps them readable.
    backgroundColor: 'rgba(12,12,12,0.55)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text, textTransform: 'uppercase' },
  pillTextAsWritten: { textTransform: 'none' },
  triggerIcons: { flexDirection: 'row', gap: 5 },
  // On its side: a button turned upright is as wide as it was tall and as tall as it was long (the longest of them).
  pillsReversed: { flexDirection: 'row-reverse' },
  arrowReversed: { transform: [{ scaleX: -1 }] },
  slot: { width: 48, alignItems: 'center', justifyContent: 'center' },
  slotInner: { height: 48, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  // Minhas gravações and Ajustes beside Gravar (2026-11-22, trying it): the glass of the app's auxiliary buttons (back,
  // delete), with its press feedback; the gallery a touch smaller (40) so it weighs as the gear. Before: bare icons
  // (`variant="bare"`, side 56); a white ring like the settings' was tried and dropped.
  side: { width: 62, height: 62, borderRadius: 31 },
  busy: { opacity: 0.4 },
  // As on the phone held on its side: a white ring with a gap, the app's amber inside (2026-11-22).
  record: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: colors.text,
    backgroundColor: 'rgba(12,12,12,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBusy: { borderColor: 'rgba(255,255,255,0.5)' },
  recordFill: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.accent },
});
