import type { BallSportId, Clip } from './schema';

/** Where a clip's Seguir a Bola framing is kept: next to it, same name, .ball.json (the Modo Foco file's format). */
export function ballPath(clipPath: string): string {
  return clipPath.replace(/\.[^./]+$/, '') + '.ball.json';
}

/** The detections cache next to the clip (.balldet.json): later cuts reuse the frames already analysed. */
export function ballDetPath(clipPath: string): string {
  return clipPath.replace(/\.[^./]+$/, '') + '.balldet.json';
}

/**
 * Whether the Seguir a Bola analysis on record is for this cut (and, when `sport` is given, this sport: a record
 * without one is basketball's, from before beach tennis).
 */
export function ballForCut(ball: Clip['ball'], trim: Clip['trim'], sport?: BallSportId): boolean {
  return (
    ball !== undefined &&
    ball.startMs === trim.startMs &&
    ball.endMs === trim.endMs &&
    (sport === undefined || (ball.sport || 'basquete') === sport)
  );
}

/**
 * The rules each sport's Seguir a Bola framing is made with: the native `BallSport.rules` (ReplayCore/BallSport.swift;
 * a test keeps the two in step). When they change (test 50: basketball's shirt rule and camera speed), a clip analysed
 * with the older ones is analysed again the next time Seguir a Bola is on: its detections are cached, so only the path
 * and the camera run (well under a second).
 */
export const BALL_RULES: Record<BallSportId, string> = { basquete: 'ball-t50', beachTennis: 'ball-bt-t60' };

/** TEMP(lab-4k): the speed test's Bola variant ('' = today), part of the rules so switching it analyses again. */
let labVariant = '';

export function setBallLabVariant(variant: string): void {
  labVariant = variant;
}

/** The rules a sport's framing is made with now (BALL_RULES plus the speed test's variant, if any). */
export function ballRules(sport: BallSportId): string {
  return BALL_RULES[sport] + labVariant;
}

/** Whether the record was made with today's rules for its sport (a record without a sport is basketball's). */
export function ballRulesCurrent(ball: NonNullable<Clip['ball']>): boolean {
  return ball.rules === ballRules(ball.sport || 'basquete');
}

/** A millisecond or two of rounding between a received clip's cut and its framing's range is the same cut. */
const RECEIVED_SLACK_MS = 2;

/**
 * The framing file of the clip's current cut, when it is ready. On a received clip (`sharePosition`) the sender's
 * framing serves any cut inside the range it covers (2026-11-22: the recipient may cut inside what came; a clip sent on
 * Bola showed the Bola card without its framing, because the editor, the preview and the export each checked the exact
 * cut). The recipient's own analysis of a cut is that cut's, as on a clip of their own.
 */
export function readyBallFile(clip: Pick<Clip, 'ball' | 'trim'> & { sharePosition?: number }): string | undefined {
  const { ball } = clip;
  if (!ball || ball.status !== 'ready' || !ball.file) return undefined;
  if (ballForCut(ball, clip.trim)) return ball.file;
  const received = clip.sharePosition !== undefined;
  const covers = ball.startMs <= clip.trim.startMs + RECEIVED_SLACK_MS && ball.endMs >= clip.trim.endMs - RECEIVED_SLACK_MS;
  return received && covers ? ball.file : undefined;
}
