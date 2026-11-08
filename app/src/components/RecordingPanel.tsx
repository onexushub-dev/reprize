import { router } from 'expo-router';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addReplayListener, getWatchStatus, setScreenEconomy } from '../../modules/replay-camera';
import { VOICE_WORD } from '../i18n';
import { useT } from '../i18n/useT';
import { removeFile, repo } from '../data/mmkv';
import { useRemoteLink } from '../devices/bluetoothRemote';
import { triggerAllowed } from '../payments/limits';
import { useRemoteLost } from '../triggers/useRemoteLost';
import { useSession } from '../session/SessionContext';
import { useScreenEconomy } from '../session/useScreenEconomy';
import { diag, diagFlags } from '../diag/diagLog'; // TEMP(diag-remote)
import { colors, fonts } from '../theme/tokens';
import { Button } from './Button';
import { EconomyButton } from './EconomyButton';
import { HoldButton } from './HoldButton';
import { MicIcon, RemoteIcon, TapIcon, WatchIcon, WaveIcon } from './icons';
import { SavedOverlay } from './SavedOverlay';

/** The watch link as the native side sees it now; read on every render, as the setup screen does. */
function subscribeWatch(onChange: () => void): () => void {
  const sub = addReplayListener('onWatchStatus', onChange);
  return () => sub.remove();
}

const OVERLAY_MS = 2000;
/** How long the battery-saving notice stays up: when a recording starts with it on, and after a tap on its button. */
const ECONOMY_NOTICE_MS = 5000;
/** How long the heat tip stays up (thermal work, item 5). */
const HEAT_TIP_MS = 8000;

/** "1080p30" → "1080p/30", the way the heat banner says it; older builds only ever stepped down to 720p/30. */
function qualityLabel(quality: string | undefined): string {
  if (quality === undefined) return '720p/30';
  const at = quality.indexOf('p');
  return at > 0 ? `${quality.slice(0, at + 1)}/${quality.slice(at + 1)}` : quality;
}

