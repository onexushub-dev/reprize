import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccount } from '../account/account';
import { SignInButtons } from '../account/SignInButtons';
import { track } from '../analytics';
import { courtesiesLeft, spendCourtesy } from '../cloud/courtesy';
import { deviceId } from '../cloud/receive';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { Button } from './Button';

export type CourtesyChoice = 'go' | 'pro' | 'cancel';

type Props = {
  visible: boolean;
  /** The received recording's share (what the server counts the courtesy on). */
  shareId: string | null;
  onChoose: (choice: CourtesyChoice) => void;
  onDismissed: () => void;
};

/** Where the sheet is once the account is known. */
type Step =
  | { kind: 'loading' }
  | { kind: 'offer' }
  | { kind: 'spending' }
  | { kind: 'exhausted' }
  | { kind: 'error'; message: 'failed' | 'notMember' };

/**
 * Before the first Save or Send of a received recording without Pro (sharing design §2 decision 9, §3.2 step 4): sign
 * in, then "Usar sua gravação de cortesia?" (one per account); once it is used, Pro only. The server spends the courtesy; no
 * free export, no Single Pass here.
 */
export function CourtesySheet({ visible, shareId, onChoose, onDismissed }: Props) {
  const { t } = useT();
  const { ready, account } = useAccount();
  const accountId = account === null ? null : account.id;
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!visible || accountId === null) return;
    // Starts as loading: the gate mounts a fresh sheet for every ask, and Tentar de novo sets it again.
    let alive = true;
    void courtesiesLeft(accountId).then((left) => {
      if (!alive) return;
      if (left === null) setStep({ kind: 'error', message: 'failed' });
      else if (left === 0) {
        track('courtesy_exhausted');
        setStep({ kind: 'exhausted' });
      } else setStep({ kind: 'offer' });
    });
    return () => {
      alive = false;
    };
  }, [visible, accountId, attempt]);

  async function spend() {
    if (shareId === null) return;
    setStep({ kind: 'spending' });
    const result = await spendCourtesy(shareId, deviceId());
    if (result.ok) {
      track('courtesy_used', { remaining: result.remaining });
      onChoose('go');
    } else if (result.reason === 'exhausted') {
      track('courtesy_exhausted');
      setStep({ kind: 'exhausted' });
    } else if (result.reason === 'not_member') setStep({ kind: 'error', message: 'notMember' });
    else setStep({ kind: 'error', message: 'failed' });
  }

  function body() {
    if (!ready) return <ActivityIndicator color={colors.accent} />;
    if (account === null) {
      return (
        <>
          <Text accessibilityRole="header" style={styles.title}>
            {t('courtesy.askTitle')}
          </Text>
          <Text style={styles.text}>{t('courtesy.signIn')}</Text>
          <SignInButtons />
        </>
      );
    }
    if (step.kind === 'loading') {
      return (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.text}>{t('courtesy.loading')}</Text>
        </View>
      );
    }
    if (step.kind === 'exhausted') {
      return (
        <>
          <Text accessibilityRole="header" style={styles.title}>
            {t('courtesy.exhaustedTitle')}
          </Text>
          <Text style={styles.text}>{t('courtesy.exhaustedBody')}</Text>
          <Button label={t('courtesy.pro')} onPress={() => onChoose('pro')} />
        </>
      );
    }
    if (step.kind === 'error') {
      return (
        <>
          <Text style={styles.text}>{t(step.message === 'notMember' ? 'courtesy.notMember' : 'courtesy.failed')}</Text>
          {step.message === 'failed' ? (
            <Button
              label={t('common.tryAgain')}
              onPress={() => {
                setStep({ kind: 'loading' });
                setAttempt((n) => n + 1);
              }}
            />
          ) : null}
        </>
      );
    }
    const spending = step.kind === 'spending';
    return (
      <>
        <Text accessibilityRole="header" style={styles.title}>
          {t('courtesy.askTitle')}
        </Text>
        <Text style={styles.text}>{t('courtesy.askBody')}</Text>
        <Button label={t('courtesy.use')} loading={spending} disabled={spending} onPress={() => void spend()} />
        <Button label={t('courtesy.pro')} variant="secondary" disabled={spending} onPress={() => onChoose('pro')} />
        <Text style={styles.note}>{t('courtesy.proNote')}</Text>
      </>
    );
  }

  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={() => onChoose('cancel')}
      onDismiss={onDismissed}
      supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel={t('common.cancel')} style={StyleSheet.absoluteFill} onPress={() => onChoose('cancel')} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.grabber} />
          {body()}
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => onChoose('cancel')} style={styles.cancel}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 14,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  title: { fontFamily: fonts.displayBold, fontSize: 26, color: colors.text, marginTop: 6 },
  text: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.soft },
  note: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.muted },
  loading: { alignItems: 'center', gap: 10, paddingVertical: 16 },
  cancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.soft },
});
