import type { ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CheckIcon, MicIcon, QrIcon, RemoteIcon, SaveLastIcon, WatchIcon, WaveIcon } from '../components/icons';
import { WavingFigure } from '../components/WavingFigure';
import type { MessageKey } from '../i18n';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { PHOTOS } from './photos';
import { Photo, Reveal } from './motion';
import type { WayId } from './slides';
import { WatchMedia } from './WatchMedia';

type IconType = ComponentType<{ color?: string; size?: number }>;

/** The save button's icon, with the clip length the onboarding shows (15 s). */
function SaveButtonIcon({ color, size }: { color?: string; size?: number }) {
  return <SaveLastIcon seconds={15} color={color} size={size} />;
}

/** `pro`: needs the paid plan. `tap` is the save button on the recording screen (a tap anywhere no longer saves). */
const WAYS: Record<WayId, { Icon: IconType; source: MessageKey; pro: boolean }> = {
  tap: { Icon: SaveButtonIcon, source: 'sources.screen', pro: false },
  wave: { Icon: WaveIcon, source: 'sources.gesture', pro: false },
  voice: { Icon: MicIcon, source: 'sources.voice', pro: false },
  phone: { Icon: QrIcon, source: 'sources.phone', pro: false },
  watch: { Icon: WatchIcon, source: 'sources.watch', pro: true },
  bluetooth: { Icon: RemoteIcon, source: 'sources.remote', pro: false },
};

type Props = {
  ways: readonly WayId[];
  /** Index of the way shown in the card. */
  card: number;
  onPick: (index: number) => void;
};

/**
 * The ways to save a play: the recording screen at the moment of a save (the timer and the count on top, the amber
 * frame, the saved card with Desfazer, the save button ticked, as RecordingPanel and SavedOverlay draw it), the options
 * as tabs and the open one as a card.
 */
export function SaveMedia({ ways, card, onPick }: Props) {
  const { t } = useT();
  const current = ways[Math.min(card, ways.length - 1)];
  const { source, pro } = WAYS[current];

  return (
    <View style={styles.root} pointerEvents="box-none">
      <View style={styles.photo} pointerEvents="none">
        <Photo photo={PHOTOS.play} />
        {current === 'watch' ? (
          // Saving from the wrist: the watch app, not the phone's screen.
          <>
            <View style={styles.dim} />
            <WatchMedia />
          </>
        ) : (
          <>
            <View style={styles.top}>
              <View style={styles.pill}>
                <View style={styles.recDot} />
                <Text style={styles.elapsed}>00:12:08</Text>
              </View>
              <View style={styles.pill}>
                <Text style={styles.count}>{t('summary.clips', { count: 1 })}</Text>
              </View>
            </View>
            <Reveal key={current} delay={250} style={styles.saved}>
              <View style={styles.savedCard}>
                <View style={styles.savedRow}>
                  <View style={styles.badge}>
                    <CheckIcon size={22} />
                  </View>
                  <View style={styles.savedText}>
                    <Text style={styles.savedTitle}>{t('recording.savedTitle', { number: 1 })}</Text>
                    <Text style={styles.savedVia}>{t('recording.savedVia', { source: t(source), seconds: 15 })}</Text>
                  </View>
                </View>
                <View style={styles.undo}>
                  <Text style={styles.undoText}>{t('recording.undo')}</Text>
                </View>
              </View>
            </Reveal>
            <View style={styles.buttonRow}>
              <View style={styles.saveRing}>
                <View style={styles.saveFill}>
                  <CheckIcon size={20} />
                </View>
              </View>
            </View>
            {/* The frame a save puts around the screen: drawn last, over the picture. */}
            <View style={styles.frame} />
          </>
        )}
      </View>

      {/* With a single way (the Pro slide) there is nothing to pick: only its card. */}
      {ways.length > 1 ? (
        <View style={styles.tabs} accessibilityLabel={t('onboarding.ways')}>
          {ways.map((id, i) => {
            const on = i === Math.min(card, ways.length - 1);
            const { Icon } = WAYS[id];
            return (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityLabel={t(`onboarding.${id}.name`)}
                accessibilityState={{ selected: on }}
                onPress={() => onPick(i)}
                style={[styles.tab, on && styles.tabOn]}>
                <Icon size={24} color={on ? colors.onAccent : colors.text} />
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Reveal key={`card-${current}`} style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardName}>{t(`onboarding.${current}.name`)}</Text>
          <View style={[styles.plan, pro && styles.planPro]}>
            <Text style={[styles.planText, pro && styles.planTextPro]}>{pro ? t('onboarding.pro') : t('onboarding.free')}</Text>
          </View>
        </View>
        {current === 'wave' ? (
          // The gesture moving, not a still picture of raised arms: just raising them is not the gesture.
          <View style={styles.waveRow}>
            <WavingFigure size={56} />
            <Text style={[styles.how, styles.waveHow]}>{t('onboarding.wave.how')}</Text>
          </View>
        ) : (
          <Text style={styles.how}>{t(`onboarding.${current}.how`)}</Text>
        )}
      </Reveal>
    </View>
  );
}

const glass = 'rgba(12,12,12,0.72)';

const styles = StyleSheet.create({
  root: { flex: 1, gap: 10 },
  photo: { flex: 1, minHeight: 160, borderRadius: 18, overflow: 'hidden', backgroundColor: '#111111' },
  dim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10,10,10,0.55)' },
  frame: { ...StyleSheet.absoluteFill, borderRadius: 18, borderWidth: 4, borderColor: colors.accent },
  top: { position: 'absolute', top: 10, left: 10, right: 10, flexDirection: 'row', justifyContent: 'space-between' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: glass },
  recDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.rec },
  elapsed: { fontFamily: fonts.display, fontSize: 17, color: colors.text, fontVariant: ['tabular-nums'] },
  count: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.accent },
  // Between the top pills and the save button, centred in what is left (short phones squeeze it, never overlap).
  saved: { position: 'absolute', left: 16, right: 16, top: 50, bottom: 72, justifyContent: 'center' },
  savedCard: { padding: 12, borderRadius: 16, backgroundColor: 'rgba(12,12,12,0.88)', gap: 10 },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  savedText: { flex: 1 },
  savedTitle: { fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 25, color: colors.text },
  savedVia: { fontFamily: fonts.body, fontSize: 12, color: colors.soft },
  undo: { height: 40, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  undoText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  buttonRow: { position: 'absolute', left: 0, right: 0, bottom: 12, alignItems: 'center' },
  saveRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 3,
    borderColor: colors.accent,
    backgroundColor: 'rgba(12,12,12,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveFill: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: {
    flex: 1,
    height: 52,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  waveHow: { flex: 1 },
  card: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardName: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 17, color: colors.text },
  plan: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  planPro: { backgroundColor: colors.accent, borderColor: colors.accent },
  planText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.text },
  planTextPro: { color: colors.onAccent },
  how: { fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 21, color: colors.text, marginTop: 2 },
});
