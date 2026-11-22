import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { router, useIsFocused } from "expo-router";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  addReplayListener,
  getSpeechPermission,
  getWatchStatus,
  getZoomRange,
  isRemoteControllerSupported,
  isRemoteSupported,
  isVoiceSupported,
  remoteControllerForget,
  remoteControllerHost,
  remoteHostControllers,
  ReplayCameraView,
  requestSpeechPermission,
  signalAction,
  signalSaveFailed,
  supportsQuality,
} from "../../modules/replay-camera";
import type {
  RemotePeer,
  ReplayErrorCode,
} from "../../modules/replay-camera/src/ReplayCamera.types";
import { useCameraPinch } from "../camera/useCameraPinch";
import { useLandscapeTurn } from "../camera/useDeviceLandscape";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { CompactDock } from "../components/CompactDock";
import { PrepareSheet } from "../components/PrepareSheet";
import { GestureSheet, VoiceSheet } from "../components/PracticeSheet";
import { modeTip } from "../components/format";
import { sourceLabel } from "../components/sourceLabel";
import { sessionSummary, track } from "../analytics";
import { PositionGuide } from "../components/PositionGuide";
import { RecordingPanel } from "../components/RecordingPanel";
import { ProBadge } from "../components/ProBadge";
import {
  CloseIcon,
  GalleryIcon,
  GearIcon,
  MicIcon,
  QrIcon,
  RemoteIcon,
  StarIcon,
  TapIcon,
  WatchIcon,
  WaveIcon,
} from "../components/icons";
import { TriggerTile } from "../components/TriggerTile";
import { ZoomButton } from "../components/ZoomButton";
import { kv, repo } from "../data/mmkv";
import { SHARING_ENABLED } from "../account/flags";
import { useSetupDiag } from "../diag/useSetupDiag"; // TEMP(diag)
import { openPaywall } from "../payments/feedback";
import {
  FREE_MAX_SECONDS,
  qualityAllowed,
  triggerAllowed,
} from "../payments/limits";
import { accessPlan } from "../payments/rules";
import { usePlan } from "../share/entitlement";
import {
  type MessageKey,
  type TFunction,
  VOICE_WORD,
  voiceLocale,
} from "../i18n";
import { useT } from "../i18n/useT";
import { useRemoteLink } from "../devices/bluetoothRemote";
import { remoteDeviceView } from "../devices/remoteDevice";
import { clearRemotePress, openingRemoteSheet } from "../devices/remoteTest";
import { useRemoteSheetOpen, useRemoteTest } from "../devices/useRemoteTest";
import {
  CLIP_SECONDS_OPTIONS,
  type ModeSettings,
  type Prefs,
} from "../data/schema";
import {
  effectiveSettings,
  modeById,
  offeredMode,
  withModeOverride,
} from "../modes/registry";
import { clampZoom, hasZoomChoice, lensFor, nextZoomStep } from "../modes/zoom";
import { useSession } from "../session/SessionContext";
import { colors, fonts, footer, radius } from "../theme/tokens";
import { useBluetoothRemote } from "../triggers/useBluetoothRemote";

const START_ERRORS: Partial<Record<ReplayErrorCode, MessageKey>> = {
  LOW_STORAGE: "setup.lowStorage",
  CAMERA_PERMISSION: "common.cameraDenied",
};

/** Under "Conectar um celular controle": how many remotes are linked right now. Nothing when none is. */
/** The watch link as the native side sees it now. Read on every render, not only on events: WatchConnectivity
 * activates when the module loads, and an activation that finishes before this screen listens is never heard. */
function subscribeWatch(onChange: () => void): () => void {
  const sub = addReplayListener("onWatchStatus", onChange);
  return () => sub.remove();
}

function controllersStatus(t: TFunction, linked: number): string | undefined {
  if (linked <= 0) return undefined;
  return linked === 1
    ? t("setup.controllerLinkedOne")
    : t("setup.controllerLinkedMany", { count: linked });
}

/**
 * Under "Usar este celular como controle": the camera phone this one is paired with. It says "Pareado", not
 * "Conectado": this screen cannot tell if the link is up, because the remote side only connects while its own screen is open.
 */
function cameraStatus(
  t: TFunction,
  host: { name: string } | null,
): string | undefined {
  if (host === null) return undefined;
  return host.name.length > 0
    ? t("setup.pairedWith", { name: host.name })
    : t("setup.paired");
}

/** How long the battery-saving notice stays after a tap on its button. */

/** Set once the tip about the gear (Ajustes) was read. */
const SETTINGS_TIP_KEY = "reprize:v1:settings-tip";

