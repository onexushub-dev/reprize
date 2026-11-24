import type { ModeId, Session } from '../data/schema';
import { type AppLocale, currentLocale, translate } from '../i18n';
import type { ModeGroup } from '../modes/registry';

// Every helper takes the language last (the app's current one by default). Components pass `locale` from useT(),
// so a memoized render is recomputed when the language changes.

/** A mode's (or a saved sport's) name. */
export function modeLabel(id: ModeId, locale: AppLocale = currentLocale()): string {
  return translate(locale, `modes.label.${id}`);
}

/** Where to put the phone, for a mode group. */
export function modeTip(group: ModeGroup, locale: AppLocale = currentLocale()): string {
  return translate(locale, `modes.tip.${group}`);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2h14" / "2h 14m" from 2h14min; "14min" / "14 min" under an hour. */
export function recordedLabel(ms: number, locale: AppLocale = currentLocale()): string {
  const minutes = Math.floor(ms / 60_000);
  const h = Math.floor(minutes / 60);
  return h > 0
    ? translate(locale, 'common.hoursMinutes', { h, m: pad(minutes % 60) })
    : translate(locale, 'common.minutes', { m: minutes });
}

export function megabytes(bytes: number, locale: AppLocale = currentLocale()): string {
  return translate(locale, 'common.megabytes', { size: new Intl.NumberFormat(locale).format(Math.round(bytes / 1_000_000)) });
}

/** "18:40" in Portuguese, "6:40 PM" in English. */
export function timeOfDay(at: number, locale: AppLocale = currentLocale()): string {
  return new Intl.DateTimeFormat(locale, { hour: locale === 'en' ? 'numeric' : '2-digit', minute: '2-digit' }).format(
    new Date(at),
  );
}

/** "16/10" in Portuguese, "10/16" in English. */
function dayMonth(at: number, locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(new Date(at));
}

/** "hoje, 18:40" / "today, 6:40 PM", or "16/10, 18:40" / "10/16, 6:40 PM". */
export function dayAndTime(at: number, now = Date.now(), locale: AppLocale = currentLocale()): string {
  const time = timeOfDay(at, locale);
  const today = new Date(now).toDateString() === new Date(at).toDateString();
  return today
    ? translate(locale, 'common.today', { time })
    : translate(locale, 'common.dayTime', { day: dayMonth(at, locale), time });
}

/** The number a clip shows in its recording: the one it was saved with, or its place in the list for older clips. */
export function clipNumber(clip: { number?: number }, index: number): number {
  return clip.number !== undefined ? clip.number : index + 1;
}

/** "m:ss", the same in every language. */
export function seconds(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** A game's name, or "<Mode> · <day>, <time>". */
export function sessionLabel(session: Session, now = Date.now(), locale: AppLocale = currentLocale()): string {
  if (session.name) return session.name;
  return translate(locale, 'common.sessionLabel', {
    mode: modeLabel(session.sport, locale),
    day: dayMonth(session.startedAt, locale),
    time: timeOfDay(session.startedAt, locale),
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The day a recording started, as a section of the list: "Hoje · 20 de novembro", "Ontem · 19 de novembro", "18 de novembro". */
export function dayTitle(at: number, now: number, locale: AppLocale, words: { today: string; yesterday: string }): string {
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const day = new Intl.DateTimeFormat(locale, sameYear ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  if (date.toDateString() === new Date(now).toDateString()) return `${words.today} · ${day}`;
  if (date.toDateString() === new Date(now - DAY_MS).toDateString()) return `${words.yesterday} · ${day}`;
  return day;
}
