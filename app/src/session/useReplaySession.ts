import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type {
  ReplayCameraModuleEvents,
  ReplayErrorCode,
  SaveClipOptions,
  SavedClip,
  SessionOptions,
  VoiceLocale,
  ZoomRange,
} from '../../modules/replay-camera/src/ReplayCamera.types';
import type { Repo } from '../data/repo';
import type { ModeId, ModeSettings, Sport, TriggerSource } from '../data/schema';
import { type AppLocale, voiceLocale } from '../i18n/locale';
import { type CaptureConfig, captureConfig, triggerAllowed } from '../payments/limits';
import { planOf } from '../payments/rules';
import type { Plan, StartDecision } from '../payments/types';
import { effectiveSettings } from '../modes/registry';
import { clampZoom, lensFor } from '../modes/zoom';
import { sessionSummary, track } from '../analytics';
import { countBucket, recordingDurationBucket } from '../analytics/session';
import { createTriggerBus } from '../triggers/bus';
import { cutMsFor, keepMsFor } from './cut';
import { initialState, reducer } from './reducer';

/** Everything the session talks to, injected so the logic runs in tests without native code. */
export type SessionDeps = {
  camera: {
    startSession(opts: SessionOptions): Promise<void>;
    stopSession(): Promise<void>;
    saveClip(opts: SaveClipOptions): Promise<SavedClip>;
    setGestureEnabled(enabled: boolean): void;
    getZoomRange(): ZoomRange;
    setZoom(factor: number, animated: boolean): void;
    setVoiceEnabled(enabled: boolean, locale: VoiceLocale): void;
    watchSync(state: { recording: boolean; clipCount: number; startedAt?: number }): void;
    watchSignal(saved: boolean): void;
    remoteSync(state: { recording: boolean; clipCount: number; startedAt?: number }): void;
    remoteSignal(saved: boolean): void;
    getSpeechPermission(): 'granted' | 'denied' | 'undetermined';
    signalSaved(opts: { sound: boolean; flash: boolean }): void;
    signalSaveFailed(opts: { sound: boolean }): void;
    addReplayListener<E extends keyof ReplayCameraModuleEvents>(
      event: E,
      listener: ReplayCameraModuleEvents[E]
    ): { remove(): void };
  };
  repo: Repo;
  deleteFile(path: string): void;
  haptic(): void;
  now(): number;
  /** The app's language now: the voice command listens in it. */
  locale(): AppLocale;
  /** How the next game starts: Pro, a Single Pass credit, one of the month's free recordings, or blocked. */
  startDecision: () => Promise<StartDecision>;
  /** Bluetooth remote: calls onPress per press while enabled (useVolumeRemote in the app). */
  useRemote(enabled: boolean, onPress: () => void): void;
  /** A clip was saved and recorded (the app queues its Modo Foco analysis). */
  onClipSaved?(clipId: string): void;
  /** TEMP(diag): true when the Diagnóstico screen turned the gesture off for every recording (heat measurement). */
  diagGestureOff?(): boolean;
};

export type StartResult = 'started' | 'failed' | 'busy';

/** What a camera was opened with: the mode's settings as read then, and what the plan allowed of them. */
type Opened = { settings: ModeSettings; config: CaptureConfig };

/** The phone is `serious` or hotter and the open camera still records above 1080p30 (or never said what it records). */
export function runsAboveHotQuality(thermal: { level: string; quality?: string }): boolean {
  if (thermal.level !== 'serious' && thermal.level !== 'critical') return false;
  return thermal.quality !== '1080p30' && thermal.quality !== '720p30';
}

/** How long after a recording starts, or the app comes back to the front, the volume buttons, gesture and voice are ignored. */
export const SETTLE_MS = 1500;

const errorCode = (e: unknown): ReplayErrorCode =>
  ((e as { code?: ReplayErrorCode })?.code ?? 'CAMERA_UNAVAILABLE') as ReplayErrorCode;

