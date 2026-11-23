import { invoke } from "@tauri-apps/api/core";

/**
 * Pont avec les vues web natives. Une vue vit dans la fenêtre principale,
 * posée sur le rectangle que la tuile mesure ; le contenu de la page n’est
 * jamais rendu par React.
 */

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageText {
  url: string;
  title: string;
  /** Fichier du texte complet, écrit par Rust. */
  path: string;
  bytes: number;
  characters: number;
  /** Début du texte, borné pour rester un résumé. */
  text: string;
  truncated: boolean;
}

/** Vues natives vivantes en même temps, toutes tuiles confondues. */
export const MAX_PAGES = 6;

const visible = new Set<string>();
const touched = new Map<string, number>();

/** Crée la vue si elle manque, sinon la replace. Ne navigue jamais. */
export function openPage(tile: string, url: string, bounds: Bounds) {
  return invoke<boolean>("web_open", { tile, url, ...bounds }).then(
    async (created) => {
      touched.set(tile, Date.now());
      await suspend(tile);
      return created;
    },
  );
}

export function placePage(tile: string, bounds: Bounds) {
  return invoke<void>("web_bounds", { tile, ...bounds });
}

export function showPage(tile: string, shown: boolean) {
  if (shown) visible.add(tile);
  else visible.delete(tile);
  return invoke<void>("web_show", { tile, visible: shown });
}

/** `web_open` affiche déjà la vue : on ne garde que le compte local. */
export function noteShown(tile: string) {
  visible.add(tile);
}

export function navigatePage(tile: string, url: string) {
  return invoke<void>("web_navigate", { tile, url });
}

export function historyPage(tile: string, moveBy: number) {
  return invoke<void>("web_history", { tile, moveBy });
}

export function reloadPage(tile: string) {
  return invoke<void>("web_reload", { tile });
}

/** Image de la page, pour la garder visible pendant un glisser-déposer. */
export function snapshotPage(tile: string) {
  return invoke<string>("web_snapshot", { tile });
}

export function readPage(tile: string) {
  return invoke<PageText>("web_read_text", { tile });
}

export async function closePage(tile: string) {
  visible.delete(tile);
  touched.delete(tile);
  await invoke<void>("web_close", { tile });
}

/** Ferme la vue la moins récemment affichée quand la limite est dépassée. */
async function suspend(keep: string) {
  if (touched.size <= MAX_PAGES) return;
  const candidates = [...touched.entries()]
    .filter(([tile]) => tile !== keep && !visible.has(tile))
    .sort((left, right) => left[1] - right[1]);
  for (const [tile] of candidates) {
    if (touched.size <= MAX_PAGES) return;
    touched.delete(tile);
    await closePage(tile).catch(() => {});
  }
}

/** Adresse lisible : un hôte sans schéma est lu comme du https. */
export function normalize(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Le web public seulement : la même règle que la commande Rust, qui tolère
 * `http://` en développement. */
export function isPublic(url: string) {
  return (
    /^https:\/\//i.test(url) || (import.meta.env.DEV && /^http:\/\//i.test(url))
  );
}

export function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
