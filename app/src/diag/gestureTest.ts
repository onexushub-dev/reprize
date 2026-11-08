// Gesture test (spike screen, for the team only): collects every gesture sample the camera module reports, the real
// distances the tester marks and the triggers, and turns them into a report to share. Portuguese only, like the
// other diagnostic screens.
import type { GestureTrace, GestureTracePerson } from '../../modules/replay-camera';

/** A sample as it arrived, with the wall clock (marks and triggers use it too). */
export type TestSample = { at: number; trace: GestureTrace };
/** The real distance the tester marked from `at` on (null: cleared). */
export type DistanceMark = { at: number; meters: number | null };
export type TestFire = { at: number; source: string };
/** What the people in front of the camera are doing from `at` on, as the tester marks it (null: cleared). */
export type KindMark = { at: number; kind: string | null };

export type TestMeta = {
  device: string;
  /** Zoom the test was started with (0.5 = ultra-wide). */
  zoom: number;
  quality: string;
};

/**
 * One try at the gesture by one person: their samples with the hands at or above the head (or the arms-up rule
 * true), joined while the gaps stay under `ATTEMPT_GAP_S`.
 */
export type Attempt = {
  id: number;
  start: number;
  end: number;
  samples: { at: number; person: GestureTracePerson }[];
  fired?: { at: number; rule: string };
  /** Every rule that fired during the attempt (the hold and the wave can both fire on one gesture). */
  rules: string[];
  markedM: number | null;
};

/** Gap (s) that ends an attempt. */
export const ATTEMPT_GAP_S = 1.5;
/** A wrist this far above the head line (in shoulder widths, can be negative) counts as "hands up" for attempts. */
export const ATTEMPT_RISE = -0.1;
/** Samples kept: ~1 h at 8 per second. */
export const MAX_SAMPLES = 30000;

