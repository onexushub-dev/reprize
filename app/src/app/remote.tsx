import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  addReplayListener,
  getMicrophonePermission,
  getSpeechPermission,
  isVoiceSupported,
  remoteControllerForget,
  remoteControllerHost,
  remoteControllerPairWithCode,
  remoteControllerPairWithLink,
  remoteControllerStartRecording,
  remoteControllerEndRecording,
  remoteControllerSave,
  remoteControllerStart,
  remoteControllerStop,
  remoteVoiceSetEnabled,
  requestMicrophonePermission,
  requestSpeechPermission,
  setRemoteScreenDim,
} from '../../modules/replay-camera';
import type { RemoteLink, RemoteLinkReason, RemotePairFailure, RemotePeer } from '../../modules/replay-camera/src/ReplayCamera.types';
import { track } from '../analytics';
import { Button } from '../components/Button';
import { ConnectionBar } from '../components/ConnectionBar';
import { QrScanner } from '../components/QrScanner';
import { RequirementsChecklist } from '../components/RequirementsChecklist';
import { DeviceNameField } from '../components/DeviceNameField';
import { EconomyToast } from '../components/EconomyToast';
import { HoldButton } from '../components/HoldButton';
import { BatteryIcon, BatteryOffIcon, MicIcon } from '../components/icons';
import { PulseRing } from '../components/PulseRing';
import { ResultFlash } from '../components/ResultFlash';
import { TriggerTile } from '../components/TriggerTile';
import { repo } from '../data/mmkv';
import type { Prefs } from '../data/schema';
import { parseCode, parsePairUrl } from '../remote/pairLink';
import { canSave, connectionTone, remoteScreen } from '../remote/remoteScreen';
import { cooldownLeft, IDLE, onResult, onTap, tick, type SaveFeedback } from '../remote/saveFeedback';
import { VOICE_WORD, voiceLocale, type TFunction } from '../i18n';
import { useT } from '../i18n/useT';
import { useScreenEconomy } from '../session/useScreenEconomy';
import { colors, fonts, radius } from '../theme/tokens';

const KEEP_AWAKE_TAG = 'remote';
const TICK_MS = 250;
const CONNECT_TIMEOUT_MS = 12_000;
/** The camera phone has this long to show it is recording before the remote says it did not start. */
const START_WAIT_MS = 8000;
/** "Segure para encerrar" is sent again this often until the camera phone shows it stopped (a weak link can lose it). */
const END_RETRY_MS = 1500;
/** The camera phone has this long to show it stopped before the remote says it did not end. */
const END_WAIT_MS = 8000;
/** How long "Tentar reconexão" waits before it can be tapped again. */
const RETRY_WAIT_MS = 6000;
/** Without a touch for this long while the camera records, the remote's screen dims (it is touched more than the camera). */
const REMOTE_ECONOMY_IDLE_MS = 60_000;
/** How long the battery-saving notice stays up when a recording starts with it on. */
const ECONOMY_NOTICE_MS = 5000;
/** How long the toast after a tap on the battery-saving tile stays up. */
const ECONOMY_TOAST_MS = 3000;

type Received = { recording: boolean; clipCount: number; startedAt: number | null; receivedAt: number };

const clock = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

function failureText(reason: RemotePairFailure, t: TFunction): string {
  switch (reason) {
    case 'expired':
      return t('remote.failExpired');
    case 'locked':
      return t('remote.failLocked');
    case 'notFound':
      return t('remote.failNotFound');
    case 'denied':
      return t('remote.failUnpaired');
    case 'full':
      return t('remote.failFull');
    case 'used':
      return t('remote.failUsed');
    case 'closed':
      return t('remote.failClosed');
    default:
      return t('remote.failWrongCode');
  }
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{String(n)}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

/** Undoes the pairing with the camera phone. Looks like what it is (it forgets), and says whose pairing goes away. */
function ForgetCamera({ name, onPress }: { name: string; onPress: () => void }) {
  const { t } = useT();
  return (
    <View style={styles.forget}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('remote.forgetCamera')}
        accessibilityHint={t('remote.forgetCameraHint', { name })}
        hitSlop={8}
        onPress={onPress}
        style={styles.forgetButton}>
        <Text style={styles.forgetText}>{t('remote.forgetCamera')}</Text>
      </Pressable>
      <Text style={styles.forgetHint}>{t('remote.forgetCameraNote', { name })}</Text>
    </View>
  );
}

