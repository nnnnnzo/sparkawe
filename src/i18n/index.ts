import {
  detectLocale,
  resolveText,
  translate,
  translatePlural,
  type Locale,
  type TranslationKey,
} from "../core/i18n.ts";
import type { LocalizedText } from "../sdk/index.ts";

const detected =
  typeof navigator === "undefined"
    ? "en"
    : detectLocale(navigator.languages ?? [navigator.language]);

let locale: Locale = detected;
const listeners = new Set<() => void>();

if (typeof document !== "undefined") document.documentElement.lang = locale;

export function getLocale(): Locale {
  return locale;
}

export function setLocale(next: Locale) {
  if (next === locale) return;
  locale = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function t(
  key: TranslationKey | string,
  params?: Record<string, string | number>,
): string {
  return translate(locale, key, params);
}

export function tp(
  key: string,
  count: number,
  params?: Record<string, string | number>,
): string {
  return translatePlural(locale, key, count, params);
}

export function text(value: LocalizedText | undefined): string {
  return resolveText(value, locale);
}