const median = (xs: number[]): number | undefined => {
  if (xs.length === 0) return undefined;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const pct = (n: number, d: number) => (d === 0 ? '-' : `${Math.round((n / d) * 100)}%`);
const fmt = (v: number | undefined, digits = 1) => (v === undefined ? '-' : v.toFixed(digits));
const minRise = (p: GestureTracePerson) =>
  p.riseL === undefined || p.riseR === undefined ? undefined : Math.min(p.riseL, p.riseR);

/** Best distance estimate for a person: from the shoulders when read (raised arms do not change it), else the box. */
export function estimatedM(p: GestureTracePerson): number | undefined {
  return p.estSwM !== undefined ? p.estSwM : p.estM;
}

function handsUp(p: GestureTracePerson): boolean {
  if (p.up === true || p.raised === true) return true;
  const r = p.riseL !== undefined && p.riseR !== undefined ? Math.max(p.riseL, p.riseR) : undefined;
  return r !== undefined && r > ATTEMPT_RISE;
}

export function kindAt(kinds: KindMark[], at: number): string | null {
  let k: string | null = null;
  for (const mark of kinds) if (mark.at <= at) k = mark.kind;
  return k;
}

export function markAt(marks: DistanceMark[], at: number): number | null {
  let m: number | null = null;
  for (const mark of marks) if (mark.at <= at) m = mark.meters;
  return m;
}

/** Splits the samples into attempts and ties each gesture trigger to the attempt it came from. */
export function findAttempts(samples: TestSample[], marks: DistanceMark[]): Attempt[] {
  const open = new Map<number, Attempt>();
  const done: Attempt[] = [];
  for (const { at, trace } of samples) {
    for (const [id, a] of open) {
      if ((at - a.end) / 1000 > ATTEMPT_GAP_S) {
        done.push(a);
        open.delete(id);
      }
    }
    for (const person of trace.persons) {
      if (!handsUp(person)) continue;
      let a = open.get(person.id);
      if (a === undefined) {
        a = { id: person.id, start: at, end: at, samples: [], rules: [], markedM: markAt(marks, at) };
        open.set(person.id, a);
      }
      a.end = at;
      a.samples.push({ at, person });
    }
    if (trace.fired !== undefined) {
      // The trigger belongs to whoever had the arms up in this sample (the biggest, if several).
      const candidates = trace.persons.filter((p) => p.up === true || p.raised === true).sort((x, y) => y.px - x.px);
      const who = candidates.length > 0 ? candidates[0].id : undefined;
      const a = who === undefined ? undefined : open.get(who);
      if (a !== undefined) {
        if (a.fired === undefined) a.fired = { at, rule: trace.fired };
        a.rules.push(trace.fired);
      }
    }
  }
  return done.concat([...open.values()]).sort((x, y) => x.start - y.start);
}

type AttemptStats = {
  durationS: number;
  readable: number;
  up: number;
  raised: number;
  facing: number;
  px?: number;
  estM?: number;
  rise?: number;
  bestRise?: number;
  wristConf?: number;
  elbowsUp: number;
  elbowsRead: number;
  swing?: number;
  sources: string;
};

export function attemptStats(a: Attempt): AttemptStats {
  const ps = a.samples.map((s) => s.person);
  const rises = ps.map(minRise).filter((v): v is number => v !== undefined);
  const wrist = ps
    .map((p) => (p.conf === undefined ? undefined : Math.min(p.conf.lw, p.conf.rw)))
    .filter((v): v is number => v !== undefined && v >= 0);
  const xs = ps.flatMap((p) => (p.xL === undefined || p.xR === undefined ? [] : [p.xL, p.xR]));
  const bySource = new Map<string, number>();
  ps.forEach((p) => bySource.set(p.src, (bySource.get(p.src) ?? 0) + 1));
  const elbows = ps.filter((p) => p.elbowsUp !== undefined);
  return {
    durationS: (a.end - a.start) / 1000,
    readable: ps.filter((p) => p.pose).length,
    up: ps.filter((p) => p.up === true).length,
    raised: ps.filter((p) => p.raised === true).length,
    facing: ps.filter((p) => p.facing === true).length,
    px: median(ps.map((p) => p.px)),
    estM: median(ps.map(estimatedM).filter((v): v is number => v !== undefined)),
    rise: median(rises),
    bestRise: rises.length === 0 ? undefined : Math.max(...rises),
    wristConf: median(wrist),
    elbowsUp: elbows.filter((p) => p.elbowsUp === true).length,
    elbowsRead: elbows.length,
    swing: xs.length === 0 ? undefined : Math.max(...xs) - Math.min(...xs),
    sources: [...bySource].map(([k, n]) => `${k} ${n}`).join(', '),
  };
}

/** Per marked distance: how well people were found and read, whatever they were doing. */
function segmentLines(samples: TestSample[], marks: DistanceMark[], attempts: Attempt[], fires: TestFire[]): string[] {
  const keys = [...new Set(samples.map((s) => markAt(marks, s.at)))].sort((a, b) => (a ?? -1) - (b ?? -1));
  return keys.map((m) => {
    const ss = samples.filter((s) => markAt(marks, s.at) === m);
    const people = ss.flatMap((s) => s.trace.persons.filter((p) => p.src !== 'wholeFrame'));
    const found = ss.filter((s) => s.trace.persons.some((p) => p.src !== 'wholeFrame')).length;
    const posed = people.filter((p) => p.pose);
    const wristsRead = posed.filter((p) => p.riseL !== undefined && p.riseR !== undefined).length;
    const est = posed.map((p) => p.estSwM).filter((v): v is number => v !== undefined);
    const estBox = people.map((p) => p.estM).filter((v): v is number => v !== undefined);
    const at = attempts.filter((a) => a.markedM === m);
    const gestureFires = fires.filter((f) => f.source === 'gesture' && markAt(marks, f.at) === m).length;
    const secs = ss.length < 2 ? 0 : (ss[ss.length - 1].at - ss[0].at) / 1000;
    const worst = ['critical', 'serious', 'fair', 'nominal'].find((l) => ss.some((x) => x.trace.thermal === l));
    return (
      `${m === null ? 'sem marca' : `${m} m`}: ${Math.round(secs)} s · ${ss.length} amostras ` +
      `(${secs > 0 ? (ss.length / secs).toFixed(1) : '-'}/s${worst === undefined ? '' : `, temperatura até ${worst}`}) · pessoa achada em ` +
      `${pct(found, ss.length)} · pose lida em ${pct(posed.length, people.length)} das pessoas · pulsos lidos em ` +
      `${pct(wristsRead, posed.length)} · altura mediana (todas as pessoas) ${fmt(median(people.map((p) => p.px)), 0)} px · ` +
      `distância estimada ${fmt(median(est))} m (ombros) / ${fmt(median(estBox))} m (caixa) · ` +
      `${at.length} tentativa(s), ${at.filter((a) => a.fired !== undefined).length} reconhecida(s) · ` +
      `gatilhos de gesto ${gestureFires}`
    );
  });
}

function clock(ms: number, t0: number): string {
  const s = Math.max(0, Math.round((ms - t0) / 1000));
  return `+${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function buildReport(
  meta: TestMeta,
  samples: TestSample[],
  marks: DistanceMark[],
  fires: TestFire[],
  now: number,
  kinds: KindMark[] = [],
): string {
  const t0 = samples.length > 0 ? samples[0].at : now;
  const attempts = findAttempts(samples, marks);
  const recognized = attempts.filter((a) => a.fired !== undefined);
  const first = samples.length > 0 ? samples[0].trace : undefined;
  const ms = samples.map((s) => s.trace.ms);
  const spanS = samples.length < 2 ? 0 : (samples[samples.length - 1].at - samples[0].at) / 1000;
  const maxMarked = Math.max(-1, ...recognized.map((a) => a.markedM ?? -1));
  const maxEst = Math.max(-1, ...recognized.map((a) => attemptStats(a).estM ?? -1));

  const lines: string[] = [];
  lines.push('TESTE DO GESTO — Reprize');
  lines.push(`gerado ${new Date(now).toISOString()} · aparelho ${meta.device}`);
  lines.push(
    `câmera: zoom ${meta.zoom}x · ${meta.quality} · quadro ${first === undefined ? '-' : first.frame.join('x')} · ` +
      `posição ${first === undefined ? '-' : first.upright} · campo de visão ${fmt(first === undefined ? undefined : first.hfov)}° ` +
      `· fator de zoom ${fmt(first === undefined ? undefined : first.zoomFactor, 2)} · focal ${first === undefined ? '-' : (first.focalPx ?? '-')} px`,
  );
  lines.push(
    `ritmo: ${samples.length} amostras em ${Math.round(spanS)} s (${spanS > 0 ? (samples.length / spanS).toFixed(1) : '-'}/s) · ` +
      `${fmt(median(ms), 0)} ms por amostra (máx ${ms.length === 0 ? '-' : Math.max(...ms)}) · celular quente em ` +
      `${pct(samples.filter((s) => s.trace.hot).length, samples.length)}`,
  );
  const levels = ['nominal', 'fair', 'serious', 'critical'];
  const withLevel = samples.filter((s) => s.trace.thermal !== undefined);
  lines.push(
    `temperatura do iPhone: ` +
      (withLevel.length === 0
        ? 'sem dado (build antigo)'
        : levels.map((l) => `${l} ${pct(withLevel.filter((s) => s.trace.thermal === l).length, withLevel.length)}`).join(' · ')) +
      ' (fair: gesto mais lento; serious: gravação cai para 30 fps, nunca abaixo de Full HD; critical: gravação para)',
  );
  lines.push('');
  lines.push('RESUMO');
  lines.push(
    `gatilhos de gesto: ${fires.filter((f) => f.source === 'gesture').length} (braços para cima ` +
      `${recognized.reduce((n, a) => n + a.rules.filter((r) => r === 'hold').length, 0)}, aceno ` +
      `${recognized.reduce((n, a) => n + a.rules.filter((r) => r === 'wave').length, 0)}; no app, gatilhos a menos de 3 s ` +
      `do anterior viram um só; segurados por já terem salvo o mesmo gesto: ` +
      `${samples.filter((x) => x.trace.suppressed !== undefined).length}) · outros gatilhos: ` +
      `${fires.filter((f) => f.source !== 'gesture').length}`,
  );
  lines.push(
    `tentativas: ${attempts.length} · reconhecidas: ${recognized.length} · ` +
      `maior distância reconhecida: ${maxMarked >= 0 ? `${maxMarked} m (marcada)` : 'sem marca'} · ` +
      `${maxEst >= 0 ? `~${maxEst.toFixed(1)} m (estimada)` : 'sem estimativa'}`,
  );
  lines.push('');
  lines.push('POR DISTÂNCIA MARCADA');
  segmentLines(samples, marks, attempts, fires).forEach((l) => lines.push(l));
  lines.push('');
  lines.push('TENTATIVAS (mãos na altura da cabeça ou acima; uma por pessoa, separadas por pausas de 1,5 s)');
  attempts.forEach((a, i) => {
    const s = attemptStats(a);
    const kind = kindAt(kinds, a.start);
    const result =
      a.fired === undefined
        ? 'NÃO reconhecida'
        : `RECONHECIDA (${a.fired.rule === 'hold' ? 'braços para cima' : 'aceno'}, após ${((a.fired.at - a.start) / 1000).toFixed(1)} s` +
          `${a.rules.length > 1 ? `; disparou ${a.rules.length}x: ${a.rules.join(', ')}` : ''})`;
    lines.push(
      `#${i + 1} ${clock(a.start, t0)} pessoa ${a.id}${kind === null ? '' : ` [${kind}]`} · ${result} · ` +
        `${s.durationS.toFixed(1)} s · marcada ` +
        `${a.markedM === null ? '-' : `${a.markedM} m`} · estimada ${fmt(s.estM)} m · altura ${fmt(s.px, 0)} px`,
    );
    lines.push(
      `   ${a.samples.length} amostras · pose lida ${pct(s.readable, a.samples.length)} · regra braços para cima ` +
        `${pct(s.up, a.samples.length)} · de frente ${pct(s.facing, a.samples.length)} · ` +
        `mãos acima da cabeça (de frente) ${pct(s.raised, a.samples.length)} · ` +
        `pulso mais baixo acima da cabeça: mediana ${fmt(s.rise, 2)}, melhor ${fmt(s.bestRise, 2)} ombros (precisa > 0.35) · ` +
        `confiança dos pulsos ${fmt(s.wristConf, 2)} · cotovelos acima dos ombros ${pct(s.elbowsUp, s.elbowsRead)} · ` +
        `vai e vem dos pulsos ${fmt(s.swing, 2)} ombros (aceno precisa ≥ 0.4) · caixas: ${s.sources}`,
    );
  });
  if (attempts.length === 0) lines.push('nenhuma: a pose não leu mãos na altura da cabeça');
  lines.push('');
  lines.push('MARCAS E GATILHOS');
  const events = [
    ...marks.map((m) => ({ at: m.at, text: `distância real: ${m.meters === null ? 'sem marca' : `${m.meters} m`}` })),
    ...fires.map((f) => ({ at: f.at, text: `gatilho: ${f.source}` })),
    ...kinds.map((k) => ({ at: k.at, text: `gesto feito: ${k.kind === null ? 'sem marca' : k.kind}` })),
  ].sort((x, y) => x.at - y.at);
  events.forEach((e) => lines.push(`${clock(e.at, t0)} ${e.text}`));
  lines.push('');
  lines.push('DADOS (uma amostra por linha: {at, mark, kind, trace})');
  samples.forEach((s) =>
    lines.push(JSON.stringify({ at: s.at, mark: markAt(marks, s.at), kind: kindAt(kinds, s.at), ...s.trace })),
  );
  return lines.join('\n') + '\n';
}

