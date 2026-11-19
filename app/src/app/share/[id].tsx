import { File } from 'expo-file-system';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { refreshOrSignOut, useAccount } from '../../account/account';
import { SHARING_ENABLED } from '../../account/flags';
import { SignInButtons } from '../../account/SignInButtons';
import { track } from '../../analytics';
import { ensureCover } from '../../cloud/shareCover';
import { liveShare, shareRecording, turnOffRecordingShare } from '../../cloud/shareRecording';
import { acceptNotice, noticeAccepted, type ShareRefusal } from '../../cloud/shares';
import { Button } from '../../components/Button';
import { ShareLinkPanel } from '../../components/ShareLinkPanel';
import { ShareNotice } from '../../components/ShareNotice';
import type { SessionShare } from '../../data/schema';
import { diag } from '../../diag/diagLog';
import { useT } from '../../i18n/useT';
import { openPaywall } from '../../payments/feedback';
import { useOverlayCapturer } from '../../share/OverlayCapturer';
import { colors, fonts } from '../../theme/tokens';

/** The app mark pictures of the cover, once it is made. */
function removeQuietly(path: string): void {
  try {
    new File(`file://${path}`).delete();
  } catch {
    // already gone
  }
}

/** Where the flow is once the account is known; signing in is read from the account itself. */
type Step =
  | { kind: 'idle' }
  | { kind: 'notice' }
  | { kind: 'creating' }
  | { kind: 'ready'; shared: SessionShare }
  | { kind: 'off' }
  | { kind: 'refused'; reason: Exclude<ShareRefusal, 'sign_in' | 'notice'> };

/**
 * Compartilhar gravação (sharing design §3.1): sign in if needed, the liability notice the first time, then the link and
 * its QR code. A link that is still live opens straight away. Reached from an ended recording, PRO only.
 */
export default function ShareScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!SHARING_ENABLED) return <Redirect href="/" />;
  return <ShareFlow sessionId={id} />;
}

