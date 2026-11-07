import type { StyleProp, ViewStyle } from 'react-native';

export type Lens = 'ultraWide' | 'wide';
/** `2160p30` = 4K at 30 fps (iOS, on phones whose camera has it: `supportsQuality`). */
export type Quality = '2160p30' | '1080p60' | '1080p30' | '720p60' | '720p30';
export type TriggerSource = 'screen' | 'gesture' | 'remote' | 'watch' | 'voice' | 'phone';
/** The language the voice command listens in (iOS speech recognizer locale). */
export type VoiceLocale = 'pt-BR' | 'en-US';
export type ThermalLevel ='nominal' | 'fair' | 'serious' | 'critical';
export type ReplayErrorCode =
  | 'LOW_STORAGE'
  | 'CAMERA_PERMISSION'
  | 'CAMERA_UNAVAILABLE'
  | 'ENCODER_FAILED'
  | 'NO_SESSION'
  | 'CANCELLED'
  | 'FOCUS_FAILED'
  | 'FOCUS_INTERRUPTED';

/**
 * `bufferSeconds`: the rolling window kept for saves (default 60; gym modes use 120).
 * `zoom`: the starting zoom where zoom is continuous (iOS: 0.5 = ultra-wide, 1 = wide); `lens` is what the others open.
 */
/** `audio`: record the microphone into the buffer (off on the free plan); native support is separate. */
export type SessionOptions = { lens: Lens; zoom?: number; maxQuality: Quality; bufferSeconds?: number; audio?: boolean };
/** What the camera can zoom: `continuous` is false where only the two lenses exist (Android). */
/** Which edge of the phone points up (UIDeviceOrientation naming). */
export type DeviceUpright = 'portrait' | 'portraitUpsideDown' | 'landscapeLeft' | 'landscapeRight';

export type ZoomRange = { min: number; max: number; continuous: boolean };
/** `at` = ms since epoch when the trigger happened. */
export type SaveClipOptions = {
  source: TriggerSource;
  at: number;
  /** How much of the buffer the file keeps, from its end (the clip's cut plus a margin); absent = the whole buffer. */
  keepMs?: number;
};
/** `shortSide`: the saved video's resolution in pixels (1080 Full HD, 2160 4K); missing on Android and older builds. */
export type SavedClip = { clipPath: string; durationMs: number; shortSide?: number };

/** Apple Watch link: no paired watch · paired without the Reprize app · ready. */
export type WatchStatus = 'unsupported' | 'notInstalled' | 'ready';

/** Second iPhone as a remote: idle · looking for the other phone · talking to it · Local Network not allowed. */
export type RemoteLink = 'idle' | 'searching' | 'connected' | 'denied';
/** Why the link is `denied`: Bluetooth is off, or the Reprize is not allowed to use it. */
export type RemoteLinkReason = 'off' | 'unauthorized';
/** `connected` is only filled in for the paired remotes of the camera phone (`remoteHostPeers`): is the link up right now. */
export type RemotePeer = { id: string; name: string; connected?: boolean };
/** What the camera phone shows to pair: the QR link, the 6-digit code, when both stop working (ms) and the QR image. */
export type RemotePairing = { url: string; code: string; expiresAt: number; qrPath: string };
/** `expired` is only about time. `used`: another remote is pairing with this code. `closed`: the camera phone is not offering a pairing. */
export type RemotePairFailure = 'expired' | 'locked' | 'notFound' | 'wrong' | 'denied' | 'full' | 'used' | 'closed';

