import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  addReplayListener,
  setGestureEnabled,
  setVoiceEnabled,
  signalSaved,
} from '../../modules/replay-camera';
import type { TriggerSource } from '../../modules/replay-camera/src/ReplayCamera.types';
import { type AppLocale, VOICE_WORD, voiceLocale } from '../i18n';
import { useT } from '../i18n/useT';
import { colors, fonts, footer, radius } from '../theme/tokens';
import { Button } from './Button';
import { SpeakingFigure } from './SpeakingFigure';
import { WavingFigure } from './WavingFigure';

/** What the practice shows: waiting for it, arms up (the gesture only: now wave), or recognized (until "try again"). */
export type PracticeState = 'waiting' | 'raised' | 'done';

/** Arms-up readings come about once a second: without one for this long, the arms are down again. */
export const RAISED_HOLD_MS = 1800;

export type PracticeTrigger = {
  source: TriggerSource;
  /** Turns the trigger's detection on for the practice, and off after it (before a game nothing listens). */
  enable(on: boolean): void;
  /** Follow arms-up readings (the gesture). */
  watchRaised: boolean;
};

/**
 * A trigger's practice on the setup screen: while on, the camera listens for that trigger and the screen follows it.
 * Once recognized (with the save chime), it stays so until `retry`. Nothing is saved: the session only saves while
 * recording.
 */
export function usePractice(on: boolean, trigger: PracticeTrigger): { state: PracticeState; retry: () => void } {
  const [state, setState] = useState<PracticeState>('waiting');
  const done = useRef(false);
  const current = useRef(trigger);
  useEffect(() => {
    current.current = trigger;
  });

  useEffect(() => {
    if (!on) return;
    const { source, enable, watchRaised } = current.current;
    enable(true);
    let raisedTimer: ReturnType<typeof setTimeout> | undefined;
    const debug = watchRaised
      ? addReplayListener('onGestureDebug', (e) => {
          if (done.current || !(e.isX || e.raised === true)) return;
          setState('raised');
          if (raisedTimer !== undefined) clearTimeout(raisedTimer);
          raisedTimer = setTimeout(() => {
            if (!done.current) setState('waiting');
          }, RAISED_HOLD_MS);
        })
      : undefined;
    const heard = addReplayListener('onTrigger', (e) => {
      if (e.source !== source || done.current) return;
      done.current = true;
      if (raisedTimer !== undefined) clearTimeout(raisedTimer);
      setState('done');
      signalSaved({ sound: true, flash: false });
    });
    return () => {
      if (debug !== undefined) debug.remove();
      heard.remove();
      if (raisedTimer !== undefined) clearTimeout(raisedTimer);
      enable(false);
      done.current = false;
      setState('waiting');
    };
  }, [on]);

  const retry = () => {
    done.current = false;
    setState('waiting');
  };
  return { state, retry };
}

type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  figure: ReactNode;
  how: string;
  note: string;
  trigger: PracticeTrigger;
  texts: { waiting: string; raised?: string; done: string };
  /** The practice cannot run yet (a permission): what to say and the button that unblocks it. */
  blocked?: { text: string; action: string; onAction: () => void };
};

/** A trigger's "?" (setup screen): the trigger moving, how to use it, and practice with the live camera. */
export function PracticeSheet({ visible, onClose, title, figure, how, note, trigger, texts, blocked }: SheetProps) {
  const { t } = useT();
  const { state, retry } = usePractice(visible && blocked === undefined, trigger);
  const status =
    state === 'done' ? texts.done : state === 'raised' && texts.raised !== undefined ? texts.raised : texts.waiting;

  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel={t('common.close')} style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.grabber} />
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <View style={styles.howRow}>
            {figure}
            <View style={styles.howText}>
              <Text style={styles.how}>{how}</Text>
              <Text style={styles.note}>{note}</Text>
            </View>
          </View>
          <Text style={styles.section}>{t('practice.section')}</Text>
          {blocked !== undefined ? (
            <View style={styles.status}>
              <Text style={[styles.statusText, styles.statusTextWaiting]}>{blocked.text}</Text>
              <Button label={blocked.action} onPress={blocked.onAction} />
            </View>
          ) : (
            <View
              accessibilityLiveRegion="polite"
              style={[styles.status, state === 'raised' && styles.statusRaised, state === 'done' && styles.statusDone]}>
              <Text
                testID="practice-status"
                style={[
                  styles.statusText,
                  state === 'waiting' && styles.statusTextWaiting,
                  state === 'done' && styles.statusTextDone,
                ]}>
                {status}
              </Text>
              {state === 'done' ? (
                <Pressable accessibilityRole="button" onPress={retry} hitSlop={8} style={styles.retry}>
                  <Text style={styles.retryText}>{t('practice.retry')}</Text>
                </Pressable>
              ) : null}
            </View>
          )}
          <Button label={t('common.close')} variant="secondary" onPress={onClose} />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const gestureTrigger: PracticeTrigger = { source: 'gesture', enable: setGestureEnabled, watchRaised: true };

