import type { LocalizedText } from "../sdk/index.ts";
import messages, { type TranslationKey } from "./locales/index.ts";

export type { TranslationKey };

/** Langues proposées par l’interface, dans l’ordre du sélecteur. */
export const LOCALES = [
  "fr",
  "en",
  "es",
  "de",
  "it",
  "pt",
  "ja",
  "zh",
] as const;

export type Locale = (typeof LOCALES)[number];

export const LANGUAGES: Record<Locale, { native: string; flag: string }> = {
  fr: { native: "Français", flag: "🇫🇷" },
  en: { native: "English", flag: "🇬🇧" },
  es: { native: "Español", flag: "🇪🇸" },
  de: { native: "Deutsch", flag: "🇩🇪" },
  it: { native: "Italiano", flag: "🇮🇹" },
  pt: { native: "Português", flag: "🇵🇹" },
  ja: { native: "日本語", flag: "🇯🇵" },
  zh: { native: "中文", flag: "🇨🇳" },
};

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

/**
 * Choisit la langue la plus proche de la liste du système. Le repli est
 * l’anglais : une langue inconnue ne doit pas imposer le français.
 */
export function detectLocale(
  languages: readonly string[],
  fallback: Locale = "en",
): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().replace("_", "-").split("-")[0];
    if (isLocale(base)) return base;
  }
  return fallback;
}

const numbers = new Map<Locale, Intl.NumberFormat>();
function numberFormat(locale: Locale) {
  const cached = numbers.get(locale);
  if (cached) return cached;
  const format = new Intl.NumberFormat(locale);
  numbers.set(locale, format);
  return format;
}

const plurals = new Map<Locale, Intl.PluralRules>();
function pluralRules(locale: Locale) {
  const cached = plurals.get(locale);
  if (cached) return cached;
  const rules = new Intl.PluralRules(locale);
  plurals.set(locale, rules);
  return rules;
}

export function formatNumber(value: number, locale: Locale): string {
  return numberFormat(locale).format(value);
}

const table = messages as Record<string, Record<Locale, string> | undefined>;

/**
 * Traduit une clé. Une clé absente retombe sur l’anglais, puis sur la clé
 * elle-même : l’interface reste lisible même pendant une migration.
 */
export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const entry = table[key];
  if (!entry) return key;
  const template = entry[locale] ?? entry.en ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === "number" ? formatNumber(value, locale) : value;
  });
}

/**
 * Choisit la variante plurielle avec `Intl.PluralRules` et retombe sur
 * `.other` quand une langue n’utilise pas la catégorie demandée.
 */
export function translatePlural(
  locale: Locale,
  key: string,
  count: number,
  params: Record<string, string | number> = {},
): string {
  const category = pluralRules(locale).select(count);
  const candidate = `${key}.${category}`;
  const actual = candidate in table ? candidate : `${key}.other`;
  return translate(locale, actual, { ...params, count });
}

/** Référence une clé de traduction depuis un manifeste ou une définition. */
export function localized(key: TranslationKey): LocalizedText {
  return { key };
}

/** Résout un texte littéral ou une référence de traduction. */
export function resolveText(
  value: LocalizedText | undefined,
  locale: Locale,
): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.key === "string")
    return translate(locale, value.key);
  return "";
}
