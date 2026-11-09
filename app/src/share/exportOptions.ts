import type { Clip } from '../data/schema';
import type { Plan } from '../payments/types';
import { readyBallFile } from '../data/ballFile';
import { cropRect, readEdit } from './editing';
import { accessPlan } from '../payments/rules';
import { FREE_SIDE, type ShortSide, sideSize } from './exportSize';

export type ExportOptions = {
  width: number;
  height: number;
  startMs: number;
  endMs: number;
  speed: number;
  muted: boolean;
  /** The visible part of the video (0..1 of its size) when the player zoomed in; absent = the whole video. */
  crop?: { x: number; y: number; width: number; height: number };
  /** Extra clockwise turn on top of the one stored in the clip. */
  rotation: 0 | 90 | 180 | 270;
  watermark: boolean;
  /**
   * Modo Foco: the framing file and the track of the clip's shape; absent = no moving framing. Seguir a Bola: its file,
   * the portrait track and `fill` (the 9:16 crop fills the whole frame, no bands).
   */
  focus?: { path: string; aspect: 'landscape' | 'portrait'; fill?: boolean };
};

/** Legacy tier names still accepted until the export takes only a `Plan`. */
type Tier = Plan | 'pass' | 'pro';

/**
 * Free: HD (720x1280), no sound (the clip may have it: it is locked here, so a recording already made can be unlocked
 * later), no Modo Foco, and the app mark; the chosen speed goes in. Paid (a paid plan, pass, pro): Full HD (or 2K/4K for
 * a 4K clip), its sound, any speed, Modo Foco, no app mark. A landscape clip gets the same frame turned on its side, so it
 * fills the screen when the phone is held sideways, like any video in Photos. Any speed other than 1x plays without
 * sound. Modo Foco applies when on, ready, not turned and not zoomed by hand.
 */
/**
 * true: every clip carries the Reprize mark, on every plan. false (the rule since 2026-10-27): only free recordings
 * carry it, Pro and the Single Pass never do.
 */
export const WATERMARK_ON_EVERY_PLAN = false as boolean;

export function exportOptions(
  tier: Tier,
  edit: Clip['edit'],
  trim: Clip['trim'],
  landscape = false,
  focus?: { path: string; ready: boolean },
  /** A paid export's resolution (short side): Full HD unless a 4K clip is exported as 4K or 2K. Free is always HD. */
  side: ShortSide = 1080,
  /** Seguir a Bola's framing file for the current cut, when ready. */
  ball?: { path: string; ready: boolean },
): ExportOptions {
  // What the export may carry (the field test unlocks it all); the screens still label the plan as it is.
  const paid = tier !== 'free' || accessPlan('free') === 'paid';
  const { width: frameWidth, height: frameHeight } = sideSize(paid ? side : FREE_SIDE, true);
  const short = frameHeight;
  const long = frameWidth;
  const { speed: chosenSpeed, muted, zoom, rotation, focus: focusOn, framing } = readEdit(edit);
  const speed = chosenSpeed;
  const manualZoom = zoom !== undefined && zoom.scale > 1;
  const follow = paid && focus !== undefined && focus.ready && focusOn && rotation === 0 && !manualZoom;
  // Seguir a Bola: always a vertical 9:16 video, whatever the clip's shape (spec 2026-11-09 §4.8); like Modo Foco, a paid
  // export only.
  const ballOn = paid && ballActive(framing, rotation, manualZoom, ball);
  const tall = ballOn || !landscape;
  return {
    width: tall ? short : long,
    height: tall ? long : short,
    startMs: trim.startMs,
    endMs: trim.endMs,
    speed,
    muted: muted || speed !== 1 || !paid,
    crop: zoom && zoom.scale > 1 ? cropRect(zoom) : undefined,
    rotation,
    // The mark follows the plan as it is, also during the field test: it is the release look, not a locked feature.
    watermark: WATERMARK_ON_EVERY_PLAN || tier === 'free',
    ...(follow ? { focus: { path: focus.path, aspect: landscape ? ('landscape' as const) : ('portrait' as const) } } : {}),
    ...(ballOn && ball ? { focus: { path: ball.path, aspect: 'portrait' as const, fill: true } } : {}),
  };
}

/** Seguir a Bola shows: chosen, its framing ready for the cut, the video not turned nor zoomed by hand. */
export function ballActive(
  framing: ReturnType<typeof readEdit>['framing'],
  rotation: number,
  manualZoom: boolean,
  ball: { ready: boolean } | undefined,
): boolean {
  return framing === 'ball' && ball !== undefined && ball.ready && rotation === 0 && !manualZoom;
}

/** What this clip uses that a free export drops: shown first in the free-export notice (it always lists every loss). */
export type FreeLosses = { focus: boolean; sound: boolean };

export function freeLosses(clip: Pick<Clip, 'edit' | 'focus'> & Partial<Pick<Clip, 'ball' | 'trim'>>): FreeLosses {
  const { focus, rotation, zoom, speed, muted, framing } = readEdit(clip.edit);
  const manualZoom = zoom !== undefined && zoom.scale > 1;
  const ballFile = clip.trim ? readyBallFile({ ball: clip.ball, trim: clip.trim }) : undefined;
  return {
    // Seguir a Bola is a framing too: a free export leaves without it, as without Modo Foco.
    focus:
      (clip.focus !== undefined && clip.focus.status === 'ready' && focus && rotation === 0 && !manualZoom) ||
      ballActive(framing, rotation, manualZoom, ballFile ? { ready: true } : undefined),
    // Away from 1x the video is silent anyway, so there is no sound to lose.
    sound: !muted && speed === 1,
  };
}
