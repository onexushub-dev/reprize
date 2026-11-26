import { NativeModule, requireNativeModule } from 'expo';

import type {
  AnalyzeBallOptions,
  AnalyzeFocusOptions,
  BallAnalysis,
  BluetoothConnected,
  DeviceUpright,
  Gravity,
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
  UploadEntry,
  UploadItem,
  DownloadEntry,
  DownloadItem,
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
  /** The raw accelerometer reading in g (iOS only), null before the first one. */
  getGravity?(): Gravity | null;
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
  // Which engine listens for "salvar" (iOS only: missing on Android and in older builds).
  setVoiceEngine?(engine: 'dictation' | 'keyword'): void;
  requestSpeechPermission(): Promise<boolean>;
  isVoiceSupported(locale: VoiceLocale): boolean;
  getSpeechPermission(): 'granted' | 'denied' | 'undetermined';
  createThumbnail(clipPath: string, atMs: number): Promise<string>;
  findContentStart?(clipPath: string): Promise<number>;
  /** Android: the clip's shape (rotation applied) read from its metadata, with no decoding; missing on iOS and in older builds. */
  videoShape?(clipPath: string): { width: number; height: number } | null;
  exportClip(opts: ExportClipOptions): Promise<ExportedClip>;
  // Modo Foco (missing in older builds).
  analyzeFocus?(opts: AnalyzeFocusOptions): Promise<FocusAnalysis>;
  cancelFocus?(clipPath: string): void;
  // Seguir a Bola (missing in older builds).
  analyzeBall?(opts: AnalyzeBallOptions): Promise<BallAnalysis>;
  cancelBall?(clipPath: string): void;
  /** Stops a running export by its `exportId` (2026-11-23). Absent on older builds. */
  cancelExport?(exportId: string): void;
  probeBall?(): Promise<number>;
  /** TEMP(lab-android): Modo Foco's evaluation on an Android phone ('run' | 'reference'); the summary line. */
  labEvalAndroid?(which: string): Promise<string>;
  classifySport?(clipPath: string, startMs: number, endMs: number): Promise<Record<string, number>>;
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
  /** iOS: asks for the extra time an app leaving the front may keep (about 30 s); a key for `endBackgroundWork`. */
  beginBackgroundWork?(name: string): Promise<number>;
  endBackgroundWork?(key: number): Promise<void>;
  /** iOS: the part of a clip, passthrough (no re-encode), without sound when `muted`. Absent on other platforms. */
  cutClip?(inPath: string, outPath: string, startMs: number, endMs: number, muted: boolean): Promise<{ path: string; durationMs: number }>;
  // Background upload (iOS only: missing on Android and in older builds).
  uploadStart?(items: UploadItem[]): void;
  uploadState?(): UploadEntry[];
  uploadReset?(): void;
  uploadPause?(): void;
  uploadResume?(cellular: boolean): void;
  uploadRemove?(ids: string[]): void;
  uploadRestore?(): void;
  // Background download of received clips (iOS only: missing on Android and in older builds).
  downloadStart?(items: DownloadItem[], paused: boolean): void;
  downloadState?(): DownloadEntry[];
  downloadPause?(): void;
  downloadResume?(): void;
  downloadRemove?(ids: string[]): void;
  downloadRestore?(): void;
  downloadReset?(): void;
}

export default requireNativeModule<ReplayCameraModule>('ReplayCamera');
