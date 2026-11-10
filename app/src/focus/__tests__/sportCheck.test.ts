import type { Session } from '../../data/schema';
import { ballSportIdOf, ballSportOf, labelSummary, sportVerdict } from '../sportCheck';

test('test 43 rule: another sport for sure only with its label >= 0.4 and no basketball', () => {
  expect(sportVerdict({ volleyball: 0.75, people: 0.8 })).toBe('other');
  expect(sportVerdict({ tennis: 0.4 })).toBe('other');
  expect(sportVerdict({ volleyball: 0.39 })).toBe('allow');
  // yt-basket-04: tennis 0.50 but basketball 0.12
  expect(sportVerdict({ tennis: 0.5, basketball: 0.12 })).toBe('allow');
  expect(sportVerdict({ people: 0.8, structure: 0.7 })).toBe('allow');
  expect(sportVerdict({})).toBe('allow');
});

test('per recording: unchecked, checked, a sport mode, or unlocked by the player', () => {
  const s = (extra: Partial<Session>): Session => ({ id: 's', sport: 'quadra', startedAt: 0, ...extra });
  expect(ballSportOf(undefined)).toBeUndefined();
  expect(ballSportOf(s({}))).toBeUndefined();
  expect(ballSportOf(s({ ballSport: { v: 1, verdict: 'other', labels: { volleyball: 0.7 } } }))).toBe('other');
  expect(ballSportOf(s({ ballSport: { v: 1, verdict: 'allow', labels: { people: 0.8 } } }))).toBe('allow');
  // a check that saw nothing is done again
  expect(ballSportOf(s({ ballSport: { v: 1, verdict: 'allow', labels: {} } }))).toBeUndefined();
  expect(ballSportOf(s({ ballSport: { v: 1, verdict: 'allow' } }))).toBeUndefined();
  // test 48: beach tennis' own mode has Seguir a Bola now; the other sport modes not yet
  expect(ballSportOf(s({ sport: 'beachTennis' }))).toBe('allow');
  expect(ballSportOf(s({ sport: 'futevolei' }))).toBe('other');
  expect(ballSportOf(s({ ballSport: { v: 1, verdict: 'other', labels: { volleyball: 0.7 }, sport: 'beachTennis' } }))).toBe(
    'allow',
  );
  expect(ballSportOf(s({ sport: 'voleiPraia', ballSport: { v: 1, verdict: 'allow', unlocked: true } }))).toBe('allow');
});

test('the Diagnóstico line: the sports first, then the strongest other labels', () => {
  expect(labelSummary({ volleyball: 0.751, people: 0.76, adult: 0.7, sport: 0.75, sky: 0.1 })).toBe(
    'volleyball 0.75, people 0.76, sport 0.75, adult 0.70',
  );
});

test('test 48: the sport Seguir a Bola analyses a recording as', () => {
  const s = (extra: Partial<Session>): Session => ({ id: 's', sport: 'quadra', startedAt: 0, ...extra });
  expect(ballSportIdOf(undefined)).toBeUndefined();
  // not chosen yet: the panel asks, once per recording, whatever the classifier said (Victor, 2026-11-10)
  expect(ballSportIdOf(s({}))).toBeUndefined();
  expect(ballSportIdOf(s({ ballSport: { v: 1, verdict: 'allow', labels: { people: 0.8 } } }))).toBeUndefined();
  expect(ballSportIdOf(s({ ballSport: { v: 1, verdict: 'other', labels: { volleyball: 0.7 } } }))).toBeUndefined();
  expect(ballSportIdOf(s({ ballSport: { v: 1, verdict: 'other', unlocked: true } }))).toBe('basquete');
  expect(ballSportIdOf(s({ ballSport: { v: 1, verdict: 'other', sport: 'beachTennis' } }))).toBe('beachTennis');
  // the player's choice wins over the classifier
  expect(ballSportIdOf(s({ ballSport: { v: 1, verdict: 'allow', labels: { people: 0.8 }, sport: 'beachTennis' } }))).toBe(
    'beachTennis',
  );
  expect(ballSportIdOf(s({ sport: 'beachTennis' }))).toBe('beachTennis');
  expect(ballSportIdOf(s({ sport: 'futevolei' }))).toBeUndefined();
});
