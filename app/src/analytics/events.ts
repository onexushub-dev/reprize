import type { Quality, RemotePairFailure, ThermalLevel } from '../../modules/replay-camera/src/ReplayCamera.types';
import type { ModeId, TriggerSource } from '../data/schema';
import type { Offering } from '../payments/types';

/** Where the paywall was opened from; `locked_feature` is a tap on something Pro-only (see pro_feature_blocked). */
export type PaywallSource = 'onboarding' | 'export_limit' | 'upgrade_card' | 'locked_feature' | 'received_export';

/** A count sent as a range, so the number of distinct values stays small and nothing is a precise tally. */
export type CountBucket = '0' | '1' | '2-5' | '6-20' | '21+';
export type DurationBucket = '<1m' | '1-5m' | '5-30m' | '>30m';
/** A recording (a game) runs much longer than an app session, so it gets wider ranges. */
export type RecordingDurationBucket = '<5m' | '5-15m' | '15-30m' | '30-60m' | '>60m';

/** Who paid for what left the app: the free plan, a Single Pass spent on that recording, or PRO. */
export type ExportPlan = 'free' | 'pass' | 'pro';

/**
 * Every event the app may send, with the exact shape of its properties. This is the whole catalogue: `track()` accepts
 * nothing else, so a typo or a stray free-text property cannot reach the vendor. An event without properties is `undefined`.
 * Properties are closed unions, booleans or bucketed strings, never file names, device names or error messages.
 */
export type AnalyticsEvents = {
  // Usage and retention
  app_open: { cold_start: boolean };
  /** Sent once when the app goes to the background; the small things (zoom, guides, economy) live only in here. */
  session_summary: {
    clips: CountBucket;
    exports: CountBucket;
    zooms: CountBucket;
    guides: CountBucket;
    economy: CountBucket;
    top_trigger: TriggerSource | 'none';
    duration: DurationBucket;
  };

  // Onboarding
  onboarding_step_viewed: { step: 1 | 2 | 3 | 4 };
  onboarding_completed: undefined;
  onboarding_skipped: { step: 1 | 2 | 3 | 4 };
  /** Sent only after a real system prompt (photos: only when the app had never asked). */
  permission_result: { kind: 'camera' | 'microphone' | 'speech' | 'photos'; granted: boolean };

  // Recording
  /** A game began: what it records with. `plan` is fixed at the start (a Single Pass is spent later, on export). */
  recording_started: {
    mode: ModeId;
    quality: Quality;
    clip_seconds: number;
    plan: 'free' | 'pro';
    gesture: boolean;
    voice: boolean;
  };
  /** A game ended: by the player (`user`), by the phone's heat (`thermal`) or by a camera error (`error`). */
  recording_ended: { reason: 'user' | 'thermal' | 'error'; duration: RecordingDurationBucket; clips: CountBucket };
  /** The phone got hot and the recording dropped its quality; once per recording. */
  recording_quality_lowered: { level: ThermalLevel };
  clip_saved: { trigger: TriggerSource; mode: ModeId };
  trigger_failed: { trigger: TriggerSource; reason: 'save_failed' };

  // Editing and output
  clip_edit_tool_used: { tool: 'focus' | 'speed' | 'sound' | 'zoom' | 'rotate' };
  focus_mode_used: undefined;
  export_completed: { quality: '720p' | '1080p' | '1440p' | '2160p'; plan: ExportPlan };
  export_failed: { reason: 'prepare_failed' };
  /** `photos` is Salvar na galeria; `share_sheet` is Enviar (the share sheet does not say which app was picked). */
  clip_shared: { destination: 'photos' | 'share_sheet' };

  // Devices
  /** Reported by the remote phone, the one that pairs (the camera phone only offers the code). The Apple Watch pairs through iOS, not here. */
  pairing_completed: { method: 'qr' | 'code'; kind: 'remote' };
  pairing_failed: { reason: RemotePairFailure | 'invalid_link' };

  // Sharing (sharing design §9)
  /** A link was created for a recording; `clips` is how many it carries. */
  share_created: { clips: CountBucket };
  /** The server refused or the request failed; never the error text. */
  share_failed: { reason: 'sign_in' | 'not_pro' | 'notice' | 'too_many' | 'failed' };
  /** The liability notice was accepted (once per account and notice version). */
  share_notice_accepted: undefined;
  /** The owner turned a link off (Desligar link). */
  share_turned_off: undefined;
  /** A received recording was kept out of a screenshot or a screen recording (capture protection, §8.2). */
  capture_blocked: { kind: 'screenshot' | 'recording' };
  /** A courtesy was spent on a received recording; `remaining` after it (0 with one courtesy per account). */
  courtesy_used: { remaining: number };
  /** Save or Send of a received recording with no courtesy left and no Pro: the panel offers Pro only. */
  courtesy_exhausted: undefined;

  // Monetization
  /** `offering` is the paywall shown: Pro (`default`) or the Single Pass (`pass`). */
  paywall_viewed: { source: PaywallSource; offering: Offering };
  purchase_completed: { offering: Offering };
  /** The paywall ended in a restore of an earlier purchase. */
  purchase_restored: { offering: Offering };
  /** A Single Pass kept from before was spent on a recording (one bought for it is purchase_completed). */
  pass_used: undefined;
  purchase_failed: { reason: 'error' };
  pro_feature_blocked: { feature: 'quality_4k' | 'clip_length' | 'watch' | 'compile' | 'share' };
  free_export_limit_hit: undefined;
  /** What the player picked on the free-plan sheet: from an export (`save`/`share`) or from the recording's PRO card (`unlock`). */
  free_export_choice: { choice: 'pro' | 'pass' | 'go' | 'cancel'; kind: 'save' | 'share' | 'unlock' };
};

export type EventName = keyof AnalyticsEvents;

/** The properties argument of `track(name, ...)`: required for events that have properties, absent for the rest. */
export type EventArgs<E extends EventName> = AnalyticsEvents[E] extends undefined ? [] : [AnalyticsEvents[E]];
