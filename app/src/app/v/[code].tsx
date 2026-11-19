// A shared link, https://reprizeapp.com/v/<code> (or www.), opened in the app (sharing design §3.2, §7): the received
// recording is made (or found again), its clips start downloading, and the recording opens.
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SHARING_ENABLED } from '../../account/flags';
import { receiveShare, type ReceiveResult } from '../../cloud/receive';
import { repo } from '../../data/mmkv';
import { Button } from '../../components/Button';
import { useT } from '../../i18n/useT';
import { colors, fonts } from '../../theme/tokens';

type Failure = Extract<ReceiveResult, { ok: false }>['state'];

export default function SharedLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  if (!SHARING_ENABLED) return <Redirect href="/" />;
  return <Receive code={code} />;
}

/**
 * Opened from inside the app (or with the app already running), the recording replaces this screen. Opened cold from a
 * link, nothing is under it: the usual stack is built (setup, games, the recording) so Back and "Nova gravação" work as
 * after a game. Someone who installed the app only to watch skips the onboarding; it is still there, under the games.
 */
function openRecording(sessionId: string) {
  const session = `/session/${sessionId}` as const;
  if (router.canGoBack()) {
    router.replace(session);
    return;
  }
  router.replace(repo.getPrefs().onboardingDone ? '/setup' : '/onboarding');
  router.push('/games');
  router.push(session);
}

function Receive({ code }: { code: string }) {
  const { t } = useT();
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    receiveShare(code).then((result) => {
      if (!alive) return;
      if (result.ok) openRecording(result.sessionId);
      else setFailure(result.state);
    });
    return () => {
      alive = false;
    };
  }, [code, attempt]);

  const message =
    failure === 'expired'
      ? t('received.expired')
      : failure === 'off'
        ? t('received.off')
        : failure === 'removed'
          ? t('received.removed')
          : failure === 'not_found'
            ? t('received.notFound')
            : failure === 'own'
              ? t('received.own')
              : t('received.error');

  return (
    <SafeAreaView style={styles.root}>
      {failure === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.body}>{t('received.opening')}</Text>
        </View>
      ) : (
        <View style={styles.center}>
          <Text style={styles.body}>{message}</Text>
          {failure === 'error' ? (
            <Button
              label={t('common.tryAgain')}
              onPress={() => {
                setFailure(undefined);
                setAttempt((n) => n + 1);
              }}
            />
          ) : null}
          <Button label={t('received.home')} variant="secondary" onPress={() => router.replace('/')} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  center: { flex: 1, alignItems: 'stretch', justifyContent: 'center', padding: 24, gap: 16 },
  body: { fontFamily: fonts.body, fontSize: 17, lineHeight: 24, color: colors.soft, textAlign: 'center' },
});
