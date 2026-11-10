// TEMP(diag-remote): the clip screen's timing lines for the diagnostic log (Modo Foco wait, export).
import { diag } from './diagLog';

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
