// TEMP(diag-remote): the Bluetooth remote's link in the diagnostic log (Portuguese, like the Diagnóstico screen).
import type { LinkEvent } from '../triggers/linkMonitor';

/**
 * The AB Shutter3 sleeps this long after its last press (300.0 / 300.2 / 300.5 s on 2026-11-08); a drop this close to
 * it reads as sleep, any other as range or the body. For the log only: no comeback ever saves a clip, the first press
 * after the sleep only wakes the remote (2026-11-08 spec §4).
 */
export const REMOTE_SLEEP_MS = 300_000;
const SLEEP_EARLY_MS = 5_000;
const SLEEP_LATE_MS = 10_000;

export function readDrop(idleMs: number | undefined): 'sleep' | 'range' {
  if (idleMs === undefined) return 'range';
  return idleMs >= REMOTE_SLEEP_MS - SLEEP_EARLY_MS && idleMs <= REMOTE_SLEEP_MS + SLEEP_LATE_MS ? 'sleep' : 'range';
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function describeLinkEvent(e: LinkEvent): string {
  if (e.kind === 'dropped') {
    const reading = readDrop(e.idleMs) === 'sleep' ? 'parece sono' : 'parece alcance ou obstáculo';
    return `controle: conexão caiu ${seconds(e.idleMs)} após o último clique — ${reading}`;
  }
  const away = e.awayMs === undefined ? '' : ` após ${seconds(e.awayMs)}`;
  const why =
    e.idleAtDropMs === undefined ? '' : readDrop(e.idleAtDropMs) === 'sleep' ? ' — acordou do sono' : ' — voltou do alcance';
  return `controle: conexão voltou${away}${why} (não conta como clique)`;
}
