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

export type Session = { id: string; sport: Sport; startedAt: number; endedAt?: number; name?: string; /** Fixed at start: true if Pro or a Single Pass unlocked this game; absent on games recorded before the free plan. */ paid?: boolean; /** RevenueCat transaction id of the single pass that unlocked this game; absent = no pass. */ passTransactionId?: string; /** True once a free export of this recording showed the full panel; later exports get the short notice. */ freeNoticeShown?: boolean; /** Seguir a Bola: whether the recording looks like basketball (test 43). */ ballSport?: BallSport; /** The link this recording was shared with (sharing design §5.3); absent = never shared. */ shared?: SessionShare; /** Set on a recording received through a link (sharing design §5.3): never `paid`, never a pass. */ received?: SessionReceived };

/** A recording someone shared with this phone. `code` opens the link again to fetch what is missing (until `expiresAt`, ms). */
export type SessionReceived = {
  shareId: string;
  code: string;
  from?: string;
  receivedAt: number;
  expiresAt: number;
  total: number;
  /** How long the recording ran on the sender's phone (ms); absent for links made before it was sent. */
  recordedMs?: number;
  /** A courtesy was spent on it (the server said so, `use_courtesy`): its clips leave in Full HD with the mark. */
  courtesy?: boolean;
  /**
   * Came in a group link (multi-recording share design §5.1): the group's id. `code` is the group's and `shareId` this
   * recording's own; `open-share` is called with both.
   */
  groupId?: string;
  /** What the person chose (§5.4); absent: `on`, as every link opened before the choice existed. */
  download?: ReceivedDownload;
  /** The size of all its clips (bytes), as the group link listed it. */
  bytes?: number;
  /**
   * The link is over (turned off, expired early, reported), as the server said when the app last asked (2026-11-22):
   * kept, so nothing asks again and an empty recording can leave the phone.
   */
  ended?: ReceivedEnd;
};

export type ReceivedEnd = 'off' | 'expired' | 'removed';

/**
 * Whether a received recording downloads: `on`; `waiting` (a group's recording until Baixar, or after Cancelar);
 * `paused` (Pausar, until Continuar).
 */
export type ReceivedDownload = 'on' | 'waiting' | 'paused';

/** The sender's link for a recording: what the share sheet shows again until it expires. Times in ms. */
export type SessionShare = {
  shareId: string;
  url: string;
  createdAt: number;
  expiresAt: number;
  clips: number;
  state: 'active' | 'off';
  /** A link with only these clips of the recording (picked-clips link, 2026-11-23); absent = all of them. */
  clipIds?: string[];
  /**
   * Shared in a group link (multi-recording share design §5.1): `url` is the group's link, `shareId` the recording's own
   * share (its uploads and progress), and this the group's id (`cloud/shareGroups.ts`).
   */
  groupId?: string;
};

/**
 * The recording's sport (spec 2026-11-11 §5), stored under its historical name. `sport`: the sport the player chose
 * (or, with `inherited`, the one taken from the previous recording); `auto`: the one worked out by itself with rule
 * `rule` (2 = spec 2026-11-11: no proof, no sport; `unsure` = nothing marked). Before: `verdict` (test 43, Apple's
 * scene classifier: `other` = another sport for sure), `unlocked` (the player said basketball), `auto` with test 51's
 * rule (which ended in basketball by default: looked at again). `labels`: what the classifier saw, plus the floor
 * (`_floorSand`, `_floorTex`); the field test reads them.
 */
export type BallSport = {
  v: 1;
  verdict: 'other' | 'allow';
  labels?: Record<string, number>;
  unlocked?: boolean;
  sport?: RecordingSportId;
  inherited?: boolean;
  auto?: RecordingSportId | 'other' | 'unsure';
  rule?: 2;
};

/** The sports Seguir a Bola analyses, each with its own model and rules (the native `BallSport`). */
export type BallSportId = 'basquete' | 'beachTennis';

/** Every sport a recording can be (the sport sheet, spec 2026-11-11 §3); the first ones have a ball model. */
export type RecordingSportId =
  | BallSportId
  | 'tenis'
  | 'futevolei'
  | 'futebol'
  | 'volei'
  | 'voleiPraia'
  | 'handebol'
  | 'outro';

/** Test 47a: why Seguir a Bola is not applied to a cut (the native `BallVerdictReason`). */
export type BallUnsuitable = 'tooFar' | 'rarelyFound' | 'tooSmall' | 'still';

