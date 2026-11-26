import { BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold } from '@expo-google-fonts/barlow-condensed';
import { Manrope_400Regular, Manrope_600SemiBold, Manrope_700Bold } from '@expo-google-fonts/manrope';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { isRemoteSupported, remoteHostStart, remoteHostStop } from '../../modules/replay-camera';
import { analytics, initAnalytics, sessionSummary, track } from '../analytics';
import { useScreenViews } from '../analytics/useScreenViews';
import { startUploadQueue } from '../cloud/appUploadQueue';
import { startSharePrep } from '../cloud/appSharePrep';
import { startReceiveQueue } from '../cloud/receive';
import { GlassDialogHost } from '../components/GlassDialog';
import { startFocusQueue } from '../focus/appFocusQueue';
import { applyVoiceEngine } from '../voice/voiceEngine';
import { useLocaleSync } from '../i18n/useT';
import { payments } from '../payments';
import { RemoteStartListener } from '../session/RemoteStartListener';
import { SessionProvider } from '../session/SessionContext';
import { clearExportsFolder } from '../share/exportCache';
import { colors } from '../theme/tokens';

SplashScreen.preventAutoHideAsync();
// Exports from the last run (a crash or a kill leaves them) go once per start; within a run they are reused.
clearExportsFolder();
// Anonymous usage metrics: starts the first session and sends app_open. Without a key in the build it sends nothing.
initAnalytics();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    BarlowCondensed_700Bold,
    BarlowCondensed_800ExtraBold,
    Manrope_400Regular,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });

  // The app language follows the device (Android can change it while the app runs).
  useLocaleSync();

  // Metrics: one screen view per route change, by route pattern.
  useScreenViews();

  useEffect(() => {
    payments.start();
  }, []);

  // Metrics: the session ends when the app leaves the front; coming back starts a new one (the cold start's was begun
  // by initAnalytics).
  useEffect(() => {
    let wasBackground = false;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        wasBackground = true;
        sessionSummary.flush();
      } else if (next === 'active' && wasBackground) {
        wasBackground = false;
        analytics.startSession();
        sessionSummary.start();
        track('app_open', { cold_start: false });
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  // Modo Foco in the background: clips are analysed while the app is open and no recording runs.
  useEffect(() => startFocusQueue(), []);
  // The voice trigger engine chosen in Diagnóstico (dictation unless a build with diagnostics chose the model).
  useEffect(() => applyVoiceEngine(), []);

  // Shared recordings upload in the background; the queue starts again what a swiped-away app left (sharing design §5.4).
  useEffect(() => startUploadQueue(), []);
  useEffect(() => startSharePrep(), []);
  // Received recordings download into the app while their link lasts (sharing design §5.5).
  useEffect(() => startReceiveQueue(), []);

  // The camera phone answers its paired remotes for as long as the app is open, whatever screen is in front: tying it to
  // one screen dropped the link every time the player moved between the setup, the recording and the summary.
  // Coming back to the front starts the advertising over, since iOS may have dropped it while the app was away.
  useEffect(() => {
    if (!isRemoteSupported()) return;
    remoteHostStart();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') remoteHostStart();
    });
    return () => {
      sub.remove();
      remoteHostStop();
    };
  }, []);

  if (!loaded && !error) return null;

  return (
    <SessionProvider>
      <StatusBar style="light" />
      <RemoteStartListener />
      {/* Back by swiping right from anywhere on the screen, not only the edge (iOS). */}
      <Stack screenOptions={{ headerShown: false, fullScreenGestureEnabled: true, contentStyle: { backgroundColor: colors.ground } }}>
        {/* The clip screen does its own swipe (between clips; on the first clip, back) and its trim handles drag sideways.
            A transparent modal with no animation of its own (2026-11-21): the recording's grid stays under it, so the clip
            grows out of its tile and, dragged down, shrinks back into it, like Photos. */}
        <Stack.Screen
          name="clip/[id]"
          options={{
            gestureEnabled: false,
            presentation: 'transparentModal',
            animation: 'none',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        {/* Controle Bluetooth (2026-11-22): a sheet as tall as what it holds over the setup screen, like the app's other
            sheets. Transparent, so the camera stays visible above it; the sheet rises on its own, the whole fades out. */}
        <Stack.Screen
          name="devices"
          options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }}
        />
        {/* Compartilhar gravação: a sheet over the recording, closed by swiping down. */}
        <Stack.Screen name="share/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="share/group" options={{ presentation: 'modal' }} />
      </Stack>
      {/* The app's confirmations, in its glass (2026-11-23): shown over whatever screen asked. */}
      <GlassDialogHost />
    </SessionProvider>
  );
}
