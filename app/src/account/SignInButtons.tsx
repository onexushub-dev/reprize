import * as AppleAuthentication from 'expo-apple-authentication';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { signInWithApple, signInWithGoogle, type SignInResult } from './account';

/** Continuar com a Apple and Continuar com Google, with the privacy line and the error, as on the account screen. */
export function SignInButtons() {
  const { t } = useT();
  const [busy, setBusy] = useState<'apple' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: 'apple' | 'google', action: () => Promise<SignInResult>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (e) {
      if (__DEV__) console.warn('[account]', e);
      setError(t('account.signInFailed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.root}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={radius.button}
        style={[styles.apple, busy !== null && styles.dimmed]}
        onPress={() => {
          if (busy === null) void run('apple', signInWithApple);
        }}
      />
      <Button
        label={busy === 'google' ? t('account.signingIn') : t('account.google')}
        variant="secondary"
        loading={busy === 'google'}
        disabled={busy !== null}
        onPress={() => void run('google', signInWithGoogle)}
      />
      <Text style={styles.note}>{t('account.privacy')}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 16 },
  apple: { height: 56, width: '100%' },
  dimmed: { opacity: 0.5 },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  error: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.warning },
});
