import { readyBallFile } from '../data/ballFile';
import type { Clip } from '../data/schema';

/**
 * Bola on a received clip (2026-11-22): the sender's framing, when it came with the clip and covers the current cut (the
 * recipient may cut inside what was sent, never outside). Without it, the recipient's own phone may analyse Bola, as on
 * a clip of their own (`readyBallFile`).
 */
export function receivedBallOf(clip: Pick<Clip, 'ball' | 'trim'>): NonNullable<Clip['ball']> | undefined {
  const ball = clip.ball;
  if (ball === undefined) return undefined;
  // The same rule as the preview and the export (`readyBallFile` on a received clip).
  return readyBallFile({ ball, trim: clip.trim, sharePosition: 0 }) !== undefined ? ball : undefined;
}

/** What the sender fixed on a received clip (none on one's own clips). */
export type ClipLocks = NonNullable<Clip['locked']>;
export const NO_LOCKS: ClipLocks = {};

/** An edit change with what the sender fixed taken out (the sound of a clip sent without it). */
export function allowedEdit<T extends { muted?: boolean }>(patch: T, locks: ClipLocks): T {
  const out = { ...patch };
  if (locks.sound && out.muted === false) delete out.muted;
  return out;
}

/**
 * What a received clip opens on where this phone cannot show Bola (2026-11-22, iPhone XR): a clip sent on Bola opens on
 * Jogadores, which every iPhone can do (the Original where even Jogadores cannot); undefined = as it came.
 */
export function receivedFramingHere(
  framing: 'none' | 'focus' | 'ball',
  here: { received: boolean; ball: boolean; players: boolean },
): 'focus' | 'none' | undefined {
  if (!here.received || framing !== 'ball' || here.ball) return undefined;
  return here.players ? 'focus' : 'none';
}
