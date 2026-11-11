import type { Session } from '../../data/schema';
import {
  autoSport,
  ballSportIdOf,
  INHERIT_MS,
  inheritedSport,
  labelSummary,
  recordingSportOf,
  sportNeedsCheck,
  sportVerdict,
} from '../sportCheck';

test('test 43 rule: another sport for sure only with its label >= 0.4 and no basketball', () => {
  expect(sportVerdict({ volleyball: 0.75, people: 0.8 })).toBe('other');
  expect(sportVerdict({ tennis: 0.4 })).toBe('other');
  expect(sportVerdict({ volleyball: 0.39 })).toBe('allow');
  // yt-basket-04: tennis 0.50 but basketball 0.12
  expect(sportVerdict({ tennis: 0.5, basketball: 0.12 })).toBe('allow');
  expect(sportVerdict({ people: 0.8, structure: 0.7 })).toBe('allow');
  expect(sportVerdict({})).toBe('allow');
});

test('spec 2026-11-11: the recording\'s sport and how it came', () => {
  const s = (extra: Partial<Session>): Session => ({ id: 's', sport: 'quadra', startedAt: 0, ...extra });
  expect(recordingSportOf(undefined)).toBeUndefined();
  expect(recordingSportOf(s({}))).toBeUndefined();
  // test 51's answer ended in basketball by default: not trusted
  expect(recordingSportOf(s({ ballSport: { v: 1, verdict: 'allow', auto: 'basquete' } }))).toBeUndefined();
  expect(recordingSportOf(s({ ballSport: { v: 1, verdict: 'allow', auto: 'basquete', rule: 2 } }))).toEqual({
    sport: 'basquete',
    how: 'detected',
  });
  expect(recordingSportOf(s({ ballSport: { v: 1, verdict: 'allow', auto: 'unsure', rule: 2 } }))).toBeUndefined();
  expect(recordingSportOf(s({ ballSport: { v: 1, verdict: 'allow', sport: 'tenis' } }))).toEqual({ sport: 'tenis', how: 'chosen' });
  expect(recordingSportOf(s({ ballSport: { v: 1, verdict: 'allow', sport: 'futebol', inherited: true } }))).toEqual({
    sport: 'futebol',
    how: 'inherited',
  });
  expect(recordingSportOf(s({ sport: 'futevolei' }))).toEqual({ sport: 'futevolei', how: 'chosen' });
  expect(recordingSportOf(s({ ballSport: { v: 1, verdict: 'other', unlocked: true } }))).toEqual({ sport: 'basquete', how: 'chosen' });
});

test('the Diagnóstico line: the sports first, then the strongest other labels', () => {
  expect(labelSummary({ volleyball: 0.751, people: 0.76, adult: 0.7, sport: 0.75, sky: 0.1 })).toBe(
    'volleyball 0.75, people 0.76, sport 0.75, adult 0.70',
  );
});

test('the sport Seguir a Bola analyses a recording as: only a sport with a ball model', () => {
  const s = (extra: Partial<Session>): Session => ({ id: 's', sport: 'quadra', startedAt: 0, ...extra });
  expect(ballSportIdOf(undefined)).toBeUndefined();
  expect(ballSportIdOf(s({}))).toBeUndefined();
  expect(ballSportIdOf(s({ ballSport: { v: 1, verdict: 'other', unlocked: true } }))).toBe('basquete');
  expect(ballSportIdOf(s({ ballSport: { v: 1, verdict: 'other', sport: 'beachTennis' } }))).toBe('beachTennis');
  expect(ballSportIdOf(s({ ballSport: { v: 1, verdict: 'allow', sport: 'tenis' } }))).toBeUndefined();
  expect(ballSportIdOf(s({ sport: 'beachTennis' }))).toBe('beachTennis');
  expect(ballSportIdOf(s({ sport: 'futevolei' }))).toBeUndefined();
  expect(ballSportIdOf(s({ ballSport: { v: 1, verdict: 'allow', auto: 'beachTennis', rule: 2 } }))).toBe('beachTennis');
});

