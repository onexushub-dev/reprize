import type { Quality, TriggerSource } from '../../modules/replay-camera/src/ReplayCamera.types';

export type { TriggerSource };

/**
 * A usage mode. The app has a single free mode (`quadra`); the other ids are kept only so games saved with
 * them stay valid and keep their label.
 */
export type ModeId =
  | 'quadra'
  | 'academia'
  | 'beachTennis'
  | 'futevolei'
  | 'voleiPraia'
  | 'outro'
  | 'musculacao'
  | 'crossfit'
  | 'funcional'
  | 'outroAcademia';
/** Kept as the field type name: Session.sport and Prefs.sport hold a mode id. */
export type Sport = ModeId;

/** How far back the camera keeps video for a save. Fixed: the player picks the clip length, not the buffer. */
export const BUFFER_SECONDS = 60;

/** The clip lengths the player can pick on the setup screen (seconds). */
export const CLIP_SECONDS_OPTIONS = [15, 30, 45, 60] as const;
/** 15 s: what the free plan records, so a new player starts on a length they can use; 30 s and up open the paywall. */
export const DEFAULT_CLIP_SECONDS = 15;

/** 0.5 = the ultra-wide lens, 1 = the wide lens, above 1 a digital crop. */
export type ModeSettings = {
  zoom: number;
  gestureEnabled: boolean;
  voiceEnabled: boolean;
  bufferSeconds: typeof BUFFER_SECONDS;
  /** The clip length the player picked: each save cuts at most this much, never reaching back before the previous clip. */
  cutSeconds: number;
  quality: Quality;
  audio: boolean;
};

/** What was saved for a mode: before zoom existed it held `lens` (read, never written). */
export type StoredModeSettings = Partial<ModeSettings> & { lens?: 'ultraWide' | 'wide' };

export type Session = { id: string; sport: Sport; startedAt: number; endedAt?: number; name?: string; /** Fixed at start: true if Pro or a Single Pass unlocked this game; absent on games recorded before the free plan. */ paid?: boolean; /** RevenueCat transaction id of the single pass that unlocked this game; absent = no pass. */ passTransactionId?: string; /** True once a free export of this recording showed the full panel; later exports get the short notice. */ freeNoticeShown?: boolean; /** Seguir a Bola: whether the recording looks like basketball (test 43). */ ballSport?: BallSport };

/**
 * Whether a recording looks like basketball to Apple's scene classifier (test 43): `other` = another sport for sure, so
 * Seguir a Bola shows "EM BREVE"; `allow` otherwise. `unlocked`: the player said it is basketball after all. `labels`:
 * what the classifier saw (the field test reads them).
 */
export type BallSport = { v: 1; verdict: 'other' | 'allow'; labels?: Record<string, number>; unlocked?: boolean };

export const MAX_GAME_NAME = 40;
/** A clip's label (its name): short, to tell at a glance who or what it is (2026-11-07 spec §6). */
export const MAX_CLIP_NAME = 25;

export type ClipFocus = { v: 1; status: 'pending' | 'ready' | 'none' | 'failed'; file?: string };

/**
 * Seguir a Bola for one cut (spec 2026-11-09 §4.6): `pending` while queued or running, `ready` with the 9:16 framing
 * `file`, `failed` when the analysis broke (`hot`: stopped because the phone got too hot). Valid only while the clip's
 * cut is `startMs`…`endMs`; another cut is analysed again (the detections already found are reused). `share`: the share
 * of the cut's frames with a trusted ball.
 */
export type ClipBall = {
  v: 1;
  status: 'pending' | 'ready' | 'failed';
  startMs: number;
  endMs: number;
  file?: string;
  share?: number;
  hot?: boolean;
};

