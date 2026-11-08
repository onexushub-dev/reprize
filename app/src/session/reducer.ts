import type { ReplayErrorCode, ThermalLevel } from '../../modules/replay-camera/src/ReplayCamera.types';
import type { TriggerSource } from '../data/schema';

export type Phase = 'idle' | 'starting' | 'recording' | 'stopping' | 'ended';
/** The camera runs from the setup screen on, so the game itself starts instantly. */
export type CameraStatus = 'off' | 'starting' | 'on';

export type SessionState = {
  phase: Phase;
  camera: CameraStatus;
  sessionId?: string;
  startedAt?: number;
  clipCount: number;
  /** `cutMs`: how much of the video the clip actually holds (can be less than the length asked for). */
  lastSaved?: { clipId: string; number: number; source: TriggerSource; at: number; cutMs: number };
  /**
   * A save under way: shown at once, with the sound and the torch, while the file is still being written (the card
   * waiting for the file came a beat after them, 2026-11-07). Gone when the save ends either way.
   */
  pendingSave?: { number: number; source: TriggerSource; at: number; cutMs: number };
  saving: boolean;
  paused: boolean;
  /** `quality`: what the camera records now, when the native side says (it steps down as the phone heats up). */
  thermal: { level: ThermalLevel; degraded: boolean; quality?: string };
  error?: ReplayErrorCode;
  /** The native side stopped because the phone got too hot. */
  thermalStop?: boolean;
  /** The running game's plan, fixed at its start (Pro or a spent Single Pass). */
  paid?: boolean;
  /** The seconds each save reaches back in the running game (15 on the free plan). */
  bufferSeconds?: number;
};

export type SessionAction =
  | { type: 'cameraStarting' }
  | { type: 'cameraOn' }
  | { type: 'cameraFailed'; code: ReplayErrorCode }
  | { type: 'cameraOff' }
  | { type: 'startRequested' }
  | { type: 'started'; sessionId: string; startedAt: number; paid: boolean; bufferSeconds: number }
  | { type: 'startFailed'; code: ReplayErrorCode }
  | { type: 'saveStarted'; source: TriggerSource; at: number; cutMs: number }
  | { type: 'saved'; sessionId: string; clipId: string; source: TriggerSource; at: number; cutMs: number }
  | { type: 'saveFailed'; sessionId: string }
  | { type: 'undone'; clipId: string }
  | { type: 'interrupted' }
  | { type: 'resumed' }
  | { type: 'thermal'; level: ThermalLevel; degraded: boolean; quality?: string }
  | { type: 'nativeError'; code: ReplayErrorCode; thermal: boolean }
  | { type: 'stopRequested' }
  | { type: 'stopped' }
  | { type: 'reset' };

export const initialState: SessionState = {
  phase: 'idle',
  camera: 'off',
  clipCount: 0,
  saving: false,
  paused: false,
  thermal: { level: 'nominal', degraded: false },
};

export function reducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'cameraStarting':
      return { ...state, camera: 'starting', error: undefined };
    case 'cameraOn':
      return { ...state, camera: 'on' };
    case 'cameraFailed':
      return { ...state, camera: 'off', error: action.code };
    case 'cameraOff':
      return { ...state, camera: 'off' };
    case 'startRequested':
      // The camera often opened before the game (preview): its heat was reported then and no new report comes while
      // the level holds, so an open camera keeps it (2026-11-05 log: "calor serious" in the header, "nominal" here).
      return {
        ...initialState,
        camera: state.camera,
        phase: 'starting',
        thermal: state.camera === 'on' ? state.thermal : initialState.thermal,
      };
    case 'started':
      return {
        ...state,
        phase: 'recording',
        sessionId: action.sessionId,
        startedAt: action.startedAt,
        clipCount: 0,
        paid: action.paid,
        bufferSeconds: action.bufferSeconds,
      };
    case 'startFailed':
      return { ...initialState, camera: state.camera, error: action.code };
    case 'saveStarted':
      return {
        ...state,
        saving: true,
        pendingSave: { number: state.clipCount + 1, source: action.source, at: action.at, cutMs: action.cutMs },
      };
    case 'saved': {
      // A save that finished after its game ended (stop → Nova gravação) must not touch the new game.
      if (action.sessionId !== state.sessionId) return state;
      const number = state.clipCount + 1;
      return {
        ...state,
        saving: false,
        pendingSave: undefined,
        clipCount: number,
        lastSaved: { clipId: action.clipId, number, source: action.source, at: action.at, cutMs: action.cutMs },
      };
    }
    case 'saveFailed':
      return action.sessionId === state.sessionId ? { ...state, saving: false, pendingSave: undefined } : state;
    case 'undone':
      return {
        ...state,
        clipCount: Math.max(0, state.clipCount - 1),
        lastSaved: state.lastSaved?.clipId === action.clipId ? undefined : state.lastSaved,
      };
    case 'interrupted':
      return { ...state, paused: true };
    case 'resumed':
      return { ...state, paused: false };
    case 'thermal':
      return {
        ...state,
        thermal: {
          level: action.level,
          degraded: action.degraded,
          ...(action.quality !== undefined ? { quality: action.quality } : {}),
        },
      };
    case 'nativeError':
      return { ...state, phase: 'ended', saving: false, error: action.code, thermalStop: action.thermal };
    case 'stopRequested':
      return { ...state, phase: 'stopping' };
    case 'stopped':
      return { ...state, phase: 'ended', saving: false, paid: undefined, bufferSeconds: undefined };
    case 'reset':
      return initialState;
  }
}