/** TEMP(diag-remote): the native screen economy, logged. */
function setEconomy(on: boolean): void {
  diag(on ? 'tela: escureceu (economia)' : 'tela: acendeu');
  setScreenEconomy(on);
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/**
 * Controls shown over the live camera while a game is recorded. The camera view itself belongs to the
 * game screen and is never recreated, so starting the game is instant (and Android keeps its preview).
 */
type Props = {
  /** The clip length the player picked: how far back a save reaches. */
  clipSeconds?: number;
  /** Which hands-free triggers are on in this mode. */
  gesture?: boolean;
  voice?: boolean;
};

export function RecordingPanel({ clipSeconds = 30, gesture = true, voice = false }: Props) {
  const { state, trigger, undoLast, stop, reset } = useSession();
  // The Bluetooth remote is paid: it saves only in a game whose plan may use it.
  const remoteOn = triggerAllowed('remote', state.paid ? 'paid' : 'free');
  // The remote gone for a while in this game (out of range and iOS gave up, or asleep): its presses are lost until it
  // is back, so the top of the screen says so (2026-11-03).
  const remoteListening = state.phase === 'recording' && remoteOn;
  const remoteLost = useRemoteLost(useRemoteLink(remoteListening), remoteListening);
  // The Apple Watch is paid too, and lit only when a paired watch has the app.
  const watch = useSyncExternalStore(subscribeWatch, getWatchStatus);
  const watchOn = Platform.OS === 'ios' && watch === 'ready' && triggerAllowed('watch', state.paid ? 'paid' : 'free');
  const { t, locale } = useT();
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<string>();
  const last = state.lastSaved;
  // Screen economy (thermal work, item 2): dark after a while without a touch; any touch brings it back. The tap that
  // wakes the screen only wakes it (the player checking it still records), so it saves no clip; the triggers keep saving.
  // TEMP(diag-remote): the Diagnóstico screen can turn it off, to compare the remote with and without it.
  // The player's choice on the setup screen (Economia de bateria), which the button in the top row also flips mid-game
  // (2026-11-02: no need to end the game to change it); the Diagnóstico screen can also turn it off.
  const [economyPref, setEconomyPref] = useState(() => repo.getPrefs().screenEconomy);
  const economyOn = state.phase === 'recording' && economyPref && !diagFlags().economyOff;
  const economy = useScreenEconomy(economyOn, state.thermal.level, setEconomy);
  const wakingTap = useRef(false);
  function onAnyTouch() {
    wakingTap.current = economy.asleep; // decided as the touch starts, before the screen wakes
    economy.wake();
  }

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Battery saving on: say so when the recording starts, so a dark screen later is no surprise; gone by itself.
  const [noticeFor, setNoticeFor] = useState<string>();
  const [noticeGone, setNoticeGone] = useState<string>();
  if (economyOn && state.sessionId !== undefined && noticeFor !== state.sessionId) setNoticeFor(state.sessionId);
  useEffect(() => {
    if (noticeFor === undefined) return;
    const hide = setTimeout(() => setNoticeGone(noticeFor), ECONOMY_NOTICE_MS);
    return () => clearTimeout(hide);
  }, [noticeFor]);
  const showEconomyNotice =
    economyOn && !economy.asleep && noticeFor !== undefined && noticeFor === state.sessionId && noticeGone !== noticeFor;

  // The battery-saving button: flips the same preference as the setup screen (the next game starts the same way) and
  // says what it did in the start notice's place, at the top (2026-11-03: one place for every battery-saving word). A
  // tap ends the start notice of this game; the notice then follows the button.
  const [economyTaps, setEconomyTaps] = useState(0);
  useEffect(() => {
    if (economyTaps === 0) return;
    const hide = setTimeout(() => setEconomyTaps(0), ECONOMY_NOTICE_MS);
    return () => clearTimeout(hide);
  }, [economyTaps]);
  const economyNotice: 'on' | 'off' | undefined = economy.asleep
    ? undefined
    : economyTaps > 0
      ? economyPref
        ? 'on'
        : 'off'
      : showEconomyNotice
        ? 'on'
        : undefined;
  function toggleEconomy() {
    const next = !economyPref;
    setEconomyPref(next);
    repo.setPrefs({ screenEconomy: next });
    if (state.sessionId !== undefined) {
      setNoticeFor(state.sessionId);
      setNoticeGone(state.sessionId);
    }
    setEconomyTaps((n) => n + 1);
  }

  // Heat, only when it matters and never as an alarm (2026-11-08): nothing at `nominal` or `fair`. At `serious`, once per
  // recording, a tip on what helps; when the quality steps down, a calm "steady in 1080p/30" for a few seconds (each
  // step once), then only a small quality chip at the top. Both go by themselves.
  const hot = state.thermal.level === 'serious' || state.thermal.level === 'critical';
  const warm = state.phase === 'recording' && hot && !state.thermal.degraded;
  const [tipFor, setTipFor] = useState<string>();
  const [tipGone, setTipGone] = useState<string>();
  if (warm && state.sessionId !== undefined && tipFor !== state.sessionId) setTipFor(state.sessionId);
  useEffect(() => {
    if (tipFor === undefined) return;
    const hide = setTimeout(() => setTipGone(tipFor), HEAT_TIP_MS);
    return () => clearTimeout(hide);
  }, [tipFor]);
  const showTip = warm && tipFor !== undefined && tipFor === state.sessionId && tipGone !== tipFor;

  const stepped = state.phase === 'recording' && state.thermal.degraded;
  const stepKey = stepped && state.sessionId !== undefined ? `${state.sessionId}|${qualityLabel(state.thermal.quality)}` : undefined;
  const [stepFor, setStepFor] = useState<string>();
  const [stepGone, setStepGone] = useState<string>();
  if (stepKey !== undefined && stepFor !== stepKey) setStepFor(stepKey);
  useEffect(() => {
    if (stepFor === undefined) return;
    const hide = setTimeout(() => setStepGone(stepFor), HEAT_TIP_MS);
    return () => clearTimeout(hide);
  }, [stepFor]);
  const showStep = stepKey !== undefined && stepFor === stepKey && stepGone !== stepKey;

  useEffect(() => {
    if (!last) return;
    const hide = setTimeout(() => setDismissed(last.clipId), OVERLAY_MS);
    return () => clearTimeout(hide);
  }, [last]);

  /**
   * After a game: its summary, or — with no clip to show — straight to Minhas gravações, the empty game removed. The
   * summary goes over the setup screen, so swiping back returns to it (the summary resets the ended game as it leaves).
   */
  function leaveEnded(id: string) {
    if (repo.listClips(id).length > 0) return router.push(`/session/${id}`);
    repo.deleteSession(id).forEach((path) => removeFile(path));
    reset();
    router.push('/games'); // the setup screen stays under it
  }

  async function end() {
    const id = await stop();
    if (id) leaveEnded(id);
  }

  // The remote phone's "Segure para encerrar a gravação" ends the game the same way the one on this screen does.
  useEffect(() => {
    const sub = addReplayListener('onRemoteStop', () => {
      if (state.phase === 'recording') void end();
    });
    return () => sub.remove();
  });

  // Android back = end the game, after a confirmation.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert(t('recording.endConfirm'), undefined, [
        { text: t('recording.keepGoing'), style: 'cancel' },
        { text: t('recording.end'), style: 'destructive', onPress: () => void end() },
      ]);
      return true;
    });
    return () => sub.remove();
  });

  if (state.phase === 'ended' && state.error) {
    const reason = t(state.thermalStop ? 'recording.reasonHot' : 'recording.reasonError');
    return (
      <SafeAreaView style={styles.stopped}>
        <Text style={styles.stoppedText}>{t('recording.stopped', { reason })}</Text>
        <Button
          label={state.sessionId && repo.listClips(state.sessionId).length > 0 ? t('recording.seeClips') : t('recording.myRecordings')}
          onPress={() => {
            if (state.sessionId) leaveEnded(state.sessionId);
          }}
        />
      </SafeAreaView>
    );
  }

  const showOverlay = last !== undefined && dismissed !== last.clipId;
  // The other ways that are on, one short tag each (2026-11-01: a line of "ou … ou … ou" was hard to read). Tapping the
  // screen always works, so it is the main line; a way that is off is not shown at all.
  const ways = [
    ...(voice ? [{ key: 'voice', icon: <MicIcon color={colors.accent} size={16} />, label: t('recording.wayVoice', { word: VOICE_WORD[locale] }) }] : []),
    ...(gesture ? [{ key: 'wave', icon: <WaveIcon color={colors.accent} size={16} />, label: t('recording.wayWave') }] : []),
    ...(remoteOn ? [{ key: 'remote', icon: <RemoteIcon color={colors.accent} size={16} />, label: t('recording.wayRemote') }] : []),
    ...(watchOn ? [{ key: 'watch', icon: <WatchIcon color={colors.accent} size={16} />, label: t('recording.wayWatch') }] : []),
  ];
  const clips = t('summary.clips', { count: state.clipCount });

  return (
    <View style={StyleSheet.absoluteFill} onTouchStart={onAnyTouch}>
      {economy.asleep ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dark]} testID="screen-economy" /> : null}
      {/* The whole screen is the save button; nothing covers the picture. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('recording.tapAnywhere')}
        onPress={() => {
          if (wakingTap.current) return;
          trigger('screen');
        }}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView pointerEvents="box-none" style={styles.content}>
        {/* Only the battery-saving button takes touches here: a tap on the pills still reaches the save surface. */}
        <View pointerEvents="box-none" style={styles.topRow}>
          <View pointerEvents="none" style={styles.pill}>
            <View style={styles.recDot} />
            <Text style={styles.pillLabel}>{t('recording.recording')}</Text>
            <Text style={styles.elapsed}>{clock(now - (state.startedAt ?? now))}</Text>
          </View>
          <View pointerEvents="box-none" style={styles.topRight}>
            {/* Hidden while dark: the tap that wakes the screen must not flip it. */}
            {economy.asleep ? null : <EconomyButton on={economyPref} onPress={toggleEconomy} size={36} />}
            {stepped ? (
              <View pointerEvents="none" testID="quality-chip" style={styles.pill}>
                <Text style={styles.qualityText}>{qualityLabel(state.thermal.quality)}</Text>
              </View>
            ) : null}
            <View pointerEvents="none" style={styles.pill}>
              <Text style={styles.countText}>{clips}</Text>
            </View>
          </View>
        </View>

        {showStep ? (
          <View pointerEvents="none" accessibilityRole="text" testID="heat-step" style={styles.info}>
            <Text style={styles.infoTitle}>{t('recording.stableTitle', { quality: qualityLabel(state.thermal.quality) })}</Text>
            <Text style={styles.infoBody}>{t('recording.stableBody')}</Text>
          </View>
        ) : null}
        {economyNotice !== undefined ? (
          <View pointerEvents="none" accessibilityRole="alert" testID="economy-notice" style={styles.notice}>
            <Text style={styles.noticeTitle}>
              {t(economyNotice === 'on' ? 'recording.economyOnTitle' : 'recording.economyOffTitle')}
            </Text>
            <Text style={styles.noticeBody}>
              {t(economyNotice === 'on' ? 'recording.economyOnBody' : 'recording.economyOffBody')}
            </Text>
          </View>
        ) : null}
        {remoteLost && !economy.asleep ? (
          <View pointerEvents="none" accessibilityRole="alert" testID="remote-lost-notice" style={styles.notice}>
            <Text style={styles.noticeTitle}>{t('recording.remoteLostTitle')}</Text>
            <Text style={styles.noticeBody}>{t('recording.remoteLostBody')}</Text>
          </View>
        ) : null}
        {showTip ? (
          <View pointerEvents="none" testID="heat-tip" style={styles.info}>
            <Text style={styles.infoTitle}>{t('recording.tipTitle')}</Text>
            <Text style={styles.infoBody}>{t('recording.tipBody')}</Text>
          </View>
        ) : null}
        {state.paused ? (
          <View pointerEvents="none" style={styles.banner}>
            <Text style={styles.bannerText}>{t('recording.paused')}</Text>
          </View>
        ) : null}

        {economy.asleep ? (
          <View pointerEvents="none" style={styles.economy}>
            <Text style={styles.economyText}>{t('recording.economy')}</Text>
          </View>
        ) : null}

        <View pointerEvents="box-none" style={styles.bottom}>
          {economy.asleep ? null : (
            <View pointerEvents="none" style={styles.hintCard}>
              <View style={styles.hintHead}>
                <TapIcon color={colors.accent} size={26} />
                {/* Always one line: on a narrower phone (iPhone XR, SE) the text shrinks a little instead of wrapping. */}
                <Text style={styles.hint} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                  {t('recording.tapToSave', { seconds: clipSeconds })}
                </Text>
              </View>
              {ways.length > 0 ? (
                <View style={styles.ways}>
                  {ways.map((way) => (
                    <View key={way.key} style={styles.way} accessible accessibilityLabel={way.label}>
                      {way.icon}
                      <Text style={styles.wayText}>{way.label}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          )}
          <HoldButton
            label={t('recording.holdToEnd')}
            holdingLabel={t('recording.keepHolding')}
            onComplete={() => void end()}
          />
        </View>
      </SafeAreaView>

      {showOverlay ? <SavedOverlay number={last.number} source={last.source} cutMs={last.cutMs} onUndo={undoLast} /> : null}
    </View>
  );
}

const glass = 'rgba(12,12,12,0.72)';

const styles = StyleSheet.create({
  dark: { backgroundColor: colors.screenOff },
  economy: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  economyText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.soft, textAlign: 'center' },
  content: { flex: 1, paddingHorizontal: 16, gap: 10 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: glass,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.rec },
  pillLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text },
  elapsed: { fontFamily: fonts.display, fontSize: 18, color: colors.text, fontVariant: ['tabular-nums'] },
  countText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.accent },
  banner: {
    backgroundColor: colors.warningGround,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  bannerText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.text },
  notice: { backgroundColor: 'rgba(12,12,12,0.82)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center', gap: 2 },
  noticeTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text, textAlign: 'center' },
  noticeBody: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.soft, textAlign: 'center' },
  info: {
    backgroundColor: 'rgba(20,20,20,0.94)',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 4,
  },
  infoTitle: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  infoBody: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.soft },
  qualityText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.soft },
  bottom: { marginTop: 'auto', gap: 8, marginBottom: 12 },
  hintCard: {
    gap: 10,
    backgroundColor: glass,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  hintHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hint: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 17, lineHeight: 22, color: colors.text },
  ways: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  way: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  wayText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.text },
  stopped: { flex: 1, backgroundColor: colors.recordingGround, justifyContent: 'center', padding: 24, gap: 20 },
  stoppedText: { fontFamily: fonts.displayBold, fontSize: 36, lineHeight: 38, color: colors.text, textAlign: 'center' },
});