export default function Setup() {
  const session = useSession();
  const { t, locale } = useT();
  // This screen stays mounted under Minhas gravações, the editor and the save screen: only hold the camera,
  // the volume buttons and the screen awake while it is the visible one.
  const focused = useIsFocused();
  // The Dispositivos sheet over this screen does not take the camera or the volume buttons away: this screen keeps both.
  const sheetOpen = useRemoteSheetOpen();
  const live = focused || sheetOpen;
  const [prefs, setPrefsState] = useState<Prefs>(() => repo.getPrefs());
  const update = (patch: Partial<Prefs>) => setPrefsState(repo.setPrefs(patch));
  // What this mode runs with (defaults + the player's changes for this mode).
  // A sport saved before the two modes opens as its group (Quadra or Academia).
  const modeId = offeredMode(prefs.sport);
  const settings = effectiveSettings(modeId, prefs);
  const updateMode = (patch: Partial<ModeSettings>) =>
    update(withModeOverride(prefs, modeId, patch));
  // Zoom: the button goes through the stops, two fingers on the preview zoom freely. Saved per mode when the gesture ends;
  // while pinching the live value is only shown (and sent to the camera), so the screen does not rewrite the prefs per frame.
  const [zoomRange] = useState(() => getZoomRange());
  const savedZoom = clampZoom(settings.zoom, zoomRange);
  const [liveZoom, setLiveZoom] = useState<number | null>(null);
  const zoom = liveZoom !== null ? liveZoom : savedZoom;
  // With two fixed lenses (Android) crossing 1x means opening the other lens; with continuous zoom the session ignores it.
  const lens = lensFor(savedZoom);
  const pinch = useCameraPinch({
    zoom,
    range: zoomRange,
    onChange: (next) => {
      setLiveZoom(next);
      session.setZoom(next, false);
    },
    onCommit: (next) => {
      setLiveZoom(null);
      if (Math.abs(next - savedZoom) > 1e-6) {
        updateMode({ zoom: next });
        sessionSummary.note("zoom");
      }
    },
  });
  const cycleZoom = () => {
    const next = nextZoomStep(zoom, zoomRange);
    session.setZoom(next, true);
    updateMode({ zoom: next });
    sessionSummary.note("zoom");
  };
  // The Bluetooth remote: the app cannot see the iOS pairing, only presses (this launch, or heard before).
  const remoteTest = useRemoteTest();
  // The remote's link as iOS shows it (BLE remotes the app has learnt), looked at while this screen is in front.
  const remoteLink = useRemoteLink(focused);
  const remoteView = remoteDeviceView(
    {
      pressed: remoteTest.pressed,
      testedBefore: remoteTest.testedBefore,
      waitedLong: false,
      link: remoteLink,
    },
    locale,
  );
  // Only a press proves the remote works: one used before may have been unpaired in Ajustes since, and the app cannot
  // tell (2026-11-01 field test). So its icon and tile light up only once a press is heard; the recording still listens
  // to it either way.
  const remoteReady = remoteView.state === "connected";
  // The sheet opens collapsed so the camera and its guide stay visible; mode and triggers sit behind the summary.
  const [expanded, setExpanded] = useState(false);
  // A trigger's "?" (the wave gesture, voice): how to use it, and practice with the live camera.
  const [practice, setPractice] = useState<"gesture" | "voice" | undefined>(
    undefined,
  );
  /** Opens a trigger's guide; each opening counts as a guide in the session summary. */
  const openPractice = (kind: "gesture" | "voice") => {
    sessionSummary.note("guide");
    setPractice(kind);
  };
  const [sheetHeight, setSheetHeight] = useState(0);
  // Swipe up on the sheet opens it, swipe down closes it; taps still reach the controls inside.
  const [swipe] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dy) > 12 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderRelease: (_, g) => setExpanded(g.dy < 0),
    }),
  );
  const [speechDenied, setSpeechDenied] = useState(false);
  // Offline recognition only: court audio is never streamed to a server.
  // Asked again if the language changes: the on-device model is per language.
  const voiceSupported = useMemo(
    () => isVoiceSupported(voiceLocale(locale)),
    [locale],
  );
  const [speech, setSpeech] = useState(() => getSpeechPermission());
  const speechGranted = speech === "granted";
  const mode = modeById(modeId);
  // The watch link: paired watch with the app → ready. Informational: the watch itself starts a save.
  const watch = useSyncExternalStore(subscribeWatch, getWatchStatus);
  const watchStatus =
    watch === "ready"
      ? t("setup.watchReady")
      : watch === "notInstalled"
        ? t("setup.watchNotInstalled")
        : t("setup.watchNone");
  // Before a game the next start's plan decides. Two questions: what the screen shows (the plan as it is: on the free
  // plan every Pro option carries its badge, the release layout) and what works (`accessPlan`: everything while the
  // field test unlocks it; a locked option opens the paywall).
  const plan = usePlan();
  const showPro = plan === "free";
  const paidAccess = accessPlan(plan) === "paid";
  // Apple Watch only: no Android smartwatch was tested, so the tile stays visible but disabled there.
  const watchSupported = Platform.OS === "ios";
  // Saying "salvar": each platform's on-device recognizer (iOS Speech; Android ML Kit, Android 12+).
  const voiceOffered = Platform.OS === "ios" || Platform.OS === "android";
  const watchAllowed = triggerAllowed("watch", plan);
  const watchOn = watchSupported && watchAllowed && watch === "ready";
  const watchLocked = watchSupported && !watchAllowed;
  // Without a paired watch, or without the app on it, the tile explains how to set it up instead of going grey.
  const watchHelp =
    watchSupported && watchAllowed && watch !== "ready"
      ? () =>
          Alert.alert(
            t("setup.watchHelpTitle"),
            watch === "notInstalled"
              ? t("setup.watchHelpInstall")
              : t("setup.watchHelpPair"),
          )
      : undefined;
  // The Apple Watch is the one paid trigger; the Bluetooth remote and the phone remote are free for every plan.
  const remoteAllowed = triggerAllowed("remote", plan);
  // The free plan cuts clips at 15 s: a longer pick is paid, and what the screen shows is what the game will get.
  const isAllowed = (seconds: number) =>
    paidAccess || seconds <= FREE_MAX_SECONDS;
  const proSeconds = CLIP_SECONDS_OPTIONS.filter(
    (seconds) => seconds > FREE_MAX_SECONDS,
  );
  const clipSeconds = isAllowed(settings.cutSeconds)
    ? settings.cutSeconds
    : Math.min(settings.cutSeconds, FREE_MAX_SECONDS);
  // 4K (30 fps) is paid and needs a camera that has it; the free plan records Full HD (60 fps) whatever was picked.
  const [has4k] = useState(() => supportsQuality("2160p30"));
  const fourKAllowed = qualityAllowed("2160p30", plan);
  const is4k = has4k && fourKAllowed && settings.quality === "2160p30";
  // Ajustes moved to the gear: a tip the first time, until it is read or the gear is used.
  const [settingsTip, setSettingsTip] = useState(
    () => SHARING_ENABLED && kv.getString(SETTINGS_TIP_KEY) !== "seen",
  );
  const dismissSettingsTip = () => {
    if (!settingsTip) return;
    kv.set(SETTINGS_TIP_KEY, "seen");
    setSettingsTip(false);
  };
  // The phone remote (a second iPhone that taps Salvar for this one). The camera phone waits for its paired remotes for
  // as long as the app is open (see the root layout); pairing happens on its own sheet (/pairing).
  // Android is only a remote for now (no camera side yet): each tile shows where its side exists.
  const [remoteSupported] = useState(() => isRemoteSupported());
  const [controllerSupported] = useState(() => isRemoteControllerSupported());
  const [controlHost, setControlHost] = useState<RemotePeer | null>(() =>
    isRemoteControllerSupported() ? remoteControllerHost() : null,
  );
  const [remoteLinked, setRemoteLinked] = useState(() =>
    remoteHostControllers(),
  );
  useEffect(() => {
    if (!remoteSupported) return;
    const sub = addReplayListener("onRemoteStatus", (e) => {
      if (e.side === "remote") return; // this phone used as a remote, not its own remotes
      setRemoteLinked(e.controllers === undefined ? 0 : e.controllers);
    });
    return () => sub.remove();
  }, [remoteSupported]);
  // Coming back to this screen, read the remote again (adjusting state during render, not in an effect): it may have
  // been paired or forgotten on the remote screen, and the status events of a remote that connected meanwhile were not
  // heard.
  const [remoteReadFocused, setRemoteReadFocused] = useState(focused);
  if (remoteReadFocused !== focused) {
    setRemoteReadFocused(focused);
    if (focused) {
      if (controllerSupported) setControlHost(remoteControllerHost());
      if (remoteSupported) setRemoteLinked(remoteHostControllers());
    }
  }
  const disconnectControl = () => {
    const name = controlHost === null ? "" : controlHost.name;
    Alert.alert(t("remote.forgetTitle", { name }), t("remote.forgetBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("remote.forget"),
        style: "destructive",
        onPress: () => {
          remoteControllerForget();
          setControlHost(null);
        },
      },
    ]);
  };
  // Voice counts as on only when this mode wants it and the phone may listen.
  const voiceOn = voiceSupported && settings.voiceEnabled && speechGranted;
  const voiceStatus = !voiceSupported
    ? t("setup.voiceUnavailable")
    : !settings.voiceEnabled
      ? t("setup.off")
      : speechGranted
        ? t("setup.voiceSay", { word: VOICE_WORD[locale] })
        : speech === "denied"
          ? t("setup.voiceDenied")
          : t("setup.tapToAllow");

  /** The voice practice asks for the permission on its own (the trigger stays as the player set it). */
  async function allowSpeech() {
    const granted = await requestSpeechPermission();
    track("permission_result", { kind: "speech", granted });
    setSpeech(granted ? "granted" : "denied");
  }

  async function toggleVoice() {
    if (voiceOn) return updateMode({ voiceEnabled: false });
    let granted = speechGranted;
    if (!granted) {
      granted = await requestSpeechPermission();
      track("permission_result", { kind: "speech", granted });
    }
    setSpeech(granted ? "granted" : "denied");
    setSpeechDenied(!granted);
    if (granted) updateMode({ voiceEnabled: true });
  }

  const summary = t("setup.summary", {
    items: [
      t("setup.summaryClip", { seconds: clipSeconds }),
      ...(is4k ? [t("setup.summary4k")] : []),
      ...(voiceOffered
        ? [t(voiceOn ? "setup.summaryVoiceOn" : "setup.summaryVoiceOff")]
        : []),
      t(
        settings.gestureEnabled
          ? "setup.summaryGestureOn"
          : "setup.summaryGestureOff",
      ),
      t(
        !remoteAllowed
          ? "setup.summaryRemoteNotConnected"
          : remoteView.state === "connected"
            ? "setup.summaryRemoteConnected"
            : remoteLink === "bluetoothOff"
              ? "setup.summaryBluetoothOff"
              : remoteLink === "missing"
                ? "setup.summaryRemoteMissing"
                : remoteView.state === "offline"
                  ? "setup.summaryRemotePaired"
                  : "setup.summaryRemoteNotConnected",
      ),
      ...(watchOn ? [t("setup.summaryWatchReady")] : []),
    ].join(", "),
  });

  const { phase, error, camera } = session.state;
  // The practice belongs to the setup: a game starting closes it.
  if (practice !== undefined && phase !== "idle") setPractice(undefined);
  const { prepare, release } = session;

  // Before a recording, until the player turns it off: how to keep the iPhone steady (no case, out of the sun).
  const [preparing, setPreparing] = useState(false);

  // No rest on this screen (2026-11-20): the setup keeps the camera on while the player positions the phone; the
  // screen rests (battery saving) only once a recording starts.
  useSetupDiag(focused && phase === "idle", false);

  // Live preview while positioning: a preview only (30 fps, no buffer, 2026-11-08 spec §3.1); "Começar gravação"
  // starts the buffer on the open camera.
  useEffect(() => {
    if (live) void prepare(modeId, plan);
    else void release();
  }, [live, prepare, release, modeId, lens, plan]);

  // A recording ended from the remote leaves the player on this screen: the camera comes back for the next hold.
  useEffect(() => {
    if (live && phase === "idle" && camera === "off") void prepare(modeId, plan);
  }, [live, phase, camera, prepare, modeId, plan]);

  /** A remote press here: the connection test. */
  const remotePress = () => {
    remoteTest.press();
  };

  useEffect(() => {
    if (!focused) return;
    void activateKeepAwakeAsync("setup");
    return () => void deactivateKeepAwake("setup");
  }, [focused]);

  // A press of the Bluetooth remote here proves it is paired and reaching the app.
  // The connection test: the remote's presses (a press that only wakes it does not show; the player presses again).
  // Held 2 s (`REMOTE_HOLD_MS`), it starts a recording from the court (2026-11-07 spec §5.1).
  useBluetoothRemote(
    live && phase === "idle" && remoteAllowed,
    remotePress,
    { onHold: startFromRemote },
  );

  // Coming back from another app, whether the remote is still on is unknown: until it is pressed again it shows as paired.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") clearRemotePress();
    });
    return () => sub.remove();
  }, []);

  const busy = useRef(false);
  /** A tap on something Pro-only: counted as a blocked feature, then the paywall opens. */
  function lockedFeature(feature: "quality_4k" | "clip_length" | "watch") {
    track("pro_feature_blocked", { feature });
    void openPaywall(t, "locked_feature");
  }
  async function onStart() {
    if (busy.current) return;
    busy.current = true;
    try {
      await session.start(modeId); // the plan never stops a start
    } finally {
      busy.current = false;
    }
  }

  function askThenStart() {
    if (repo.getPrefs().prepareTipSeen === true) {
      void onStart();
      return;
    }
    setPreparing(true);
  }
  function startPrepared(hideNextTime: boolean) {
    if (hideNextTime) repo.setPrefs({ prepareTipSeen: true });
    setPreparing(false);
    void onStart();
  }

  /** The remote held 2 s here: the same start as the button, answered by its own sound and torch (or the failure beep). */
  async function startFromRemote() {
    remoteTest.press(); // a hold proves the remote works too
    if (busy.current) return;
    busy.current = true;
    try {
      const result = await session.start(modeId);
      const prefs = repo.getPrefs();
      if (result === "started")
        signalAction("started", {
          sound: prefs.soundOnSave,
          flash: prefs.flashOnSave,
        });
      else if (result === "failed")
        signalSaveFailed({ sound: prefs.soundOnSave });
    } finally {
      busy.current = false;
    }
  }

  const opening = camera === "starting";
  const starting = phase === "starting" || opening;
  const errorText = error
    ? t(START_ERRORS[error] ?? "setup.cameraFailed")
    : null;

  // On its side the phone shows only two small buttons (the settings open on demand), so the sheet does not cover the camera.
  // On its side, the buttons' contents turn upright (the app itself stays in portrait).
  const turn = useLandscapeTurn(live && phase === "idle");
  const landscape = turn !== 0;
  const compact = landscape;
  const upright = landscape ? { transform: [{ rotate: `${turn}deg` }] } : undefined;
  const screen = useWindowDimensions();

  const inGame =
    phase === "recording" ||
    phase === "stopping" ||
    (phase === "ended" && error !== undefined);

  // One camera view for the whole game: setup and recording only swap the controls drawn over it.
  return (
    <View testID="setup-root" style={styles.root}>
      <ReplayCameraView style={StyleSheet.absoluteFill} />
      {inGame ? (
        <RecordingPanel
          clipSeconds={settings.cutSeconds}
          gesture={settings.gestureEnabled}
          voice={voiceOn}
          // Continuous zoom only: a fixed lens cannot change while the camera records.
          zoom={
            zoomRange.continuous
              ? { value: zoom, onPress: cycleZoom, pinch }
              : undefined
          }
        />
      ) : (
        renderSetupControls()
      )}
      <PrepareSheet
        visible={preparing}
        onStart={startPrepared}
        onClose={() => setPreparing(false)}
      />
      {practice === "gesture" ? (
        <GestureSheet
          visible={live && phase === "idle"}
          onClose={() => setPractice(undefined)}
        />
      ) : null}
      {practice === "voice" ? (
        <VoiceSheet
          visible={live && phase === "idle"}
          onClose={() => setPractice(undefined)}
          locale={locale}
          speech={speech}
          onAllow={() => void allowSpeech()}
        />
      ) : null}
    </View>
  );

  function renderSetupControls() {
    return (
      <>
        {zoomRange.continuous ? (
          <View
            testID="zoom-pinch"
            style={StyleSheet.absoluteFill}
            {...pinch}
          />
        ) : null}
        {/* The zoom sits over the sheet, in the middle, as in the Camera app (2026-11-20). */}
        {hasZoomChoice(zoomRange) && !expanded && !compact ? (
          <View
            pointerEvents="box-none"
            style={[styles.zoomDock, { bottom: (compact ? 72 : sheetHeight) + 16 }]}
          >
            <ZoomButton value={zoom} onPress={cycleZoom} />
          </View>
        ) : null}
        <View
          testID="guide-area"
          pointerEvents="none"
          style={[styles.guideArea, { bottom: landscape ? 72 : sheetHeight }]}
        >
          <PositionGuide guide={mode.guide} />
        </View>

        <SafeAreaView edges={["top"]} style={styles.top}>
          {/* Gravações on the left, Ajustes on the right (2026-11-20: battery saving is only on the recording screen). */}
          <View style={styles.topRow}>
            <View style={styles.topSide}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("setup.myRecordings")}
                onPress={() => router.push("/games")}
                style={styles.galleryButton}
              >
                <View style={upright}>
                  <GalleryIcon size={28} />
                </View>
              </Pressable>
            </View>
            <View style={[styles.topSide, styles.topSideEnd]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("setup.settings")}
                onPress={() => {
                  dismissSettingsTip();
                  router.push("/account");
                }}
                style={styles.gearButton}
              >
                <View style={upright}>
                  <GearIcon size={23} />
                </View>
              </Pressable>
            </View>
          </View>
          {settingsTip && !compact ? (
            <View style={styles.settingsTip}>
              <View style={styles.settingsTipArrow} />
              <Text style={styles.settingsTipTitle}>{t("setup.settingsTipTitle")}</Text>
              <Text style={styles.settingsTipBody}>{t("setup.settingsTipBody")}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={dismissSettingsTip}
                style={styles.settingsTipButton}
              >
                <Text style={styles.settingsTipButtonText}>{t("setup.settingsTipOk")}</Text>
              </Pressable>
            </View>
          ) : null}
          {mode.tip && !compact ? (
            <View style={styles.tip}>
              <Text style={styles.tipText}>{modeTip(mode.group, locale)}</Text>
            </View>
          ) : null}
        </SafeAreaView>

        {landscape ? (
          <>
            {expanded ? renderLandscapeSettings() : null}
            {/* Over the settings: Ajustes toggles them, and Gravar with them open only closes them (2026-11-20). */}
            <CompactDock
              busy={starting}
              error={expanded ? null : errorText}
              onSettings={() => setExpanded(!expanded)}
              onStart={() => (expanded ? setExpanded(false) : askThenStart())}
              turn={turn}
              zoom={hasZoomChoice(zoomRange) ? { value: zoom, onPress: cycleZoom } : undefined}
            />
          </>
        ) : (
          <View
            testID="setup-sheet"
            style={styles.sheet}
            onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
          >
            <SafeAreaView
              edges={["bottom"]}
              style={styles.sheetBody}
              {...swipe.panHandlers}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  expanded ? t("setup.closeSettings") : t("setup.openSettings")
                }
                onPress={() => setExpanded(!expanded)}
                hitSlop={12}
                style={styles.handleArea}
              >
                <View style={styles.handle} />
              </Pressable>
              {expanded ? renderSettings() : renderSummary()}

              {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
              <Button
                label={opening ? t("setup.openingCamera") : t("setup.start")}
                icon={
                  starting ? (
                    <ActivityIndicator color={colors.onAccent} />
                  ) : undefined
                }
                disabled={starting}
                onPress={askThenStart}
              />
            </SafeAreaView>
          </View>
        )}
      </>
    );
  }

  /**
   * The settings with the phone on its side (2026-11-20): the app stays in portrait, so the panel is drawn turned a
   * quarter to stand upright. It takes the whole screen but the round buttons' side, with every setting in view (three
   * columns, no scrolling). Fechar, a tap outside it, or Gravar close it (Gravar records on the next tap).
   */
  function renderLandscapeSettings() {
    const long = screen.height;
    const short = screen.width;
    // The round buttons (Ajustes, Gravar, zoom) stay in view on the side the phone's bottom is; the notch on the other.
    const dockSide = turn === 90 ? "right" : "left";
    const notchSide = turn === 90 ? "left" : "right";
    return (
      <>
        <Pressable
          testID="landscape-backdrop"
          accessible={false}
          onPress={() => setExpanded(false)}
          style={styles.landscapeBackdrop}
        />
        <View
          pointerEvents="box-none"
          style={[
            styles.landscapeFrame,
            {
              width: long,
              height: short,
              left: (short - long) / 2,
              top: (long - short) / 2,
              transform: [{ rotate: `${turn}deg` }],
            },
          ]}
        >
          <View
            testID="setup-sheet"
            style={[
              styles.landscapePanel,
              { [dockSide]: LANDSCAPE_DOCK, [notchSide]: LANDSCAPE_NOTCH },
            ]}
          >
            <View style={styles.landscapeHead}>
              <Text style={styles.landscapeTitle}>{t("setup.dockSettings")}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("setup.closeSettings")}
                onPress={() => setExpanded(false)}
                hitSlop={10}
                style={styles.landscapeClose}
              >
                <CloseIcon size={16} color={colors.onAccent} />
                <Text style={styles.landscapeCloseText}>{t("common.close")}</Text>
              </Pressable>
            </View>
            {/* Everything fits on a phone of today; the scroll is only a fallback for the smallest screens. */}
            <ScrollView
              style={styles.landscapeScroll}
              contentContainerStyle={styles.landscapeContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {renderSettingsColumns()}
            </ScrollView>
            {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
          </View>
        </View>
      </>
    );
  }

  function renderSummary() {
    const iconColor = (on: boolean) => (on ? colors.accent : colors.muted);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary}
        onPress={() => setExpanded(true)}
        style={styles.summary}
      >
        <View style={styles.summaryHead}>
          <Text style={styles.section}>{t("setup.howToSave")}</Text>
        </View>
        <View style={styles.summaryIcons}>
          {voiceOffered ? (
            <MicIcon color={iconColor(voiceOn)} size={32} />
          ) : null}
          <WaveIcon color={iconColor(settings.gestureEnabled)} size={32} />
          <RemoteIcon
            color={iconColor(remoteReady && remoteAllowed)}
            size={32}
          />
          {watchSupported ? (
            <WatchIcon color={iconColor(watchOn)} size={32} />
          ) : null}
          {remoteSupported ? (
            <QrIcon color={iconColor(remoteLinked > 0)} size={32} />
          ) : null}
        </View>
      </Pressable>
    );
  }

  /** The clip lengths, the paid ones under one "Pro" outline. */
  function renderClipLength() {
    return (
      <View style={styles.clipLength}>
        <Text style={styles.section}>{t("setup.clipLength")}</Text>
        <View style={styles.chips}>
          {CLIP_SECONDS_OPTIONS.filter(
            (seconds) => !showPro || seconds <= FREE_MAX_SECONDS,
          ).map((seconds) => (
            <Chip
              key={seconds}
              label={`${seconds}s`}
              selected={clipSeconds === seconds}
              onPress={() => updateMode({ cutSeconds: seconds })}
            />
          ))}
          {showPro ? (
            // The paid lengths share one outline and one "Pro" badge instead of one each.
            <View style={styles.proGroup}>
              {proSeconds.map((seconds) =>
                isAllowed(seconds) ? (
                  <Chip
                    key={seconds}
                    label={`${seconds}s`}
                    grouped
                    selected={clipSeconds === seconds}
                    onPress={() => updateMode({ cutSeconds: seconds })}
                  />
                ) : (
                  <Chip
                    key={seconds}
                    label={`${seconds}s`}
                    grouped
                    lockedHint={t("setup.proOnly")}
                    onPress={() => lockedFeature("clip_length")}
                  />
                ),
              )}
              <ProBadge label={t("setup.proBadge")} right={6} />
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  function renderQuality() {
    if (!has4k) return null;
    return (
      <View style={styles.clipLength}>
        <Text style={styles.section}>{t("setup.quality")}</Text>
        <View style={styles.chips}>
          <Chip
            label={t("setup.qualityFullHd")}
            selected={!is4k}
            onPress={() => updateMode({ quality: "1080p60" })}
          />
          {!showPro ? (
            <Chip
              label={t("setup.quality4k")}
              selected={is4k}
              onPress={() => updateMode({ quality: "2160p30" })}
            />
          ) : (
            <View style={styles.proGroup}>
              {fourKAllowed ? (
                <Chip
                  label={t("setup.quality4k")}
                  grouped
                  selected={is4k}
                  onPress={() => updateMode({ quality: "2160p30" })}
                />
              ) : (
                <Chip
                  label={t("setup.quality4k")}
                  grouped
                  lockedHint={t("setup.proOnly")}
                  onPress={() => lockedFeature("quality_4k")}
                />
              )}
              <ProBadge label={t("setup.proBadge")} right={6} />
            </View>
          )}
        </View>
        <Text style={styles.clipLengthHint}>
          {t(is4k ? "setup.quality4kHint" : "setup.qualityFullHdHint")}
        </Text>
      </View>
    );
  }

  /** The Bluetooth remote and the Apple Watch save a lance best: their own title says why (2026-11-02). */
  function renderRecommendedHead() {
    return (
      <View style={styles.recommendedHead}>
        <View style={styles.recommendedTitle}>
          <StarIcon size={12} />
          <Text style={[styles.section, styles.recommended]}>
            {t("setup.recommendedTriggers")}
          </Text>
        </View>
        <Text style={styles.recommendedHint}>{t("setup.recommendedHint")}</Text>
      </View>
    );
  }

  function renderRemoteTile(dense: boolean) {
    return (
      <TriggerTile
        dense={dense}
        icon={<RemoteIcon />}
        title={t("setup.bluetoothRemote")}
        status={remoteView.statusText}
        active={remoteReady && remoteAllowed}
        lockedHint={remoteAllowed ? undefined : t("setup.proOnly")}
        onPress={
          remoteAllowed
            ? () => {
                openingRemoteSheet(); // the camera stays on under the sheet (presses are heard through it)
                router.push({
                  pathname: "/devices",
                  params: { kind: "remote" },
                });
              }
            : () => void openPaywall(t, "locked_feature")
        }
      />
    );
  }

  /** The paid trigger: in the free plan the Apple Watch tile alone carries the outline and the "Pro" badge. iPhone only. */
  function renderWatchTile(dense: boolean) {
    if (!watchSupported) return null;
    return (
      <View style={styles.proTile}>
        {showPro ? <View pointerEvents="none" style={styles.proOutline} /> : null}
        <TriggerTile
          dense={dense}
          icon={<WatchIcon />}
          title={sourceLabel("watch", locale)}
          status={watchStatus}
          active={watchOn}
          lockedHint={watchLocked ? t("setup.watchProOnly") : undefined}
          onPress={watchLocked ? () => lockedFeature("watch") : watchHelp}
        />
        {showPro ? <ProBadge label={t("setup.proBadge")} top={-9} right={6} /> : null}
      </View>
    );
  }

  function renderVoiceTile(dense: boolean) {
    if (!voiceOffered) return null;
    return (
      <TriggerTile
        dense={dense}
        icon={<MicIcon />}
        title={sourceLabel("voice", locale)}
        status={voiceStatus}
        active={voiceOn}
        disabled={!voiceSupported}
        onPress={voiceSupported ? () => void toggleVoice() : undefined}
        help={
          voiceSupported
            ? { label: t("voiceGuide.help"), onPress: () => openPractice("voice") }
            : undefined
        }
      />
    );
  }

  function renderWaveTile(dense: boolean) {
    return (
      <TriggerTile
        dense={dense}
        icon={<WaveIcon />}
        title={sourceLabel("gesture", locale)}
        status={settings.gestureEnabled ? t("setup.on") : t("setup.off")}
        active={settings.gestureEnabled}
        onPress={() => updateMode({ gestureEnabled: !settings.gestureEnabled })}
        help={{ label: t("gestureGuide.help"), onPress: () => openPractice("gesture") }}
      />
    );
  }

  function renderPhoneRemoteTile(dense: boolean) {
    if (!remoteSupported) return null;
    return (
      <TriggerTile
        dense={dense}
        icon={<QrIcon />}
        title={t("setup.connectPhoneRemote")}
        status={controllersStatus(t, remoteLinked)}
        active={remoteLinked > 0}
        onPress={() => router.push("/pairing")}
      />
    );
  }

  function renderUseAsRemoteTile(dense: boolean) {
    if (!remoteSupported && !controllerSupported) return null;
    return (
      <TriggerTile
        dense={dense}
        icon={<TapIcon />}
        title={t("setup.useAsRemote")}
        status={cameraStatus(t, controlHost)}
        active={controlHost !== null}
        onPress={() => router.push("/remote")}
      />
    );
  }

  function renderDisconnect(dense: boolean) {
    if (!(remoteSupported || controllerSupported) || controlHost === null) return null;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("setup.disconnectThisPhone")}
        hitSlop={8}
        onPress={disconnectControl}
        style={dense ? styles.remoteLinkDense : styles.remoteLinkBox}
      >
        <Text style={styles.remoteLink}>{t("setup.disconnectThisPhone")}</Text>
      </Pressable>
    );
  }

  function renderAlerts() {
    return (
      <View style={styles.feedbackRow}>
        <Text style={styles.section}>{t("setup.saveAlerts")}</Text>
        <View style={styles.chips}>
          <Chip
            label={t("setup.sound")}
            selected={prefs.soundOnSave}
            onPress={() => update({ soundOnSave: !prefs.soundOnSave })}
          />
          <Chip
            label={t("setup.flash")}
            selected={prefs.flashOnSave}
            onPress={() => update({ flashOnSave: !prefs.flashOnSave })}
          />
        </View>
      </View>
    );
  }

  /** Upright: the settings in one column, in the sheet. */
  function renderSettings() {
    return (
      <>
        {renderClipLength()}
        {renderQuality()}
        {renderRecommendedHead()}
        <View testID="recommended-triggers" style={styles.proTriggers}>
          <View style={styles.gridRow}>
            {renderRemoteTile(false)}
            {renderWatchTile(false)}
          </View>
        </View>
        <Text style={styles.section}>{t("setup.otherTriggers")}</Text>
        <View style={styles.grid}>
          <View style={styles.gridRow}>
            {renderVoiceTile(false)}
            {renderWaveTile(false)}
          </View>
        </View>
        <View style={styles.triggerPlain}>
          {remoteSupported || controllerSupported ? (
            <>
              <View style={styles.gridRow}>
                {renderPhoneRemoteTile(false)}
                {renderUseAsRemoteTile(false)}
              </View>
              {renderDisconnect(false)}
            </>
          ) : null}
        </View>
        {speechDenied ? <Text style={styles.error}>{t("setup.speechDenied")}</Text> : null}
        {renderAlerts()}
      </>
    );
  }

  /**
   * On its side (2026-11-20): every setting in view without scrolling, in two columns. Left: the clip (its lengths on
   * one line, the quality); right: the triggers, recommended first, and the alerts in the corner.
   */
  function renderSettingsColumns() {
    return (
      <View style={styles.columns}>
        <View style={[styles.column, styles.columnLeft]}>
          {renderClipLength()}
          {renderQuality()}
        </View>
        <View style={[styles.column, styles.columnRight]}>
          <View style={styles.columnGroup}>
            {renderRecommendedHead()}
            <View testID="recommended-triggers" style={[styles.gridRow, styles.recommendedDense]}>
              {renderRemoteTile(true)}
              {renderWatchTile(true)}
            </View>
          </View>
          <View style={styles.columnGroup}>
            <Text style={styles.section}>{t("setup.otherTriggers")}</Text>
            <View style={styles.gridRow}>
              {renderVoiceTile(true)}
              {renderWaveTile(true)}
            </View>
            {remoteSupported || controllerSupported ? (
              <View style={styles.gridRow}>
                {renderPhoneRemoteTile(true)}
                {renderUseAsRemoteTile(true)}
              </View>
            ) : null}
            {renderDisconnect(true)}
            {speechDenied ? <Text style={styles.error}>{t("setup.speechDenied")}</Text> : null}
          </View>
          <View style={styles.columnCorner}>{renderAlerts()}</View>
        </View>
      </View>
    );
  }
}

/** On its side: how much of the screen the round buttons take, and the notch side (landscape points). */
const LANDSCAPE_DOCK = 124;
const LANDSCAPE_NOTCH = 52;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  top: { position: "absolute", top: 0, left: 16, right: 16, gap: 8 },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  topSide: { flex: 1, flexDirection: "row" },
  topSideEnd: { justifyContent: "flex-end" },
  galleryButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  gearButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(12,12,12,0.75)",
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsTip: {
    alignSelf: "flex-end",
    width: 270,
    marginTop: 4,
    padding: 14,
    gap: 6,
    borderRadius: 14,
    backgroundColor: colors.text,
  },
  settingsTipArrow: {
    position: "absolute",
    top: -6,
    right: 18,
    width: 12,
    height: 12,
    backgroundColor: colors.text,
    transform: [{ rotate: "45deg" }],
  },
  settingsTipTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.onAccent },
  settingsTipBody: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: "#3A3A3A" },
  settingsTipButton: {
    alignSelf: "flex-end",
    marginTop: 4,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.ground,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsTipButtonText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text },
  zoomDock: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  landscapeBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.45)" },
  landscapeFrame: { position: "absolute" },
  landscapePanel: {
    position: "absolute",
    top: 8,
    bottom: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 10,
    backgroundColor: colors.ground,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  landscapeHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  landscapeTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 24,
    color: colors.text,
    textTransform: "uppercase",
  },
  // A plain "Fechar" on the accent, where the eye lands first (2026-11-20: the bare ✕ went unnoticed).
  landscapeClose: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: colors.accent,
  },
  landscapeCloseText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.onAccent },
  landscapeScroll: { flex: 1 },
  landscapeContent: { flexGrow: 1 },
  columns: { flexDirection: "row", gap: 20, flexGrow: 1 },
  column: { flex: 1, gap: 12, minWidth: 0 },
  // Wide enough for every clip length on one line; the triggers' column gets the rest.
  columnLeft: { flex: 0.9 },
  // Room on the right for the Apple Watch's "Pro" outline (4 pt outside its tile), which the scroll would cut.
  columnRight: { flex: 1.25, gap: 10, paddingRight: 6 },
  columnGroup: { gap: 8 },
  recommendedDense: { marginTop: 4 }, // room for the watch's "Pro" badge
  // Avisos ao salvar in the panel's bottom right corner.
  columnCorner: { marginTop: "auto", alignItems: "flex-end" },
  tip: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(12,12,12,0.8)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  tipText: { fontFamily: fonts.body, fontSize: 12, color: colors.soft },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.ground,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  sheetBody: { paddingHorizontal: footer.side, paddingTop: 8, paddingBottom: footer.bottom, gap: 12 },
  guideArea: { position: "absolute", top: 0, left: 0, right: 0 },
  handleArea: {
    alignSelf: "center",
    paddingVertical: 6,
    paddingHorizontal: 40,
    minHeight: 24,
    justifyContent: "center",
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.muted,
  },
  summary: { gap: 8, minHeight: 44 },
  summaryHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  summaryChevron: { fontSize: 12, color: colors.muted },
  summaryIcons: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    minHeight: 48,
  },
  clipLength: { gap: 8 },
  clipLengthHint: { fontFamily: fonts.body, fontSize: 12, color: colors.soft },
  section: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1,
    color: colors.muted,
  },
  proGroup: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.chip,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  remoteLinkBox: { minHeight: 48, justifyContent: "center" },
  remoteLinkDense: { minHeight: 32, justifyContent: "center" },
  remoteLink: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.soft,
    textDecorationLine: "underline",
  },
  // The outline is drawn around the tiles, out in the sheet's side padding, so the tiles keep the width of the free ones.
  proTriggers: { marginTop: 8, marginBottom: 4 }, // room for the badge under the section title
  recommendedHead: { gap: 2 },
  recommendedTitle: { flexDirection: "row", alignItems: "center", gap: 5 },
  recommended: { color: colors.accent },
  recommendedHint: { fontFamily: fonts.body, fontSize: 12, color: colors.soft },
  proTile: { flex: 1, flexDirection: "row" },
  proOutline: {
    position: "absolute",
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 15,
  },
  triggerPlain: { gap: 8 },
  grid: { gap: 8 },
  gridRow: { flexDirection: "row", gap: 8 },
  error: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.warning },
  feedbackRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
});
