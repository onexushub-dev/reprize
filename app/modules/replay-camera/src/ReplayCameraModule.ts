import { NativeModule, requireNativeModule } from 'expo';

import type {
  AnalyzeBallOptions,
  AnalyzeFocusOptions,
  BallAnalysis,
  BluetoothConnected,
  DeviceUpright,
  ExportClipOptions,
  ExportedClip,
  FocusAnalysis,
  ReplayCameraModuleEvents,
  SaveClipOptions,
  RemotePairing,
  RemotePeer,
  SavedClip,
  SessionOptions,
  VoiceLocale,
  WatchStatus,
  ZoomRange,
  Quality,
} from './ReplayCamera.types';

declare class ReplayCameraModule extends NativeModule<ReplayCameraModuleEvents> {
  startSession(opts: SessionOptions): Promise<void>;
  /** Optional: builds without it (Android) buffer from the start. */
  startBuffering?(): Promise<void>;
  /** Optional (iOS): the setup screen's paused camera at its lowest rate. */
  setCameraIdle?(on: boolean): void;
  stopSession(): Promise<void>;
  saveClip(opts: SaveClipOptions): Promise<SavedClip>;
  setGestureEnabled(enabled: boolean): void;
  // Gesture test, spike screen (iOS only: missing on Android and in older builds).
  setGestureTrace?(enabled: boolean): void;
  // The phone's position (iOS only: missing on Android and in older builds).
  getUpright?(): DeviceUpright;
  // Continuous zoom (iOS only: missing on Android and in older builds).
  getZoomRange?(): ZoomRange;
  setZoom?(factor: number, animated: boolean): void;
  // Screen economy while recording (iOS only: missing on Android and in older builds).
  setScreenEconomy?(on: boolean): void;
  // Screen economy on the remote phone (iOS only: missing on Android and in older builds).
  setRemoteScreenDim?(on: boolean): void;
  // Whether the phone records a quality (iOS only: missing on Android and in older builds).
  supportsQuality?(quality: Quality): boolean;
  // The phone's real output volume, 0-1 (iOS only: missing on Android and in older builds).
  outputVolume?(): number;
  // Volume buttons as capture events, true when the phone delivers them (iOS only: missing on Android and in older builds).
  setCaptureButtons?(enabled: boolean): boolean;
  // TEMP(diag-remote) (iOS only: missing on Android and in older builds).
  diagAudioState?(): string;
  // TEMP(diag-remote) (iOS only: missing on Android and in older builds).
  diagPower?(): string;
  // TEMP(diag-remote) (iOS only: missing on Android and in older builds).
  diagCaptureState?(): Promise<string>;
  // The Bluetooth selfie remote as iOS shows it (iOS only: missing on Android and in older builds).
  bluetoothConnected?(ask: boolean): Promise<BluetoothConnected>;
  requestPermissions(): Promise<boolean>;
  signalSaved(sound: boolean, flash: boolean): void;
  // iOS only: missing on Android and in older builds.
  signalAction?(kind: 'started' | 'ended', sound: boolean, flash: boolean): void;
  signalSaveFailed(sound: boolean): void;
  setVoiceEnabled(enabled: boolean, locale: VoiceLocale): void;
  requestSpeechPermission(): Promise<boolean>;
  isVoiceSupported(locale: VoiceLocale): boolean;
  getSpeechPermission(): 'granted' | 'denied' | 'undetermined';
  createThumbnail(clipPath: string, atMs: number): Promise<string>;
  findContentStart?(clipPath: string): Promise<number>;
  exportClip(opts: ExportClipOptions): Promise<ExportedClip>;
  // Modo Foco (missing in older builds).
  analyzeFocus?(opts: AnalyzeFocusOptions): Promise<FocusAnalysis>;
  cancelFocus?(clipPath: string): void;
  // Seguir a Bola (missing in older builds).
  analyzeBall?(opts: AnalyzeBallOptions): Promise<BallAnalysis>;
  cancelBall?(clipPath: string): void;
  probeBall?(): Promise<number>;
  getWatchStatus(): WatchStatus;
  watchSync(recording: boolean, clipCount: number, startedAt: number | null): void;
  watchSignal(saved: boolean): void;
  /** Missing on native builds from before the watch trigger was paid. */
  watchSetSaveAllowed?(allowed: boolean): void;
  // Second iPhone as a remote (iOS only: these are missing on Android).
  remoteHostStart?(): void;
  remoteHostStop?(): void;
  remoteHostBeginPairing?(): RemotePairing | null;
  remoteHostEndPairing?(): void;
  remoteHostPeers?(): RemotePeer[];
  remoteHostRemove?(id: string): void;
  remoteHostCheck?(id: string): void;
  remoteHostControllers?(): number;
  remoteSync?(recording: boolean, clipCount: number, startedAt: number | null): void;
  remoteSignal?(saved: boolean): void;
  remoteControllerStart?(): void;
  remoteControllerStop?(): void;
  remoteControllerHost?(): RemotePeer | null;
  remoteControllerForget?(): void;
  remoteControllerPairWithLink?(hostId: string, secret: string, hostName: string): void;
  remoteControllerPairWithCode?(code: string): void;
  remoteControllerSave?(): void;
  remoteControllerEndRecording?(): void;
  remoteControllerStartRecording?(): void;
  remoteControllerPreview?(on: boolean): void;
  remoteVoiceSetEnabled?(on: boolean, locale: VoiceLocale): void;
  getMicrophonePermission?(): 'granted' | 'denied' | 'undetermined';
  requestMicrophonePermission?(): Promise<boolean>;
  remoteDeviceName?(): string;
  remoteSetDeviceName?(name: string): void;
  shareToInstagramStory(videoPath: string, metaAppId: string): Promise<'opened' | 'unavailable'>;
  /** One system share sheet with all these video files. 'shared' when it completed (Android cannot tell: 'shared' once it opens). */
  shareFiles(paths: string[]): Promise<'shared' | 'dismissed'>;
  /** Joins exports of the same size and codec into one video without re-encoding. */
  concatVideos(paths: string[], outPath: string): Promise<{ path: string; durationMs: number }>;
}

export default requireNativeModule<ReplayCameraModule>('ReplayCamera');
