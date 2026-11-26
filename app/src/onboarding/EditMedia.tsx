import type { ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { FocusIcon, PlayIcon, RotateIcon, SoundIcon, SpeedIcon, ZoomIcon } from '../components/icons';
import { BallIcon, ChevronDownIcon, NoneIcon, PlayersIcon, SportIcon } from '../components/sportIcons';
import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { PHOTOS } from './photos';
import { Photo, useLoop } from './motion';

type IconType = ComponentType<{ color?: string; size?: number }>;

// No PRO tags here: what the free plan leaves out of the exported video is told in the editor and before exporting.
// The editor's own order (clip/tools.tsx).
const TOOLS: { id: 'focus' | 'speed' | 'sound' | 'zoom' | 'rotate'; Icon: IconType }[] = [
  { id: 'focus', Icon: FocusIcon },
  { id: 'speed', Icon: SpeedIcon },
  { id: 'sound', Icon: SoundIcon },
  { id: 'zoom', Icon: ZoomIcon },
  { id: 'rotate', Icon: RotateIcon },
];

/** The framings of the Foco panel (FocusPanel), Jogadores chosen. */
const FRAMINGS: { id: 'none' | 'players' | 'ball'; label: 'clip.framingOriginal' | 'clip.framingPlayers' | 'clip.framingBall'; Icon: IconType }[] = [
  { id: 'none', label: 'clip.framingOriginal', Icon: NoneIcon },
  { id: 'players', label: 'clip.framingPlayers', Icon: PlayersIcon },
  { id: 'ball', label: 'clip.framingBall', Icon: BallIcon },
];

/**
 * The editor as it is (2026-11-23): the clip on Modo Foco: Jogadores, the Foco panel with the recording's sport and
 * Original · Jogadores · Bola, the trim bar being adjusted and the tools.
 */
export function EditMedia() {
  const { t } = useT();
  const trim = useLoop(4000, { bounce: true, rest: 0 });
  const head = useLoop(3200);
  const trimStyle = useAnimatedStyle(() => ({ left: `${4 + 16 * trim.get()}%` }));
  const headStyle = useAnimatedStyle(() => ({ left: `${22 + 62 * head.get()}%` }));
  const toolLabel = {
    focus: t('clip.toolFocus'),
    speed: t('clip.toolSpeed'),
    sound: t('clip.sound'),
    zoom: t('clip.toolZoom'),
    rotate: t('clip.toolRotate'),
  };

  return (
    <View style={styles.root} pointerEvents="none">
      <View style={styles.editor}>
        <View style={styles.header}>
          <Text style={styles.cancel}>{t('common.cancel')}</Text>
          <Text style={styles.title}>{t('clip.editTitle')}</Text>
          <View style={styles.done}>
            <Text style={styles.doneText}>{t('clip.done')}</Text>
          </View>
        </View>
        <View style={styles.photo}>
          <Photo photo={PHOTOS.focus} />
          <View style={styles.focusTag}>
            <View style={styles.focusDot} />
            <Text style={styles.focusText}>{t('clip.focusPlayersTag')}</Text>
          </View>
        </View>
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>{t('clip.focusMode')}</Text>
            <View style={styles.chip}>
              <SportIcon sport="beachTennis" size={15} color={colors.accent} />
              <Text style={styles.chipText}>{t('clip.sportBeachTennis')}</Text>
              <Text style={styles.chipNote}>{t('clip.sportDetected')}</Text>
              <ChevronDownIcon size={14} />
            </View>
          </View>
          <View style={styles.cards}>
            {FRAMINGS.map(({ id, label, Icon }) => {
              const on = id === 'players';
              const color = on ? colors.accent : colors.soft;
              return (
                <View key={id} style={[styles.card, on && styles.cardOn]}>
                  <Icon size={17} color={color} />
                  <Text style={[styles.cardText, { color }]}>{t(label)}</Text>
                </View>
              );
            })}
          </View>
        </View>
        <View style={styles.trimRow}>
          <View style={styles.play}>
            <PlayIcon size={15} />
          </View>
          <View style={styles.timeline}>
            <Animated.View style={[styles.trim, trimStyle]}>
              <View style={[styles.handle, { left: 2 }]} />
              <View style={[styles.handle, { right: 2 }]} />
            </Animated.View>
            <Animated.View style={[styles.head, headStyle]} />
            <View style={styles.mark} />
          </View>
        </View>
        <View style={styles.tools}>
          {TOOLS.map(({ id, Icon }) => {
            const on = id === 'focus';
            return (
              <View key={id} style={styles.tool}>
                <View style={[styles.toolIcon, on && styles.toolIconOn]}>
                  <Icon size={20} color={on ? colors.onAccent : colors.text} />
                </View>
                <Text style={[styles.toolLabel, on && { color: colors.accent }]}>{toolLabel[id]}</Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: 10 },
  editor: { flex: 1, minHeight: 240, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.ground, borderWidth: 1, borderColor: colors.border },
  header: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  cancel: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.soft },
  title: { fontFamily: fonts.displayBold, fontSize: 20, letterSpacing: 0.8, color: colors.text },
  done: { height: 32, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.accent, justifyContent: 'center' },
  doneText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.onAccent },
  photo: { flex: 1, overflow: 'hidden' },
  focusTag: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(10,10,10,0.72)',
  },
  focusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  focusText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.accent },
  panel: { paddingTop: 10, paddingHorizontal: 12, gap: 8 },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  panelTitle: { fontFamily: fonts.displayBold, fontSize: 17, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.text },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 30,
    paddingLeft: 7,
    paddingRight: 8,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexShrink: 1,
  },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.text },
  chipNote: { fontFamily: fonts.body, fontSize: 10.5, color: colors.muted },
  cards: { flexDirection: 'row', gap: 6 },
  card: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  cardOn: { borderWidth: 2, borderColor: colors.accent },
  cardText: { fontFamily: fonts.bodyBold, fontSize: 13 },
  trimRow: { paddingTop: 10, paddingHorizontal: 12, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 10 },
  play: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  timeline: { flex: 1, height: 44, borderRadius: 10, backgroundColor: colors.surface },
  trim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: '5%',
    borderWidth: 3,
    borderColor: colors.accent,
    borderRadius: 10,
    backgroundColor: 'rgba(255,176,0,0.12)',
  },
  handle: { position: 'absolute', top: 8, width: 10, height: 22, borderRadius: 4, backgroundColor: colors.accent },
  head: { position: 'absolute', top: -4, width: 2, height: 52, backgroundColor: colors.text },
  mark: { position: 'absolute', left: '66%', top: -6, width: 9, height: 9, marginLeft: -4, backgroundColor: colors.accent, transform: [{ rotate: '45deg' }] },
  tools: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 10, paddingTop: 4 },
  tool: { width: 62, alignItems: 'center', gap: 4 },
  toolIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  toolIconOn: { backgroundColor: colors.accent },
  toolLabel: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.soft },
});