export const MAX_GAME_NAME = 40;
/** A clip's label (its name): short, to tell at a glance who or what it is (2026-11-07 spec §6). */
export const MAX_CLIP_NAME = 25;

export type ClipFocus = {
  v: 1;
  status: 'pending' | 'ready' | 'none' | 'failed';
  file?: string;
  /**
   * The part of the clip the analysis covered (lab test 56: the cut ± 2 s, inside `bounds`); a cut that leaves it is
   * analysed again (only the new seconds: the people are kept per picture). Absent on records from before 2026-11-13:
   * those covered the clip's whole `bounds`.
   */
  startMs?: number;
  endMs?: number;
  /** TEMP(lab-4k): analysed one frame every `every` ms (absent = 100, today); another setting analyses again. */
  every?: number;
  /**
   * Framed leaving out the people on the next court (Android, beach tennis), with this version of the rule
   * (`NEXT_COURT_RULE`; `true` = the first, per picture); absent = not.
   */
  nextCourt?: true | number;
};

/**
 * Seguir a Bola for one cut (spec 2026-11-09 §4.6): `pending` while queued or running, `ready` with the 9:16 framing
 * `file`, `failed` when the analysis broke (`hot`: stopped because the phone got too hot), `unsuitable` when it would
 * not look good on this video (test 47a, `reason`: recorded too far, the ball rarely found or too small, the camera
 * would hardly move) — the clip stays on Modo Foco. Valid only while the clip's cut is `startMs`…`endMs` and the sport
 * is `sport` (absent = basketball); another cut or sport is analysed again (the detections already found by the same
 * model are reused). `share`: the share of the cut's frames with a trusted ball.
 */
export type ClipBall = {
  v: 1;
  status: 'pending' | 'ready' | 'failed' | 'unsuitable';
  startMs: number;
  endMs: number;
  sport?: BallSportId;
  /** The native rules the record was made with (`BallSport.rules`); a ready record with older ones is analysed again. */
  rules?: string;
  file?: string;
  share?: number;
  hot?: boolean;
  reason?: BallUnsuitable;
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
    /** Jogadores, Bola or neither; absent = what `focus` says for an older stored edit (on unless false), else neither. */
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
  /** On a received recording: the clip's place in the share it came from (sharing design §5.5). */
  sharePosition?: number;
  /**
   * On a received clip: what the sender's edit fixed (2026-11-22, `cloud/shareCut.ts`). `sound`: the file has no sound,
   * so it cannot be turned on. The cut is fixed by the file itself (nothing outside it was sent).
   */
  locked?: { sound?: true };
  /** When the edited video was last saved to Photos / sent through the share sheet (the clip itself stays inside the app). */
  savedAt?: number;
  sharedAt?: number;
};

/** A Bluetooth remote the app has learnt (see `Prefs.remotes`). */
export type KnownRemote = { id: string; name?: string };

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
   * The Bluetooth remotes as iOS shows them (BLE remotes only): each one's peripheral id and name, learnt at a press when
   * exactly one connected device could be it. Then the app sees them connect and go without a press. Since 2026-11-22;
   * absent: read the one remote kept before (`remoteBleId`).
   */
  remotes?: KnownRemote[];
  /** Before 2026-11-22 the app kept one remote: read once into `remotes`, then cleared. */
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
  /** The first-time tour of the camera was finished or skipped (Ajustes > Tutorial turns it back off). */
  cameraTourSeen?: boolean;
  /** The recording opened last: "Visto por último" in Minhas gravações. */
  lastOpenedSessionId?: string;
  /**
   * TEMP(lab-4k, plan 2026-11-12, Diagnóstico only): the speed test's variants. `labBallMaxWidth`: Bola's frames scaled
   * down to this width first (absent / 0 = native size, today). `labFocusEveryMs`: Jogadores analyses one frame every
   * this many ms (absent / 100 = today, 200 = 5 fps).
   */
  labBallMaxWidth?: number;
  labFocusEveryMs?: number;
  /**
   * TEMP(lab-pass, plan 2026-11-12 Stage 2, Diagnóstico only): on a frame both Jogadores and Bola want, the two
   * detectors run one after the other instead of side by side (absent / false = side by side, the default).
   */
  labScanSequential?: boolean;
  /**
   * TEMP(lab-motion, plan 2026-11-12 Stage 2, Diagnóstico only): Bola sends to the model only the tiles where the
   * picture changed (lab tests 53 and 54). Absent / false = every tile, the default.
   */
  labBallMotionTiles?: boolean;
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