export type Clip = {
  id: string;
  sessionId: string;
  createdAt: number;
  source: TriggerSource;
  path: string;
  durationMs: number;
  trim: { startMs: number; endMs: number };
  /** The video's resolution in pixels, its short side (2160 = 4K). Absent on Android and older clips: Full HD. */
  shortSide?: number;
  /** Its place in the recording when saved; kept when earlier clips are deleted. Absent on older clips (their place in the list is used). */
  number?: number;
  /**
   * The part of the saved file this clip may show: the cut it was first saved with. The editor can shorten the cut
   * inside it but never reach the rest of the buffer, which holds moments already in other clips.
   * Absent on clips saved before this existed: those can use the whole file.
   */
  bounds?: { startMs: number; endMs: number };
  /** Where the useful video starts after a black start (0 = from the beginning); unset until the editor first checked. */
  contentStartMs?: number;
  /** Editor choices; absent = normal speed, with sound, no zoom. `slowmo` is how clips saved before speeds were stored. */
  edit?: {
    slowmo?: boolean;
    speed?: 0.5 | 1 | 1.5 | 2;
    muted: boolean;
    zoom?: { scale: number; cx: number; cy: number };
    rotation?: 0 | 90 | 180 | 270;
    /** Modo Foco for this clip; absent = on. Read only when `framing` is absent (clips from before Seguir a Bola). */
    focus?: boolean;
    /** Modo Foco, Seguir a Bola or neither; absent = Modo Foco (or what `focus` says). */
    framing?: 'focus' | 'ball' | 'none';
  };
  /**
   * The Modo Foco analysis: `pending` while queued or running, `ready` with the framing `file`, `none` when there were
   * too few people for a framing, `failed` when the analysis broke. Absent = never analysed (clips from before it).
   */
  focus?: ClipFocus;
  /** The Seguir a Bola analysis of the cut; absent = never asked for. */
  ball?: ClipBall;
  /** Optional name the player gives the clip (like a recording's name). */
  name?: string;
  /** When the edited video was last saved to Photos / sent through the share sheet (the clip itself stays inside the app). */
  savedAt?: number;
  sharedAt?: number;
};

export type Prefs = {
  onboardingDone: boolean;
  sport: Sport;
  lens: 'ultraWide' | 'wide';
  gestureEnabled: boolean;
  /** Feedback the moment a save is accepted, for a player far from the phone. */
  soundOnSave: boolean;
  flashOnSave: boolean;
  /** "salvar" by voice (iOS). Off until speech permission is granted. */
  voiceEnabled: boolean;
  /** When a press of the Bluetooth remote was first heard; the app cannot see the iOS pairing, only presses. */
  remoteTestedAt?: number;
  /**
   * The Bluetooth remote as iOS shows it (BLE remotes only): its peripheral id and name, learnt at a press when exactly
   * one connected device could be it. Then the app sees it connect and go without a press.
   */
  remoteBleId?: string;
  remoteBleName?: string;
  /** The Modo Foco introduction (the first framed clip) was shown. */
  focusIntroSeen?: boolean;
  /** The Seguir a Bola first-use sheet was turned off for good ("Não mostrar de novo"). */
  ballIntroSeen?: boolean;
  /** Seguir a Bola's one-time speed probe: ms for one 19-region frame on this phone (the option shows up to 400). */
  ballProbeMs?: number;
  /** Battery saving while recording: the screen goes dark after a while without a touch (the recording goes on). */
  screenEconomy: boolean;
  /** Battery saving on the remote phone while the camera records: the screen dims after a minute without a touch. */
  remoteEconomy: boolean;
  /** "salvar" by voice on the remote phone while the camera records (iOS, with both permissions). */
  remoteVoice: boolean;
  /** The remote screen already explained voice and asked for its permissions once. */
  remoteVoiceAsked?: boolean;
  /** The player's changes to a mode's defaults, kept per mode. */
  modeSettings?: Partial<Record<ModeId, StoredModeSettings>>;
  /** "Prepare o celular" (no case, out of the sun) was dismissed for good before a recording. */
  prepareTipSeen?: boolean;
  /** The recording opened last: "Visto por último" in Minhas gravações. */
  lastOpenedSessionId?: string;
};

export const DEFAULT_PREFS: Prefs = {
  onboardingDone: false,
  sport: 'quadra',
  lens: 'ultraWide',
  gestureEnabled: true,
  soundOnSave: true,
  flashOnSave: true,
  voiceEnabled: false,
  screenEconomy: true,
  remoteEconomy: true,
  remoteVoice: true,
};

/** Default cut when a save gives none: the last 30s of the saved 60s window (spec 3.3). Saves pass the clip length. */
export const DEFAULT_TRIM_MS = 30 * 1000;