/** The wave gesture's "?". */
export function GestureSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useT();
  return (
    <PracticeSheet
      visible={visible}
      onClose={onClose}
      title={t('gestureGuide.title')}
      figure={<WavingFigure size={88} accessibilityLabel={t('onboarding.wave.how')} />}
      how={t('onboarding.wave.how')}
      note={t('gestureGuide.stay')}
      trigger={gestureTrigger}
      texts={{ waiting: t('gestureGuide.waiting'), raised: t('gestureGuide.raised'), done: t('gestureGuide.done') }}
    />
  );
}

type VoiceProps = {
  visible: boolean;
  onClose: () => void;
  locale: AppLocale;
  /** The speech permission: practice needs it granted. */
  speech: 'granted' | 'denied' | 'undetermined';
  /** Asks for the permission (the system prompt). */
  onAllow: () => void;
};

/** The voice trigger's "?". */
export function VoiceSheet({ visible, onClose, locale, speech, onAllow }: VoiceProps) {
  const { t } = useT();
  const word = VOICE_WORD[locale];
  const trigger: PracticeTrigger = {
    source: 'voice',
    enable: (on) => setVoiceEnabled(on, voiceLocale(locale)),
    watchRaised: false,
  };
  const blocked =
    speech === 'granted'
      ? undefined
      : speech === 'denied'
        ? { text: t('voiceGuide.deniedText'), action: t('common.openSettings'), onAction: () => void Linking.openSettings() }
        : { text: t('voiceGuide.allowText'), action: t('voiceGuide.allow'), onAction: onAllow };
  return (
    <PracticeSheet
      visible={visible}
      onClose={onClose}
      title={t('voiceGuide.title')}
      figure={<SpeakingFigure size={88} accessibilityLabel={t('voiceGuide.how', { word })} />}
      how={t('voiceGuide.how', { word })}
      note={t('voiceGuide.stay')}
      trigger={trigger}
      texts={{ waiting: t('voiceGuide.waiting', { word }), done: t('voiceGuide.done') }}
      blocked={blocked}
    />
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: footer.side,
    paddingTop: 10,
    paddingBottom: footer.bottom,
    gap: 14,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  title: { fontFamily: fonts.displayBold, fontSize: 26, color: colors.text, marginTop: 6 },
  howRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  howText: { flex: 1, gap: 6 },
  how: { fontFamily: fonts.bodySemi, fontSize: 16, lineHeight: 22, color: colors.text },
  note: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.soft },
  section: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.muted, textTransform: 'uppercase' },
  // Big and colored: it is read from a few steps away, with the arms up.
  status: {
    minHeight: 92,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  statusRaised: { borderColor: colors.accent },
  statusDone: { borderColor: colors.accent, backgroundColor: colors.accent },
  statusText: { fontFamily: fonts.displayBold, fontSize: 28, lineHeight: 32, color: colors.accent, textAlign: 'center' },
  statusTextWaiting: { fontFamily: fonts.bodySemi, fontSize: 16, lineHeight: 22, color: colors.text },
  statusTextDone: { color: colors.onAccent },
  retry: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.onAccent,
  },
  retryText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.onAccent },
});
