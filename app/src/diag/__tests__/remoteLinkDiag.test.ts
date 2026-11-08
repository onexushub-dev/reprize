import { describeLinkEvent, readDrop } from '../remoteLinkDiag';

test("a drop at the AB Shutter3's 300 s reads as sleep, any other as range (2026-11-08 spec §4)", () => {
  expect(readDrop(300_200)).toBe('sleep');
  expect(readDrop(295_000)).toBe('sleep');
  expect(readDrop(310_000)).toBe('sleep');
  expect(readDrop(55_600)).toBe('range');
  expect(readDrop(310_001)).toBe('range');
  expect(readDrop(undefined)).toBe('range');
});

test('the diagnostic lines say what the drop looks like, and that a comeback never counts as a press', () => {
  expect(describeLinkEvent({ kind: 'dropped', idleMs: 300_200 })).toBe(
    'controle: conexão caiu 300.2 s após o último clique — parece sono',
  );
  expect(describeLinkEvent({ kind: 'dropped', idleMs: 30_400 })).toBe(
    'controle: conexão caiu 30.4 s após o último clique — parece alcance ou obstáculo',
  );
  expect(describeLinkEvent({ kind: 'back', awayMs: 27_500, idleAtDropMs: 300_200 })).toBe(
    'controle: conexão voltou após 27.5 s — acordou do sono (não conta como clique)',
  );
  expect(describeLinkEvent({ kind: 'back', awayMs: 1200, idleAtDropMs: 30_400 })).toBe(
    'controle: conexão voltou após 1.2 s — voltou do alcance (não conta como clique)',
  );
  expect(describeLinkEvent({ kind: 'back', awayMs: undefined, idleAtDropMs: undefined })).toBe(
    'controle: conexão voltou (não conta como clique)',
  );
});