/** The second iPhone: shows the camera phone's game and taps Salvar for it. */
export default function Remote() {
  const { t, locale } = useT();
  const [host, setHost] = useState<RemotePeer | null>(() => remoteControllerHost());
  const [link, setLink] = useState<RemoteLink>('idle');
  const [linkReason, setLinkReason] = useState<RemoteLinkReason | undefined>(undefined);
  // "Tentar reconexão" was tapped: the button waits (and cannot be tapped again) until the link is back or a few seconds pass.
  const [retrying, setRetrying] = useState(false);
  const [peerName, setPeerName] = useState<string | null>(null);
  const [received, setReceived] = useState<Received | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [feedback, setFeedback] = useState<SaveFeedback>(IDLE);
  const [lastSave, setLastSave] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<RemotePairFailure | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [code, setCode] = useState('');
  const lastSaveRef = useRef<number | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [startAskedAt, setStartAskedAt] = useState<number | null>(null);
  const [endAskedAt, setEndAskedAt] = useState<number | null>(null);
  const connectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>(() => repo.getPrefs());
  const updatePrefs = (patch: Partial<Prefs>) => setPrefsState(repo.setPrefs(patch));
  const [noticeFor, setNoticeFor] = useState<string | null>(null);
  const [noticeGone, setNoticeGone] = useState<string | null>(null);
  const [economyToast, setEconomyToast] = useState(0);
  // Voice on this phone: offline recognition only, so it exists only where the on-device model does.
  const voiceSupported = useMemo(() => isVoiceSupported(voiceLocale(locale)), [locale]);
  const [mic, setMic] = useState(() => getMicrophonePermission());
  const [speech, setSpeech] = useState(() => getSpeechPermission());
  // The save of a heard command: the current screen's (set on every render, read by the event listener).
  const voiceSave = useRef<(() => void) | null>(null);
  // How the pairing in progress was started, for the metrics (the camera phone's answer does not say).
  const pairMethod = useRef<'code' | 'qr'>('code');

  const stopConnectTimer = () => {
    if (connectTimer.current !== null) clearTimeout(connectTimer.current);
    connectTimer.current = null;
  };

  useEffect(() => {
    remoteControllerStart();
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      remoteControllerStop();
      deactivateKeepAwake(KEEP_AWAKE_TAG);
      if (connectTimer.current !== null) clearTimeout(connectTimer.current);
    };
  }, []);

  // Time moves everything on: the clock, and the save feedback (sending times out, results clear by themselves).
  useEffect(() => {
    const id = setInterval(() => {
      const at = Date.now();
      setNow(at);
      setFeedback((current) => tick(current, at));
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (feedback.phase === 'timeout') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, [feedback.phase]);

  useEffect(() => {
    const status = addReplayListener('onRemoteStatus', (e) => {
      // This phone also runs the camera side (it starts whenever the app comes to the front): its status is not ours.
      if (e.side !== 'remote') return;
      setLink(e.link);
      setLinkReason(e.reason);
      if (e.peerName !== undefined) setPeerName(e.peerName);
    });
    const state = addReplayListener('onRemoteState', (e) => {
      const at = Date.now();
      setNow(at);
      if (e.recording) setStartAskedAt(null);
      else setEndAskedAt(null);
      setReceived({
        recording: e.recording,
        clipCount: e.clipCount,
        startedAt: e.startedAt === undefined ? null : e.startedAt,
        receivedAt: at,
      });
    });
    const saved = addReplayListener('onRemoteResult', (e) => {
      setFeedback((current) => onResult(current, e.saved, Date.now()));
      Haptics.notificationAsync(
        e.saved ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
      );
    });
    const heard = addReplayListener('onRemoteVoice', () => {
      const saveNow = voiceSave.current;
      if (saveNow !== null) saveNow();
    });
    const pairing = addReplayListener('onRemotePairing', (e) => {
      if (e.phase !== 'paired' && e.phase !== 'failed') return; // the other phases are for the camera phone
      stopConnectTimer();
      setConnecting(false);
      if (e.phase === 'paired') {
        setNotice(null);
        setFailure(null);
        setReceived(null);
        setHost(remoteControllerHost());
        track('pairing_completed', { method: pairMethod.current, kind: 'remote' });
        return;
      }
      track('pairing_failed', { reason: e.reason });
      if (e.reason === 'denied') {
        setHost(null);
        setReceived(null);
      }
      setFailure(e.reason);
      setNotice(failureText(e.reason, t));
    });
    return () => {
      status.remove();
      state.remove();
      saved.remove();
      heard.remove();
      pairing.remove();
    };
  }, [t]);

  const beginConnecting = () => {
    setNotice(null);
    setFailure(null);
    setConnecting(true);
    stopConnectTimer();
    // The camera phone may never answer (out of range, app closed): do not spin forever.
    connectTimer.current = setTimeout(() => {
      connectTimer.current = null;
      setConnecting(false);
      setFailure('notFound');
      setNotice(failureText('notFound', t));
      track('pairing_failed', { reason: 'notFound' });
    }, CONNECT_TIMEOUT_MS);
  };

  const submit = (digits: string) => {
    setLastCode(digits);
    pairMethod.current = 'code';
    beginConnecting();
    remoteControllerPairWithCode(digits);
  };

  // The QR code shown on the camera phone, read right here.
  const onQr = (text: string) => {
    if (connecting) return;
    const link = parsePairUrl(text);
    if (link === null) return;
    setLastCode(null);
    pairMethod.current = 'qr';
    beginConnecting();
    remoteControllerPairWithLink(link.hostId, link.secret, link.hostName);
  };

  // The hold is done: say so at once and keep asking until the camera phone shows the recording ended. The camera phone
  // ends a recording only once, so the repeats are harmless.
  const endRecording = () => {
    setEndAskedAt(Date.now());
    setNotice(null);
    remoteControllerEndRecording();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  useEffect(() => {
    if (endAskedAt === null) return;
    const id = setInterval(() => {
      if (Date.now() - endAskedAt < END_WAIT_MS) remoteControllerEndRecording();
    }, END_RETRY_MS);
    return () => clearInterval(id);
  }, [endAskedAt]);

  const startRecording = () => {
    setEndAskedAt(null);
    setStartAskedAt(Date.now());
    setNotice(null);
    remoteControllerStartRecording();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const typeCode = (text: string) => {
    setCode(text);
    const digits = parseCode(text);
    if (digits !== null && !connecting) submit(digits);
  };

  const connect = () => {
    const digits = parseCode(code);
    if (digits === null) {
      setNotice(t('remote.enterSix'));
      return;
    }
    submit(digits);
  };

  const retry = () => {
    if (lastCode !== null) submit(lastCode);
  };

  // Opened straight from the QR code there is no screen behind this one: go to the start instead of doing nothing.
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  // The link looks lost: start the search over now instead of waiting for the next automatic try.
  const retryNow = () => {
    if (retrying) return;
    setRetrying(true);
    remoteControllerStop();
    remoteControllerStart();
  };

  useEffect(() => {
    if (!retrying) return;
    const timer = setTimeout(() => setRetrying(false), RETRY_WAIT_MS);
    return () => clearTimeout(timer);
  }, [retrying]);

  // Unpair from this side (the camera phone is told too, when it is in reach) and go back to asking for a code.
  const forgetCamera = () => {
    const name = host === null || host.name.length === 0 ? t('remote.theCamera') : host.name;
    Alert.alert(
      t('remote.forgetTitle', { name }),
      t('remote.forgetBodyBoth', { name }),
      [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('remote.forgetAndRepair'),
        style: 'destructive',
        onPress: () => {
          remoteControllerForget();
          setHost(null);
          setReceived(null);
          setFailure(null);
          setNotice(null);
        },
      },
    ],
    );
  };

  const save = () => {
    const at = Date.now();
    if (!canSave(at, lastSaveRef.current)) {
      // Inside the gap between two saves: nothing is sent, but the tap is acknowledged.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    lastSaveRef.current = at;
    setLastSave(at);
    setNow(at);
    setFeedback((current) => onTap(current, at));
    remoteControllerSave();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  };

  const hostLabel =
    host !== null && host.name.length > 0 ? host.name : peerName === null ? t('remote.genericHost') : peerName;
  const screenModel = remoteScreen({
    link,
    reason: linkReason,
    hostName: hostLabel,
    state:
      received === null
        ? null
        : {
            recording: received.recording,
            clipCount: received.clipCount,
            startedAt: received.startedAt,
            ageSec: Math.max(0, (now - received.receivedAt) / 1000),
          },
  });

  // Screen economy, the camera's mechanism with a longer wait and a readable 15% brightness: while the camera records,
  // the screen dims after a minute without a touch. The touch that lights it up only does that (it saves nothing and
  // presses nothing); a lost link lights it up by itself, since the screen is then no longer the recording one.
  const economyOn = host !== null && screenModel.kind === 'recording' && prefs.remoteEconomy;
  const economy = useScreenEconomy(economyOn, 'nominal', setRemoteScreenDim, REMOTE_ECONOMY_IDLE_MS);

  // Battery saving on: say so when a recording starts (from here or from the camera phone), so a dim screen later is no
  // surprise; gone by itself.
  const recordingKey = screenModel.kind === 'recording' ? String(screenModel.startedAt) : null;
  if (economyOn && recordingKey !== null && noticeFor !== recordingKey) setNoticeFor(recordingKey);
  useEffect(() => {
    if (noticeFor === null) return;
    const hide = setTimeout(() => setNoticeGone(noticeFor), ECONOMY_NOTICE_MS);
    return () => clearTimeout(hide);
  }, [noticeFor]);
  const showEconomyNotice = economyOn && !economy.asleep && noticeFor === recordingKey && noticeGone !== noticeFor;

  useEffect(() => {
    if (economyToast === 0) return;
    const hide = setTimeout(() => setEconomyToast(0), ECONOMY_TOAST_MS);
    return () => clearTimeout(hide);
  }, [economyToast]);
  const toggleEconomy = () => {
    updatePrefs({ remoteEconomy: !prefs.remoteEconomy });
    setEconomyToast((n) => n + 1);
  };

  // Voice: "salvar" said near this phone saves like a tap on SALVAR. It listens only while the camera
  // records, with both permissions and the player's choice (on by default); a dim screen keeps listening.
  const voiceGranted = mic === 'granted' && speech === 'granted';
  const voiceDenied = mic === 'denied' || speech === 'denied';
  const voiceOn = voiceSupported && prefs.remoteVoice && voiceGranted;
  const listening = voiceOn && host !== null && screenModel.kind === 'recording';
  const recognizerLocale = voiceLocale(locale);
  useEffect(() => {
    remoteVoiceSetEnabled(listening, recognizerLocale);
  }, [listening, recognizerLocale]);
  useEffect(() => () => remoteVoiceSetEnabled(false, recognizerLocale), [recognizerLocale]);

  // Back from Settings, a permission may have changed.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setMic(getMicrophonePermission());
      setSpeech(getSpeechPermission());
    });
    return () => sub.remove();
  }, []);

  /** Asks for the microphone, then speech recognition; true when both are granted. */
  const askVoice = async (): Promise<boolean> => {
    let micOk = mic === 'granted';
    if (!micOk) {
      micOk = await requestMicrophonePermission();
      track('permission_result', { kind: 'microphone', granted: micOk });
    }
    setMic(micOk ? 'granted' : 'denied');
    if (!micOk) return false;
    let speechOk = speech === 'granted';
    if (!speechOk) {
      speechOk = await requestSpeechPermission();
      track('permission_result', { kind: 'speech', granted: speechOk });
    }
    setSpeech(speechOk ? 'granted' : 'denied');
    return speechOk;
  };

  const toggleVoice = async () => {
    if (voiceOn) return updatePrefs({ remoteVoice: false });
    // A permission said no before: only Settings can change it now.
    if (voiceDenied) return void Linking.openSettings();
    if (await askVoice()) updatePrefs({ remoteVoice: true, remoteVoiceAsked: true });
  };

  // The first time this phone is connected and ready, voice (on by default) is explained before iOS asks for the
  // microphone and speech recognition. "Agora não" turns it off; the tile turns it on again later.
  const waitingNow = host !== null && screenModel.kind === 'waiting';
  const askNow = waitingNow && voiceSupported && prefs.remoteVoice && !voiceGranted && !voiceDenied && prefs.remoteVoiceAsked !== true;
  const askedHere = useRef(false);
  useEffect(() => {
    if (!askNow || askedHere.current) return;
    askedHere.current = true;
    const word = VOICE_WORD[locale];
    // Once per phone: either answer is remembered, so it never comes back.
    Alert.alert(t('remote.voiceAskTitle'), t('remote.voiceAskBody', { word }), [
      {
        text: t('remote.voiceAskLater'),
        style: 'cancel',
        onPress: () => updatePrefs({ remoteVoice: false, remoteVoiceAsked: true }),
      },
      {
        text: t('remote.voiceAskAllow'),
        onPress: () => {
          updatePrefs({ remoteVoiceAsked: true });
          void askVoice();
        },
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askNow]);

  const voiceStatus = !prefs.remoteVoice
    ? t('remote.economyStatusOff')
    : voiceGranted
      ? t('setup.voiceSay', { word: VOICE_WORD[locale] })
      : voiceDenied
        ? t('setup.voiceDenied')
        : t('setup.tapToAllow');

  // A heard command saves only on the recording screen (it can arrive just after the recording ended).
  const recordingNow = host !== null && screenModel.kind === 'recording';
  useEffect(() => {
    voiceSave.current = recordingNow ? save : null;
  });

  if (host === null) {
    return (
      <SafeAreaView style={styles.root}>
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
          <Text style={styles.role}>{t('remote.roleRemote')}</Text>
          <Text style={styles.title}>{t('remote.title')}</Text>
          {notice !== null ? <Text style={styles.warning}>{notice}</Text> : null}
          <Step n={1} text={t('remote.step1')} />
          <Step n={2} text={t('remote.step2')} />
          <QrScanner active={!connecting} onCode={onQr} />
          {connecting ? (
            <View style={styles.connecting}>
              <ActivityIndicator color={colors.text} />
              <Text style={styles.text}>{t('remote.connecting')}</Text>
            </View>
          ) : null}
          {failure === 'notFound' && !connecting && lastCode !== null ? (
            <Button label={t('common.tryAgain')} variant="secondary" onPress={retry} />
          ) : null}
          <RequirementsChecklist />
          <Text style={styles.text}>{t('remote.cantScan')}</Text>
          <TextInput
            accessibilityLabel={t('remote.codeLabel')}
            editable={!connecting}
            keyboardType="number-pad"
            maxLength={7}
            onChangeText={typeCode}
            placeholder="000000"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={code}
          />
          <Button label={connecting ? t('remote.connecting') : t('remote.connect')} loading={connecting} onPress={connect} />
          <DeviceNameField />
          <Button label={t('common.close')} variant="secondary" onPress={leave} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // The button only shows while the link is down or silent, so it simply waits out RETRY_WAIT_MS.
  const retryShown = retrying;
  const recordingDetail =
    screenModel.kind === 'recording'
      ? t('remote.detail', {
          time: screenModel.startedAt === null ? '0:00' : clock((now - screenModel.startedAt) / 1000),
          plays: t('remote.plays', { count: screenModel.clipCount }),
        })
      : undefined;
  const startWaiting = startAskedAt !== null && !(received !== null && received.recording);
  const startPending = startWaiting && now - startAskedAt < START_WAIT_MS;
  const startFailed = startWaiting && now - startAskedAt >= START_WAIT_MS;
  const endPending = endAskedAt !== null && now - endAskedAt < END_WAIT_MS;
  const endFailed = endAskedAt !== null && now - endAskedAt >= END_WAIT_MS;
  const sending = feedback.phase === 'sending';
  const left = cooldownLeft(lastSave, now);
  const flash = feedback.phase === 'saved' || feedback.phase === 'failed' || feedback.phase === 'timeout';

  return (
    <SafeAreaView style={styles.root} onTouchStart={economy.wake}>
      <View style={styles.body}>
        <ConnectionBar tone={connectionTone(screenModel)} name={hostLabel} detail={recordingDetail} />
        {showEconomyNotice ? (
          <View pointerEvents="none" accessibilityRole="alert" testID="economy-notice" style={styles.notice}>
            <Text style={styles.noticeTitle}>{t('remote.economyOnTitle')}</Text>
            <Text style={styles.noticeBody}>{t('remote.economyNoticeBody')}</Text>
          </View>
        ) : null}
        {screenModel.kind === 'recording' ? null : <Text style={styles.role}>{t('remote.roleRemote')}</Text>}
        {notice !== null ? <Text style={styles.warning}>{notice}</Text> : null}

        {screenModel.kind === 'denied' ? (
          <View style={styles.center}>
            {screenModel.reason === 'unauthorized' ? (
              <>
                <Text style={styles.text}>{t('remote.bluetoothDenied')}</Text>
                <Button label={t('common.openSettings')} onPress={() => Linking.openSettings()} />
              </>
            ) : (
              <Text style={styles.text}>{t('remote.bluetoothOff')}</Text>
            )}
          </View>
        ) : null}

        {screenModel.kind === 'searching' ? (
          <View style={styles.center}>
            <PulseRing color={colors.warning} />
            <Text style={styles.status}>{t('remote.searching', { name: screenModel.hostName === null ? hostLabel : screenModel.hostName })}</Text>
            <Text style={styles.hint}>{t('remote.searchingHint')}</Text>
            <ForgetCamera name={hostLabel} onPress={forgetCamera} />
          </View>
        ) : null}

        {screenModel.kind === 'waiting' ? (
          <View style={styles.center}>
            <PulseRing color={colors.accent} />
            <Text style={styles.status}>{t('remote.ready')}</Text>
            <Button
              label={startPending ? t('remote.starting') : t('remote.startRecording')}
              loading={startPending}
              onPress={startRecording}
            />
            {startFailed ? (
              <Text style={styles.warning}>{t('remote.startFailed')}</Text>
            ) : (
              <Text style={styles.hint}>{t('remote.orStartThere')}</Text>
            )}
            <View style={styles.options}>
              <TriggerTile
                icon={prefs.remoteEconomy ? <BatteryIcon color={colors.accent} /> : <BatteryOffIcon />}
                title={t('setup.economy')}
                status={t(prefs.remoteEconomy ? 'remote.economyStatusOn' : 'remote.economyStatusOff')}
                active={prefs.remoteEconomy}
                onPress={toggleEconomy}
              />
              {voiceSupported ? (
                <TriggerTile
                  icon={<MicIcon color={voiceOn ? colors.accent : colors.muted} />}
                  title={t('remote.voiceTitle')}
                  status={voiceStatus}
                  active={voiceOn}
                  onPress={() => void toggleVoice()}
                />
              ) : null}
            </View>
            <ForgetCamera name={hostLabel} onPress={forgetCamera} />
          </View>
        ) : null}

        {screenModel.kind === 'reconnecting' ? (
          <View style={styles.center}>
            <PulseRing color={colors.warning} size={64} />
            <Text style={styles.status}>{t('remote.reconnectingScreen', { name: screenModel.hostName })}</Text>
            <Text style={styles.hint}>{t('remote.keepOpen')}</Text>
            <Button label={retryShown ? t('remote.reconnecting') : t('remote.retryLink')} loading={retryShown} onPress={retryNow} />
            <ForgetCamera name={hostLabel} onPress={forgetCamera} />
          </View>
        ) : null}

        {screenModel.kind === 'stale' ? (
          <>
            <View style={styles.center}>
              <PulseRing color={colors.warning} size={64} />
              <Text style={styles.status}>{t('remote.noSignal', { name: screenModel.hostName })}</Text>
              <Text style={styles.sub}>{t('remote.checkingLink')}</Text>
              <Button label={retryShown ? t('remote.reconnecting') : t('remote.retryLink')} loading={retryShown} onPress={retryNow} />
              <ForgetCamera name={hostLabel} onPress={forgetCamera} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('remote.save')}
              accessibilityState={{ disabled: true }}
              disabled
              style={[styles.save, styles.saveOff]}>
              <Text style={styles.saveText}>{t('remote.save')}</Text>
            </Pressable>
          </>
        ) : null}

        {screenModel.kind === 'recording' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('remote.save')}
            accessibilityState={{ busy: sending }}
            onPress={save}
            style={({ pressed }) => [styles.save, pressed && styles.savePressed]}>
            {sending ? (
              <>
                <ActivityIndicator size="large" color={colors.onAccent} />
                <Text style={styles.sendingText}>{t('remote.sending')}</Text>
              </>
            ) : (
              <Text style={styles.saveText}>{t('remote.save')}</Text>
            )}
            {left > 0 ? <View testID="cooldown" pointerEvents="none" style={[styles.cooldown, { width: `${Math.round(left * 100)}%` }]} /> : null}
          </Pressable>
        ) : null}

        {screenModel.kind === 'recording' && listening ? (
          <View style={styles.voiceHint}>
            <MicIcon color={colors.accent} size={16} />
            <Text style={styles.hint}>{t('recording.orSay', { word: VOICE_WORD[locale] })}</Text>
          </View>
        ) : null}

        {screenModel.kind === 'recording' && endFailed ? <Text style={styles.warning}>{t('remote.endFailed')}</Text> : null}
        {screenModel.kind === 'recording' && endPending ? (
          <Button label={t('remote.ending')} variant="secondary" loading onPress={() => {}} />
        ) : null}
        {screenModel.kind === 'recording' && !endPending ? (
          <HoldButton label={t('remote.holdToEnd')} holdingLabel={t('remote.holding')} onComplete={endRecording} />
        ) : null}

        <View style={styles.footer}>
          <View style={styles.footerItem}>
            <Button label={t('common.close')} variant="secondary" onPress={leave} />
          </View>
        </View>
      </View>
      {economy.asleep ? (
        // Over everything while dim: the touch that lights the screen up reaches no button under it.
        <Pressable
          testID="remote-economy"
          accessibilityRole="button"
          accessibilityLabel={t('remote.economyAsleep')}
          onPressIn={economy.wake}
          style={[StyleSheet.absoluteFill, styles.asleep]}>
          <View style={styles.asleepPill}>
            <Text style={styles.asleepText}>{t('remote.economyAsleep')}</Text>
          </View>
        </Pressable>
      ) : null}
      {economyToast > 0 ? <EconomyToast remote on={prefs.remoteEconomy} bottom={96} /> : null}
      {flash ? <ResultFlash kind={feedback.phase as 'saved' | 'failed' | 'timeout'} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  body: { flex: 1, padding: 20, gap: 16 },
  scrollBody: { flexGrow: 1, padding: 20, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  role: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, color: colors.muted },
  title: { fontFamily: fonts.display, fontSize: 32, lineHeight: 34, color: colors.text },
  text: { fontFamily: fonts.bodySemi, fontSize: 16, lineHeight: 23, color: colors.text },
  status: { fontFamily: fonts.bodySemi, fontSize: 22, lineHeight: 30, color: colors.text, textAlign: 'center' },
  sub: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.warning, textAlign: 'center' },
  hint: { fontFamily: fonts.body, fontSize: 15, color: colors.muted, textAlign: 'center' },
  forget: { alignItems: 'center', gap: 2, marginTop: 8 },
  options: { alignSelf: 'stretch', flexDirection: 'row', gap: 10 },
  voiceHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  notice: { backgroundColor: 'rgba(12,12,12,0.82)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center', gap: 2 },
  noticeTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text, textAlign: 'center' },
  noticeBody: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.soft, textAlign: 'center' },
  asleep: { alignItems: 'center', paddingTop: 96 },
  asleepPill: { backgroundColor: 'rgba(12,12,12,0.82)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 16 },
  asleepText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.soft, textAlign: 'center' },
  forgetButton: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  forgetText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.warning, textDecorationLine: 'underline' },
  forgetHint: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, textAlign: 'center' },
  connecting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  footer: { flexDirection: 'row', gap: 12 },
  footerItem: { flex: 1 },
  warning: { fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 21, color: colors.warning },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.onAccent },
  stepText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 16, lineHeight: 23, color: colors.text },
  input: {
    fontFamily: fonts.displayBold,
    fontSize: 32,
    letterSpacing: 4,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingHorizontal: 16,
    minHeight: 64,
    textAlign: 'center',
  },
  save: {
    flex: 1,
    minHeight: 220,
    borderRadius: radius.card,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    overflow: 'hidden',
  },
  savePressed: { transform: [{ scale: 0.97 }] },
  saveOff: { opacity: 0.25 },
  saveText: { fontFamily: fonts.displayBold, fontSize: 72, letterSpacing: 2, color: colors.onAccent },
  sendingText: { fontFamily: fonts.displayBold, fontSize: 40, letterSpacing: 1, color: colors.onAccent },
  // A thin line along the bottom edge that shortens over the 3 s gap: it says "wait a moment" without looking like a loader.
  cooldown: { position: 'absolute', bottom: 0, left: 0, height: 8, backgroundColor: 'rgba(12,12,12,0.55)' },
});
