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
export const BALL_RULES: Record<BallSportId, string> = { basquete: 'ball-t50', beachTennis: 'ball-bt-t52' };

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

/** The framing file of the clip's current cut, when it is ready. */
export function readyBallFile(clip: Pick<Clip, 'ball' | 'trim'>): string | undefined {
  const { ball } = clip;
  return ball && ball.status === 'ready' && ball.file && ballForCut(ball, clip.trim) ? ball.file : undefined;
}
