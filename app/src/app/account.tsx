import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { deleteAccount, signOut, useAccount, type DeleteResult } from '../account/account';
import { SignInButtons } from '../account/SignInButtons';
import { SHARING_ENABLED } from '../account/flags';
import { Button } from '../components/Button';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';

type Busy = 'out' | 'delete';
type Translate = ReturnType<typeof useT>['t'];

const FAILED: Record<Busy, (t: Translate) => string> = {
  out: (t) => t('account.signOutFailed'),
  delete: (t) => t('account.deleteFailed'),
};

/** Account: sign in with Apple or Google, see who is signed in, sign out, delete the account (sharing design, Phase 1). */
export default function AccountScreen() {
  if (!SHARING_ENABLED) return <Redirect href="/" />;
  return <AccountView />;
}

function AccountView() {
  const { t } = useT();
  const { ready, account } = useAccount();
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(kind: Busy, action: () => Promise<DeleteResult | void>) {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (result === 'deleted') setNotice(t('account.deleted'));
    } catch (e) {
      if (__DEV__) console.warn('[account]', e);
      setError(FAILED[kind](t));
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete() {
    Alert.alert(t('account.deleteTitle'), t('account.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('account.deleteConfirm'), style: 'destructive', onPress: () => void run('delete', deleteAccount) },
    ]);
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
            <SignInButtons />
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
            <Pressable
              accessibilityRole="button"
              disabled={busy !== null}
              hitSlop={8}
              style={styles.deleteRow}
              onPress={confirmDelete}
            >
              {busy === 'delete' ? <ActivityIndicator color={colors.warning} /> : null}
              <Text style={[styles.delete, busy !== null && styles.dimmed]}>
                {busy === 'delete' ? t('account.deleting') : t('account.delete')}
              </Text>
            </Pressable>
          </>
        )}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
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
  dimmed: { opacity: 0.5 },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, gap: 4 },
  name: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.text },
  email: { fontFamily: fonts.body, fontSize: 15, color: colors.soft },
  provider: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  error: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.warning },
  notice: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.soft },
  deleteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  delete: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.warning },
});
