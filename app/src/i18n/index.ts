import { getLocales } from "expo-localization";
import { I18n } from "i18n-js";
import { Platform } from "react-native";

import { type AppLocale, resolveLocale } from "./locale";
import { androidOverrides } from "./locales/android";
import { en, type Messages } from "./locales/en";
import { ptBR } from "./locales/pt-BR";

export {
  type AppLocale,
  resolveLocale,
  voiceLocale,
  VOICE_WORD,
  type VoiceLocale,
} from "./locale";
export type { Messages };

type Plural = { one: string; other: string };
type Leaf = string | Plural;
type Paths<T> = {
  [K in keyof T & string]: T[K] extends Leaf ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

/** Every translatable text: a dot path to a string or a plural (`{ one, other }`, picked by `count`). */
export type MessageKey = Paths<Messages>;
export type MessageParams = Record<string, string | number>;
export type TFunction = (key: MessageKey, params?: MessageParams) => string;

/** `base` with `over` laid on top, key by key (plurals and strings are replaced whole). */
export function overlay<T>(base: T, over: unknown): T {
  if (
    over === undefined ||
    over === null ||
    typeof over !== "object" ||
    typeof base !== "object" ||
    base === null
  ) {
    return (over === undefined ? base : over) as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const b = out[k];
    const plural = typeof v === "object" && v !== null && "other" in v;
    out[k] = plural || typeof b !== "object" ? v : overlay(b, v);
  }
  return out as T;
}

/** The texts on this platform: Android names its own settings app, gallery and Bluetooth menus. */
function forPlatform(locale: AppLocale, messages: Messages): Messages {
  return Platform.OS === "android"
    ? overlay(messages, androidOverrides[locale])
    : messages;
}

export const catalogs: Record<AppLocale, Messages> = {
  en: forPlatform("en", en),
  "pt-BR": forPlatform("pt-BR", ptBR),
};

// The default pluralizer is English's (1 → one, else other), which is also how Brazilian apps count ("0 clipes").
const i18n = new I18n(catalogs);
i18n.defaultLocale = "en";
i18n.enableFallback = true;

/** `key` in `locale`, with `%{name}` placeholders filled from `params`. */
export function translate(
  locale: AppLocale,
  key: MessageKey,
  params?: MessageParams,
): string {
  return i18n.t(key, { ...params, locale });
}

function deviceTags(): string[] {
  try {
    return getLocales().map((l) => l.languageTag);
  } catch {
    return [];
  }
}

let current: AppLocale = resolveLocale(deviceTags());
const listeners = new Set<() => void>();

/** The language the app shows now. */
export function currentLocale(): AppLocale {
  return current;
}

export function setLocale(locale: AppLocale): void {
  if (locale === current) return;
  current = locale;
  i18n.locale = locale;
  listeners.forEach((fn) => fn());
}
i18n.locale = current;

/** Re-reads the device languages (Android can change them while the app runs) and switches when they changed. */
export function syncLocale(tags: string[] = deviceTags()): void {
  setLocale(resolveLocale(tags));
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** For code outside React: the text in the current language, read at call time. */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(current, key, params);
}
