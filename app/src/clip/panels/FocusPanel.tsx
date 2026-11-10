import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { BallSportId, BallUnsuitable } from '../../data/schema';
import type { MessageKey } from '../../i18n';
import { useT } from '../../i18n/useT';
import { colors, fonts } from '../../theme/tokens';
import type { ToolContext } from '../tools';
import { PanelHead } from './PanelParts';

/** The panel's on/off switch (amber when on). */
function Toggle({ label, on, disabled, onPress }: { label: string; on: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={[styles.track, on ? styles.trackOn : null, disabled ? styles.off : null]}>
      <View style={[styles.knob, on ? styles.knobOn : null]} />
    </Pressable>
  );
}

/** The sports Seguir a Bola analyses, as the panel offers them (test 48). */
const BALL_SPORTS: { id: BallSportId; label: MessageKey }[] = [
  { id: 'basquete', label: 'clip.sportBasquete' },
  { id: 'beachTennis', label: 'clip.sportBeachTennis' },
];

/** Test 47a: why Seguir a Bola is not applied, in a sentence. */
const WHY: Record<BallUnsuitable, MessageKey> = {
  tooFar: 'clip.ballWhyTooFar',
  rarelyFound: 'clip.ballWhyRarelyFound',
  tooSmall: 'clip.ballWhyTooSmall',
  still: 'clip.ballWhyStill',
};

/** "Que esporte é esta gravação?" with one button per sport Seguir a Bola knows; the others are coming. */
function SportChoice({ onChoose }: { onChoose: (sport: BallSportId) => void }) {
  const { t } = useT();
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.question}>{t('clip.ballSportQuestion')}</Text>
      <View style={styles.choices}>
        {BALL_SPORTS.map((s) => (
          <Pressable key={s.id} accessibilityRole="button" onPress={() => onChoose(s.id)} style={styles.choice}>
            <Text style={styles.choiceText}>{t(s.label)}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.noteText}>{t('clip.ballSportOthers')}</Text>
    </View>
  );
}

/**
 * The Foco panel: Modo Foco and, below it, Seguir a Bola (spec 2026-11-09 §4.1, layouts A1–A3). The two exclude each
 * other; the analysis' progress is shown on the video, never here.
 */
export function FocusPanel({ ctx }: { ctx: ToolContext }) {
  const { t } = useT();
  // "Trocar": the player wants to say another sport than the one Seguir a Bola uses now
  const [changing, setChanging] = useState(false);
  // On a free recording the framing works here, but it does not leave the app: the hints say so.
  const free = ctx.plan === 'free';
  const ballShown = ctx.ball !== 'hidden' && ctx.ball !== 'soon';
  const choose = (sport: BallSportId) => {
    setChanging(false);
    ctx.chooseBallSport(sport);
  };
  const sportName = ctx.ballSport ? t(BALL_SPORTS.filter((s) => s.id === ctx.ballSport)[0].label) : undefined;
  const ballOn = ctx.ball === 'on' || ctx.ball === 'analysing';
  const focusOn = ctx.focus === 'on';
  const preparing = ctx.focus === 'preparing';

  let focusHint = free ? t('clip.focusPro') : t('clip.focusHint');
  if (ctx.focus === 'unavailable') focusHint = t('clip.focusUnavailable');
  else if (ctx.ball === 'analysing') focusHint = t('clip.focusBackNow');
  else if (ctx.ball === 'on') focusHint = t('clip.focusOffForBall');

  let note = <Text style={styles.noteText}>{t('clip.focusHold')}</Text>;
  if (ctx.ball === 'on') note = <Text style={styles.noteText}>{t('clip.ballReadyNote')}</Text>;
  else if (preparing && !ballOn) {
    note = (
      <>
        <ActivityIndicator size="small" color={colors.soft} />
        <Text style={styles.noteText}>{t('clip.focusPreparingNote')}</Text>
      </>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      <PanelHead
        title={t('clip.focusMode')}
        hint={focusHint}
        pro={free && ctx.focus !== 'unavailable' ? t('setup.proBadge') : undefined}
        right={
          ctx.focus === 'unavailable' ? undefined : (
            <Toggle label={t('clip.focusMode')} on={focusOn} disabled={preparing && !ballOn} onPress={ctx.toggleFocus} />
          )
        }
      />
      {ctx.ball === 'soon' || (ballShown && changing) ? (
        <View style={{ gap: 6 }}>
          <PanelHead
            title={t('clip.ballMode')}
            hint={free ? t('clip.ballPro') : t('clip.ballHint')}
            pro={free ? t('setup.proBadge') : undefined}
            right={<Toggle label={t('clip.ballMode')} on={false} disabled onPress={ctx.toggleBall} />}
          />
          <SportChoice onChoose={choose} />
        </View>
      ) : ctx.ball === 'unsuitable' ? (
        <View style={{ gap: 6 }}>
          <PanelHead
            title={t('clip.ballMode')}
            hint={`${t('clip.ballUnsuitable')}. ${ctx.ballReason ? t(WHY[ctx.ballReason]) : ''}`}
            right={<Toggle label={t('clip.ballMode')} on={false} disabled onPress={ctx.toggleBall} />}
          />
          {sportName ? (
            <Pressable accessibilityRole="button" onPress={() => setChanging(true)} hitSlop={8}>
              <Text style={styles.link}>
                {t('clip.ballSportLine', { sport: sportName })} · {t('clip.ballSportChange')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : ballShown ? (
        <View style={{ gap: 6 }}>
          <PanelHead
            title={t('clip.ballMode')}
            hint={free ? t('clip.ballPro') : t('clip.ballHint')}
            pro={free ? t('setup.proBadge') : undefined}
            badge={free ? undefined : t('clip.ballNew')}
            right={<Toggle label={t('clip.ballMode')} on={ballOn} onPress={ctx.toggleBall} />}
          />
          {sportName ? (
            <Pressable accessibilityRole="button" onPress={() => setChanging(true)} hitSlop={8}>
              <Text style={styles.link}>
                {t('clip.ballSportLine', { sport: sportName })} · {t('clip.ballSportChange')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={styles.note}>{note}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: 52, height: 32, borderRadius: 16, backgroundColor: colors.border, justifyContent: 'center', padding: 3 },
  trackOn: { backgroundColor: colors.accent },
  off: { opacity: 0.45 },
  knob: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.text },
  knobOn: { alignSelf: 'flex-end', backgroundColor: colors.onAccent },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  link: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.accent },
  question: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.text },
  choices: { flexDirection: 'row', gap: 8 },
  choice: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  choiceText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.text },
  noteText: { flexShrink: 1, fontFamily: fonts.body, fontSize: 12, color: colors.soft },
});
