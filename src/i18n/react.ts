import { useMemo, useSyncExternalStore } from "react";
import {
  resolveText,
  translate,
  translatePlural,
  type Locale,
  type TranslationKey,
} from "../core/i18n.ts";
import type { LocalizedText } from "../sdk/index.ts";
import { getLocale, subscribeLocale } from "./index.ts";

/**
 * Traductions réactives pour les vues React. Le changement de langue
 * réabonne les composants sans remonter les ressources (PTY, éditeur, PDF).
 */
export function useI18n() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return useMemo(
    () => ({
      locale,
      t: (
        key: TranslationKey | string,
        params?: Record<string, string | number>,
      ) => translate(locale, key, params),
      tp: (
        key: string,
        count: number,
        params?: Record<string, string | number>,
      ) => translatePlural(locale, key, count, params),
      text: (value: LocalizedText | undefined) => resolveText(value, locale),
    }),
    [locale],
  );
}

export type { Locale };