function ShareFlow({ sessionId }: { sessionId: string }) {
  const { t } = useT();
  const { ready, account } = useAccount();
  const [step, setStep] = useState<Step>(() => {
    const live = liveShare(sessionId);
    return live ? { kind: 'ready', shared: live } : { kind: 'idle' };
  });
  const [agreeing, setAgreeing] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  const [offError, setOffError] = useState(false);
  const accountId = account === null ? null : account.id;
  // Draws the app mark of the cover (the web preview) while this sheet is open.
  const capturer = useOverlayCapturer();
  const shareId = step.kind === 'ready' ? step.shared.shareId : undefined;
  useEffect(() => {
    if (shareId === undefined) return;
    const make = () => void ensureCover(sessionId, capturer.capture).finally(() => capturer.release(removeQuietly));
    make();
    // iOS stops a video export when the app leaves the front (the sender went to WhatsApp to send the link): the cover
    // is made again when the app comes back with this sheet still open.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') make();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per link shown
  }, [shareId]);
  const started = useRef<string | null>(null);

  async function create(again = true) {
    setStep({ kind: 'creating' });
    const result = await shareRecording(sessionId);
    if (result.ok) setStep({ kind: 'ready', shared: result.shared });
    else if (result.reason === 'notice') setStep({ kind: 'notice' });
    else if (result.reason === 'sign_in') {
      // The server did not accept the session: a fresh token is tried once; a session gone for good signs this phone
      // out, and the sheet asks to sign in again.
      if (!again) setStep({ kind: 'refused', reason: 'failed' });
      else if (await refreshOrSignOut()) await create(false);
      else setStep({ kind: 'idle' });
    } else setStep({ kind: 'refused', reason: result.reason });
  }

  // Once signed in: the notice the first time, then the link. A live link shown at once is left alone.
  useEffect(() => {
    if (step.kind === 'ready' || !ready) return;
    if (accountId === null) {
      started.current = null;
      return;
    }
    if (started.current === accountId) return;
    started.current = accountId;
    noticeAccepted()
      .then((accepted) => (accepted ? create() : setStep({ kind: 'notice' })))
      .catch((e: unknown) => {
        diag(`envio: conferir aviso FALHOU (${e instanceof Error ? e.message : String(e)})`);
        setStep({ kind: 'refused', reason: 'failed' });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the account changes
  }, [ready, accountId]);

  async function agree() {
    if (accountId === null) return;
    setAgreeing(true);
    try {
      await acceptNotice(accountId);
      track('share_notice_accepted');
      await create();
    } catch {
      setStep({ kind: 'refused', reason: 'failed' });
    } finally {
      setAgreeing(false);
    }
  }

  function confirmTurnOff() {
    Alert.alert(t('sharing.turnOffTitle'), t('sharing.turnOffBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('sharing.turnOffConfirm'), style: 'destructive', onPress: () => void turnOff() },
    ]);
  }

  async function turnOff() {
    setTurningOff(true);
    setOffError(false);
    const ok = await turnOffRecordingShare(sessionId);
    setTurningOff(false);
    if (ok) setStep({ kind: 'off' });
    else setOffError(true);
  }

  // What shows: the link when there is one; before the account is read, a spinner; signed out, the sign-in buttons.
  const view =
    step.kind === 'ready' || step.kind === 'off'
      ? step.kind
      : !ready || (accountId !== null && step.kind === 'idle')
        ? 'loading'
        : accountId === null
          ? 'signIn'
          : step.kind;

  async function subscribe() {
    const outcome = await openPaywall(t, 'locked_feature');
    if (outcome === 'purchased' || outcome === 'restored') await create();
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.back}>{t('common.close')}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {view === 'notice' ? null : <Text style={styles.title}>{t('sharing.title')}</Text>}
        {view === 'loading' ? <ActivityIndicator color={colors.accent} /> : null}
        {view === 'signIn' ? (
          <>
            <Text style={styles.body}>{t('sharing.signIn')}</Text>
            <SignInButtons />
          </>
        ) : null}
        {view === 'notice' ? <ShareNotice busy={agreeing} onAgree={() => void agree()} /> : null}
        {view === 'creating' ? (
          <View style={styles.creating}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.body}>{t('sharing.creating')}</Text>
          </View>
        ) : null}
        {view === 'ready' && step.kind === 'ready' ? (
          <>
            <ShareLinkPanel shared={step.shared} />
            <Pressable
              accessibilityRole="button"
              disabled={turningOff}
              hitSlop={8}
              onPress={confirmTurnOff}
              style={styles.turnOff}
            >
              {turningOff ? <ActivityIndicator color={colors.warning} /> : null}
              <Text style={styles.turnOffText}>{turningOff ? t('sharing.turningOff') : t('sharing.turnOff')}</Text>
            </Pressable>
            {offError ? <Text style={styles.error}>{t('sharing.turnOffFailed')}</Text> : null}
          </>
        ) : null}
        {view === 'off' ? (
          <>
            <Text style={styles.body}>{t('sharing.turnedOff')}</Text>
            <Button label={t('sharing.newLink')} onPress={() => void create()} />
          </>
        ) : null}
        {view === 'refused' && step.kind === 'refused' ? (
          <>
            <Text style={styles.body}>
              {step.reason === 'not_pro' ? t('sharing.notPro') : step.reason === 'too_many' ? t('sharing.tooMany') : t('sharing.failed')}
            </Text>
            {step.reason === 'not_pro' ? <Button label={t('sharing.subscribe')} onPress={() => void subscribe()} /> : null}
            {step.reason === 'failed' ? <Button label={t('common.tryAgain')} onPress={() => void create()} /> : null}
          </>
        ) : null}
      </ScrollView>
      {capturer.element}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  header: { paddingHorizontal: 20, paddingVertical: 12 },
  back: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.accent },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 16 },
  title: { fontFamily: fonts.displayBold, fontSize: 34, color: colors.text, textTransform: 'uppercase' },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: colors.soft },
  creating: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  turnOff: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  turnOffText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.warning },
  error: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.warning, textAlign: 'center' },
});
