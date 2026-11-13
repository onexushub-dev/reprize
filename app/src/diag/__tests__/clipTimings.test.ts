import { stagesText } from '../clipTimings';

test('the stages of an analysis in one piece of a Diagnóstico line, in seconds', () => {
  expect(
    stagesText({
      stages: { decodeMs: 912.4, peopleMs: 4130, prepMs: 610, modelMs: 3540, pathMs: 21.6, regions: 19 },
      panP95: 0.1234,
      turnsPer10s: 1.26,
    }),
  ).toBe(' — etapas: decodificar 0.9 s, pessoas 4.1 s, recortes 0.6 s, modelo 3.5 s, caminho 0.02 s; 19.0 recortes/quadro; câmera: pan p95 0.12/s, 1.3 viradas/10 s');
});

test('Jogadores alone has no ball stages and no regions', () => {
  expect(
    stagesText({
      stages: { decodeMs: 900, peopleMs: 4100, prepMs: 0, modelMs: 0, pathMs: 20, regions: 0 },
      panP95: 0,
      turnsPer10s: 0,
    }),
  ).toBe(' — etapas: decodificar 0.9 s, pessoas 4.1 s, caminho 0.02 s; câmera: pan p95 0.00/s, 0.0 viradas/10 s');
});

test('a native side without the stages (an older build) adds nothing', () => {
  expect(stagesText({})).toBe('');
});
