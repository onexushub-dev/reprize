import { type ReactNode, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { CloseIcon, LockIcon } from '../../components/icons';
import { BallIcon, ChevronDownIcon, NoneIcon, PlayersIcon, ProgressRing, SportIcon } from '../../components/sportIcons';
import type { RecordingSportId } from '../../data/schema';
import type { MessageKey } from '../../i18n';
import { useT } from '../../i18n/useT';
import type { Framing } from '../../share/editing';
import { colors, fonts } from '../../theme/tokens';
import type { ToolContext } from '../tools';
import { SPORT_LABEL, SportSheet } from './SportSheet';

type Card = {
  framing: Framing;
  label: MessageKey;
  icon: (color: string) => ReactNode;
  /** Working: the card shows a ring (with the percent when known) instead of its icon. */
  busy: boolean;
  percent?: number;
  /** Waiting for the phone to cool down: "Aguardando" instead of a percent. */
  waiting?: boolean;
  dimmed: boolean;
};

/**
 * The Foco panel (spec 2026-11-11 §3): the recording's sport on the right of the title, and one row of cards —
 * Original, Jogadores, Bola (only for a sport with a ball model). Nothing is applied by itself: a card is applied when
 * tapped, shows its progress while it works, and stays ready afterwards (switching back is instant).
 */
export function FocusPanel({ ctx }: { ctx: ToolContext }) {
  const { t } = useT();
  const [sheet, setSheet] = useState(false);
  // A clip saved before (Modo Foco on by default) where Jogadores cannot frame shows as the Original it is.
  // Likewise a clip stored on Bola where Bola is not offered (its sport not known, or without a ball model).
  let framing: Framing = ctx.edit.framing;
  if ((framing === 'focus' && ctx.focus === 'unavailable') || (framing === 'ball' && ctx.ball === 'hidden')) framing = 'none';
  const free = ctx.plan === 'free';
  const playersWorking = framing === 'focus' && ctx.focus === 'preparing';
  const ballWorking = framing === 'ball' && ctx.ball === 'analysing';

  const cards: Card[] = [
    { framing: 'none', label: 'clip.framingOriginal', icon: (c) => <NoneIcon color={c} />, busy: false, dimmed: false },
  ];
  if (ctx.focus !== 'unavailable') {
    cards.push({
      framing: 'focus',
      label: 'clip.framingPlayers',
      icon: (c) => <PlayersIcon color={c} />,
      busy: playersWorking,
      dimmed: false,
    });
  }
  if (ctx.ball !== 'hidden') {
    cards.push({
      framing: 'ball',
      label: 'clip.framingBall',
      icon: (c) => <BallIcon color={c} />,
      busy: ballWorking,
      percent: ballWorking && !ctx.ballCooling ? ctx.ballPercent : undefined,
      waiting: ballWorking && ctx.ballCooling,
      dimmed: ctx.ball === 'unsuitable',
    });
  }

  // The cards say what each framing is and show their own progress (Victor, 2026-11-12: no descriptions, no notes).
  // The one line left answers a tap that changed nothing: Bola found no ball in play, so the clip stayed as it was.
  const warn = framing === 'none' && ctx.ball === 'unsuitable' ? t('clip.framingHintBallNotFound') : undefined;

  const sportName = ctx.sport !== undefined ? t(SPORT_LABEL[ctx.sport]) : t('clip.sportChoose');
  const choose = (sport: RecordingSportId) => {
    setSheet(false);
    ctx.chooseSport(sport);
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.head}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{t('clip.focusMode')}</Text>
          {free ? (
            <View style={styles.pro} accessibilityLabel={t('setup.proBadge')}>
              <LockIcon color={colors.onAccent} size={9} />
              <Text style={styles.proText}>{t('setup.proBadge')}</Text>
            </View>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('clip.sportChipA11y', { sport: sportName })}
          onPress={() => setSheet(true)}
          hitSlop={6}
          style={styles.chip}>
          <SportIcon sport={ctx.sport} size={18} color={colors.accent} />
          <Text style={styles.chipText}>{sportName}</Text>
          {ctx.sportHow === 'detected' ? <Text style={styles.chipNote}>{t('clip.sportDetected')}</Text> : null}
          <ChevronDownIcon />
        </Pressable>
      </View>
      <View accessibilityRole="radiogroup" style={styles.row}>
        {cards.map((c) => {
          const on = framing === c.framing;
          const color = c.dimmed ? '#5A5A5A' : on ? colors.accent : colors.soft;
          const name = t(c.label);
          const a11y = c.waiting
            ? t('clip.framingWaitingA11y', { name })
            : c.busy
            ? c.percent !== undefined
              ? t('clip.framingWorking', { name, percent: c.percent })
              : t('clip.framingWorkingNoPercent', { name })
            : name;
          return (
            <View key={c.framing} style={styles.cardWrap}>
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel={a11y}
                accessibilityState={{ checked: on, disabled: c.dimmed }}
                disabled={c.dimmed}
                onPress={() => ctx.pickFraming(c.framing)}
                style={[styles.card, on ? styles.cardOn : null, c.dimmed ? styles.cardDimmed : null]}>
                {c.busy ? (
                  c.percent !== undefined ? (
                    <ProgressRing progress={c.percent / 100} />
                  ) : (
                    <ActivityIndicator size="small" color={colors.accent} />
                  )
                ) : (
                  c.icon(color)
                )}
                <Text style={[styles.cardText, { color }]}>
                  {c.waiting ? t('clip.framingWaiting') : c.busy && c.percent !== undefined ? `${c.percent}%` : name}
                </Text>
              </Pressable>
              {c.busy || c.waiting ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('clip.framingStop')}
                  hitSlop={8}
                  onPress={ctx.stopFraming}
                  style={styles.stop}>
                  <CloseIcon size={10} color={colors.onAccent} />
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
      {warn !== undefined ? <Text style={[styles.hint, styles.hintWarn]}>{warn}</Text> : null}
      <SportSheet
        visible={sheet}
        sport={ctx.sport}
        how={ctx.sportHow}
        onChoose={choose}
        onClose={() => setSheet(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  proText: { fontFamily: fonts.bodyBold, fontSize: 9, color: colors.onAccent },
  title: { fontFamily: fonts.displayBold, fontSize: 18, letterSpacing: 0.7, textTransform: 'uppercase', color: colors.text },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingLeft: 8,
    paddingRight: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexShrink: 1,
  },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text },
  chipNote: { fontFamily: fonts.body, fontSize: 11, color: colors.muted },
  row: { flexDirection: 'row', gap: 8 },
  cardWrap: { flex: 1 },
  stop: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.ground,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 6,
  },
  cardOn: { borderWidth: 2, borderColor: colors.accent },
  cardDimmed: { borderStyle: 'dashed' },
  cardText: { fontFamily: fonts.bodyBold, fontSize: 14 },
  hint: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  hintWarn: { color: colors.warning },
});
