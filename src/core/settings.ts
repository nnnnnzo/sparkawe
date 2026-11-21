/**
 * Préférences de l'application, indépendantes de l'espace de travail :
 * elles survivent au changement d'onglet et ne font pas partie du document.
 */

export interface AppSettings {
  dev: boolean;
}

const defaults: AppSettings = { dev: false };

export function restoreSettings(value: unknown): AppSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { ...defaults };
  const settings = value as Record<string, unknown>;
  if (settings.dev !== undefined && typeof settings.dev !== "boolean")
    return { ...defaults };
  return { dev: settings.dev === true };
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
