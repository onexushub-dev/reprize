// TEMP(diag-remote): the clip screen's timing lines for the diagnostic log (Modo Foco wait, export).
import type { AnalysisStages } from '../../modules/replay-camera/src/ReplayCamera.types';
import { diag } from './diagLog';

/**
 * Where an analysis spent its time and how much its camera moves, as the tail of its Diagnóstico line (plan 2026-11-12,
 * I5). With the people and ball detectors side by side their times overlap, so the stages can add up to more than the
 * analysis took.
 */
export function stagesText(r: { stages?: AnalysisStages; panP95?: number; turnsPer10s?: number }): string {
  const s = r.stages;
  if (s === undefined) return '';
  const sec = (ms: number, digits = 1) => `${(ms / 1000).toFixed(digits)} s`;
  const parts = [`decodificar ${sec(s.decodeMs)}`];
  if (s.peopleMs > 0) parts.push(`pessoas ${sec(s.peopleMs)}`);
  if (s.modelMs > 0) parts.push(`recortes ${sec(s.prepMs)}`, `modelo ${sec(s.modelMs)}`);
  parts.push(`caminho ${sec(s.pathMs, 2)}`);
  const regions = s.regions > 0 ? `; ${s.regions.toFixed(1)} recortes/quadro` : '';
  const pan = r.panP95 !== undefined ? r.panP95 : 0;
  const turns = r.turnsPer10s !== undefined ? r.turnsPer10s : 0;
  return ` — etapas: ${parts.join(', ')}${regions}; câmera: pan p95 ${pan.toFixed(2)}/s, ${turns.toFixed(1)} viradas/10 s`;
}

const secs = (ms: number) => (ms / 1000).toFixed(1);

export function diagShapeKnown(sinceOpenMs: number): void {
  diag(`clipe: forma conhecida ${secs(sinceOpenMs)} s após abrir`);
}

export function diagFramingShown(sinceOpenMs: number): void {
  diag(`clipe: enquadramento do Foco na tela ${secs(sinceOpenMs)} s após abrir`);
}

export function diagExport(o: { frameMs: number; renderMs: number; lengthMs: number; width: number; height: number; side: number; focus: boolean; speed: number; muted: boolean }): void {
  diag(
    `clipe exportação: moldura ${o.frameMs} ms, render ${o.renderMs} ms (${(o.lengthMs / 1000).toFixed(0)} s, ` +
      `${o.width}x${o.height}, ${o.side}p, foco ${o.focus ? 'sim' : 'não'}, velocidade ${o.speed}, ${o.muted ? 'sem' : 'com'} som)`,
  );
}
