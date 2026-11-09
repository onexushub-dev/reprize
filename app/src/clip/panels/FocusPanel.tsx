import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

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

/**
 * The Foco panel: Modo Foco and, below it, Seguir a Bola (spec 2026-11-09 §4.1, layouts A1–A3). The two exclude each
 * other; the analysis' progress is shown on the video, never here.
 */
export function FocusPanel({ ctx }: { ctx: ToolContext }) {
  const { t } = useT();
  // On a free recording the framing works here, but it does not leave the app: the hints say so.
  const free = ctx.plan === 'free';
  const ballShown = ctx.ball !== 'hidden' && ctx.ball !== 'soon';
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
      {ctx.ball === 'soon' ? (
        <View style={{ gap: 6 }}>
          <PanelHead
            title={t('clip.ballMode')}
            hint={t('clip.ballSoonHint')}
            badge={t('clip.ballSoon')}
            right={<Toggle label={t('clip.ballMode')} on={false} disabled onPress={ctx.toggleBall} />}
          />
          <Pressable accessibilityRole="button" onPress={ctx.unlockBall} hitSlop={8}>
            <Text style={styles.link}>{t('clip.ballUnlock')}</Text>
          </Pressable>
        </View>
      ) : ballShown ? (
        <PanelHead
          title={t('clip.ballMode')}
          hint={free ? t('clip.ballPro') : t('clip.ballHint')}
          pro={free ? t('setup.proBadge') : undefined}
          badge={free ? undefined : t('clip.ballNew')}
          right={<Toggle label={t('clip.ballMode')} on={ballOn} onPress={ctx.toggleBall} />}
        />
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
  noteText: { flexShrink: 1, fontFamily: fonts.body, fontSize: 12, color: colors.soft },
});