export type ReplayCameraModuleEvents = {
  onTrigger: (e: { source: TriggerSource; at: number }) => void;
  onWatchStatus: (e: { status: WatchStatus }) => void;
  /**
   * Both sides of the phone remote send it, since the same app runs on both phones: `side` says which one. The remote
   * screen reads only `remote`, the camera screens only `camera` (a missing side is treated as the camera's, as before).
   */
  onRemoteStatus: (e: {
    side?: 'camera' | 'remote';
    link: RemoteLink;
    reason?: RemoteLinkReason;
    peerName?: string;
    controllers?: number;
  }) => void;
  /** Remote phone only: what the camera phone is doing. */
  onRemoteState: (e: { recording: boolean; clipCount: number; startedAt?: number }) => void;
  /** Remote phone only: how the last save ended. */
  onRemoteResult: (e: { saved: boolean }) => void;
  /** Camera phone only: a remote asked to end the recording (the game screen decides whether it makes sense). */
  onRemoteStop: () => void;
  /** Camera phone only: a remote asked to start a new recording (only the game screen knows if it may). */
  onRemoteStart: () => void;
  /** Remote phone only: one picture of the camera phone's view, a JPEG in base64. */
  onRemoteFrame: (e: { jpeg: string }) => void;
  /** Remote phone only: the save command was heard here (`remoteVoiceSetEnabled`); the screen saves as for a tap. */
  onRemoteVoice: (e: { at: number }) => void;
  /**
   * `paired` / `failed`: the end of a pairing, on either phone. Camera phone only: `connecting` (a remote proved the code
   * and is linking up), `released` (that link failed, the code is free again) and `offerEnded` (five wrong tries).
   */
  onRemotePairing: (
    e:
      | { phase: 'paired'; peer: RemotePeer }
      | { phase: 'failed'; reason: RemotePairFailure }
      | { phase: 'connecting'; peer: RemotePeer }
      | { phase: 'released' }
      | { phase: 'offerEnded'; reason: 'locked' },
  ) => void;
  /** Camera phone only: the answer to `remoteHostCheck`. `ms` is the round trip; 0 when `ok` is false. */
  onRemoteCheck: (e: { id: string; ok: boolean; ms: number }) => void;
  /** `quality`: what the camera records now ("1080p30", "720p30"…); missing in older builds. */
  onThermalChange: (e: { level: ThermalLevel; degraded: boolean; quality?: string }) => void;
  onInterrupted: () => void;
  onResumed: () => void;
  /**
   * A volume button (or a Bluetooth selfie remote, which presses "volume up") pressed as a capture event while
   * `setCaptureButtons(true)` and the camera runs. iOS 17.2+ only. `primary`: volume down, Action button, Camera
   * Control; `secondary`: volume up.
   */
  onCaptureButton: (e: { button: 'primary' | 'secondary' }) => void;
  /** The audio route changed or the camera is restarting: the volume moves by itself for a moment. iOS only. */
  onAudioChange: (e: { reason: string }) => void;
  /** TEMP(diag-remote): one line for the in-app diagnostic log. iOS only. */
  onDiag: (e: { message: string }) => void;
  onError: (e: { code: ReplayErrorCode; message: string }) => void;
  /** What the gesture detector saw lately (people, arms up, wave): the practice screen reads `raised`. */
  onGestureDebug: (e: GestureDebug) => void;
  /** Gesture test (spike screen): one event per gesture sample while setGestureTrace(true). iOS only. */
  onGestureTrace: (e: GestureTrace) => void;
};

/** One person the gesture detector looked at in one sample (see GestureDetector.traceInfo). */
export type GestureTracePerson = {
  /** Track id; -1 for the whole-frame fallback. */
  id: number;
  /** How the box was found this sample: whole-frame detector, a tile, a close look around a far person, kept from an earlier sample, or no box. */
  src: 'full' | 'tile' | 'focus' | 'kept' | 'wholeFrame';
  /** Box height in pixels. */
  px: number;
  /** [x, y, width, height], normalized, origin bottom-left. */
  box: number[];
  /** Distance from the box height, assuming a 1.75 m player (raised arms make it read closer). */
  estM?: number;
  /** A body was found in the crop. */
  pose: boolean;
  /** Joint confidences (-1: missing): lw, rw, le, re, ls, rs, nose. */
  conf?: Record<string, number>;
  up?: boolean;
  raised?: boolean;
  /** Shoulder width in pixels, and the distance it gives assuming 0.31 m between the shoulder joints. */
  swPx?: number;
  estSwM?: number;
  /** Each wrist above the head line, in shoulder widths (the hold needs both > 0.35). */
  riseL?: number;
  riseR?: number;
  /** Each wrist sideways from the shoulder centre, in shoulder widths. */
  xL?: number;
  xR?: number;
  elbowsUp?: boolean;
};

