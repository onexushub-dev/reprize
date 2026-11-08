import { classify, formatLine, parseLine, recordingSummary } from '../diagLog';

describe('every line has its area, read from the prefix (2026-11-08 spec §6)', () => {
  test.each([
    ['controle: CLIQUE (captura, secondary, 1 ms)', 'CONTROLE', 'CLIQUE (captura, secondary, 1 ms)'],
    ['controle: SEGURADO 2 s (captura, secondary)', 'CONTROLE', 'SEGURADO 2 s (captura, secondary)'],
    ['controle: conexão caiu 300.2 s após o último clique — parece sono', 'CONEXÃO', 'caiu 300.2 s após o último clique — parece sono'],
    ['controle: volume 1.00 ignorado (armando)', 'VOLUME', 'controle: volume 1.00 ignorado (armando)'],
    ['controle: aguardando o sistema (route 3)', 'VOLUME', 'controle: aguardando o sistema (route 3)'],
    ['controle: FALHOU ao devolver o volume', 'VOLUME', 'controle: FALHOU ao devolver o volume'],
    ['clipe salvo (remote)', 'CLIPE', 'salvo (remote)'],
    ['pulso 3 min: bateria 80% (fora do cabo), calor nominal', 'ENERGIA', 'pulso 3 min: bateria 80% (fora do cabo), calor nominal'],
    ['preparo: pulso 1 min — câmera ligada', 'PREPARO', 'pulso 1 min — câmera ligada'],
    ['câmera: INTERROMPIDA pelo iOS', 'CÂMERA', 'INTERROMPIDA pelo iOS'],
    ['áudio: rota mudou (categoria mudou)', 'ÁUDIO', 'rota mudou (categoria mudou)'],
    ['calor: fair, gravando em 1080p60', 'CALOR', 'fair, gravando em 1080p60'],
    ['tela: escureceu (economia)', 'TELA', 'escureceu (economia)'],
    ['app: background', 'APP', 'background'],
    ['Modo Foco: clipe de 15 s analisado em 8.3 s', 'FOCO', 'clipe de 15 s analisado em 8.3 s'],
    ['===== GRAVAÇÃO INICIADA — economia de tela ligada =====', 'GRAVAÇÃO', '===== GRAVAÇÃO INICIADA — economia de tela ligada ====='],
    ['algo sem prefixo', 'OUTRO', 'algo sem prefixo'],
  ])('%s → %s', (event, area, message) => {
    expect(classify(event)).toMatchObject({ area, message });
  });

  test('warnings: failures, interruptions, drops', () => {
    expect(classify('câmera: INTERROMPIDA pelo iOS').warn).toBe(true);
    expect(classify('controle: conexão caiu 55.6 s após o último clique — parece alcance ou obstáculo').warn).toBe(true);
    expect(classify('controle: FALHOU ao devolver o volume').warn).toBe(true);
    expect(classify('clipe salvo (remote)').warn).toBe(false);
  });
});

test('a line: time, time into the recording (blank outside one), area, ⚠, message; and read back', () => {
  const at = new Date(2026, 10, 8, 10, 13, 33).getTime();
  const during = formatLine(at, at - 529_000, 'controle: conexão caiu 300.2 s após o último clique — parece sono');
  expect(during).toBe('10:13:33 [+08:49] CONEXÃO  │ ⚠ caiu 300.2 s após o último clique — parece sono');
  expect(parseLine(during)).toEqual({ area: 'CONEXÃO', warn: true });
  const outside = formatLine(at, undefined, 'app: active');
  expect(outside).toBe('10:13:33          APP      │ active');
  expect(parseLine(outside)).toEqual({ area: 'APP', warn: false });
  expect(parseLine('10:13:33 controle: linha antiga')).toEqual({ area: 'OUTRO', warn: false });
});

test("a recording's summary: length, clips by source, drops, heat, battery, warnings", () => {
  const t = new Date(2026, 10, 8, 9, 33, 34).getTime();
  const since = t;
  const line = (s: number, e: string) => formatLine(t + s * 1000, since, e);
  const lines = [
    line(0, '===== GRAVAÇÃO INICIADA — economia de tela ligada — bateria 90% (fora do cabo), calor nominal ====='),
    line(0, 'calor: nominal'),
    line(65, 'clipe salvo (remote)'),
    line(200, 'clipe salvo (screen)'),
    line(530, 'controle: conexão caiu 300.2 s após o último clique — parece sono'),
    line(560, 'controle: conexão voltou após 27.5 s — acordou do sono (não conta como clique)'),
    line(566, 'clipe salvo (remote)'),
    line(600, 'calor: fair, gravando em 1080p60'),
    line(700, 'controle: conexão caiu 55.6 s após o último clique — parece alcance ou obstáculo'),
    line(786, 'fim da gravação: bateria 85% (fora do cabo), calor fair'),
  ];
  expect(recordingSummary(lines, 786_000)).toBe(
    'resumo: 13:06 · 3 clipes (controle 2, tela 1) · controle: 1 queda por sono, 1 por alcance · ' +
      'calor máx. fair · bateria 90% → 85% · 2 alertas',
  );
});
