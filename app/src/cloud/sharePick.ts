import type { Session } from '../data/schema';

// Kept apart from shareGroup.ts (no upload queue, no native module) so Minhas gravações can check a pick on its own.

/** Recordings in one link and their clips together (decision 3; the server checks the same limits). */
export const MAX_GROUP_RECORDINGS = 10;
export const MAX_GROUP_CLIPS = 600;

/** Why the picked recordings cannot be shared together. */
export type PickRefusal = 'none' | 'tooMany' | 'received' | 'empty' | 'tooManyClips';

/**
 * Whether the recordings picked in Minhas gravações can go in one link (multi-recording share design §5.5): 1 to 10 of
 * this phone's own ended recordings, each with clips, at most 600 clips together.
 */
export function shareablePick(picked: { session: Session; clips: number }[]): { ok: true } | { ok: false; reason: PickRefusal } {
  if (picked.length === 0) return { ok: false, reason: 'none' };
  if (picked.length > MAX_GROUP_RECORDINGS) return { ok: false, reason: 'tooMany' };
  if (picked.some((p) => p.session.received !== undefined)) return { ok: false, reason: 'received' };
  if (picked.some((p) => p.clips === 0 || p.session.endedAt === undefined)) return { ok: false, reason: 'empty' };
  if (picked.reduce((total, p) => total + p.clips, 0) > MAX_GROUP_CLIPS) return { ok: false, reason: 'tooManyClips' };
  return { ok: true };
}
