import * as AppleAuthentication from 'expo-apple-authentication';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { signInWithApple, signInWithGoogle, signOut, useAccount, type SignInResult } from '../account/account';
import { SHARING_ENABLED } from '../account/flags';
import { Button } from '../components/Button';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';

/** Account: sign in with Apple or Google, see who is signed in, sign out (sharing design, Phase 1). */
export default function AccountScreen() {
  if (!SHARING_ENABLED) return <Redirect href="/" />;
  return <AccountView />;
}

function AccountView() {
  const { t } = useT();
  const { ready, account } = useAccount();
  const [busy, setBusy] = useState<'apple' | 'google' | 'out' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: 'apple' | 'google' | 'out', action: () => Promise<SignInResult | void>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (e) {
      if (__DEV__) console.warn('[account]', e);
      setError(kind === 'out' ? t('account.signOutFailed') : t('account.signInFailed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.back}>{t('common.back')}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('account.title')}</Text>
        {!ready ? (
          <ActivityIndicator color={colors.accent} />
        ) : account === null ? (
          <>
            <Text style={styles.body}>{t('account.why')}</Text>
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
          </>
        ) : (
          <>
            <View style={styles.card}>
              {account.name ? <Text style={styles.name}>{account.name}</Text> : null}
              {account.email ? <Text style={styles.email}>{account.email}</Text> : null}
              <Text style={styles.provider}>
                {account.provider === 'apple' ? t('account.viaApple') : account.provider === 'google' ? t('account.viaGoogle') : ''}
              </Text>
            </View>
            <Button
              label={busy === 'out' ? t('account.signingOut') : t('account.signOut')}
              variant="secondary"
              loading={busy === 'out'}
              disabled={busy !== null}
              onPress={() => void run('out', signOut)}
            />
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
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
  apple: { height: 56, width: '100%' },
  dimmed: { opacity: 0.5 },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, gap: 4 },
  name: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.text },
  email: { fontFamily: fonts.body, fontSize: 15, color: colors.soft },
  provider: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  error: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.warning },
});
