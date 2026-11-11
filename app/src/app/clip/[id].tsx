import { File } from 'expo-file-system';
import { diag } from '../../diag/diagLog'; // TEMP(diag-remote): export timings
import { diagExport, diagFramingShown, diagShapeKnown } from '../../diag/clipTimings'; // TEMP(diag-remote)
import { Asset } from 'expo-media-library';
import { router, useLocalSearchParams } from 'expo-router';
import { shareAsync } from 'expo-sharing';
import { useVideoPlayer } from 'expo-video';
import { type ComponentRef, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Alert,
  Animated,
  BackHandler,
  Easing,
  Image,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createThumbnail, exportClip, findContentStart, isFocusSupported, videoShape } from '../../../modules/replay-camera';
import { ClipEdit } from '../../clip/ClipEdit';
import { ClipWatch } from '../../clip/ClipWatch';
import { beginEdit, type EditSnapshot, hasChanges, lastTool, rememberTool, restorePatch, type ToolId } from '../../clip/editSession';
import { IconButton, SCRIM } from '../../clip/IconButton';
import { NeighbourStage } from '../../clip/NeighbourStage';
import { BallChip, type BallChipState } from '../../clip/BallChip';
import { BallIntroSheet } from '../../clip/BallIntroSheet';
import { ballContent, previewBox } from '../../clip/stage';
import { ToolBar } from '../../clip/ToolBar';
import { type BallUi, EDIT_TOOLS, type EditTool, type FocusUi, type ToolContext } from '../../clip/tools';
import { WatchProgress } from '../../clip/WatchProgress';
import { ExportProgress, type ExportJob } from '../../components/ExportProgress';
import { clipNumber, seconds, timeOfDay } from '../../components/format';
import { BackIcon, PauseIcon, PlayIcon } from '../../components/icons';
import { Playhead } from '../../components/Playhead';
import { useExportQualityGate } from '../../components/useExportQualityGate';
import { useFreeExportGate } from '../../components/useFreeExportGate';
import { TrimBar } from '../../components/TrimBar';
import { knownShape, rememberShape } from '../../components/clipShape';
import { useClipThumbnail } from '../../components/useClipThumbnail';
import { useReduceMotion } from '../../components/useReduceMotion';
import { sessionSummary, track as trackEvent } from '../../analytics';
import { exportPlanOf } from '../../analytics/plans';
import { askPhotos } from '../../share/askPhotos';
import { ballForCut, readyBallFile } from '../../data/ballFile';
import type { BallSportId } from '../../data/schema';
import { readFocusFile } from '../../data/focusFile';
import { removeFile, repo } from '../../data/mmkv';
import { ballAvailable, ballQueue, checkSportOnce, probeBallOnce, sportChecking } from '../../focus/appBallQueue';
import { ballSportIdOf, ballSportOf, sportNeedsCheck } from '../../focus/sportCheck';
import { focusQueue } from '../../focus/appFocusQueue';
import { focusHold } from '../../focus/focusQueue';
import { useFocusFraming } from '../../focus/useFocusFraming';
import type { MessageKey } from '../../i18n';
import { useT } from '../../i18n/useT';
import { effectiveSettings } from '../../modes/registry';
import { captureOverlay } from '../../share/captureOverlay';
import { applyEdit, contentFloor, nextRotation, outputMs, raiseToFloor, readEdit, storedEdit, turnedSize } from '../../share/editing';
import { clipWindow } from '../../share/trim';
import { unlockRecording } from '../../payments/unlock';
import { accessPlan } from '../../payments/rules';
import { clipExportJob } from '../../share/clipExport';
import { useViewPlan } from '../../share/entitlement';
import { cachedExport, rememberExport } from '../../share/exportCache';
import { exportChoices, type ShortSide } from '../../share/exportSize';
import { labelledPaths } from '../../share/labelledFile';
import { frameLayout } from '../../share/layout';
import { ShareOverlay } from '../../share/ShareOverlay';
import { ZoomableVideo } from '../../share/ZoomableVideo';
import { colors, fonts } from '../../theme/tokens';

const SLIDE_MS = 220;
/** Past the last clip the picture only gives a little, like Photos. */
const RUBBER = 0.3;
/** If the first frame is never reported, the still gives way after this long anyway. */
const POSTER_MAX_MS = 1500;
/** Which side the next clip comes in from; set just before navigating, read by the screen that mounts. */
let enterFrom: 1 | -1 | 0 = 0;

/** Loop back this much before the end of the cut: the last time update can land just short of it. */
const LOOP_EARLY_S = 0.15;
const SAVED_VISIBLE_MS = 3500;
// The share sheet is up long before `shareAsync` returns (it waits for the sheet to close), so the card leaves early.
const SHARE_HANDOFF_MS = 1200;
const FOCUS_INTRO_MS = 3000;
/** How long the framing takes to grow out of the whole video: the first time ever, and when it gets ready on screen. */
const FOCUS_INTRO_EASE_MS = 700;
const FOCUS_READY_EASE_MS = 400;
/** Seguir a Bola: under this share of frames with the ball, a note says the camera follows the players when it loses it. */
const BALL_SPARSE_SHARE = 0.35;
const BALL_SPARSE_MS = 6000;

type Player = ReturnType<typeof useVideoPlayer>;

/** Player settings live outside the component: the React Compiler forbids mutating a hook's return value. */
function applyPlayback(player: Player, speed: number, muted: boolean) {
  player.playbackRate = speed;
  player.muted = muted || speed !== 1;
}

function seek(player: Player, ms: number) {
  player.currentTime = ms / 1000;
}

function setPlaying(player: Player, playing: boolean) {
  if (playing) player.play();
  else player.pause();
}

function removeQuietly(path: string) {
  try {
    new File(`file://${path}`).delete();
  } catch {
    // already gone
  }
}


