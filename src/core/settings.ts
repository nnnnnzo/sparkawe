/**
 * Préférences de l'application, indépendantes de l'espace de travail :
 * elles survivent au changement d'onglet et ne font pas partie du document.
 */

import { isLocale, type Locale } from "./i18n.ts";

export interface AppSettings {
  dev: boolean;
  locale: Locale;
}

export function restoreSettings(
  value: unknown,
  fallback: Locale = "en",
): AppSettings {
  const empty: AppSettings = { dev: false, locale: fallback };
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return empty;
  const settings = value as Record<string, unknown>;
  if (settings.dev !== undefined && typeof settings.dev !== "boolean")
    return empty;
  return {
    dev: settings.dev === true,
    locale: isLocale(settings.locale) ? settings.locale : fallback,
  };
}

export class Settings {
  private readonly listeners = new Set<() => void>();
  private state: AppSettings;

  constructor(state: AppSettings) {
    this.state = state;
  }
  get = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  patch(change: Partial<AppSettings>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }
}