/** The running test: the spike screen feeds it and asks for the live summary and the report. */
export function createGestureTest(now: () => number = Date.now) {
  let samples: TestSample[] = [];
  let marks: DistanceMark[] = [];
  let fires: TestFire[] = [];
  let kinds: KindMark[] = [];

  return {
    addTrace(trace: GestureTrace): void {
      samples.push({ at: now(), trace });
      if (samples.length > MAX_SAMPLES) samples = samples.slice(samples.length - MAX_SAMPLES);
    },
    mark(meters: number | null): void {
      marks.push({ at: now(), meters });
    },
    fire(source: string): void {
      fires.push({ at: now(), source });
    },
    /** The gesture being tried from now on (a lower wave, claps…), or null. */
    kind(kind: string | null): void {
      kinds.push({ at: now(), kind });
    },
    clear(): void {
      samples = [];
      marks = [];
      fires = [];
      kinds = [];
    },
    currentMark(): number | null {
      return markAt(marks, now());
    },
    /** One line for the screen. */
    summary(): string {
      const attempts = findAttempts(samples, marks);
      const ok = attempts.filter((a) => a.fired !== undefined);
      const maxMarked = Math.max(-1, ...ok.map((a) => a.markedM ?? -1));
      const maxEst = Math.max(-1, ...ok.map((a) => attemptStats(a).estM ?? -1));
      const last = attempts.length > 0 ? attempts[attempts.length - 1] : undefined;
      const lastText =
        last === undefined
          ? ''
          : ` · última: ${last.fired === undefined ? 'não reconhecida' : 'reconhecida'}, ~${fmt(attemptStats(last).estM)} m, ` +
            `pose ${pct(attemptStats(last).readable, last.samples.length)}`;
      return (
        `teste: ${samples.length} amostras · tentativas ${attempts.length} · reconhecidas ${ok.length} · maior distância ` +
        `${maxMarked >= 0 ? `${maxMarked} m` : '-'} (marcada) / ${maxEst >= 0 ? `~${maxEst.toFixed(1)} m` : '-'} (estimada)` +
        lastText
      );
    },
    report(meta: TestMeta): string {
      return buildReport(meta, samples, marks, fires, now(), kinds);
    },
  };
}

export type GestureTest = ReturnType<typeof createGestureTest>;
