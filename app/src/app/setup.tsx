import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { router, useIsFocused } from "expo-router";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Alert,
  Animated,
  AppState,
  Easing,
  Platform,
  Pressable,
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
  signalSaved,
  signalSaveFailed,
  supportsQuality,
} from "../../modules/replay-camera";
import type { RemotePeer, ReplayErrorCode } from "../../modules/replay-camera/src/ReplayCamera.types";
import { useCameraPinch } from "../camera/useCameraPinch";
import { useLandscapeTurn } from "../camera/useDeviceLandscape";
import { BAR_GAP, CameraBar, type CameraPanel, type TourTargets, type TriggerKey } from "../components/CameraBar";
import { CameraTour, type TourStep } from "../components/CameraTour";
import { cameraTourSeen, finishCameraTour } from "../onboarding/cameraTour";
import { PhoneRemotePanel } from "../components/PhoneRemotePanel";
import { PrepareSheet } from "../components/PrepareSheet";
import { modeTip } from "../components/format";
import { sourceLabel } from "../components/sourceLabel";
import { sessionSummary, track } from "../analytics";
import { PositionGuide } from "../components/PositionGuide";
import { RecordingPanel } from "../components/RecordingPanel";
import {
  PanelAction,
  PanelGroup,
  PanelInfo,
  PanelOption,
  panelColors,
  ProGroup,
  SetupPanel,
  TriggerCircle,
} from "../components/SetupPanel";
import { TriggerTestPanel } from "../components/TriggerTestPanel";
import {
  BoltIcon,
  MicIcon,
  PhoneIcon,
  RemoteIcon,
  SoundIcon,
  WatchIcon,
  WaveIcon,
} from "../components/icons";
import { ZoomButton } from "../components/ZoomButton";
import { repo } from "../data/mmkv";
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
import { colors, fonts } from "../theme/tokens";
import { useBluetoothRemote } from "../triggers/useBluetoothRemote";

const START_ERRORS: Partial<Record<ReplayErrorCode, MessageKey>> = {
  LOW_STORAGE: "setup.lowStorage",
  CAMERA_PERMISSION: "common.cameraDenied",
};

/** The watch link as the native side sees it now. Read on every render, not only on events: WatchConnectivity
 * activates when the module loads, and an activation that finishes before this screen listens is never heard. */
function subscribeWatch(onChange: () => void): () => void {
  const sub = addReplayListener("onWatchStatus", onChange);
  return () => sub.remove();
}

/** Under "Conectar um celular": how many remotes are linked right now. Nothing when none is. */
function controllersStatus(t: TFunction, linked: number): string | undefined {
  if (linked <= 0) return undefined;
  return linked === 1
    ? t("setup.controllerLinkedOne")
    : t("setup.controllerLinkedMany", { count: linked });
}

/**
 * Under "Usar este celular": the camera phone this one is paired with. It says "Pareado", not "Conectado": this screen
 * cannot tell if the link is up, because the remote side only connects while its own screen is open.
 */
function cameraStatus(t: TFunction, host: { name: string } | null): string | undefined {
  if (host === null) return undefined;
  return host.name.length > 0 ? t("setup.pairedWith", { name: host.name }) : t("setup.paired");
}

/** How long the battery-saving notice stays after a tap on its button. */

/** How long the buttons' contents take to turn upright after the phone turns. */
const TURN_SPIN_MS = 280;

/** How long the zoom button stays amber after the zoom changed. */
const ZOOM_LIT_MS = 900;