/** Metrics: one `recording_ended` per game, with how long it ran and how many clips it kept (both as ranges). */
function reportEnded(repo: Repo, id: string, endedAt: number, reason: 'user' | 'thermal' | 'error'): void {
  try {
    const game = repo.getSession(id);
    const ranMs = game ? endedAt - game.startedAt : 0;
    track('recording_ended', { reason, duration: recordingDurationBucket(ranMs), clips: countBucket(repo.listClips(id).length) });
  } catch {
    // metrics never reach the game
  }
}

/** One game: starts the camera, turns triggers into saved clips, and records everything in the repo. */
export function useReplaySession(deps: SessionDeps) {
  const [state, dispatch] = useReducer(reducer, initialState);
  // Latest state for callbacks fired by native events; updated right after each commit.
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);
  const saving = useRef(false);
  // Metrics: whether this recording already reported its first quality drop.
  const qualityLowered = useRef(false);
  // The camera configuration currently open, undefined when off; read synchronously by start().
  // Continuous zoom (iOS): "quality|buffer|audio", the zoom is changed live. Two fixed lenses (Android): "lens|quality|buffer|audio".
  const cameraLens = useRef<string | undefined>(undefined);
  // The zoom the running camera was last given, so the same zoom is never sent twice (a repeat would cut a smooth ramp short).
  const zoomApplied = useRef<number | undefined>(undefined);
  const cameraOpening = useRef<Promise<Opened | undefined> | undefined>(undefined);
  const cameraError = useRef<ReplayErrorCode | undefined>(undefined);
  // The running game's clip length, fixed at its start by its plan (15 s at most on the free plan): applies to every saved clip.
  const cutSeconds = useRef(0);
  // Where each clip's cut may start, newest last: the recording's start, then the moment of every clip saved since.
  // A clip is only cut back to the previous one, so undoing a clip hands its span back to the next save.
  const cutFloors = useRef<number[]>([]);
  const [bus] = useState(() => createTriggerBus({ now: deps.now }));

  const save = useCallback(
    async (source: TriggerSource, at: number) => {
      const sessionId = stateRef.current.sessionId;
      if (saving.current || stateRef.current.phase !== 'recording' || !sessionId) return;
      saving.current = true;
      // Fixed before the save finishes: the clip covers the time since the previous clip, up to the player's clip length.
      const floors = cutFloors.current;
      const clipSeconds = cutSeconds.current;
      const cutMs = cutMsFor(clipSeconds, at, floors.length > 0 ? floors[floors.length - 1] : at - clipSeconds * 1000);
      // Feedback right away, card, sound and torch together: the 60s are already captured, the file just isn't written yet.
      dispatch({ type: 'saveStarted', source, at, cutMs });
      const prefs = deps.repo.getPrefs();
      deps.camera.signalSaved({ sound: prefs.soundOnSave, flash: prefs.flashOnSave });
      try {
        const saved = await deps.camera.saveClip({ source, at, keepMs: keepMsFor(cutMs) });
        const clip = deps.repo.addClip({
          sessionId,
          createdAt: at,
          source,
          path: saved.clipPath,
          durationMs: saved.durationMs,
          ...(saved.shortSide !== undefined ? { shortSide: saved.shortSide } : {}),
        }, cutMs);
        if (deps.onClipSaved) deps.onClipSaved(clip.id);
        const game = deps.repo.getSession(sessionId);
        track('clip_saved', { trigger: source, mode: game ? game.sport : 'quadra' });
        sessionSummary.note('clip_saved', source);
        // A save that finished after its game ended must not move the floor of the next game.
        if (stateRef.current.sessionId === sessionId) cutFloors.current = [...cutFloors.current, at];
        deps.haptic();
        dispatch({ type: 'saved', sessionId, clipId: clip.id, source, at, cutMs: clip.trim.endMs - clip.trim.startMs });
        deps.camera.watchSignal(true);
        deps.camera.remoteSignal(true);
      } catch {
        track('trigger_failed', { trigger: source, reason: 'save_failed' });
        deps.camera.signalSaveFailed({ sound: prefs.soundOnSave });
        deps.camera.watchSignal(false);
        deps.camera.remoteSignal(false);
        dispatch({ type: 'saveFailed', sessionId });
      } finally {
        saving.current = false;
      }
    },
    [deps]
  );

  useEffect(() => bus.subscribe((source, at) => void save(source, at)), [bus, save]);

  useEffect(() => {
    const { camera, repo, now } = deps;
    const subs = [
      camera.addReplayListener('onTrigger', (e) => {
        // Outside a recording a tap saves nothing, so it must not use up the debounce of a real one.
        if (stateRef.current.phase === 'recording') void bus.fire(e.source);
      }),
      camera.addReplayListener('onInterrupted', () => dispatch({ type: 'interrupted' })),
      camera.addReplayListener('onResumed', () => dispatch({ type: 'resumed' })),
      camera.addReplayListener('onThermalChange', (e) => {
        // Metrics: the first quality drop of a recording, not every later step.
        if (e.degraded && stateRef.current.phase === 'recording' && !qualityLowered.current) {
          qualityLowered.current = true;
          track('recording_quality_lowered', { level: e.level });
        }
        dispatch({ type: 'thermal', level: e.level, degraded: e.degraded, quality: e.quality });
      }),
      camera.addReplayListener('onError', (e) => {
        // The native side has already stopped; keep what was saved and end the game.
        // Forget the camera too, so the next prepare() really reopens it.
        cameraLens.current = undefined;
        cameraOpening.current = undefined;
        dispatch({ type: 'cameraOff' });
        const id = stateRef.current.sessionId;
        if (id) {
          const endedAt = now();
          repo.endSession(id, endedAt);
          reportEnded(repo, id, endedAt, e.message === 'thermal' ? 'thermal' : 'error');
        }
        dispatch({ type: 'nativeError', code: e.code, thermal: e.message === 'thermal' });
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [bus, deps]);

  // The watch and the remote phone show what this phone shows: the clock and count while recording, idle otherwise.
  const recording = state.phase === 'recording';
  useEffect(() => {
    const shown = recording
      ? { recording, clipCount: state.clipCount, startedAt: state.startedAt }
      : { recording, clipCount: 0 };
    deps.camera.watchSync(shown);
    deps.camera.remoteSync(shown);
  }, [deps, recording, state.clipCount, state.startedAt]);

  const trigger = useCallback((source: TriggerSource) => void bus.fire(source), [bus]);

  // Back from the lock screen or another app: the camera and its audio restart, and iOS moves the volume on the way.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') bus.quiet(SETTLE_MS);
    });
    return () => sub.remove();
  }, [bus]);

  // The Bluetooth remote is paid: it listens only in a game whose plan may use it (fixed at the game's start).
  const remoteOn = state.phase === 'recording' && triggerAllowed('remote', state.paid ? 'paid' : 'free');
  deps.useRemote(remoteOn, () => trigger('remote'));

  /**
   * Turns the camera on for `mode` with what `plan` allows (the free plan: 15 s at most).
   * Reopens it when the quality, buffer or sound differ from what is open (and, with two fixed lenses, its lens);
   * with continuous zoom a different zoom is applied to the running camera instead. Resolves with what the camera is
   * open with (start uses exactly that, even if the prefs change meanwhile), or undefined when it failed.
   */
  const openCamera = useCallback(
    (mode: ModeId, plan: Plan, reopen = false): Promise<Opened | undefined> => {
      const settings = effectiveSettings(mode, deps.repo.getPrefs());
      const config = captureConfig(settings, plan);
      const opened: Opened = { settings, config };
      const { quality, bufferSeconds, audio } = config;
      const range = deps.camera.getZoomRange();
      const zoom = clampZoom(settings.zoom, range);
      const lens = lensFor(zoom);
      const key = range.continuous
        ? `${quality}|${bufferSeconds}|${audio}`
        : `${lens}|${quality}|${bufferSeconds}|${audio}`;
      if (cameraLens.current === key && !reopen) {
        if (range.continuous && zoomApplied.current !== zoom) {
          zoomApplied.current = zoom;
          deps.camera.setZoom(zoom, false);
        }
        return Promise.resolve(opened);
      }
      const open = async () => {
        await cameraOpening.current;
        if (cameraLens.current === key && !reopen) return opened;
        dispatch({ type: 'cameraStarting' });
        try {
          if (cameraLens.current !== undefined) {
            cameraLens.current = undefined;
            await deps.camera.stopSession();
          }
          // Body-pose detection is heavy: it only runs once the game starts.
          deps.camera.setGestureEnabled(false);
          await deps.camera.startSession({ lens, zoom, maxQuality: quality, bufferSeconds, audio });
          cameraLens.current = key;
          zoomApplied.current = zoom;
          dispatch({ type: 'cameraOn' });
          return opened;
        } catch (e) {
          cameraError.current = errorCode(e);
          dispatch({ type: 'cameraFailed', code: cameraError.current });
          return undefined;
        }
      };
      cameraOpening.current = open();
      return cameraOpening.current;
    },
    [deps]
  );

  /**
   * The setup screen's live preview for `mode` on `plan`, so the game starts instantly. Never touches a camera a game
   * is starting, recording or stopping with (a plan change notified meanwhile must not reopen it): resolves true.
   */
  const prepare = useCallback(
    (mode: ModeId, plan: Plan): Promise<boolean> => {
      const phase = stateRef.current.phase;
      if (phase === 'starting' || phase === 'recording' || phase === 'stopping') return Promise.resolve(true);
      return openCamera(mode, plan).then((opened) => opened !== undefined);
    },
    [openCamera]
  );

  // Never throws: a decision that cannot be read is a free start (fail-open, accepted in the spec).
  const safeDecision = useCallback(async (): Promise<StartDecision> => {
    try {
      return await deps.startDecision();
    } catch {
      return { kind: 'free' };
    }
  }, [deps]);

  const startingRef = useRef(false);
  const start = useCallback(
    async (sport: Sport): Promise<StartResult> => {
      const phase = stateRef.current.phase;
      if (startingRef.current || phase === 'starting' || phase === 'recording' || phase === 'stopping') return 'busy';
      startingRef.current = true;
      try {
        // decide → open the camera for that plan → decide again → reopen if the plan changed → create the session.
        // The plan never stops a start, and nothing paid is ever asked once recording.
        let decision = await safeDecision();
        dispatch({ type: 'startRequested' });
        // Visible to a prepare() before React commits: from here only start() touches the camera.
        stateRef.current = { ...stateRef.current, phase: 'starting' };
        let toggled = false;
        let locale: VoiceLocale | undefined;
        try {
          // Hot already (2026-11-07 spec §4.2): a camera still above 1080p30 is reopened, and the native side opens it one
          // step down, instead of two minutes at 60 fps and a restart (empty buffer, no microphone) mid-recording.
          let opened = await openCamera(sport, planOf(decision), runsAboveHotQuality(stateRef.current.thermal));
          if (!opened) {
            dispatch({ type: 'startFailed', code: cameraError.current ?? 'CAMERA_UNAVAILABLE' });
            return 'failed';
          }
          // The plan can change while the camera opens (Pro bought or lapsing): this check decides, and the camera is
          // reopened to match it.
          const again = await safeDecision();
          if (planOf(again) !== planOf(decision)) {
            opened = await openCamera(sport, planOf(again));
            if (!opened) {
              dispatch({ type: 'startFailed', code: cameraError.current ?? 'CAMERA_UNAVAILABLE' });
              return 'failed';
            }
          }
          decision = again; // the session always matches the camera that is open
          const plan = planOf(decision);
          // The settings the open camera was given: prefs changed while it opened do not reach this game.
          const { settings, config } = opened;
          // Listen only when the phone may: native and the setup tile must agree on whether voice is on.
          const voiceOn = settings.voiceEnabled && deps.camera.getSpeechPermission() === 'granted';
          locale = voiceLocale(deps.locale());
          toggled = true;
          const gestureOff = deps.diagGestureOff !== undefined && deps.diagGestureOff();
          deps.camera.setGestureEnabled(settings.gestureEnabled && !gestureOff);
          deps.camera.setVoiceEnabled(voiceOn, locale);
          // Last fallible step: a start that failed leaves no session behind.
          const session = deps.repo.startSession(sport, deps.now(), { paid: plan === 'paid' });
          cutSeconds.current = config.cutSeconds;
          cutFloors.current = [session.startedAt];
          bus.quiet(SETTLE_MS);
          const paid = plan === 'paid';
          dispatch({
            type: 'started',
            sessionId: session.id,
            startedAt: session.startedAt,
            paid,
            bufferSeconds: config.bufferSeconds,
          });
          // Visible to a second start() before React commits.
          stateRef.current = { ...stateRef.current, phase: 'recording', paid };
          qualityLowered.current = false;
          track('recording_started', {
            mode: sport,
            quality: settings.quality,
            clip_seconds: config.cutSeconds,
            plan: paid ? 'pro' : 'free',
            gesture: settings.gestureEnabled,
            voice: voiceOn,
          });
          return 'started';
        } catch (e) {
          // No game: body pose and voice go back off, as while positioning.
          // Each on its own: one that throws must not leave the other on. The start already failed; its error is shown.
          if (toggled) {
            try {
              deps.camera.setGestureEnabled(false);
            } catch {
              // see above
            }
            try {
              if (locale) deps.camera.setVoiceEnabled(false, locale);
            } catch {
              // see above
            }
          }
          dispatch({ type: 'startFailed', code: errorCode(e) });
          return 'failed';
        }
      } finally {
        startingRef.current = false;
      }
    },
    [bus, deps, openCamera, safeDecision]
  );

  const stop = useCallback(async (): Promise<string | undefined> => {
    const id = stateRef.current.sessionId;
    dispatch({ type: 'stopRequested' });
    cameraLens.current = undefined;
    await deps.camera.stopSession().catch(() => {});
    dispatch({ type: 'cameraOff' });
    if (id) {
      const endedAt = deps.now();
      deps.repo.endSession(id, endedAt);
      reportEnded(deps.repo, id, endedAt, 'user');
    }
    dispatch({ type: 'stopped' });
    return id;
  }, [deps]);

  const undoLast = useCallback(() => {
    const last = stateRef.current.lastSaved;
    if (!last) return;
    const clip = deps.repo.getClip(last.clipId);
    if (clip) deps.deleteFile(clip.path);
    deps.repo.deleteClip(last.clipId);
    // The undone clip's span is free again: the next save reaches back to the clip before it.
    if (cutFloors.current.length > 1) cutFloors.current = cutFloors.current.slice(0, -1);
    dispatch({ type: 'undone', clipId: last.clipId });
  }, [deps]);

  /** Turns the camera off when no game is running (e.g. the setup screen is under another screen). */
  const release = useCallback(async () => {
    const phase = stateRef.current.phase;
    if (cameraLens.current === undefined || phase === 'recording' || phase === 'starting' || phase === 'stopping') return;
    cameraLens.current = undefined;
    cameraOpening.current = undefined;
    await deps.camera.stopSession().catch(() => {});
    dispatch({ type: 'cameraOff' });
  }, [deps]);

  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  /** Zooms the running camera (setup screen only; the zoom is locked while recording). `animated` is for a button tap. */
  const setZoom = useCallback(
    (zoom: number, animated: boolean) => {
      zoomApplied.current = zoom;
      deps.camera.setZoom(zoom, animated);
    },
    [deps],
  );

  return { state, prepare, release, start, stop, trigger, undoLast, reset, setZoom };
}

export type ReplaySession = ReturnType<typeof useReplaySession>;