/**
 * One clip: watch it clean (Salvar, Enviar, hold for 2x) or edit it (tool bar over the cut; Cancelar undoes). The preview
 * is the exact frame that gets exported (with the app mark).
 */
export default function ClipScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // After a swipe the clip left behind stays on top, looking exactly like the new one's first frame, until the new one
  // (made underneath) shows that frame: the switch is never seen, and the controls never leave the screen.
  const [held, setHeld] = useState<string>();
  const layers = held !== undefined && held !== id ? [id, held] : [id];
  return (
    <View style={styles.layers}>
      {layers.map((clipId) => {
        const leaving = clipId !== id;
        return (
          // Keyed by clip: each clip starts from its own state; the one leaving keeps its place in the list, so it is not made again.
          <View key={clipId} pointerEvents={leaving ? 'none' : 'auto'} style={StyleSheet.absoluteFill}>
            <ClipEditor
              id={clipId}
              leaving={leaving}
              onSwitch={() => setHeld(clipId)}
              onShown={() => setHeld(undefined)}
            />
          </View>
        );
      })}
    </View>
  );
}

type EditorProps = {
  id: string;
  /** Swiped away: kept on top, still, until the next clip is on screen under it. */
  leaving: boolean;
  /** Right before moving to another clip by swiping: keep this one on top meanwhile. */
  onSwitch: () => void;
  /** The video's first frame is on screen (or took too long): whatever was kept on top can go. */
  onShown: () => void;
};

