import ReplayCameraModule from './ReplayCameraModule';
import type {
  AnalyzeFocusOptions,
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

// Native rejections carry `code` (a ReplayErrorCode), so callers can branch on it.

/** Asks for camera and microphone; resolves true when the camera is granted. */
export function requestPermissions(): Promise<boolean> {
  return ReplayCameraModule.requestPermissions();
}

export function startSession(opts: SessionOptions): Promise<void> {
  return ReplayCameraModule.startSession(opts);
}

export function stopSession(): Promise<void> {
  return ReplayCameraModule.stopSession();
}

export function saveClip(opts: SaveClipOptions): Promise<SavedClip> {
  return ReplayCameraModule.saveClip(opts);
}

export function setGestureEnabled(enabled: boolean): void {
  ReplayCameraModule.setGestureEnabled(enabled);
}

/** Gesture test (spike screen): every gesture sample arrives as onGestureTrace while on. No-op where unsupported. */
export function setGestureTrace(enabled: boolean): void {
  if (typeof ReplayCameraModule.setGestureTrace === 'function') ReplayCameraModule.setGestureTrace(enabled);
}

/** How the phone is held right now. Portrait where the platform cannot tell (Android, older builds). */
export function getDeviceUpright(): DeviceUpright {
  if (typeof ReplayCameraModule.getUpright === 'function') return ReplayCameraModule.getUpright();
  return 'portrait';
}

/** What the camera can zoom. Without native zoom there are only the two lenses: 0.5x and 1x, picked when the camera opens. */
export function getZoomRange(): ZoomRange {
  if (typeof ReplayCameraModule.getZoomRange === 'function') return ReplayCameraModule.getZoomRange();
  return { min: 0.5, max: 1, continuous: false };
}

/** Zooms the running camera (0.5 = ultra-wide, 1 = wide, above 1 is a digital crop). `animated` ramps smoothly, for a button tap. */
export function setZoom(factor: number, animated: boolean = false): void {
  if (typeof ReplayCameraModule.setZoom === 'function') ReplayCameraModule.setZoom(factor, animated);
}

/** Screen economy while recording: the brightness goes down (iOS also stops the preview); false gives it back. */
export function setScreenEconomy(on: boolean): void {
  const set = ReplayCameraModule.setScreenEconomy;
  if (typeof set === 'function') set.call(ReplayCameraModule, on);
}

/** Screen economy on the remote phone (iOS): the brightness goes down to 15% (never up); false gives it back. */
export function setRemoteScreenDim(on: boolean): void {
  const set = ReplayCameraModule.setRemoteScreenDim;
  if (typeof set === 'function') set.call(ReplayCameraModule, on);
}

/** The phone's real output volume (0-1), or undefined where the module can't tell (Android, older builds). */
export function outputVolume(): number | undefined {
  const get = ReplayCameraModule.outputVolume;
  return typeof get === 'function' ? get.call(ReplayCameraModule) : undefined;
}

/**
 * While true, a volume button or Bluetooth selfie remote press arrives as `onCaptureButton` instead of changing the
 * volume (iOS 17.2+, camera running). Returns whether this phone delivers them (false on Android and older builds).
 */
export function setCaptureButtons(enabled: boolean): boolean {
  const set = ReplayCameraModule.setCaptureButtons;
  return typeof set === 'function' ? set.call(ReplayCameraModule, enabled) : false;
}

/**
 * The BLE peripherals iOS holds connected now (how the Bluetooth selfie remote is seen); undefined where unsupported
 * (Android, older builds). `ask` false never makes iOS ask for Bluetooth: the state is then "notDetermined".
 */
export async function bluetoothConnected(ask: boolean): Promise<BluetoothConnected | undefined> {
  const probe = ReplayCameraModule.bluetoothConnected;
  return typeof probe === 'function' ? probe.call(ReplayCameraModule, ask) : undefined;
}

/** TEMP(diag-remote): the audio session the Bluetooth remote depends on, in one line; empty where unsupported. */
export function diagAudioState(): string {
  const get = ReplayCameraModule.diagAudioState;
  return typeof get === 'function' ? get.call(ReplayCameraModule) : '';
}

/**
 * TEMP(diag-remote): what the capture-event path has installed right now (window, previews, camera running,
 * MPVolumeView on screen), in one line; undefined where unsupported.
 */
export async function diagCaptureState(): Promise<string | undefined> {
  const get = ReplayCameraModule.diagCaptureState;
  return typeof get === 'function' ? get.call(ReplayCameraModule) : undefined;
}

/** TEMP(diag-remote): battery level, charging and heat in one line; empty where unsupported. */
export function diagPower(): string {
  const get = ReplayCameraModule.diagPower;
  return typeof get === 'function' ? get.call(ReplayCameraModule) : '';
}

/** Short "saved" chime and/or two blinks of the rear torch, so a player far from the phone knows. */
export function signalSaved({ sound, flash }: { sound: boolean; flash: boolean }): void {
  ReplayCameraModule.signalSaved(sound, flash);
}

/** Distinct low double beep when a save fails. */
export function signalSaveFailed({ sound }: { sound: boolean }): void {
  ReplayCameraModule.signalSaveFailed(sound);
}

/** Whether a watch is paired and has the app (iOS; always 'unsupported' on Android for now). */
export function getWatchStatus(): WatchStatus {
  return ReplayCameraModule.getWatchStatus();
}

/** Tells the watch how the recording stands: it shows the time and clip count. */
export function watchSync(state: { recording: boolean; clipCount: number; startedAt?: number }): void {
  ReplayCameraModule.watchSync(state.recording, state.clipCount, state.startedAt ?? null);
}

/**
 * Tells the watch whether its Save button works (the watch trigger is paid). Sent with the recording state, so a watch
 * app opened later reads it too. A native build without it ignores the call (the watch then keeps Save).
 */
export function watchSetSaveAllowed(allowed: boolean): void {
  if (typeof ReplayCameraModule.watchSetSaveAllowed === 'function') ReplayCameraModule.watchSetSaveAllowed(allowed);
}

/** Makes the watch vibrate for a clip that was saved (true) or a save that failed (false). */
export function watchSignal(saved: boolean): void {
  ReplayCameraModule.watchSignal(saved);
}

/** Listens for the save command in `locale` ("salvar" or "save") in the game's audio (iOS; no-op on Android for now). */
export function setVoiceEnabled(enabled: boolean, locale: VoiceLocale): void {
  ReplayCameraModule.setVoiceEnabled(enabled, locale);
}

/** True when this phone can recognize the save command offline in `locale` (iOS with that on-device model). */
export function isVoiceSupported(locale: VoiceLocale): boolean {
  return ReplayCameraModule.isVoiceSupported(locale);
}

/** Current speech-recognition permission, without asking. */
export function getSpeechPermission(): 'granted' | 'denied' | 'undetermined' {
  return ReplayCameraModule.getSpeechPermission();
}

/** Asks for speech recognition; resolves true when granted (always false on Android for now). */
export function requestSpeechPermission(): Promise<boolean> {
  return ReplayCameraModule.requestSpeechPermission();
}

/** Writes a JPEG frame of the clip at `atMs` next to it (<clip>.jpg, reused if present) and resolves its path. */
export function createThumbnail(clipPath: string, atMs: number): Promise<string> {
  return ReplayCameraModule.createThumbnail(clipPath, atMs);
}

/** Time in ms where the clip's picture begins after a black start; 0 when it starts with a picture (always 0 on Android for now). */
export async function findContentStart(clipPath: string): Promise<number> {
  return (await ReplayCameraModule.findContentStart?.(clipPath)) ?? 0;
}

/** Renders the cut (optionally slowed/muted) into a width×height video with the overlay on top. */
export function exportClip(opts: ExportClipOptions): Promise<ExportedClip> {
  return ReplayCameraModule.exportClip(opts);
}

// ---- Modo Foco (iOS only). Without the native functions there is no analysis.

/** Whether this phone can analyse clips for Modo Foco. False on Android and web. */
/** Whether this phone records `quality` (4K needs a camera that has it); Full HD always. */
export function supportsQuality(quality: Quality): boolean {
  if (quality !== '2160p30') return true;
  const check = ReplayCameraModule.supportsQuality;
  return typeof check === 'function' ? check.call(ReplayCameraModule, quality) : false;
}

export function isFocusSupported(): boolean {
  return typeof ReplayCameraModule.analyzeFocus === 'function';
}

/** Analyses the clip between `startMs` and `endMs`; rejects with code `CANCELLED` after `cancelFocus`. */
export function analyzeFocus(opts: AnalyzeFocusOptions): Promise<FocusAnalysis> {
  const analyze = ReplayCameraModule.analyzeFocus;
  if (typeof analyze !== 'function') return Promise.reject(new Error('Modo Foco is not supported here'));
  return analyze.call(ReplayCameraModule, opts);
}

/** Stops the analysis of this clip if it is waiting or running. */
export function cancelFocus(clipPath: string): void {
  const cancel = ReplayCameraModule.cancelFocus;
  if (typeof cancel === 'function') cancel.call(ReplayCameraModule, clipPath);
}

/** Opens Instagram's Story composer with the video; 'unavailable' without a Meta App ID or Instagram. */
export function shareToInstagramStory(videoPath: string, metaAppId: string): Promise<'opened' | 'unavailable'> {
  return ReplayCameraModule.shareToInstagramStory(videoPath, metaAppId);
}

/** Opens one share sheet with all these videos (plain file paths). Resolves 'dismissed' when the person closed it without sharing. */
export function shareFiles(paths: string[]): Promise<'shared' | 'dismissed'> {
  return ReplayCameraModule.shareFiles(paths);
}

/** Joins exported videos of the same size and codec, in order, into `outPath` without re-encoding. */
export function concatVideos(paths: string[], outPath: string): Promise<ExportedClip> {
  return ReplayCameraModule.concatVideos(paths, outPath);
}

// ---- Second iPhone as a remote (iOS only). Without the native functions every call does nothing.

/** Whether this phone can pair with another one as camera or as remote. False on Android for now. */
export function isRemoteSupported(): boolean {
  return typeof ReplayCameraModule.remoteHostStart === 'function';
}

/** Camera phone: wait for paired remotes (and for an open pairing) while the setup screen is in front. */
export function remoteHostStart(): void {
  if (ReplayCameraModule.remoteHostStart) ReplayCameraModule.remoteHostStart();
}

export function remoteHostStop(): void {
  if (ReplayCameraModule.remoteHostStop) ReplayCameraModule.remoteHostStop();
}

/** Opens a pairing: the QR link, the 6-digit code and when they expire. Null when four remotes are already paired. */
export function remoteHostBeginPairing(): RemotePairing | null {
  return ReplayCameraModule.remoteHostBeginPairing ? ReplayCameraModule.remoteHostBeginPairing() : null;
}

export function remoteHostEndPairing(): void {
  if (ReplayCameraModule.remoteHostEndPairing) ReplayCameraModule.remoteHostEndPairing();
}

export function remoteHostPeers(): RemotePeer[] {
  return ReplayCameraModule.remoteHostPeers ? ReplayCameraModule.remoteHostPeers() : [];
}

export function remoteHostRemove(id: string): void {
  if (ReplayCameraModule.remoteHostRemove) ReplayCameraModule.remoteHostRemove(id);
}

/** Camera phone: ask one paired remote "are you there?". The answer arrives as `onRemoteCheck`. */
export function remoteHostCheck(id: string): void {
  if (ReplayCameraModule.remoteHostCheck) ReplayCameraModule.remoteHostCheck(id);
}

/** Camera phone: how many remotes are connected right now. */
export function remoteHostControllers(): number {
  return ReplayCameraModule.remoteHostControllers ? ReplayCameraModule.remoteHostControllers() : 0;
}

/** Camera phone → remotes: the same state the watch gets. */
export function remoteSync(state: { recording: boolean; clipCount: number; startedAt?: number }): void {
  if (ReplayCameraModule.remoteSync) {
    ReplayCameraModule.remoteSync(state.recording, state.clipCount, state.startedAt === undefined ? null : state.startedAt);
  }
}

/** Camera phone → remotes: how the last save ended (they vibrate). */
export function remoteSignal(saved: boolean): void {
  if (ReplayCameraModule.remoteSignal) ReplayCameraModule.remoteSignal(saved);
}

/** Remote phone: look for the paired camera phone and keep the link up. */
export function remoteControllerStart(): void {
  if (ReplayCameraModule.remoteControllerStart) ReplayCameraModule.remoteControllerStart();
}

export function remoteControllerStop(): void {
  if (ReplayCameraModule.remoteControllerStop) ReplayCameraModule.remoteControllerStop();
}

/** The camera phone this remote is paired with, if any. */
export function remoteControllerHost(): RemotePeer | null {
  return ReplayCameraModule.remoteControllerHost ? ReplayCameraModule.remoteControllerHost() : null;
}

export function remoteControllerForget(): void {
  if (ReplayCameraModule.remoteControllerForget) ReplayCameraModule.remoteControllerForget();
}

/** Pairs with the camera phone named in a scanned `reprize://pair` link; the result arrives as `onRemotePairing`. */
export function remoteControllerPairWithLink(hostId: string, secret: string, hostName: string): void {
  if (ReplayCameraModule.remoteControllerPairWithLink) {
    ReplayCameraModule.remoteControllerPairWithLink(hostId, secret, hostName);
  }
}

/** Pairs with whichever camera phone shows this 6-digit code; the result arrives as `onRemotePairing`. */
export function remoteControllerPairWithCode(code: string): void {
  if (ReplayCameraModule.remoteControllerPairWithCode) ReplayCameraModule.remoteControllerPairWithCode(code);
}

/** Remote phone: ask the camera phone to save a clip. */
export function remoteControllerSave(): void {
  if (ReplayCameraModule.remoteControllerSave) ReplayCameraModule.remoteControllerSave();
}

/** Remote phone: ask the camera phone to end the recording (what holding its own "Segure para encerrar" does). */
export function remoteControllerEndRecording(): void {
  if (ReplayCameraModule.remoteControllerEndRecording) ReplayCameraModule.remoteControllerEndRecording();
}

/** Remote phone: ask the camera phone to start a new recording. */
export function remoteControllerStartRecording(): void {
  if (ReplayCameraModule.remoteControllerStartRecording) ReplayCameraModule.remoteControllerStartRecording();
}

/** Remote phone: ask for pictures of the camera view (say it again every second while open) or stop them. */
export function remoteControllerPreview(on: boolean): void {
  if (ReplayCameraModule.remoteControllerPreview) ReplayCameraModule.remoteControllerPreview(on);
}

/** Remote phone: listen for the save command (heard ones arrive as `onRemoteVoice`) or stop. */
export function remoteVoiceSetEnabled(on: boolean, locale: VoiceLocale): void {
  if (ReplayCameraModule.remoteVoiceSetEnabled) ReplayCameraModule.remoteVoiceSetEnabled(on, locale);
}

/** Current microphone permission, without asking ('denied' where the module cannot tell). */
export function getMicrophonePermission(): 'granted' | 'denied' | 'undetermined' {
  return ReplayCameraModule.getMicrophonePermission ? ReplayCameraModule.getMicrophonePermission() : 'denied';
}

/** Asks for the microphone; resolves true when granted. */
export function requestMicrophonePermission(): Promise<boolean> {
  return ReplayCameraModule.requestMicrophonePermission ? ReplayCameraModule.requestMicrophonePermission() : Promise.resolve(false);
}

/** The name this phone shows to the other one while pairing ("iPhone XR#1234" unless the person renamed it). */
export function remoteDeviceName(): string {
  return ReplayCameraModule.remoteDeviceName ? ReplayCameraModule.remoteDeviceName() : '';
}

/** Renames this phone for the next pairings; an empty name goes back to the default. */
export function remoteSetDeviceName(name: string): void {
  if (ReplayCameraModule.remoteSetDeviceName) ReplayCameraModule.remoteSetDeviceName(name);
}

export function addReplayListener<E extends keyof ReplayCameraModuleEvents>(
  event: E,
  listener: ReplayCameraModuleEvents[E]
) {
  return ReplayCameraModule.addListener(event, listener);
}

