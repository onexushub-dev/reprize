import { router } from 'expo-router';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Animated, BackHandler, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addReplayListener, getWatchStatus, setScreenEconomy, signalAction } from '../../modules/replay-camera';
import { VOICE_WORD } from '../i18n';
import { useT } from '../i18n/useT';
import { formatZoom } from '../modes/zoom';
import { removeFile, repo } from '../data/mmkv';
import { useRemoteLink } from '../devices/bluetoothRemote';
import { triggerAllowed } from '../payments/limits';
import { useRemoteLost } from '../triggers/useRemoteLost';
import { onRemoteEnd } from '../triggers/remoteCommands';
import { useSession } from '../session/SessionContext';
import { useScreenEconomy } from '../session/useScreenEconomy';
import { diag } from '../diag/diagLog'; // TEMP(diag-remote)
import { colors, fonts, footer } from '../theme/tokens';
import { Button } from './Button';
import { EconomyButton } from './EconomyButton';
import { HoldButton } from './HoldButton';
import { MicIcon, RemoteIcon, WatchIcon, WaveIcon } from './icons';
import { SaveClipButton } from './SaveClipButton';
import { TRIGGER_DEBOUNCE_MS } from '../triggers/bus';
import type { useCameraPinch } from '../camera/useCameraPinch';
import { SavedOverlay } from './SavedOverlay';

/** The watch link as the native side sees it now; read on every render, as the setup screen does. */
function subscribeWatch(onChange: () => void): () => void {
  const sub = addReplayListener('onWatchStatus', onChange);
  return () => sub.remove();
}

const OVERLAY_MS = 2000;
/** How long the "ended" chime plays before the camera (and its audio session) stops. */
export const REMOTE_END_SIGNAL_MS = 700;
/** How long the battery-saving notice stays up: when a recording starts with it on, and after a tap on its button. */
const ECONOMY_NOTICE_MS = 5000;
/** How long the zoom value stays up after the fingers stop changing it, before it fades (2026-11-21). */
const ZOOM_SHOWN_MS = 1500;
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
  /** The clip length the player picked: how far back the save button reaches (its icon shows it). */
  clipSeconds?: number;
  /** Which hands-free triggers are on in this mode. */
  gesture?: boolean;
  voice?: boolean;
  /** The camera's zoom while recording (continuous zoom only): its button over the save button, and the pinch. */
  zoom?: { value: number; onPress: () => void; pinch?: ReturnType<typeof useCameraPinch> };
};