function ClipEditor({ id, leaving, onSwitch, onShown }: EditorProps) {
  const { t, locale } = useT();
  const version = useSyncExternalStore(repo.subscribe, repo.version);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the change signal
  const clip = useMemo(() => repo.getClip(id), [id, version]);
  const number = useMemo(
    () => (clip ? repo.listClips(clip.sessionId).findIndex((c) => c.id === id) + 1 : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the change signal
    [clip, id, version],
  );
  // `number` is the place in the swipe list ("2 de 3"); the clip's own number is the one it was saved with.
  const ownNumber = clip ? clipNumber(clip, number - 1) : 0;
  const siblings = useMemo(
    () => (clip ? repo.listClips(clip.sessionId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the change signal
    [clip, version],
  );
  const session = clip ? repo.getSession(clip.sessionId) : undefined;
  const maxMs = session ? effectiveSettings(session.sport, repo.getPrefs()).bufferSeconds * 1000 : undefined;
  const plan = useViewPlan(clip?.sessionId);
  const freeGate = useFreeExportGate();
  // A 4K clip leaves the app as 4K, 2K or Full HD (asked at each Salvar/Enviar); every other clip as Full HD.
  const qualityGate = useExportQualityGate();
  const [exportSide, setExportSide] = useState<ShortSide>(1080);

  const [trim, setTrim] = useState(() => (clip ? clip.trim : { startMs: 0, endMs: 0 }));
  // Speed, sound and Modo Foco work in the app for every plan; a free export drops them (see the notice in `run`).
  const edit = readEdit(clip?.edit);
  const soundOff = edit.muted;
  const floor = clip?.contentStartMs ?? 0;
  // The track covers only what the clip was first saved with, so the cut can be shortened but never reach moments
  // that already belong to the previous clip.
  const win = clip ? clipWindow(clip, floor) : { startMs: 0, endMs: 0 };
  // Bumped to start the zoomed video over from the saved zoom (reset, turn, Modo Foco back on, mode switch).
  const [zoomKey, setZoomKey] = useState(0);
  // Watch (clean, Salvar/Enviar) or edit (tool bar, Cancelar/Concluir); edit keeps what Cancelar puts back.
  const [mode, setMode] = useState<'watch' | 'edit'>('watch');
  const snapshot = useRef<EditSnapshot | undefined>(undefined);
  // One report per tool per clip: flipping between tabs is browsing, not using.
  const reportedTools = useRef(new Set<string>());
  const [openTool, setOpenTool] = useState<ToolId>(lastTool);
  // A finger held on the video in watch mode: 2x while it stays down.
  const [fast, setFast] = useState(false);
  const window = useWindowDimensions();
  const [name, setName] = useState(() => clip?.name ?? '');
  const [playing, setPlayingState] = useState(true);
  const scrubbing = useRef(false);
  const wantsPlay = useRef(true);
  const [scrubMs, setScrubMs] = useState<number>();

  // Known already when this clip was next door to the one just swiped from: it opens at its own shape.
  const [videoSize, setVideoSize] = useState(() => (clip ? knownShape(clip.path) : undefined) || { width: 1920, height: 1080 });
  // Exports wait for the real shape: a portrait clip exported with the landscape default gets wrong bands.
  const [sizeKnown, setSizeKnown] = useState(() => clip !== undefined && knownShape(clip.path) !== undefined);
  const [busy, setBusy] = useState(false);
  // What is being made right now, so the screen can say what for and for how long.
  const [job, setJob] = useState<ExportJob>();
  // Like the Photos app: the video leaves to one side while the next one comes in from the other; the controls stay.
  const [slide] = useState(() => new Animated.Value(enterFrom * window.width));
  useEffect(() => {
    if (enterFrom === 0) return;
    enterFrom = 0;
    Animated.timing(slide, {
      toValue: 0,
      duration: SLIDE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slide]);
  // This clip's still over the video until the first frame is drawn: the same still that just slid in as the neighbour.
  const [posterAt] = useState(() => (clip ? clip.trim.startMs : 0));
  const poster = useClipThumbnail(clip ? clip.path : '', posterAt);
  const [framed, setFramed] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the first frame is up
  useEffect(() => (framed ? onShown() : undefined), [framed]);
  useEffect(() => {
    const timer = setTimeout(() => setFramed(true), POSTER_MAX_MS);
    return () => clearTimeout(timer);
  }, []);
  // A key, not a text: it is shown in whatever language is current.
  const [notice, setNotice] = useState<MessageKey>();
  // The "saved" confirmation stays long enough to be read.
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [saved]);
  const exporting = useRef(false);
  const captureRefView = useRef<ComponentRef<typeof View>>(null);

  // The shape after the player's own turn; the clip's own rotation is already in the thumbnail's shape.
  const shape = turnedSize(videoSize, edit.rotation);
  // A landscape clip is exported (and previewed) in a landscape frame; a vertical one in a vertical frame.
  const landscape = shape.width > shape.height;

  // Modo Foco: the framing of the clip's shape, once its analysis is ready and the shape is known.
  const focusSupported = isFocusSupported();
  const focusState = clip && clip.focus ? clip.focus : undefined;
  const focusFile = focusState && focusState.status === 'ready' ? focusState.file : undefined;
  const focusAspect = landscape ? 'landscape' : 'portrait';
  const track = useMemo(
    () => (focusFile && sizeKnown ? readFocusFile(focusFile, focusAspect) : undefined),
    [focusFile, focusAspect, sizeKnown],
  );
  const handZoom = edit.zoom !== undefined && edit.zoom.scale > 1;
  // Modo Foco works in the app for every plan, to be tried and wanted; a free export leaves without it (see the notice in `run`).
  const focusActive = track !== undefined && edit.focus && edit.rotation === 0 && !handZoom;

  // Seguir a Bola (spec 2026-11-09): the 9:16 framing of the current cut, once its analysis is ready. Until then the
  // preview keeps Modo Foco's framing (A3: the video keeps playing the current picture) and the chip shows the progress.
  const ballChosen = edit.framing === 'ball';
  const ballFile = clip ? readyBallFile(clip) : undefined;
  const ballTrack = useMemo(
    () => (ballFile && sizeKnown ? readFocusFile(ballFile, 'portrait') : undefined),
    [ballFile, sizeKnown],
  );
  const ballOn = ballChosen && ballTrack !== undefined && edit.rotation === 0 && !handZoom;
  const focusPreview = track !== undefined && edit.rotation === 0 && !handZoom && (edit.focus || (ballChosen && !ballOn));
  const ballProgress = useSyncExternalStore(ballQueue.subscribe, () => ballQueue.progress(id));
  const cutKey = clip ? `${clip.trim.startMs}:${clip.trim.endMs}` : '';
  // Test 48: the sport Seguir a Bola analyses this recording as (its model and rules); undefined = the panel asks.
  const [, setSportTick] = useState(0);
  const ballSport = ballSportIdOf(session);
  // On, with the cut or the sport changed or never analysed: the queue analyses it (the frames already found are reused).
  useEffect(() => {
    if (!ballChosen || leaving) return;
    ballQueue.request(id);
  }, [ballChosen, cutKey, ballSport, id, leaving]);
  // Test 47a: judged not worth it on this cut and sport: back to Modo Foco, the chip says why for a few seconds.
  const unsuitable =
    clip && clip.ball && clip.ball.status === 'unsuitable' && ballSport && ballForCut(clip.ball, clip.trim, ballSport)
      ? clip.ball.reason || 'still'
      : undefined;
  const unsuitableKey = unsuitable !== undefined ? `${cutKey}:${ballSport || ''}` : undefined;
  // the cut and sport this screen just turned back to Modo Foco (the chip says so then, not on every visit)
  const turnedBack = useRef<string | undefined>(undefined);
  const [unsuitableSeen, setUnsuitableSeen] = useState<string>();
  useEffect(() => {
    if (!ballChosen || unsuitableKey === undefined) return;
    turnedBack.current = unsuitableKey;
    setEdit({ framing: 'focus' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ballChosen, unsuitableKey]);
  useEffect(() => {
    if (unsuitableKey === undefined) return;
    const timer = setTimeout(() => setUnsuitableSeen(unsuitableKey), BALL_SPARSE_MS);
    return () => clearTimeout(timer);
  }, [unsuitableKey]);
  const unsuitableNote =
    unsuitableKey !== undefined && turnedBack.current === unsuitableKey && unsuitableSeen !== unsuitableKey;
  // "Bola pouco visível": once per cut, for a few seconds under the chip.
  const sparseKey =
    ballOn && clip && clip.ball && clip.ball.share !== undefined && clip.ball.share < BALL_SPARSE_SHARE ? cutKey : undefined;
  const [sparseDone, setSparseDone] = useState<string>();
  useEffect(() => {
    if (sparseKey === undefined) return;
    const timer = setTimeout(() => setSparseDone(sparseKey), BALL_SPARSE_MS);
    return () => clearTimeout(timer);
  }, [sparseKey]);
  const [ballIntro, setBallIntro] = useState(false);
  let ballChip: BallChipState | undefined;
  if (clip && ballChosen && edit.rotation === 0 && !handZoom) {
    if (ballOn) ballChip = { kind: 'ready', sparse: sparseKey !== undefined && sparseDone !== sparseKey };
    else if (clip.ball && clip.ball.status === 'failed' && ballForCut(clip.ball, clip.trim)) {
      ballChip = { kind: 'failed', hot: clip.ball.hot === true };
    } else ballChip = { kind: 'working', progress: ballProgress };
  }
  if (!ballChip && unsuitableNote && edit.rotation === 0 && !handZoom) {
    ballChip = { kind: 'unsuitable' };
  }
  let focusChip: 'preparing' | 'on' | 'off' | undefined;
  if (edit.rotation === 0) {
    if (track) focusChip = focusActive ? 'on' : 'off';
    else if (focusSupported && (!focusState || focusState.status === 'pending')) focusChip = 'preparing';
  }
  // The analysis starts once the clip's shape is known: it takes the processor, and the thumbnail that measures the
  // video must not wait behind it (the frame would stay in its default landscape shape meanwhile).
  // TEMP(diag-remote): where the wait for the framing goes (screen open → shape known → framing on screen).
  const openedAt = useRef(Date.now());
  useEffect(() => {
    if (sizeKnown) diagShapeKnown(Date.now() - openedAt.current);
  }, [sizeKnown]);
  useEffect(() => {
    if (track) diagFramingShown(Date.now() - openedAt.current);
  }, [track]);
  useEffect(() => {
    if (!sizeKnown) return;
    const current = repo.getClip(id);
    if (current && focusSupported) focusQueue.ensure(current);
  }, [id, focusSupported, sizeKnown]);
  // The introduction, once ever: the framing grows out of the whole video with a caption.
  const reduceMotion = useReduceMotion();
  const [introDue] = useState(() => !repo.getPrefs().focusIntroSeen);
  const [introOver, setIntroOver] = useState(false);
  const showIntro = introDue && !introOver && focusActive;
  useEffect(() => {
    if (!showIntro) return;
    repo.setPrefs({ focusIntroSeen: true });
    const timer = setTimeout(() => setIntroOver(true), FOCUS_INTRO_MS);
    return () => clearTimeout(timer);
  }, [showIntro]);
  const [readyAtOpen] = useState(() => {
    const opened = repo.getClip(id);
    return opened !== undefined && opened.focus !== undefined && opened.focus.status === 'ready';
  });
  const focusEnterMs = reduceMotion ? 0 : showIntro ? FOCUS_INTRO_EASE_MS : readyAtOpen ? 0 : FOCUS_READY_EASE_MS;

  // The export of this clip as it looks now: the same job the recording screen's batch makes, so they cannot differ.
  // The size picked for the last export, if this clip offers it (a swipe to a Full HD clip falls back to Full HD).
  const side: ShortSide = exportChoices(clip ? clip.shortSide : undefined).includes(exportSide) ? exportSide : 1080;
  const look = clip
    ? clipExportJob(clip, plan, videoSize, undefined, track !== undefined, side, ballTrack !== undefined)
    : undefined;
  // The export reads the job of the size just picked: it waits for the screen to redraw the overlay at that size.
  const lookRef = useRef(look);
  const sideWait = useRef<{ side: ShortSide; done: () => void } | null>(null);
  useEffect(() => {
    lookRef.current = look;
    const wait = sideWait.current;
    if (wait && wait.side === side) {
      sideWait.current = null;
      requestAnimationFrame(() => wait.done()); // the off-screen overlay is laid out at the new size first
    }
  });
  const options = look ? look.options : undefined;
  const frame = look ? look.frame : landscape ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
  const layout = look ? look.layout : frameLayout(shape, frame);
  // What the screen shows: the export's frame, or Seguir a Bola's vertical one (also on a free plan).
  const shown = look ? look.preview : { frame, layout };
  // The real aspect ratio (rotation applied) comes from the clip's thumbnail.
  const clipPath = clip?.path;
  const startMs = clip?.trim.startMs ?? 0;
  useEffect(() => {
    if (!clipPath) return;
    // Android reads the shape from the metadata at once: the thumbnail's decoder can wait behind a Modo Foco analysis.
    const quick = videoShape(clipPath);
    if (quick) {
      rememberShape(clipPath, quick);
      setVideoSize(quick);
      setSizeKnown(true);
      return;
    }
    createThumbnail(clipPath, startMs)
      .then((path) => Image.getSize(`file://${path}`))
      .then(({ width, height }) => {
        rememberShape(clipPath, { width, height });
        setVideoSize({ width, height });
      })
      .catch(() => {}) // keep the default shape
      .finally(() => setSizeKnown(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the shape does not change with the cut
  }, [clipPath]);

  // Exports are temporary: Photos and Instagram keep their own copies.
  const mounted = useRef(true);
  useEffect(() => {
    // Exports stay for the whole app session (the recording screen's batch and this screen reuse them); the folder
    // is cleared when the app starts.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const player = useVideoPlayer(clip ? { uri: `file://${clip.path}` } : null, (p) => {
    p.timeUpdateEventInterval = 0.1;
    p.currentTime = trim.startMs / 1000;
    p.play();
  });
  // Swiped away: stand still (and quiet) on top until the next clip is on screen underneath.
  useEffect(() => {
    if (!leaving) return;
    wantsPlay.current = false;
    setPlaying(player, false);
  }, [leaving, player]);
  const focusFollow = useFocusFraming(player, track, focusPreview);
  const ballFollow = useFocusFraming(player, ballTrack, ballOn, 'height');
  const follow = ballOn ? ballFollow : focusFollow;
  // The one-time speed check of Seguir a Bola, when the editor first opens on this phone; and once per recording, whether
  // it looks like basketball (test 43).
  const sessionId = clip ? clip.sessionId : undefined;
  useEffect(() => {
    if (mode !== 'edit') return;
    probeBallOnce();
    const c = repo.getClip(id);
    if (sessionId && c && ballAvailable()) checkSportOnce(sessionId, c);
  }, [mode, id, sessionId]);

  // The first time a clip opens, find where its picture starts: a black start is not part of the video.
  const hasFloor = clip?.contentStartMs !== undefined;
  useEffect(() => {
    if (!clipPath || hasFloor) return;
    let alive = true;
    findContentStart(clipPath)
      .catch(() => 0)
      .then((contentMs) => {
        if (!alive) return;
        const current = repo.getClip(id);
        if (!current) return;
        const floor = contentFloor(contentMs, current.durationMs);
        const own = clipWindow(current, floor);
        const raised = raiseToFloor(current.trim, own.startMs, own.endMs);
        if (raised === current.trim) return void repo.updateClip(id, { contentStartMs: floor });
        repo.updateClip(id, { contentStartMs: floor, trim: raised });
        setTrim(raised);
        seek(player, raised.startMs);
      });
    return () => {
      alive = false;
    };
  }, [clipPath, hasFloor, id, player]);

  // Loop the cut; follow speed and sound live. Time updates come every 0.1 s, so the last one before the end of the file
  // can miss it: the player then stops at the end by itself, and its own "reached the end" restarts the cut.
  useEffect(() => {
    applyPlayback(player, edit.speed, soundOff);
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      if (scrubbing.current) return;
      if (currentTime >= trim.endMs / 1000 - LOOP_EARLY_S || currentTime < trim.startMs / 1000 - 0.5) seek(player, trim.startMs);
    });
    const end = player.addListener('playToEnd', () => {
      seek(player, trim.startMs);
      setPlaying(player, wantsPlay.current);
    });
    return () => {
      sub.remove();
      end.remove();
    };
  }, [player, trim, edit.speed, soundOff]);

  // Android back while editing works as Cancelar, asking first when something changed (iOS has no back gesture here).
  useEffect(() => {
    if (mode !== 'edit') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      askCancelEdit();
      return true;
    });
    return () => sub.remove();
  });

  if (!clip || !session || !options) {
    return (
      <SafeAreaView style={styles.missingRoot}>
        <IconButton label={t('common.back')} onPress={() => router.back()}>
          <BackIcon />
        </IconButton>
        <Text style={styles.missing}>{t('clip.missing')}</Text>
      </SafeAreaView>
    );
  }

  const at = siblings.findIndex((c) => c.id === id);
  const previous = at > 0 ? siblings[at - 1] : undefined;
  const next = at >= 0 ? siblings[at + 1] : undefined;

  /** Like Photos: the clip follows the finger; with nothing on that side it gives only a little. The first clip's right side is the way back. */
  function drag(dx: number) {
    const open = dx > 0 ? previous !== undefined || at === 0 : next !== undefined;
    slide.setValue(open ? dx : dx * RUBBER);
  }

  function settleBack() {
    Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 20 }).start();
  }

  /** The swipe was far or fast enough: left shows the next clip, right the previous one (or, on the first, the recording). */
  function goBy(step: 1 | -1) {
    const target = step === 1 ? next : previous;
    if (!target) {
      if (step === -1 && at === 0) router.back();
      else settleBack();
      return;
    }
    Animated.timing(slide, {
      toValue: -step * window.width,
      duration: SLIDE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      // The neighbour's still is already in place: the new clip opens right there, without a second slide.
      enterFrom = 0;
      onSwitch();
      router.setParams({ id: target.id });
    });
  }

  function setEdit(patch: Partial<ReturnType<typeof readEdit>>) {
    repo.updateClip(id, { edit: storedEdit(applyEdit(edit, patch)) });
  }

  function commitZoom(z: { scale: number; cx: number; cy: number }) {
    // A pinch on the followed picture takes over: the hand zoom stays and Modo Foco turns off.
    if (ballOn) {
      // A pinch turns Seguir a Bola off: back to the whole video, in the clip's own frame.
      setEdit({ framing: 'none', zoom: undefined });
      setZoomKey((k) => k + 1);
      return;
    }
    if (focusActive) setEdit({ zoom: z.scale > 1 ? z : undefined, framing: 'none' });
    else setEdit({ zoom: z.scale > 1 ? z : undefined });
  }

  function toggleFocus() {
    if (focusActive) return setEdit({ framing: 'none' });
    trackEvent('focus_mode_used');
    // Modo Foco on stops Seguir a Bola's analysis at once (what it found stays for later).
    if (ballChosen) ballQueue.cancel(id);
    setEdit({ framing: 'focus', zoom: undefined });
    setZoomKey((k) => k + 1);
  }

  /** Seguir a Bola on (the first-use sheet first, until it is turned off) or off (back to Modo Foco, the default). */
  function toggleBall() {
    if (ballChosen) {
      ballQueue.cancel(id);
      setEdit({ framing: 'focus' });
      setZoomKey((k) => k + 1);
      return;
    }
    if (!repo.getPrefs().ballIntroSeen) return setBallIntro(true);
    turnBallOn();
  }

  function turnBallOn() {
    setEdit({ framing: 'ball', zoom: undefined });
    setZoomKey((k) => k + 1);
  }

  /** The first-use sheet answered: "Não mostrar de novo" is kept; "Seguir o clipe todo" turns it on. */
  function answerBallIntro(go: boolean, hide: boolean) {
    setBallIntro(false);
    if (hide) repo.setPrefs({ ballIntroSeen: true });
    if (go) turnBallOn();
  }

  /** ✕ on the chip: Seguir a Bola off, back to Modo Foco; the frames found so far stay for next time. */
  function cancelBall() {
    ballQueue.cancel(id);
    setEdit({ framing: 'focus' });
    setZoomKey((k) => k + 1);
  }

  function enterEdit(tool?: ToolId) {
    const current = repo.getClip(id);
    if (!current) return;
    snapshot.current = beginEdit(current);
    const first = tool ? tool : lastTool();
    // Where Modo Foco cannot run there is no Foco tool to open.
    setOpenTool(first === 'focus' && !focusSupported ? 'speed' : first);
    setMode('edit');
    setZoomKey((k) => k + 1);
  }

  function leaveEdit() {
    snapshot.current = undefined;
    setMode('watch');
    setZoomKey((k) => k + 1);
  }

  /** Cancelar: the clip's cut and choices go back to what they were when edit mode opened. */
  function cancelEdit() {
    const before = snapshot.current;
    if (before) {
      repo.updateClip(id, restorePatch(before));
      setTrim(before.trim);
      seek(player, before.trim.startMs);
    }
    leaveEdit();
  }

  function pickTool(tool: ToolId) {
    setOpenTool(tool);
    rememberTool(tool);
    if (reportedTools.current.has(`${id}:${tool}`)) return;
    reportedTools.current.add(`${id}:${tool}`);
    trackEvent('clip_edit_tool_used', { tool });
  }

  /** Watch mode, like Reels: 2x (silent) while a finger is held on the video; the clip's own speed after. */
  function holdFast(down: boolean) {
    setFast(down);
    if (down) applyPlayback(player, 2, true);
    else applyPlayback(player, edit.speed, soundOff);
  }

  function togglePlay() {
    wantsPlay.current = !wantsPlay.current;
    setPlayingState(wantsPlay.current);
    setPlaying(player, wantsPlay.current);
  }

  /** While a handle is dragged the preview shows what that edge will cut; letting go plays the new cut again. */
  function scrub(next: { startMs: number; endMs: number }, moved: 'start' | 'end') {
    setTrim(next);
    scrubTo(moved === 'start' ? next.startMs : Math.max(next.startMs, next.endMs - 500));
  }

  /** The cursor (or a handle) is on `ms`: hold playback there while the finger is down. */
  function scrubTo(ms: number) {
    if (!scrubbing.current) {
      scrubbing.current = true;
      player.pause();
    }
    setScrubMs(ms);
    seek(player, ms);
    if (follow) follow.sync(ms);
  }

  function endScrub() {
    scrubbing.current = false;
    setScrubMs(undefined);
    setPlaying(player, wantsPlay.current);
  }

  function commitTrim(next: { startMs: number; endMs: number }) {
    scrubbing.current = false;
    setScrubMs(undefined);
    repo.updateClip(id, { trim: next });
    seek(player, next.startMs);
    if (follow) follow.sync(next.startMs);
    setPlaying(player, wantsPlay.current);
  }

  const saveName = () => {
    if (clip && name.trim() !== (clip.name ?? '')) repo.renameClip(id, name);
  };

  function confirmDelete() {
    Alert.alert(t('clip.deleteConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('clip.delete'),
        style: 'destructive',
        onPress: () => {
          const after = next ?? previous;
          removeFile(clip!.path);
          repo.deleteClip(id);
          if (after) {
            enterFrom = next ? 1 : -1;
            router.setParams({ id: after.id });
          }
          else router.back();
        },
      },
    ]);
  }

  /** Shows (and lays out) the export at `next` before it is captured; at once when it already is. */
  function showSide(next: ShortSide): Promise<void> {
    if (next === side) return Promise.resolve();
    return new Promise((done) => {
      sideWait.current = { side: next, done };
      setExportSide(next);
    });
  }

  /** One export per look (cut, edits, frame, size), reused by both buttons. */
  async function ensureExport(): Promise<string> {
    const job = lookRef.current;
    const key = job ? job.key : '';
    const cached = cachedExport(key);
    if (cached) return cached;
    const t0 = Date.now();
    const overlayPngPath = await captureOverlay(captureRefView);
    const t1 = Date.now();
    const result = await exportClip({ clipPath: clip!.path, ...job!.options, overlayPngPath, background: colors.ground });
    const o = job!.options;
    diagExport({ frameMs: t1 - t0, renderMs: Date.now() - t1, lengthMs: o.endMs - o.startMs, width: o.width, height: o.height, side, focus: !!o.focus, speed: o.speed, muted: !!o.muted });
    removeQuietly(overlayPngPath);
    // Kept even when the screen closed meanwhile: the next Salvar/Enviar of this look (here or in a batch) uses it.
    rememberExport(key, result.path);
    if (!mounted.current) throw new Error('closed');
    return result.path;
  }

  async function run(kind: ExportJob['kind'], action: (path: string) => Promise<void>) {
    if (exporting.current || !sizeKnown) return;
    // The free-plan notice says what the video loses: nothing while the field test unlocks it all (accessPlan).
    const free = accessPlan(plan) === 'free';
    if (free) {
      const go = await freeGate.ask(
        clip!.sessionId,
        { focus: focusActive || ballOn, sound: !edit.muted && edit.speed === 1 },
        kind === 'share' ? 'share' : 'save',
        { preview: { path: clip!.path, atMs: posterAt } },
      );
      if (!go || exporting.current) return;
    }
    // Only a paid export picks a size: a free one is always HD.
    const choices = exportChoices(clip!.shortSide);
    if (!free && choices.length > 1 && look) {
      const picked = await qualityGate.ask({
        choices,
        landscape: look.frame.width > look.frame.height,
        durationMs: (look.options.endMs - look.options.startMs) / look.options.speed,
        sound: !look.options.muted,
      });
      if (picked === null || exporting.current) return;
      await showSide(picked);
    }
    exporting.current = true;
    // The render and the gallery write get the phone to themselves: Modo Foco analyses of other clips (they start again
    // afterwards) made a 30 s save take over a minute and froze the playback (2026-11-10 field log).
    focusQueue.setHold('all');
    saveName(); // a name typed without closing the keyboard still counts
    setBusy(true);
    setNotice(undefined);
    setJob({ kind, stage: 'preparing' });
    try {
      const path = await ensureExport();
      setJob({ kind, stage: 'delivering' });
      if (kind === 'share') {
        setTimeout(() => setJob((j) => (j && j.kind === 'share' ? undefined : j)), SHARE_HANDOFF_MS);
      }
      await action(path);
    } catch (error) {
      // A screen closed mid-export is the player leaving, not a failure.
      if (!(error instanceof Error && error.message === 'closed')) trackEvent('export_failed', { reason: 'prepare_failed' });
      setNotice('clip.prepareFailed');
    } finally {
      focusQueue.setHold(focusHold(false));
      exporting.current = false;
      setBusy(false);
      setJob(undefined);
    }
  }

  /** The export reached the player (the gallery or the share sheet): one report of its size and where it went. */
  function reportDelivered(destination: 'photos' | 'share_sheet') {
    trackEvent('export_completed', { quality: `${side}p`, plan: exportPlanOf(plan, repo.getSession(id)) });
    trackEvent('clip_shared', { destination });
    sessionSummary.note('export');
  }

  const save = () =>
    run('save', async (path) => {
      const granted = await askPhotos();
      if (!granted) return setNotice('clip.noPhotos');
      const g0 = Date.now();
      await Asset.create(`file://${path}`);
      diag(`clipe galeria: gravado em ${Date.now() - g0} ms`);
      reportDelivered('photos');
      repo.updateClip(id, { savedAt: Date.now() });
      setSaved(true);
    });

  const share = () => run('share', async (path) => {
      // Named after the clip's label when it has one ("toco do marcao.mp4").
      const current = repo.getClip(id);
      const [named] = await labelledPaths([{ path, label: current ? current.name : undefined }]);
      await shareAsync(`file://${named}`, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' });
      reportDelivered('share_sheet');
      repo.updateClip(id, { sharedAt: Date.now() });
    });

  /** Back while editing: nothing changed leaves at once; changes ask before they are thrown away. */
  function askCancelEdit() {
    const current = repo.getClip(id);
    const before = snapshot.current;
    if (!current || !before || !hasChanges(before, current)) return cancelEdit();
    Alert.alert(t('clip.discardTitle'), undefined, [
      { text: t('clip.keepEditing'), style: 'cancel' },
      { text: t('clip.discard'), style: 'destructive', onPress: cancelEdit },
    ]);
  }

  const pr = PixelRatio.get();
  const busyActions = busy || !sizeKnown;
  const editing = mode === 'edit';

  let focusUi: FocusUi = 'unavailable';
  if (focusChip === 'on' || focusChip === 'off' || focusChip === 'preparing') focusUi = focusChip;
  // A ready framing is read once the video's shape is known: until then it is still on its way, not impossible.
  else if (focusFile && !sizeKnown && edit.rotation === 0) focusUi = 'preparing';
  const tools = focusSupported ? EDIT_TOOLS : EDIT_TOOLS.filter((t) => t.id !== 'focus');
  let ballUi: BallUi = 'hidden';
  if (ballAvailable()) {
    if (ballChosen) ballUi = ballOn ? 'on' : 'analysing';
    else if (ballSport === undefined) {
      // Test 51: no question unless this build cannot tell; another sport keeps Modo Foco ("EM BREVE")
      const needs = sportNeedsCheck(session);
      if (!needs && ballSportOf(session) === 'other') ballUi = 'soon';
      else if (needs && session && (!session.ballSport || !session.ballSport.labels || sportChecking(session.id))) {
        ballUi = 'checking';
      }
      else ballUi = 'ask';
    }
    else ballUi = unsuitable !== undefined ? 'unsuitable' : 'off';
  }
  const ctx: ToolContext = {
    edit,
    plan,
    unlock: () => void (clip && unlockRecording(clip.sessionId, t)),
    setEdit,
    focus: focusUi,
    toggleFocus,
    ball: ballUi,
    toggleBall,
    ballSport,
    ballReason: unsuitable,
    chooseBallSport: (sport: BallSportId) => {
      if (!session) return;
      const before = session.ballSport;
      repo.setBallSport(session.id, { ...(before || { v: 1, verdict: 'other' as const }), v: 1, sport });
      setSportTick((k) => k + 1);
    },
    resetZoom: () => {
      setEdit({ zoom: undefined });
      setZoomKey((k) => k + 1);
    },
    turn: () => {
      // A zoom window means something else after a turn, so start from the whole picture again.
      setEdit({ rotation: nextRotation(edit.rotation), zoom: undefined });
      setZoomKey((k) => k + 1);
    },
  };
  const tool = (tools.find((t) => t.id === openTool) as EditTool | undefined) || tools[0];

  /** The export's frame as large as `area` allows, the video in it, the app mark over it. */
  function renderStage(area: { width: number; height: number }) {
    // The same reckoning as the neighbours' stills, so that a swipe lands on the picture that slid in.
    const { height: previewHeight, scale, video: videoBox } = previewBox(shown.frame, shown.layout, area);
    return (
      <Animated.View testID="clip-stage" style={[styles.stage, { transform: [{ translateX: slide }] }]}>
        {/* What a drag uncovers on each side: the neighbouring clips' stills, or the way back on the first clip. */}
        {!editing ? (
          <>
            <View pointerEvents="none" style={[styles.neighbour, { left: -area.width, width: area.width }]}>
              {previous ? <NeighbourStage clip={previous} tier={plan} area={area} /> : at === 0 ? <Text style={styles.backHint}>{t('clip.backToRecording')}</Text> : null}
            </View>
            <View pointerEvents="none" style={[styles.neighbour, { left: area.width, width: area.width }]}>
              {next ? <NeighbourStage clip={next} tier={plan} area={area} /> : null}
            </View>
          </>
        ) : null}
        <View style={[styles.preview, { width: shown.frame.width * scale, height: previewHeight }]}>
          <ZoomableVideo
            key={zoomKey}
            player={player}
            area={{ width: shown.frame.width * scale, height: previewHeight }}
            box={videoBox}
            zoom={edit.zoom}
            rotation={edit.rotation}
            onCommit={editing ? commitZoom : () => {}}
            onTap={togglePlay}
            onSwipe={editing ? undefined : goBy}
            onDrag={editing ? undefined : drag}
            onDragCancel={editing ? undefined : settleBack}
            poster={framed ? undefined : poster}
            onFirstFrame={() => setFramed(true)}
            follow={follow}
            content={ballOn ? ballContent(shape, videoBox) : undefined}
            enterMs={focusEnterMs}
            pinch={editing}
            onHold={editing ? undefined : holdFast}
          />
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <ShareOverlay frame={shown.frame} layout={shown.layout} scale={scale} watermark={options ? options.watermark : true} />
          </View>
          {editing && ballChip ? (
            <BallChip state={ballChip} onCancel={cancelBall} onRetry={() => ballQueue.request(id)} />
          ) : null}
          {!playing ? (
            <View pointerEvents="none" style={styles.pausedBadge}>
              <View style={styles.pausedDisc}>
                <PlayIcon color={colors.text} size={36} />
              </View>
            </View>
          ) : null}
        </View>
      </Animated.View>
    );
  }

  return (
    <View style={styles.root}>
      {editing ? (
        <ClipEdit
          renderStage={renderStage}
          onCancel={cancelEdit}
          onDone={leaveEdit}
          panel={<tool.Panel ctx={ctx} />}
          cut={
            <>
              <View style={styles.trimLabels}>
                <Text style={styles.small}>{`-${seconds(win.endMs - win.startMs)}`}</Text>
                <Text style={styles.cut}>{`Corte: ${seconds(outputMs(trim, edit.speed))}`}</Text>
                <Text style={styles.small}>gatilho</Text>
              </View>
              <View style={styles.trimRow}>
                <IconButton label={playing ? 'Pausar' : 'Reproduzir'} onPress={togglePlay}>
                  {playing ? <PauseIcon /> : <PlayIcon />}
                </IconButton>
                <View style={styles.trimBar}>
                  <TrimBar
                    durationMs={win.endMs}
                    floorMs={win.startMs}
                    trim={trim}
                    maxMs={maxMs}
                    onChange={scrub}
                    onCommit={commitTrim}>
                    <Playhead
                      player={player}
                      durationMs={win.endMs}
                      floorMs={win.startMs}
                      trim={trim}
                      speed={edit.speed}
                      scrubMs={scrubMs}
                      onScrub={scrubTo}
                      onScrubEnd={endScrub}
                    />
                  </TrimBar>
                </View>
              </View>
            </>
          }
          toolBar={<ToolBar open={tool.id} focusOn={focusUi === 'on'} onOpen={pickTool} tools={tools} />}
        />
      ) : (
        <ClipWatch
          renderStage={renderStage}
          name={name}
          placeholder={t('clip.namePlaceholder', { number: ownNumber, time: timeOfDay(clip.createdAt, locale) })}
          onChangeName={setName}
          onSaveName={saveName}
          onBack={() => router.back()}
          onDelete={confirmDelete}
          focusTag={ballChosen ? undefined : focusChip === 'on' ? 'on' : focusChip === 'preparing' ? 'preparing' : undefined}
          ballTag={ballChip ? <BallChip state={ballChip} onCancel={cancelBall} onRetry={() => ballQueue.request(id)} /> : undefined}
          onFocusTag={() => enterEdit('focus')}
          notice={busy || !notice ? undefined : t(notice)}
          position={siblings.length > 1 ? t('clip.ofTotal', { number, total: siblings.length }) : undefined}
          progress={
            <WatchProgress
              player={player}
              trim={trim}
              speed={edit.speed}
              playing={playing}
              onTogglePlay={togglePlay}
              onSeek={scrubTo}
              onSeekEnd={endScrub}
            />
          }
          onEdit={() => enterEdit()}
          onSave={() => void save()}
          onShare={() => void share()}
          actionsDisabled={busyActions}
          saving={job !== undefined && job.kind === 'save'}
          sharing={job !== undefined && job.kind === 'share'}
          fast={fast}
          caption={showIntro ? t('clip.focusIntro') : undefined}
        />
      )}

      {freeGate.sheet}
      <BallIntroSheet
        visible={ballIntro}
        onCut={(hide) => answerBallIntro(false, hide)}
        onGo={(hide) => answerBallIntro(true, hide)}
        onClose={() => setBallIntro(false)}
      />
      {qualityGate.sheet}

      {/* Off-screen copy at exactly the export's pixel size, captured to PNG for the video overlay. */}
      <View pointerEvents="none" style={styles.offscreen}>
        <ShareOverlay ref={captureRefView} frame={frame} layout={layout} scale={1 / pr} watermark={options.watermark} />
      </View>

      {saved && !job ? (
        <Pressable accessibilityRole="alert" onPress={() => setSaved(false)} style={styles.savedWrap}>
          <View style={styles.savedCard}>
            <View style={styles.savedCheck}>
              <Text style={styles.savedCheckMark}>✓</Text>
            </View>
            <Text style={styles.savedText}>{t('clip.savedToPhotos')}</Text>
            <Text style={styles.savedHint}>{t('clip.savedHint')}</Text>
          </View>
        </Pressable>
      ) : null}
      {job ? <ExportProgress job={job} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  layers: { flex: 1, backgroundColor: colors.ground },
  root: { flex: 1, backgroundColor: colors.ground },
  neighbour: { position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.ground, alignItems: 'center', justifyContent: 'center' },
  backHint: { color: colors.muted, fontFamily: fonts.bodySemi, fontSize: 15 },
  missingRoot: { flex: 1, backgroundColor: colors.ground, paddingHorizontal: 16, gap: 12 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  preview: { overflow: 'hidden', backgroundColor: colors.ground },
  pausedBadge: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  pausedDisc: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: SCRIM,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 4,
  },
  offscreen: { position: 'absolute', left: -10000, top: 0 },
  savedWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  savedCard: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 22,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.82)',
  },
  savedCheck: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  savedCheckMark: { fontFamily: fonts.bodyBold, fontSize: 24, color: colors.ground },
  savedText: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.text },
  savedHint: { fontFamily: fonts.body, fontSize: 13, color: colors.text, opacity: 0.8 },
  trimLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  trimRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trimBar: { flex: 1 },
  small: { fontFamily: fonts.body, fontSize: 12, color: colors.text, opacity: 0.8 },
  cut: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text },
  missing: { fontFamily: fonts.body, fontSize: 15, color: colors.soft, textAlign: 'center', marginTop: 40 },
});
