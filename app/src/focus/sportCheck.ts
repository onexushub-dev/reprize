import type { BallSportId, RecordingSportId, Session } from '../data/schema';

/** Apple's scene labels that mean another sport (test 43: beach tennis comes out as "volleyball"). */
export const OTHER_SPORT_LABELS = ['volleyball', 'tennis', 'ping_pong', 'badminton', 'soccer', 'football'];
/** Test 43: another sport's label at 0.4 or more, with "basketball" under 0.1 — 14 of 18 other sports, 0 of 75 basketball. */
export const OTHER_SPORT_MIN = 0.4;
export const BASKETBALL_MAX = 0.1;

/** The classifier's labels → another sport for sure, or allowed (unsure is allowed). */
export function sportVerdict(labels: Record<string, number>): 'other' | 'allow' {
  const other = Math.max(0, ...OTHER_SPORT_LABELS.map((l) => labels[l] || 0));
  const basketball = labels.basketball || 0;
  return other >= OTHER_SPORT_MIN && basketball < BASKETBALL_MAX ? 'other' : 'allow';
}

/** Spec 2026-11-11: the sports with a Seguir a Bola model (the Bola card shows only for them). */
export const BALL_SPORTS: BallSportId[] = ['basquete', 'beachTennis'];

/** The sport sheet's sports, in its order (spec 2026-11-11 §3). */
export const RECORDING_SPORTS: RecordingSportId[] = [
  'basquete',
  'beachTennis',
  'tenis',
  'futevolei',
  'futebol',
  'volei',
  'voleiPraia',
  'handebol',
  'outro',
];

export function hasBallModel(sport: RecordingSportId | undefined): sport is BallSportId {
  return sport !== undefined && (BALL_SPORTS as RecordingSportId[]).includes(sport);
}

/** How the recording's sport came: worked out by itself, chosen by the player, or taken from the previous recording. */
export type SportHow = 'detected' | 'chosen' | 'inherited';

/** Recordings made in a sport mode (before the single court mode) say their sport themselves. */
const MODE_SPORTS: Partial<Record<Session['sport'], RecordingSportId>> = {
  beachTennis: 'beachTennis',
  futevolei: 'futevolei',
  voleiPraia: 'voleiPraia',
};

/**
 * The recording's sport and how it came (spec 2026-11-11); undefined = not known (nothing marked: the sport sheet opens
 * with nothing selected). Only rule 2's own answer counts as worked out by itself: test 51's ended in basketball by
 * default.
 */
export function recordingSportOf(
  session: Session | undefined,
): { sport: RecordingSportId; how: SportHow } | undefined {
  if (!session) return undefined;
  const b = session.ballSport;
  if (b && b.sport) return { sport: b.sport, how: b.inherited ? 'inherited' : 'chosen' };
  const mode = MODE_SPORTS[session.sport];
  if (mode !== undefined) return { sport: mode, how: 'chosen' };
  if (b && b.unlocked) return { sport: 'basquete', how: 'chosen' };
  if (b && b.rule === 2 && b.auto !== undefined && b.auto !== 'unsure' && b.auto !== 'other') {
    return { sport: b.auto, how: 'detected' };
  }
  return undefined;
}

/** The sport Seguir a Bola analyses this recording as (its model and rules); undefined = no Bola for it. */
export function ballSportIdOf(session: Session | undefined): BallSportId | undefined {
  const r = recordingSportOf(session);
  return r !== undefined && hasBallModel(r.sport) ? r.sport : undefined;
}

/**
 * Spec 2026-11-11, phase 1 (before the native ball probe): Apple's "basketball" label at this or more names basketball
 * (13 of 75 basketball clips in test 43, no other sport); under it, unsure.
 */
export const BASKETBALL_SURE = 0.3;

/**
 * Test 51 (2026-11-10): the floor of the classifier's 3 frames (native `SportFloor`, the lab's `sport_sand.py`): a sand
 * court is beach tennis'. Sand-coloured share of the bottom of the picture >= 0.2 and its grain >= 4.5 (wooden floors
 * are sand-coloured but smooth): in the lab 0 of 79 basketball clips, 39 of 43 beach tennis clips; beach volleyball /
 * futevôlei also pass half the time (Victor, 2026-11-10: accepted for now).
 */
export const SAND_MIN = 0.2;
export const SAND_GRAIN_MIN = 4.5;

/** Whether the labels' floor is a sand court; undefined = a build without the floor measure. */
export function sandFloor(labels: Record<string, number> | undefined): boolean | undefined {
  if (!labels) return undefined;
  const sand = labels._floorSand;
  const grain = labels._floorTex;
  if (typeof sand !== 'number' || typeof grain !== 'number') return undefined;
  return sand >= SAND_MIN && grain >= SAND_GRAIN_MIN;
}

/**
 * The sport a recording is worked out as, with no question (spec 2026-11-11 §4.2, phase 1): no proof, no sport. A sand
 * court is beach tennis; another sport for sure (test 43) is unsure (the sheet shows every sport); Apple's "basketball"
 * label at BASKETBALL_SURE or more is basketball; anything else is unsure. Never basketball by default (a living room
 * with a person walking came out basketball, 2026-11-11). undefined = a build without the floor measure.
 */
export function autoSport(labels: Record<string, number>): RecordingSportId | 'unsure' | undefined {
  const sand = sandFloor(labels);
  if (sand === undefined) return undefined;
  if (sand) return 'beachTennis';
  if (sportVerdict(labels) === 'other') return 'unsure';
  return (labels.basketball || 0) >= BASKETBALL_SURE ? 'basquete' : 'unsure';
}

/** Spec 2026-11-11 decision 3: a recording takes the sport of one started at most this long before it. */
export const INHERIT_MS = 3 * 60 * 60 * 1000;

/**
 * The sport this recording takes from the previous one (spec 2026-11-11 decision 3): the latest recording started at
 * most INHERIT_MS before it whose sport is known, unless the floors disagree (sand in one, not in the other); undefined
 * = none.
 */
export function inheritedSport(
  session: Session,
  others: Session[],
  labels: Record<string, number> | undefined,
): RecordingSportId | undefined {
  let best: Session | undefined;
  for (const o of others) {
    if (o.id === session.id || o.startedAt >= session.startedAt) continue;
    if (session.startedAt - o.startedAt > INHERIT_MS) continue;
    if (best === undefined || o.startedAt > best.startedAt) best = o;
  }
  if (best === undefined) return undefined;
  const prev = recordingSportOf(best);
  if (prev === undefined) return undefined;
  const mine = sandFloor(labels);
  const theirs = sandFloor(best.ballSport ? best.ballSport.labels : undefined);
  if (mine !== undefined && theirs !== undefined && mine !== theirs) return undefined;
  return prev.sport;
}

/** Whether the recording's sport still has to be worked out (never looked at, or looked at with an older rule). */
export function sportNeedsCheck(session: Session | undefined): boolean {
  if (!session) return false;
  if (MODE_SPORTS[session.sport] !== undefined) return false;
  const b = session.ballSport;
  if (!b) return true;
  if (b.sport || b.unlocked) return false;
  return b.rule !== 2;
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