/** The camera opening says so only past this (a quick reopen, coming back from another screen, only flashed). */
const OPENING_NOTE_MS = 700;

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
      lightZoom();
      if (Math.abs(next - savedZoom) > 1e-6) {
        updateMode({ zoom: next });
        sessionSummary.note("zoom");
      }
    },
  });
  // The zoom button turns amber while the zoom changes, and a moment after (2026-11-22): the eye finds the new value.
  const [zoomLit, setZoomLit] = useState(false);
  const [zoomTouches, setZoomTouches] = useState(0);
  const lightZoom = () => {
    setZoomLit(true);
    setZoomTouches((n) => n + 1);
  };
  useEffect(() => {
    if (zoomTouches === 0) return;
    const timer = setTimeout(() => setZoomLit(false), ZOOM_LIT_MS);
    return () => clearTimeout(timer);
  }, [zoomTouches]);
  const cycleZoom = () => {
    lightZoom();
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
  // Upright (2026-11-22): the panel open over the camera (clip length, quality, triggers or their test), and the height
  // of the button bar under the picture, which the panels, the zoom and the positioning guide sit above.
  const [panel, setPanel] = useState<CameraPanel | undefined>(undefined);
  const closePanel = () => setPanel(undefined);
  const [barHeight, setBarHeight] = useState(0);
  // The trigger test: a remote press heard since it opened. The remote's listener reads the open panel from a ref.
  const [remoteHeard, setRemoteHeard] = useState(false);
  const testing = useRef(false);
  useEffect(() => {
    testing.current = panel === "test";
  }, [panel]);
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
  // The phone remote (a second iPhone that taps Salvar for this one; back in the triggers panel 2026-11-22). The camera
  // phone waits for its paired remotes for as long as the app is open (see the root layout); pairing happens on its own
  // sheet (/pairing). Android is only a remote for now (no camera side yet): each button shows where its side exists.
  const [remoteSupported] = useState(() => isRemoteSupported());
  const [controllerSupported] = useState(() => isRemoteControllerSupported());
  const [controlHost, setControlHost] = useState<RemotePeer | null>(() =>
    isRemoteControllerSupported() ? remoteControllerHost() : null,
  );
  const [remoteLinked, setRemoteLinked] = useState(() => remoteHostControllers());
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
  // The first-time tour (2026-11-22, model A): read again on coming back, as Ajustes > Tutorial turns it back on.
  const [tourSeen, setTourSeen] = useState(cameraTourSeen);
  const [tourTargets, setTourTargets] = useState<TourTargets | undefined>(undefined);
  const [remoteReadFocused, setRemoteReadFocused] = useState(focused);
  if (remoteReadFocused !== focused) {
    setRemoteReadFocused(focused);
    if (focused) {
      setTourSeen(cameraTourSeen());
      if (controllerSupported) setControlHost(remoteControllerHost());
      if (remoteSupported) setRemoteLinked(remoteHostControllers());
    }
  }
  // The phone remote (2026-11-22): one of the triggers, "Celular", under Mais opções; a tap opens its own panel.
  const phoneOffered = remoteSupported || controllerSupported;
  const linkedStatus = controllersStatus(t, remoteLinked);
  const pairedStatus = cameraStatus(t, controlHost);
  const phoneStatus = linkedStatus !== undefined ? linkedStatus : controlHost !== null ? t("setup.paired") : t("setup.phoneNone");
  const openPhoneRemote = () => setPanel("phone");
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

  const { phase, error, camera } = session.state;
  if (panel !== undefined && phase !== "idle") setPanel(undefined);
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

  // Back on the camera after a game (2026-11-22: Gravações has no "Nova gravação", the player just goes back): a game
  // that ended still holds the live session, so it starts clean, as that button did. Only on coming back: the moment a
  // game ends here, the screen is still on top while it moves on to the game's clips.
  const wasFocused = useRef(focused);
  useEffect(() => {
    const back = focused && !wasFocused.current;
    wasFocused.current = focused;
    if (back && phase === "ended" && error === undefined) session.reset();
  }, [focused, phase, error, session]);

  // A recording ended from the remote leaves the player on this screen: the camera comes back for the next hold.
  useEffect(() => {
    if (live && phase === "idle" && camera === "off") void prepare(modeId, plan);
  }, [live, phase, camera, prepare, modeId, plan]);

  /** A remote press here: the connection test, and a "Funcionou" in the trigger test (with the saved-clip chime). */
  const remotePress = () => {
    remoteTest.press();
    if (testing.current) {
      setRemoteHeard(true);
      signalSaved({ sound: true, flash: false });
    }
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
  // Back from another screen the camera reopens in a moment, and saying so only flashed on screen (2026-11-22): the
  // note and the waiting look show only once it takes longer than OPENING_NOTE_MS. The buttons wait for it either way;
  // a tap on Gravar shows its wait at once.
  const [slowOpen, setSlowOpen] = useState(false);
  useEffect(() => {
    if (!opening) return;
    const timer = setTimeout(() => setSlowOpen(true), OPENING_NOTE_MS);
    return () => {
      clearTimeout(timer);
      setSlowOpen(false);
    };
  }, [opening]);
  const showOpening = opening && slowOpen;
  const waiting = phase === "starting" || showOpening;
  const errorText = error
    ? t(START_ERRORS[error] ?? "setup.cameraFailed")
    : null;

  // On its side the phone shows only two small buttons (the settings open on demand), so the sheet does not cover the camera.
  // On its side, the buttons' contents turn upright (the app itself stays in portrait).
  const turn = useLandscapeTurn(live && phase === "idle");
  const landscape = turn !== 0;
  // In the turned frame: the phone's bottom edge (the column, as in the Camera app) and the notch's side.
  const columnSide = turn === 90 ? "right" : "left";
  const notchSide = turn === 90 ? "left" : "right";
  // Turning the phone turns what is in the buttons, as in the Camera app (2026-11-22): animated, from where it was.
  const [spin] = useState(() => new Animated.Value(turn));
  useEffect(() => {
    Animated.timing(spin, {
      toValue: turn,
      duration: TURN_SPIN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [turn, spin]);
  const spinDeg = spin.interpolate({ inputRange: [-90, 90], outputRange: ["-90deg", "90deg"] });
  const screen = useWindowDimensions();

  // What the triggers' button draws: the ones on right now (a remote only once a press proved it works).
  const triggersOn: TriggerKey[] = [
    ...(remoteReady && remoteAllowed ? (["remote"] as const) : []),
    ...(watchOn ? (["watch"] as const) : []),
    ...(voiceOn ? (["voice"] as const) : []),
    ...(settings.gestureEnabled ? (["wave"] as const) : []),
    ...(remoteLinked > 0 ? (["phone"] as const) : []),
  ];

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
    </View>
  );

  function renderSetupControls() {
    // What is going on sits over the camera beside the buttons: the camera opening (once slow), or why a start failed.
    const message = errorText !== null ? errorText : showOpening ? t("setup.openingCamera") : null;
    const showZoom = hasZoomChoice(zoomRange) && panel === undefined && message === null;
    const bar = (
      <CameraBar
        clipSeconds={clipSeconds}
        quality={is4k ? t("setup.quality4k") : t("setup.qualityFullHd")}
        qualityFixed={!has4k}
        triggers={triggersOn}
        panel={panel}
        onPanel={(kind) => setPanel(panel === kind ? undefined : kind)}
        busy={starting}
        waiting={waiting}
        onRecord={() => {
          closePanel();
          askThenStart();
        }}
        onRecordings={() => router.push("/games")}
        onSettings={() => router.push("/account")}
        onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
        spin={spinDeg}
        turned={landscape}
        reversed={landscape && turn === 90}
        onTargets={tourSeen ? undefined : (next) => setTourTargets((prev) => (sameTargets(prev, next) ? prev : next))}
      />
    );
    // The tour waits for a quiet camera, upright: nothing open, nothing loading, no note over the camera.
    const showTour =
      !tourSeen && !landscape && focused && phase === "idle" && panel === undefined && message === null && !waiting && !preparing;
    // A tap on the camera around an open panel closes it.
    const backdrop =
      panel === undefined ? null : (
        <Pressable testID="panel-backdrop" accessible={false} onPress={closePanel} style={StyleSheet.absoluteFill} />
      );
    const messageText =
      message === null ? null : (
        <Text
          accessibilityRole={errorText !== null ? "alert" : "text"}
          style={[styles.message, errorText !== null && styles.messageError]}
        >
          {message}
        </Text>
      );
    return (
      <>
        {zoomRange.continuous ? (
          <View
            testID="zoom-pinch"
            style={StyleSheet.absoluteFill}
            {...pinch}
          />
        ) : null}
        <View
          testID="guide-area"
          pointerEvents="none"
          style={[styles.guideArea, { bottom: barHeight }]}
        >
          <PositionGuide guide={mode.guide} />
        </View>

        <SafeAreaView edges={["top"]} pointerEvents="box-none" style={styles.top}>
          {/* The zoom at the top of the screen (2026-11-22), upright and on its side in the same place: on its side
              only its text turns to stand upright. */}
          {showZoom ? (
            <View testID="zoom-dock" pointerEvents="box-none" style={styles.zoomTop}>
              <Animated.View style={{ transform: [{ rotate: spinDeg }] }}>
                <ZoomButton value={zoom} onPress={cycleZoom} lit={liveZoom !== null || zoomLit} />
              </Animated.View>
            </View>
          ) : null}
          {mode.tip && !landscape ? (
            <View style={styles.tip}>
              <Text style={styles.tipText}>{modeTip(mode.group, locale)}</Text>
            </View>
          ) : null}
        </SafeAreaView>

        {landscape ? (
          // On its side (2026-11-22): the panels and the notes are drawn in a frame turned a quarter to stand upright
          // (the app itself stays in portrait), beside the bar, which is on the phone's bottom edge.
          <View
            testID="landscape-frame"
            pointerEvents="box-none"
            style={[
              styles.landscapeFrame,
              {
                width: screen.height,
                height: screen.width,
                left: (screen.width - screen.height) / 2,
                top: (screen.height - screen.width) / 2,
                transform: [{ rotate: `${turn}deg` }],
              },
            ]}
          >
            {messageText === null ? null : (
              <View
                pointerEvents="none"
                style={[styles.landscapeMessage, { [columnSide]: barHeight + 14, [notchSide]: LANDSCAPE_NOTCH }]}
              >
                {messageText}
              </View>
            )}
            {backdrop}
            {panel === undefined ? null : (
              <View
                pointerEvents="box-none"
                style={[styles.landscapePanel, { [columnSide]: barHeight + BAR_GAP, [notchSide]: LANDSCAPE_NOTCH }]}
              >
                {renderPanel()}
              </View>
            )}
          </View>
        ) : (
          <>
            {messageText === null ? null : (
              <View pointerEvents="none" style={[styles.messageDock, { bottom: barHeight + 14 }]}>
                {messageText}
              </View>
            )}
            {backdrop}
            {renderPanel()}
          </>
        )}
        {/* The same bar either way (2026-11-22): on its side it stays where it is on the phone and only its contents
            turn, so nothing moves or flashes when the phone turns. */}
        {bar}
        {showTour && tourTargets !== undefined ? (
          <CameraTour
            steps={tourSteps(tourTargets)}
            onDone={() => {
              finishCameraTour();
              setTourSeen(true);
            }}
          />
        ) : null}
      </>
    );
  }

  /** The tour's four tips, on the controls as they are now (the clip length chosen, the quality this phone has). */
  function tourSteps(targets: TourTargets): TourStep[] {
    const quality = !has4k ? "cameraTour.qualityBodyFixed" : fourKAllowed ? "cameraTour.qualityBodyPaid" : "cameraTour.qualityBody";
    const chip = (icon: (color: string) => ReactNode, label: string) => ({ label, icon: icon(colors.text) });
    return [
      { key: "clip", target: targets.clip, title: t("cameraTour.clipTitle"), body: t("cameraTour.clipBody") },
      { key: "quality", target: targets.quality, title: t("cameraTour.qualityTitle"), body: t(quality) },
      {
        key: "triggers",
        target: targets.triggers,
        title: t("cameraTour.triggersTitle"),
        body: t("cameraTour.triggersBody"),
        chips: [
          chip((color) => <RemoteIcon size={15} color={color} />, t("setup.remoteShort")),
          chip((color) => <WaveIcon size={15} color={color} />, t("setup.waveShort")),
          chip((color) => <MicIcon size={15} color={color} />, sourceLabel("voice", locale)),
        ],
      },
      { key: "record", target: targets.record, round: true, title: t("cameraTour.recordTitle"), body: t("cameraTour.recordBody") },
    ];
  }

  /** The panel open over the camera: upright just above the bar's buttons; on its side beside the column, centred. */
  function renderPanel() {
    const place = landscape
      ? { maxHeight: screen.width - 16 }
      : // Above the settings by the same distance as the settings sit above the black (2026-11-22).
        { position: "absolute" as const, left: 8, right: 8, bottom: barHeight + BAR_GAP, maxHeight: Math.max(260, screen.height - barHeight - 70) };
    // A sideways swipe on a panel goes through the settings in their order (2026-11-22); no quality without 4K.
    const order: CameraPanel[] = has4k ? ["clip", "quality", "triggers"] : ["clip", "triggers"];
    const swipeTo = (to: "next" | "previous") => {
      const at = panel === undefined ? -1 : order.indexOf(panel);
      if (at < 0) return;
      const next = order[at + (to === "next" ? 1 : -1)];
      if (next !== undefined) setPanel(next);
    };
    const swipe = (kind: CameraPanel) => ({
      onSwipe: swipeTo,
      page: { index: order.indexOf(kind), count: order.length },
    });
    if (panel === "clip") {
      const freeSeconds = CLIP_SECONDS_OPTIONS.filter((seconds) => seconds <= FREE_MAX_SECONDS);
      return (
        <SetupPanel key="clip" testID="clip-panel" {...swipe("clip")} title={t("setup.clipTitle")} onClose={closePanel} place={place} turn={turn}>
          <PanelGroup label={t("setup.clipQuestion")}>
            <View style={styles.optionRow}>
              {showPro ? freeSeconds.map(renderClipOption) : CLIP_SECONDS_OPTIONS.map(renderClipOption)}
              {/* The paid lengths together under one outline and one "Pro" mark (2026-11-22). */}
              {showPro ? <ProGroup label={t("setup.proBadge")}>{proSeconds.map(renderClipOption)}</ProGroup> : null}
            </View>
          </PanelGroup>
          <PanelInfo text={t("setup.clipInfo")} />
        </SetupPanel>
      );
    }
    if (panel === "quality") {
      const fourKLocked = showPro && !fourKAllowed;
      return (
        <SetupPanel key="quality" testID="quality-panel" {...swipe("quality")} title={t("setup.qualityTitle")} onClose={closePanel} place={place} turn={turn}>
          {/* Rectangles like the clip lengths (2026-11-22, trying it instead of the two circles); 4K under the "Pro" mark. */}
          <PanelGroup label={t("setup.qualityQuestion")}>
            <View style={styles.optionRow}>
              <PanelOption
                label={t("setup.qualityFullHd")}
                sub={t("setup.fps60")}
                selected={!is4k}
                onPress={() => updateMode({ quality: "1080p60" })}
              />
              {showPro ? <ProGroup label={t("setup.proBadge")} flex={1}>{renderFourK(fourKLocked)}</ProGroup> : renderFourK(fourKLocked)}
            </View>
          </PanelGroup>
          <PanelInfo text={t(is4k ? "setup.quality4kInfo" : "setup.qualityFullHdInfo")} />
        </SetupPanel>
      );
    }
    if (panel === "triggers") {
      const triggerIcon = 24;
      // On its side the two groups share a line: each takes room for its triggers, so every circle is as wide.
      const recommendedCount = watchSupported ? 2 : 1;
      const moreCount = (voiceOffered ? 1 : 0) + 1 + (phoneOffered ? 1 : 0);
      return (
        <SetupPanel key="triggers" testID="triggers-panel" {...swipe("triggers")} title={t("setup.triggersTitle")} onClose={closePanel} place={place} turn={turn}>
          <View style={landscape ? styles.wideRow : styles.tallColumn}>
          <PanelGroup label={t("setup.recommendedShort")} style={landscape ? { ...styles.wideGroup, flex: recommendedCount } : undefined}>
            <View testID="recommended-triggers" style={styles.circleRow}>
              <TriggerCircle
                icon={(color) => <RemoteIcon size={triggerIcon} color={color} />}
                title={t("setup.remoteShort")}
                status={remoteView.statusText}
                on={remoteReady && remoteAllowed}
                ok={remoteReady && remoteAllowed}
                onPress={remoteAllowed ? openRemoteSheet : () => void openPaywall(t, "locked_feature")}
              />
              {watchSupported ? (
                <TriggerCircle
                  icon={(color) => <WatchIcon size={triggerIcon} color={color} />}
                  title={sourceLabel("watch", locale)}
                  status={watchLocked ? t("setup.watchProOnly") : watchStatus}
                  on={watchOn}
                  ok={watchOn}
                  pro={showPro ? t("setup.proBadge") : undefined}
                  onPress={watchLocked ? () => lockedFeature("watch") : watchHelp}
                />
              ) : null}
            </View>
          </PanelGroup>
          <PanelGroup label={t("setup.othersShort")} style={landscape ? { ...styles.wideGroup, flex: moreCount } : undefined}>
            <View testID="more-triggers" style={styles.circleRow}>
              {voiceOffered ? (
                <TriggerCircle
                  icon={(color) => <MicIcon size={triggerIcon} color={color} />}
                  title={sourceLabel("voice", locale)}
                  status={voiceStatus}
                  on={voiceOn}
                  ok={voiceOn}
                  disabled={!voiceSupported}
                  onPress={voiceSupported ? () => void toggleVoice() : undefined}
                />
              ) : null}
              <TriggerCircle
                icon={(color) => <WaveIcon size={triggerIcon} color={color} />}
                title={t("setup.waveShort")}
                status={settings.gestureEnabled ? t("setup.on") : t("setup.off")}
                on={settings.gestureEnabled}
                ok={settings.gestureEnabled}
                onPress={() => updateMode({ gestureEnabled: !settings.gestureEnabled })}
              />
              {phoneOffered ? (
                <TriggerCircle
                  icon={(color) => <PhoneIcon size={triggerIcon} color={color} />}
                  title={sourceLabel("phone", locale)}
                  status={phoneStatus}
                  on={remoteLinked > 0}
                  ok={remoteLinked > 0}
                  onPress={openPhoneRemote}
                />
              ) : null}
            </View>
            {speechDenied ? <Text style={styles.error}>{t("setup.speechDenied")}</Text> : null}
          </PanelGroup>
          </View>
          <View style={landscape ? styles.wideRow : styles.tallColumn}>
          {/* One short line (2026-11-22): the label and two small toggles. */}
          <View style={[styles.alertRow, landscape && styles.wideGroup]}>
            <Text style={styles.alertLabel}>{t("setup.saveAlert")}</Text>
            <View style={styles.alertOptions}>
              <PanelOption
                small
                label={t("setup.sound")}
                selected={prefs.soundOnSave}
                icon={(color) => <SoundIcon size={16} color={color} />}
                onPress={() => update({ soundOnSave: !prefs.soundOnSave })}
              />
              <PanelOption
                small
                label={t("setup.flash")}
                selected={prefs.flashOnSave}
                icon={(color) => <BoltIcon size={16} color={color} />}
                onPress={() => update({ flashOnSave: !prefs.flashOnSave })}
              />
            </View>
          </View>
          <View style={landscape ? styles.wideAction : undefined}>
            <PanelAction
              label={t("setup.testTriggers")}
              icon={<BoltIcon size={19} color={colors.accent} />}
              onPress={() => {
                setRemoteHeard(false);
                setPanel("test");
              }}
            />
          </View>
          </View>
        </SetupPanel>
      );
    }
    if (panel === "phone") {
      return (
        <PhoneRemotePanel
          title={sourceLabel("phone", locale)}
          canHost={remoteSupported}
          linkedStatus={linkedStatus}
          pairedStatus={pairedStatus}
          place={place}
          onConnect={() => router.push("/pairing")}
          onUseAsRemote={() => router.push("/remote")}
          onDisconnect={disconnectControl}
          onDone={() => setPanel("triggers")}
        />
      );
    }
    if (panel === "test") {
      return (
        <TriggerTestPanel
          // The remote takes part once it was ever heard on this phone (one never set up would wait forever).
          remote={remoteAllowed && remoteView.state !== "setup"}
          watch={watchOn}
          voice={voiceOn}
          wave={settings.gestureEnabled}
          remoteHeard={remoteHeard}
          locale={locale}
          place={place}
          onDone={() => setPanel("triggers")}
        />
      );
    }
    return null;
  }

  function renderFourK(locked: boolean) {
    return (
      <PanelOption
        label={t("setup.quality4k")}
        sub={t("setup.fps30")}
        selected={is4k}
        locked={locked}
        lockedHint={t("setup.proOnly")}
        onPress={locked ? () => lockedFeature("quality_4k") : () => updateMode({ quality: "2160p30" })}
      />
    );
  }

  function renderClipOption(seconds: number) {
    return isAllowed(seconds) ? (
      <PanelOption
        key={seconds}
        label={`${seconds}s`}
        selected={clipSeconds === seconds}
        onPress={() => updateMode({ cutSeconds: seconds })}
      />
    ) : (
      <PanelOption
        key={seconds}
        label={`${seconds}s`}
        locked
        lockedHint={t("setup.proOnly")}
        onPress={() => lockedFeature("clip_length")}
      />
    );
  }

  function openRemoteSheet() {
    openingRemoteSheet(); // the camera stays on under the sheet (presses are heard through it)
    router.push({ pathname: "/devices", params: { kind: "remote" } });
  }
}

/** The tour's targets moved (a layout pass measures them again and again: only a real change re-renders). */
function sameTargets(a: TourTargets | undefined, b: TourTargets): boolean {
  if (a === undefined) return false;
  return (["clip", "quality", "triggers", "record"] as const).every(
    (k) => Math.round(a[k].x) === Math.round(b[k].x) && Math.round(a[k].y) === Math.round(b[k].y) && Math.round(a[k].width) === Math.round(b[k].width),
  );
}

/** On its side: room left on the notch's side (landscape points). */
const LANDSCAPE_NOTCH = 52;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  top: { position: "absolute", top: 0, left: 16, right: 16, gap: 8 },
  messageDock: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  message: {
    overflow: "hidden",
    backgroundColor: "rgba(12,12,12,0.88)",
    borderRadius: 16,
    paddingVertical: 9,
    paddingHorizontal: 14,
    fontFamily: fonts.bodySemi,
    fontSize: 13.5,
    lineHeight: 18,
    color: colors.text,
    textAlign: "center",
  },
  messageError: { color: colors.warning },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  circleRow: { flexDirection: "row" },
  alertRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: panelColors.GROUP,
    borderRadius: 14,
    paddingVertical: 8,
    paddingRight: 8,
    paddingLeft: 14,
  },
  alertLabel: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.muted },
  alertOptions: { flexDirection: "row", gap: 6, width: 190 },
  zoomTop: { alignItems: "center", marginTop: 8 },
  landscapeFrame: { position: "absolute" },
  tip: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(12,12,12,0.8)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  tipText: { fontFamily: fonts.body, fontSize: 12, color: colors.soft },
  guideArea: { position: "absolute", top: 0, left: 0, right: 0 },
  error: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.warning },
  // On its side (2026-11-22, L1): beside the column, in the middle of the height.
  landscapeMessage: { position: "absolute", top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  landscapePanel: { position: "absolute", top: 8, bottom: 8, justifyContent: "center" },
  // The triggers on its side: the two groups side by side, then the alert line and the test on one line.
  wideRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  tallColumn: { gap: 14 },
  wideGroup: { flex: 1, minWidth: 0 },
  wideAction: { width: 210 },
});