export function RecordingPanel({ clipSeconds = 30, gesture = true, voice = false, zoom }: Props) {
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
  // The saved card, keyed by the save's moment: it shows as the save starts (with the sound and the torch) and stays
  // the same card when the file is written.
  const [dismissed, setDismissed] = useState<number>();
  const last = state.lastSaved;
  const pending = state.pendingSave;
  const shown = pending !== undefined ? pending : last;
  // Screen economy (thermal work, item 2): dark after a while without a touch; any touch brings it back. The tap that
  // wakes the screen only wakes it (the player checking it still records), so it saves no clip; the triggers keep saving.
  // TEMP(diag-remote): the Diagnóstico screen can turn it off, to compare the remote with and without it.
  // The player's choice on the setup screen (Economia de bateria), which the button in the top row also flips mid-game
  // (2026-11-02: no need to end the game to change it); the Diagnóstico screen can also turn it off.
  const [economyPref, setEconomyPref] = useState(() => repo.getPrefs().screenEconomy);
  const economyOn = state.phase === 'recording' && economyPref;
  const economy = useScreenEconomy(economyOn, state.thermal.level, setEconomy);
  // The zoom shows only while a pinch changes it, over the save button, and fades a moment after (2026-11-21): no
  // button of its own while recording.
  const zoomValue = zoom ? zoom.value : undefined;
  const [zoomFade] = useState(() => new Animated.Value(0));
  const lastZoom = useRef(zoomValue);
  // Before the frame is drawn, and at once (no fade in): it showed a beat late (2026-11-21).
  useLayoutEffect(() => {
    if (zoomValue === undefined || zoomValue === lastZoom.current) return;
    lastZoom.current = zoomValue;
    zoomFade.stopAnimation();
    zoomFade.setValue(1);
    const hide = setTimeout(
      () => Animated.timing(zoomFade, { toValue: 0, duration: 300, useNativeDriver: true }).start(),
      ZOOM_SHOWN_MS,
    );
    return () => clearTimeout(hide);
  }, [zoomValue, zoomFade]);

  // Any touch wakes the dark screen; the save button is hidden while it is dark, so the waking touch saves nothing.
  function onAnyTouch() {
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

  const shownAt = shown === undefined ? undefined : shown.at;
  // For TRIGGER_DEBOUNCE_MS after a save (from any trigger) another one is dropped: the save button says so, greyed out
  // until then (2026-11-21). `readyAfter` is the save the wait is over for.
  const [readyAfter, setReadyAfter] = useState<number>();
  useEffect(() => {
    if (shownAt === undefined) return;
    const ready = setTimeout(() => setReadyAfter(shownAt), Math.max(0, TRIGGER_DEBOUNCE_MS - (Date.now() - shownAt)));
    return () => clearTimeout(ready);
  }, [shownAt]);
  const cooling = shownAt !== undefined && readyAfter !== shownAt;
  useEffect(() => {
    if (shownAt === undefined) return;
    const hide = setTimeout(() => setDismissed(shownAt), OVERLAY_MS);
    return () => clearTimeout(hide);
  }, [shownAt]);

  // Desfazer tapped before the file was written: done as soon as the clip exists.
  const undoAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (undoAt.current === undefined || last === undefined || last.at !== undoAt.current) return;
    undoAt.current = undefined;
    undoLast();
  }, [last, undoLast]);
  function undoShown() {
    if (pending !== undefined) undoAt.current = pending.at;
    else undoLast();
  }

  /**
   * After a game: its summary, or — with no clip to show — back on the camera, ready for the next one, the empty game
   * removed (2026-11-22; it opened Minhas gravações). The summary goes over the setup screen, so swiping back returns to
   * it (the summary resets the ended game as it leaves).
   */
  function leaveEnded(id: string) {
    if (repo.listClips(id).length > 0) return router.push(`/session/${id}`);
    repo.deleteSession(id).forEach((path) => removeFile(path));
    reset(); // the setup screen's controls come back and it opens the camera again
  }

  async function end() {
    const id = await stop();
    if (id) leaveEnded(id);
  }

  /**
   * Ended from the remote's 2 s hold (2026-11-07 spec §5.1): its sound and torch first, then the recording ends and
   * the player stays on the setup screen, the camera coming back for the next hold. The recording is in Minhas
   * gravações (one with no clips is deleted, as `leaveEnded` does).
   */
  const endingFromRemote = useRef(false);
  async function endFromRemote() {
    if (endingFromRemote.current) return;
    endingFromRemote.current = true;
    // The screen comes back first, as when the player touches it to end: ending with it dark (preview paused, brightness
    // down) left the phone on the black screen until the app went away and came back (2026-11-07 field test).
    economy.wake();
    const prefs = repo.getPrefs();
    signalAction('ended', { sound: prefs.soundOnSave, flash: prefs.flashOnSave });
    // The chime plays in the camera's audio session: give it time before the camera stops.
    await new Promise<void>((resolve) => setTimeout(resolve, REMOTE_END_SIGNAL_MS));
    const id = await stop();
    if (id && repo.listClips(id).length === 0) repo.deleteSession(id).forEach((path) => removeFile(path));
    reset();
    endingFromRemote.current = false;
  }

  useEffect(() =>
    onRemoteEnd(() => {
      if (state.phase === 'recording') void endFromRemote();
    }),
  );

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
          label={state.sessionId && repo.listClips(state.sessionId).length > 0 ? t('recording.seeClips') : t('recording.backToCamera')}
          onPress={() => {
            if (state.sessionId) leaveEnded(state.sessionId);
          }}
        />
      </SafeAreaView>
    );
  }

  const showOverlay = shown !== undefined && dismissed !== shown.at;
  // The other ways that save right now, as one line of small chips over the end button (2026-11-20, option A); a way that
  // is off is not shown. The chip says it short; VoiceOver reads it whole. The save button itself needs no chip.
  const ways: { key: string; icon: ReactNode; short: string; label: string }[] = [
    ...(voice
      ? [{ key: 'voice', icon: <MicIcon color={colors.accent} size={16} />, short: t('recording.chipVoice', { word: VOICE_WORD[locale] }), label: t('recording.wayVoice', { word: VOICE_WORD[locale] }) }]
      : []),
    ...(gesture ? [{ key: 'wave', icon: <WaveIcon color={colors.accent} size={16} />, short: t('recording.chipWave'), label: t('recording.wayWave') }] : []),
    ...(remoteOn ? [{ key: 'remote', icon: <RemoteIcon color={colors.accent} size={16} />, short: t('recording.wayRemote'), label: t('recording.wayRemote') }] : []),
    ...(watchOn ? [{ key: 'watch', icon: <WatchIcon color={colors.accent} size={16} />, short: t('recording.chipWatch'), label: t('recording.wayWatch') }] : []),
  ];
  // Always one line (2026-11-21): with every way on, the chips get a little slimmer, and shrink further if still short.
  const crowded = ways.length >= 5;
  const clips = t('summary.clips', { count: state.clipCount });

  return (
    <View testID="recording-root" style={StyleSheet.absoluteFill} onTouchStart={onAnyTouch}>
      {/* Battery saving dims the picture, which stays in view (2026-11-21): a dark veil over the camera, never the phone's
          own brightness (iOS does not reliably take that back when the phone is locked, so it leaked to the lock screen
          and every other app). On the OLED iPhones a darker picture is what saves the battery. */}
      {economy.asleep ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dark]} testID="screen-economy" /> : null}
      {/* A tap on the picture no longer saves (2026-11-21): two fingers zoom it, as on the setup screen; saving is the
          button at the bottom. */}
      {zoom && zoom.pinch ? <View testID="zoom-pinch" style={StyleSheet.absoluteFill} {...zoom.pinch} /> : null}

      <SafeAreaView pointerEvents="box-none" style={styles.content}>
        {/* Time on the left (the red dot says it records: no word, 2026-11-21); clips and battery saving on the right, the
            quality (when it stepped down) on a line of its own under them. */}
        <View pointerEvents="box-none" style={styles.topRow}>
          <View pointerEvents="none" accessible accessibilityLabel={t('recording.recording')} style={styles.pill}>
            <View style={styles.recDot} />
            <Text style={styles.elapsed}>{clock(now - (state.startedAt ?? now))}</Text>
          </View>
          <View pointerEvents="box-none" style={styles.topRight}>
            <View pointerEvents="none" style={styles.pill}>
              <Text style={styles.countText}>{clips}</Text>
            </View>
            {/* Hidden while dark: the tap that wakes the screen must not flip it. */}
            {economy.asleep ? null : <EconomyButton on={economyPref} onPress={toggleEconomy} size={48} />}
          </View>
        </View>
        {stepped ? (
          <View pointerEvents="none" testID="quality-chip" style={[styles.pill, styles.qualityRow]}>
            <Text style={styles.qualityText}>{qualityLabel(state.thermal.quality)}</Text>
          </View>
        ) : null}

        {showStep ? (
          <View pointerEvents="none" accessibilityRole="text" testID="heat-step" style={styles.info}>
            <Text style={styles.infoTitle}>{t('recording.stableTitle', { quality: qualityLabel(state.thermal.quality) })}</Text>
            <Text style={styles.infoBody}>{t('recording.stableBody')}</Text>
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

        {/* Turning battery saving on or off says so where the dimmed screen's note will be, in the same letters
            (2026-11-22): centred, what happened in bold, then the detail. Never with the screen dark (no notice then). */}
        {economyNotice !== undefined ? (
          <View pointerEvents="none" style={styles.economy}>
            <View accessibilityRole="alert" testID="economy-notice" style={styles.economyNote}>
              <Text style={styles.economyText}>
                {t(economyNotice === 'on' ? 'recording.economyOnTitle' : 'recording.economyOffTitle')}
              </Text>
              <Text style={styles.economyTap}>
                {t(economyNotice === 'on' ? 'recording.economyOnBody' : 'recording.economyOffBody')}
              </Text>
            </View>
          </View>
        ) : null}
        {economy.asleep ? (
          <View pointerEvents="none" style={styles.economy}>
            {/* Bigger, on two lines (2026-11-21): what happened, then what to do. */}
            <View style={styles.economyNote} accessible accessibilityLabel={`${t('recording.economy')}. ${t('recording.economyTap')}`}>
              <Text style={styles.economyText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {t('recording.economy')}
              </Text>
              <Text style={styles.economyTap}>{t('recording.economyTap')}</Text>
            </View>
          </View>
        ) : null}

        <View pointerEvents="box-none" style={styles.bottom}>
          {economy.asleep ? null : (
            <>
              {/* The zoom where the setup screen has it, over the main button, only while a pinch changes it. */}
              {zoom ? (
                <Animated.View
                  pointerEvents="none"
                  testID="zoom-info"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={[styles.center, styles.zoomInfoWrap, { opacity: zoomFade }]}>
                  <View style={styles.zoomInfo}>
                    <Text style={styles.zoomInfoText}>{formatZoom(zoom.value)}</Text>
                  </View>
                </Animated.View>
              ) : null}
              <View pointerEvents="box-none" style={styles.center}>
                <SaveClipButton
                  cooling={cooling}
                  seconds={clipSeconds}
                  label={t('recording.saveButton', { seconds: clipSeconds })}
                  onPress={() => trigger('screen')}
                />
              </View>
            </>
          )}
          {economy.asleep || ways.length === 0 ? null : (
            <View pointerEvents="none" testID="save-ways" style={styles.ways}>
              {ways.map((way) => (
                <View key={way.key} style={[styles.way, crowded && styles.wayCrowded]} accessible accessibilityLabel={way.label}>
                  {way.icon}
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                    style={[styles.wayText, crowded && styles.wayTextCrowded]}>
                    {way.short}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <HoldButton
            label={t('recording.holdToEnd')}
            holdingLabel={t('recording.keepHolding')}
            onComplete={() => void end()}
          />
        </View>
      </SafeAreaView>

      {showOverlay ? <SavedOverlay number={shown.number} source={shown.source} cutMs={shown.cutMs} onUndo={undoShown} /> : null}
    </View>
  );
}

const glass = 'rgba(12,12,12,0.72)';

const styles = StyleSheet.create({
  dark: { backgroundColor: 'rgba(0,0,0,0.72)' },
  // A small note over the dimmed picture, not a screen of its own.
  // Over the whole screen, not in the column (2026-11-22): the column's free middle moved with what is shown under it
  // (the save button and the triggers are hidden while dark), so the notice and the dark screen's note sat at different
  // heights. Both are centred on the same box now.
  economy: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  economyNote: {
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(12,12,12,0.6)',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  economyText: {
    fontFamily: fonts.bodyBold,
    fontSize: 17,
    lineHeight: 22,
    color: colors.text,
    textAlign: 'center',
  },
  economyTap: { fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 20, color: colors.soft, textAlign: 'center' },
  content: { flex: 1, paddingHorizontal: footer.side, gap: 10 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // The quality chip is a small note under the row, not one of its buttons.
  qualityRow: { alignSelf: 'flex-end', marginTop: -2, height: 30, paddingHorizontal: 12 },
  // The same 48 pt height as the round buttons, here and on the setup screen (2026-11-20).
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: glass,
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 24,
  },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.rec },
  elapsed: { fontFamily: fonts.display, fontSize: 22, color: colors.text, fontVariant: ['tabular-nums'] },
  countText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.accent },
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
  // Where every screen's bottom button sits (Gravações' "Nova gravação", 2026-11-21).
  bottom: { marginTop: 'auto', gap: 8, marginBottom: footer.bottom },
  center: { alignItems: 'center' },
  // The setup screen's zoom button, as a note: more room under it than the rest of the column (2026-11-21).
  zoomInfoWrap: { marginBottom: 12 },
  zoomInfo: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  zoomInfoText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.onAccent },
  // One centred line of chips, never a second one.
  ways: { flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'center', gap: 6 },
  way: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 32,
    paddingHorizontal: 11,
    borderRadius: 16,
    backgroundColor: glass,
  },
  wayCrowded: { paddingHorizontal: 8, gap: 4, flexShrink: 1 },
  wayText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  wayTextCrowded: { fontSize: 13, flexShrink: 1 },
  stopped: { flex: 1, backgroundColor: colors.recordingGround, justifyContent: 'center', padding: 24, gap: 20 },
  stoppedText: { fontFamily: fonts.displayBold, fontSize: 36, lineHeight: 38, color: colors.text, textAlign: 'center' },
});
