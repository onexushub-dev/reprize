import type { BallSportId, Session } from '../data/schema';

/** Apple's scene labels that mean another sport (test 43: beach tennis comes out as "volleyball"). */
export const OTHER_SPORT_LABELS = ['volleyball', 'tennis', 'ping_pong', 'badminton', 'soccer', 'football'];
/** Test 43: another sport's label at 0.4 or more, with "basketball" under 0.1 — 14 of 18 other sports, 0 of 75 basketball. */
export const OTHER_SPORT_MIN = 0.4;
export const BASKETBALL_MAX = 0.1;

/**
 * Recordings made in a sport mode (before the single court mode) say their sport themselves: beach tennis has Seguir a
 * Bola (test 48), these do not yet.
 */
const OTHER_SPORT_MODES: Session['sport'][] = ['futevolei', 'voleiPraia'];

/** The classifier's labels → another sport for sure, or allowed (unsure is allowed). */
export function sportVerdict(labels: Record<string, number>): 'other' | 'allow' {
  const other = Math.max(0, ...OTHER_SPORT_LABELS.map((l) => labels[l] || 0));
  const basketball = labels.basketball || 0;
  return other >= OTHER_SPORT_MIN && basketball < BASKETBALL_MAX ? 'other' : 'allow';
}

/**
 * Whether this recording looks like another sport than basketball for Seguir a Bola (`other`: the Foco panel asks which
 * sport it is); undefined = not checked yet (offered meanwhile). A sport the player chose, or beach tennis' own mode, is
 * `allow`.
 */
export function ballSportOf(session: Session | undefined): 'other' | 'allow' | undefined {
  if (!session) return undefined;
  if (session.ballSport && (session.ballSport.unlocked || session.ballSport.sport)) return 'allow';
  if (session.sport === 'beachTennis') return 'allow';
  if (OTHER_SPORT_MODES.includes(session.sport)) return 'other';
  // A check that saw nothing (a build without the classifier) does not count: it is looked at again.
  const b = session.ballSport;
  // Test 51: the sport worked out by itself
  if (b && b.auto !== undefined) return b.auto === 'other' ? 'other' : 'allow';
  if (!b || !b.labels || Object.keys(b.labels).length === 0) return undefined;
  return b.verdict;
}

/**
 * The sport Seguir a Bola analyses this recording as (test 48: it picks the model and the rules): the player's choice,
 * beach tennis for its own mode, basketball when unlocked; undefined = ask the player. Victor, 2026-11-10 (a beach
 * tennis clip the classifier was unsure about went to basketball's model and followed the next court): the Foco panel
 * asks once per recording, on its first clip, until the sport can be told reliably by itself; the answer serves every
 * clip of the recording.
 */
export function ballSportIdOf(session: Session | undefined): BallSportId | undefined {
  if (!session) return undefined;
  const b = session.ballSport;
  if (b && b.sport) return b.sport;
  if (session.sport === 'beachTennis') return 'beachTennis';
  if (b && b.unlocked) return 'basquete';
  // Test 51: worked out by itself (another sport: none, Modo Foco only)
  if (b && b.auto !== undefined && b.auto !== 'other') return b.auto;
  return undefined;
}

/**
 * Test 51 (2026-11-10): the floor of the classifier's 3 frames (native `SportFloor`, the lab's `sport_sand.py`): a sand
 * court is beach tennis'. Sand-coloured share of the bottom of the picture >= 0.2 and its grain >= 4.5 (wooden floors
 * are sand-coloured but smooth): in the lab 0 of 79 basketball clips, 39 of 43 beach tennis clips; beach volleyball /
 * futevôlei also pass half the time (Victor, 2026-11-10: accepted for now, beach tennis' verdict turns most down).
 */
export const SAND_MIN = 0.2;
export const SAND_GRAIN_MIN = 4.5;

/**
 * The sport a recording is analysed as, with no question (test 51): a sand court is beach tennis; otherwise another
 * sport for sure (test 43) gets Modo Foco only; otherwise basketball. undefined = a build without the floor measure.
 */
export function autoSport(labels: Record<string, number>): BallSportId | 'other' | undefined {
  const sand = labels._floorSand;
  const grain = labels._floorTex;
  if (typeof sand !== 'number' || typeof grain !== 'number') return undefined;
  if (sand >= SAND_MIN && grain >= SAND_GRAIN_MIN) return 'beachTennis';
  return sportVerdict(labels) === 'other' ? 'other' : 'basquete';
}

/** Whether the recording's sport still has to be worked out (never looked at, or looked at before test 51). */
export function sportNeedsCheck(session: Session | undefined): boolean {
  if (!session) return false;
  if (session.sport === 'beachTennis' || OTHER_SPORT_MODES.includes(session.sport)) return false;
  const b = session.ballSport;
  if (!b) return true;
  if (b.sport || b.unlocked) return false;
  return b.auto === undefined;
}

/** The labels the field test reads on the Diagnóstico screen: the sports' ones and the strongest others. */
export function labelSummary(labels: Record<string, number>): string {
  const keys = ['basketball', ...OTHER_SPORT_LABELS, '_floorSand', '_floorTex'];
  const sports = keys.filter((k) => labels[k] !== undefined).map((k) => `${k} ${labels[k].toFixed(2)}`);
  const top = Object.entries(labels)
    .filter(([k]) => !keys.includes(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} ${v.toFixed(2)}`);
  return [...sports, ...top].join(', ') || 'nada';
}
