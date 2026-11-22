import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { setGestureEnabled, setVoiceEnabled } from '../../modules/replay-camera';
import { type AppLocale, VOICE_WORD, voiceLocale } from '../i18n';
import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { CheckIcon, MicIcon, RemoteIcon, WatchIcon, WaveIcon } from './icons';
import { type PracticeState, usePractice } from './PracticeSheet';
import { PanelAction, PanelInfo, panelColors, SetupPanel } from './SetupPanel';

type Props = {
  /** Which triggers are on, and so take part in the test. */
  remote: boolean;
  watch: boolean;
  voice: boolean;
  wave: boolean;
  /** A remote press was heard since the test opened (the screen listens to the remote; this panel only shows it). */
  remoteHeard: boolean;
  locale: AppLocale;
  /** Where it sits (see SetupPanel). */
  place: ViewStyle;
  onDone: () => void;
};

const gestureTrigger = { source: 'gesture' as const, enable: setGestureEnabled, watchRaised: false };

/**
 * "Testar gatilhos" (2026-11-22): the camera listens and looks as in a game, but nothing is saved. Each trigger that is
 * on turns to "Funcionou" when used, with the saved-clip chime. The voice and the wave reuse the practice of their "?"
 * sheets; the remote is heard by the setup screen; the Apple Watch only shows its link (a tap on it, before a game,
 * starts a recording, so it is not asked for here).
 */
export function TriggerTestPanel({ remote, watch, voice, wave, remoteHeard, locale, place, onDone }: Props) {
  const { t } = useT();
  const voiceTrigger = { source: 'voice' as const, enable: (on: boolean) => setVoiceEnabled(on, voiceLocale(locale)), watchRaised: false };
  const voiceTest = usePractice(voice, voiceTrigger);
  const waveTest = usePractice(wave, gestureTrigger);
  const none = !remote && !watch && !voice && !wave;
  return (
    <SetupPanel testID="trigger-test" title={t('triggerTest.title')} onClose={onDone} place={place}>
      {none ? <Text style={styles.empty}>{t('triggerTest.empty')}</Text> : null}
      <View style={styles.rows}>
        {remote ? (
          <Row icon={<RemoteIcon size={22} color={colors.accent} />} ask={t('triggerTest.remote')} done={remoteHeard} t={t} />
        ) : null}
        {voice ? (
          <Row
            icon={<MicIcon size={22} color={colors.accent} />}
            ask={t('triggerTest.voice', { word: VOICE_WORD[locale] })}
            done={worked(voiceTest.state)}
            t={t}
          />
        ) : null}
        {wave ? (
          <Row icon={<WaveIcon size={22} color={colors.accent} />} ask={t('triggerTest.wave')} done={worked(waveTest.state)} t={t} />
        ) : null}
        {watch ? (
          <Row icon={<WatchIcon size={22} color={colors.accent} />} ask={t('triggerTest.watch')} done connected t={t} />
        ) : null}
      </View>
      <PanelInfo text={t('triggerTest.note')} />
      <PanelAction label={t('triggerTest.done')} onPress={onDone} filled />
    </SetupPanel>
  );
}

function worked(state: PracticeState): boolean {
  return state === 'done';
}

function Row({
  icon,
  ask,
  done,
  connected = false,
  t,
}: {
  icon: ReactNode;
  ask: string;
  done: boolean;
  connected?: boolean;
  t: ReturnType<typeof useT>['t'];
}) {
  const status = done ? t(connected ? 'triggerTest.connected' : 'triggerTest.worked') : t('triggerTest.waiting');
  return (
    <View accessible accessibilityLabel={`${ask}, ${status}`} style={[styles.row, done && styles.rowDone]}>
      {icon}
      <Text style={styles.ask}>{ask}</Text>
      <View style={styles.status}>
        {done ? <CheckIcon size={16} color={panelColors.OK} /> : <View style={styles.waitDot} />}
        <Text style={[styles.statusText, done && { color: panelColors.OK }]}>{status}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { gap: 8 },
  row: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: panelColors.OPTION,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowDone: { backgroundColor: 'rgba(76,217,100,0.12)', borderColor: 'rgba(76,217,100,0.45)' },
  ask: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  waitDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  statusText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.muted },
  empty: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.muted },
});
