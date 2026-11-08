import type { GestureTrace, GestureTracePerson } from '../../../modules/replay-camera';
import { buildReport, createGestureTest, estimatedM, findAttempts, type TestSample } from '../gestureTest';

function person(over: Partial<GestureTracePerson> = {}): GestureTracePerson {
  return {
    id: 1,
    src: 'tile',
    px: 80,
    box: [0.5, 0.5, 0.02, 0.07],
    estM: 16,
    pose: true,
    conf: { lw: 0.5, rw: 0.4, le: 0.3, re: 0.3, ls: 0.8, rs: 0.8, nose: 0.6 },
    riseL: -1,
    riseR: -1,
    up: false,
    raised: false,
    ...over,
  };
}

function trace(persons: GestureTracePerson[], fired?: 'hold' | 'wave'): GestureTrace {
  const t: GestureTrace = {
    t: 0, ms: 40, frame: [1920, 1080], upright: 'landscapeLeft', hot: false, tracked: persons.length,
    isUp: persons.some((p) => p.up === true), raised: persons.some((p) => p.raised === true),
    hfov: 106, zoomFactor: 1, focalPx: 723, persons,
  };
  if (fired !== undefined) t.fired = fired;
  return t;
}

const up = person({ riseL: 0.6, riseR: 0.5, up: true, raised: true });
const down = person();

describe('findAttempts', () => {
  it('joins the samples of one raise and ties the trigger to it', () => {
    const samples: TestSample[] = [
      { at: 0, trace: trace([down]) },
      { at: 250, trace: trace([up]) },
      { at: 500, trace: trace([up]) },
      { at: 1500, trace: trace([up]) }, // a 1 s gap does not split it
      { at: 1750, trace: trace([up], 'hold') },
      { at: 2000, trace: trace([down]) },
    ];
    const attempts = findAttempts(samples, [{ at: 0, meters: 15 }]);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].samples).toHaveLength(4);
    expect(attempts[0].fired).toEqual({ at: 1750, rule: 'hold' });
    expect(attempts[0].markedM).toBe(15);
  });

  it('splits after a pause longer than 1.5 s and keeps people apart', () => {
    const other = { ...up, id: 2 };
    const samples: TestSample[] = [
      { at: 0, trace: trace([up, other]) },
      { at: 3000, trace: trace([up]) },
    ];
    const attempts = findAttempts(samples, []);
    expect(attempts.map((a) => a.id)).toEqual([1, 2, 1]);
    expect(attempts.every((a) => a.fired === undefined)).toBe(true);
  });

  it('counts hands at the head as an attempt even when the rule is not met', () => {
    const near = person({ riseL: 0.1, riseR: 0.0 });
    expect(findAttempts([{ at: 0, trace: trace([near]) }], [])).toHaveLength(1);
  });
});

describe('estimatedM', () => {
  it('prefers the shoulders over the box', () => {
    expect(estimatedM(person({ estSwM: 18 }))).toBe(18);
    expect(estimatedM(person())).toBe(16);
  });
});

describe('report', () => {
  it('names the farthest recognized distance and carries the raw samples', () => {
    let clock = 0;
    const test = createGestureTest(() => clock);
    test.mark(10);
    test.addTrace(trace([up]));
    clock = 1500;
    test.addTrace(trace([up], 'hold'));
    test.fire('gesture');
    clock = 10000;
    test.mark(20);
    test.addTrace(trace([up]));
    clock = 12000;
    test.addTrace(trace([down]));

    const text = test.report({ device: 'iPhone', zoom: 0.5, quality: '1080p60' });
    expect(text).toContain('maior distância reconhecida: 10 m (marcada)');
    expect(text).toContain('#2 +00:10 pessoa 1 · NÃO reconhecida');
    expect(text.trim().split('\n').filter((l) => l.startsWith('{"at"'))).toHaveLength(4);
    expect(test.summary()).toContain('reconhecidas 1');
  });

  it('labels each attempt and each raw sample with the gesture the tester marked', () => {
    let clock = 0;
    const test = createGestureTest(() => clock);
    test.kind('aceno baixo');
    test.addTrace(trace([up]));
    clock = 5000;
    test.kind('jogo normal');
    test.addTrace(trace([up]));

    const text = test.report({ device: 'iPhone', zoom: 1, quality: '1080p60' });
    expect(text).toContain('#1 +00:00 pessoa 1 [aceno baixo]');
    expect(text).toContain('#2 +00:05 pessoa 1 [jogo normal]');
    expect(text).toContain('gesto feito: aceno baixo');
    const raw = text.trim().split('\n').filter((l) => l.startsWith('{"at"')).map((l) => JSON.parse(l).kind);
    expect(raw).toEqual(['aceno baixo', 'jogo normal']);
  });

  it('works with nothing recorded', () => {
    expect(buildReport({ device: 'x', zoom: 1, quality: '1080p30' }, [], [], [], 0)).toContain('tentativas: 0');
  });
});
