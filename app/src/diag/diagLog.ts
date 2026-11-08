// TEMP(diag-remote): Bluetooth remote investigation; this whole file goes with its commit.
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';

/**
 * In-app diagnostic log (field tests; temporary). One readable line per event, kept in `Documents/diagnostico.txt` so
 * it survives the app being closed, and shown and shared from the Diagnóstico screen. Every file access is guarded:
 * logging must never break a recording (and there is no file system in tests).
 *
 * Every line carries the area it belongs to, read from the event's prefix (`controle: …`, also for the native lines),
 * and a ⚠ when it is a warning (2026-11-08 spec §6):
 *
 *   10:13:33 [+08:49] CONEXÃO  │ ⚠ caiu 300.2 s após o último clique — parece sono
 *
 * A recording's end adds a summary line (clips by source, remote drops, heat, battery, warnings).
 */

/**
 * On only in builds made with `REPRIZE_DIAGNOSTICS=1` (see app.config.js). Off, nothing is logged or written, so a
 * store build behaves as if this file did not exist.
 */
export const DIAGNOSTICS_ENABLED = Constants.expoConfig?.extra?.diagnostics === true;

const LOG_NAME = 'diagnostico.txt';
/** Older lines go first; a long game logs a few hundred. */
const MAX_LINES = 5000;

let lines: string[] | undefined;
let recordingSince: number | undefined;
const listeners = new Set<() => void>();

function logFile(): File {
  return new File(Paths.document, LOG_NAME);
}

function load(): string[] {
  if (lines !== undefined) return lines;
  try {
    const f = logFile();
    lines = f.exists ? f.textSync().split('\n').filter((l) => l.length > 0) : [];
  } catch {
    lines = [];
  }
  return lines;
}

function persist(all: string[]): void {
  try {
    const f = logFile();
    if (!f.exists) f.create();
    f.write(all.length > 0 ? all.join('\n') + '\n' : '');
  } catch {
    // no file system (tests) or a full disk: the log stays in memory
  }
}

const pad = (n: number, size = 2) => String(n).padStart(size, '0');

/** The areas a line can belong to, in the order the Diagnóstico screen offers them as filters. */
export const DIAG_AREAS = [
  'GRAVAÇÃO',
  'CLIPE',
  'CONTROLE',
  'CONEXÃO',
  'VOLUME',
  'PREPARO',
  'ENERGIA',
  'CALOR',
  'CÂMERA',
  'ÁUDIO',
  'TELA',
  'APP',
  'FOCO',
  'OUTRO',
] as const;
export type DiagArea = (typeof DIAG_AREAS)[number];

/** Prefix → area, first match wins; `strip` removes the prefix from the message (the tag says it). */
const RULES: { prefix: string; area: DiagArea; strip: boolean }[] = [
  { prefix: '=====', area: 'GRAVAÇÃO', strip: false },
  { prefix: 'resumo:', area: 'GRAVAÇÃO', strip: false },
  { prefix: 'fim da gravação', area: 'GRAVAÇÃO', strip: false },
  { prefix: 'pulso ', area: 'ENERGIA', strip: false },
  { prefix: 'clipe ', area: 'CLIPE', strip: true },
  { prefix: 'controle: conexão', area: 'CONEXÃO', strip: true },
  { prefix: 'controle: volume', area: 'VOLUME', strip: false },
  { prefix: 'controle: aguardando o sistema', area: 'VOLUME', strip: false },
  { prefix: 'controle: FALHOU ao devolver', area: 'VOLUME', strip: false },
  { prefix: 'controle: ', area: 'CONTROLE', strip: true },
  { prefix: 'preparo: ', area: 'PREPARO', strip: true },
  { prefix: 'câmera: ', area: 'CÂMERA', strip: true },
  { prefix: 'áudio: ', area: 'ÁUDIO', strip: true },
  { prefix: 'calor: ', area: 'CALOR', strip: true },
  { prefix: 'tela: ', area: 'TELA', strip: true },
  { prefix: 'app: ', area: 'APP', strip: true },
  { prefix: 'Modo Foco: ', area: 'FOCO', strip: true },
];

/** Words that make a line a warning (⚠): something failed, was taken away or dropped. */
const WARNING = /FALHOU|INTERROMPIDA|desligada pelo iOS|caiu|ILEGÍVEL|REINICIADOS|COMEÇOU/;

/** An event's area, its message without the prefix, and whether it is a warning. */
export function classify(event: string): { area: DiagArea; message: string; warn: boolean } {
  const rule = RULES.find((r) => event.startsWith(r.prefix));
  const area: DiagArea = rule === undefined ? 'OUTRO' : rule.area;
  let message = rule !== undefined && rule.strip ? event.slice(rule.prefix.length) : event;
  message = message.replace(/^[\s:—]+/, '');
  if (message.length === 0) message = event;
  return { area, message, warn: WARNING.test(event) };
}

const AREA_WIDTH = Math.max(...DIAG_AREAS.map((a) => a.length));
const NO_RECORDING = ' '.repeat('[+00:00]'.length);