export type GestureTrace = {
  /** Camera clock, seconds. */
  t: number;
  /** Time the sample took, ms. */
  ms: number;
  frame: number[];
  upright: string;
  hot: boolean;
  /** iOS thermal state: nominal, fair, serious, critical (missing in builds before 2026-10-28). */
  thermal?: string;
  tracked: number;
  isUp: boolean;
  raised: boolean;
  hfov?: number;
  zoomFactor?: number;
  focalPx?: number;
  fired?: 'hold' | 'wave';
  /** A rule fired again on a gesture that already saved a clip: held back (FireGate), no clip. */
  suppressed?: 'hold' | 'wave';
  persons: GestureTracePerson[];
};

export type GestureDebug = {
  /** People known to the detector (iOS: kept for 3 s between samples, see PersonTracks). */
  people: number;
  /** People the pose step looked at in the last sample. iOS only. */
  posed?: number;
  /** People found only by the tiles (far players) in the last sample. iOS only. */
  fromTiles?: number;
  /** Height in pixels of the smallest person the pose step looked at. iOS only. */
  smallestPx?: number;
  isX: boolean;
  /** Both wrists above the head line in at least one person (the cue for sampling faster). */
  raised?: boolean;
  /** The wave gesture fired in this sample. */
  waved?: boolean;
  orientation: number;
  samples: number;
  missing?: string;
  minConf?: number;
  wristsUp?: boolean;
  elbowsUp?: boolean;
  crossed?: boolean;
  /** Wrist distance in shoulder widths: positive = uncrossed, negative = crossed. */
  wristGap?: number;
};

export type ExportClipOptions = {
  clipPath: string;
  startMs: number;
  endMs: number;
  /** 0.5, 1, 1.5 or 2. Anything but 1 plays without sound. */
  speed: number;
  muted: boolean;
  /** The visible part of the video (0..1 of its size) after a zoom; omit for the whole video. */
  crop?: { x: number; y: number; width: number; height: number };
  /** Modo Foco: follow this framing file's track (ignored when `crop` is set). iOS only. */
  focus?: { path: string; aspect: 'landscape' | 'portrait' };
  /** Extra clockwise turn (0, 90, 180 or 270) on top of the clip's own. */
  rotation?: number;
  width: number;
  height: number;
  /** Full-frame PNG drawn over the video (the Story template bands). */
  overlayPngPath?: string;
  /** '#RRGGBB' behind the video where the overlay is transparent. */
  background: string;
};

export type ExportedClip = { path: string; durationMs: number };

/** Modo Foco analysis of a clip (iOS only). Writes the framing to `outPath` (see `focusPath`). */
export type AnalyzeFocusOptions = {
  clipPath: string;
  startMs: number;
  endMs: number;
  outPath: string;
  /** Also write the people found in each analysed frame (`samples`), for the test screen. */
  debug?: boolean;
};

/** `none`: too few people for a framing (the file has empty tracks). */
export type FocusAnalysis = {
  status: 'ready' | 'none';
  frames: number;
  framesWithPeople: number;
  meanPeople: number;
  elapsedMs: number;
};

export type ReplayCameraViewProps = {
  style?: StyleProp<ViewStyle>;
};

/** How the Bluetooth stands for the app: "notDetermined" = never asked (nothing was looked at). */
export type BluetoothState = 'on' | 'off' | 'unauthorized' | 'unsupported' | 'notDetermined' | 'unknown';

/** The BLE peripherals iOS holds connected right now, and which services showed each ("hid", "battery", "info"). */
export type BluetoothConnected = {
  state: BluetoothState;
  devices: { id: string; name: string; services: string[] }[];
};