test('spec 2026-11-11: no proof, no sport — never basketball by default', () => {
  // arena A / B (lab): sand 0.54-0.80, grain 5-15
  expect(autoSport({ volleyball: 0.75, _floorSand: 0.79, _floorTex: 14.7 })).toBe('beachTennis');
  // the living room with a person walking (2026-11-11): nothing to say it is basketball
  expect(autoSport({ people: 0.8, _floorSand: 0.1, _floorTex: 3 })).toBe('unsure');
  // a wooden gym with a weak basketball label: unsure
  expect(autoSport({ basketball: 0.12, _floorSand: 0.44, _floorTex: 4.1 })).toBe('unsure');
  // Apple sure it is basketball
  expect(autoSport({ basketball: 0.31, _floorSand: 0.04, _floorTex: 9 })).toBe('basquete');
  // indoor volleyball: another sport for sure, so unsure (the sheet shows every sport)
  expect(autoSport({ volleyball: 0.62, _floorSand: 0.51, _floorTex: 1.3 })).toBe('unsure');
  // a build without the floor measure: not worked out
  expect(autoSport({ volleyball: 0.62 })).toBeUndefined();
});

test('spec 2026-11-11: which recordings still have their sport to work out', () => {
  const s = (extra: Partial<Session>): Session => ({ id: 's', sport: 'quadra', startedAt: 0, ...extra });
  expect(sportNeedsCheck(undefined)).toBe(false);
  expect(sportNeedsCheck(s({}))).toBe(true);
  // looked at with test 51's rule: again
  expect(sportNeedsCheck(s({ ballSport: { v: 1, verdict: 'allow', labels: {}, auto: 'basquete' } }))).toBe(true);
  expect(sportNeedsCheck(s({ ballSport: { v: 1, verdict: 'allow', labels: {}, auto: 'unsure', rule: 2 } }))).toBe(false);
  expect(sportNeedsCheck(s({ ballSport: { v: 1, verdict: 'allow', sport: 'tenis' } }))).toBe(false);
  expect(sportNeedsCheck(s({ sport: 'beachTennis' }))).toBe(false);
  expect(sportNeedsCheck(s({ sport: 'voleiPraia' }))).toBe(false);
});

test('spec 2026-11-11: the previous recording\'s sport, within 3 h, unless the floors disagree', () => {
  const H = 60 * 60 * 1000;
  const sand = { _floorSand: 0.7, _floorTex: 9 };
  const gym = { _floorSand: 0.05, _floorTex: 9 };
  const me: Session = { id: 'me', sport: 'quadra', startedAt: 10 * H };
  const bt: Session = { id: 'a', sport: 'quadra', startedAt: 9 * H, ballSport: { v: 1, verdict: 'allow', sport: 'beachTennis', labels: sand } };
  const old: Session = { id: 'b', sport: 'quadra', startedAt: 10 * H - INHERIT_MS - 1, ballSport: { v: 1, verdict: 'allow', sport: 'tenis' } };
  const unknown: Session = { id: 'c', sport: 'quadra', startedAt: 9.5 * H, ballSport: { v: 1, verdict: 'allow', auto: 'unsure', rule: 2 } };
  expect(inheritedSport(me, [bt], sand)).toBe('beachTennis');
  // the floors disagree: this recording's own detection decides
  expect(inheritedSport(me, [bt], gym)).toBeUndefined();
  // no floor measured here: inherited
  expect(inheritedSport(me, [bt], undefined)).toBe('beachTennis');
  // more than 3 h before
  expect(inheritedSport(me, [old], undefined)).toBeUndefined();
  // the latest one counts, and it did not know its sport
  expect(inheritedSport(me, [bt, unknown], sand)).toBeUndefined();
  // a later recording is not "previous"
  expect(inheritedSport({ ...me, startedAt: 8 * H }, [bt], sand)).toBeUndefined();
});