/** One stored line: time, time since the recording started (blank outside one), area, ⚠, message. */
export function formatLine(ms: number, since: number | undefined, event: string): string {
  const d = new Date(ms);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  let rel = NO_RECORDING;
  if (since !== undefined) {
    const s = Math.max(0, Math.floor((ms - since) / 1000));
    rel = `[+${pad(Math.floor(s / 60))}:${pad(s % 60)}]`;
  }
  const { area, message, warn } = classify(event);
  return `${clock} ${rel} ${area.padEnd(AREA_WIDTH)} │ ${warn ? '⚠ ' : ''}${message}`;
}

const LINE = /^\d\d:\d\d:\d\d (?:\[\+\d+:\d\d\]| {8}) (\S+) *│ (⚠ )?/;

/** A stored line's area and warning; lines from before the tags read as OUTRO. */
export function parseLine(line: string): { area: DiagArea; warn: boolean } {
  const m = LINE.exec(line);
  if (m === null) return { area: 'OUTRO', warn: false };
  const area = (DIAG_AREAS as readonly string[]).includes(m[1]) ? (m[1] as DiagArea) : 'OUTRO';
  return { area, warn: m[2] !== undefined };
}

/** Adds one line. */
export function diag(event: string): void {
  if (!DIAGNOSTICS_ENABLED) return;
  const all = load();
  all.push(formatLine(Date.now(), recordingSince, event));
  if (all.length > MAX_LINES) all.splice(0, all.length - MAX_LINES);
  persist(all);
  listeners.forEach((l) => l());
}

/** Marks a recording's start: lines after it also show the time since (`[+09:58]`). */
export function diagRecordingStarted(details: string): void {
  recordingSince = Date.now();
  diag(`===== GRAVAÇÃO INICIADA — ${details} =====`);
}

export function diagRecordingEnded(): void {
  const all = load();
  let from = all.length;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].includes('GRAVAÇÃO INICIADA')) {
      from = i;
      break;
    }
  }
  const lengthMs = recordingSince === undefined ? 0 : Date.now() - recordingSince;
  diag(recordingSummary(all.slice(from), lengthMs));
  diag('===== GRAVAÇÃO ENCERRADA =====');
  recordingSince = undefined;
}

const SOURCE_NAMES: Record<string, string> = {
  remote: 'controle',
  screen: 'tela',
  gesture: 'gesto',
  voice: 'voz',
  watch: 'relógio',
  phone: 'celular',
};
const HEAT_ORDER = ['nominal', 'fair', 'serious', 'critical'];

/** One line about a recording, from its own lines: what a field test needs at a glance. */
export function recordingSummary(lines: string[], lengthMs: number): string {
  const s = Math.max(0, Math.floor(lengthMs / 1000));
  const clips = new Map<string, number>();
  let sleep = 0;
  let range = 0;
  let heat = -1;
  let warnings = 0;
  const battery: string[] = [];
  for (const line of lines) {
    const { area, warn } = parseLine(line);
    if (warn) warnings += 1;
    const clip = /│ (?:⚠ )?salvo \((\w+)\)/.exec(line);
    if (area === 'CLIPE' && clip !== null) {
      const name = SOURCE_NAMES[clip[1]] === undefined ? clip[1] : SOURCE_NAMES[clip[1]];
      clips.set(name, (clips.get(name) === undefined ? 0 : (clips.get(name) as number)) + 1);
    }
    if (area === 'CONEXÃO') {
      if (line.includes('caiu') && line.includes('parece sono')) sleep += 1;
      else if (line.includes('caiu')) range += 1;
    }
    if (area === 'CALOR') {
      const level = HEAT_ORDER.findIndex((h) => line.includes(`│ ${h}`));
      if (level > heat) heat = level;
    }
    const b = /bateria (\d+%)/.exec(line);
    if (b !== null) battery.push(b[1]);
  }
  const total = [...clips.values()].reduce((a, b) => a + b, 0);
  const bySource = [...clips.entries()].map(([k, v]) => `${k} ${v}`).join(', ');
  return (
    `resumo: ${pad(Math.floor(s / 60))}:${pad(s % 60)} · ` +
    `${total} clipe${total === 1 ? '' : 's'}${total > 0 ? ` (${bySource})` : ''} · ` +
    `controle: ${sleep} queda por sono, ${range} por alcance · ` +
    `calor máx. ${heat < 0 ? '?' : HEAT_ORDER[heat]} · ` +
    `bateria ${battery.length === 0 ? '?' : `${battery[0]} → ${battery[battery.length - 1]}`} · ` +
    `${warnings} alerta${warnings === 1 ? '' : 's'}`
  );
}

export function diagText(): string {
  return load().join('\n');
}

export function diagClear(): void {
  lines = [];
  persist(lines);
  listeners.forEach((l) => l());
}

/** The log file's `file://` address, for the share sheet; undefined when it can't be reached. */
export function diagFileUri(): string | undefined {
  try {
    persist(load());
    return logFile().uri;
  } catch {
    return undefined;
  }
}

/** Calls `listener` after every change; returns the unsubscribe. */
export function diagSubscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
