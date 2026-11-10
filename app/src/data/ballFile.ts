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

/** The framing file of the clip's current cut, when it is ready. */
export function readyBallFile(clip: Pick<Clip, 'ball' | 'trim'>): string | undefined {
  const { ball } = clip;
  return ball && ball.status === 'ready' && ball.file && ballForCut(ball, clip.trim) ? ball.file : undefined;
}
