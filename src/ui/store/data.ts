import { resolveText, translate, type Locale } from "../../core/i18n.ts";
import type { ExtensionTier, Manifest } from "../../sdk/index.ts";

export type StoreView = "home" | "updates" | "installed" | "sources";

export type StoreOrigin = StoreView | { view: "repository"; url: string };

export type StoreRoute =
  | { view: StoreView }
  | {
      view: "detail";
      id: string;
      from?: StoreOrigin;
      /** Renseigné pour une fiche distante non installée. */
      source?: string;
    }
  | { view: "repository"; url: string };

const viewOf = (origin: StoreOrigin | undefined): StoreView =>
  origin && typeof origin === "object" ? "sources" : (origin ?? "home");

/** Vue à mettre en avant dans la sidebar quand une fiche ou un dépôt est ouvert. */
export const activeStoreView = (route: StoreRoute): StoreView => {
  if (route.view === "detail") return viewOf(route.from);
  if (route.view === "repository") return "sources";
  return route.view;
};

/** Retour réel : une fiche revient à son origine, un dépôt à Sources. */
export const backRoute = (route: StoreRoute): StoreRoute => {
  if (route.view === "detail") {
    if (route.from && typeof route.from === "object") return route.from;
    return { view: route.from ?? "home" };
  }
  if (route.view === "repository") return { view: "sources" };
  return { view: "home" };
};

export const FEATURED_IDS = [
  "spark.terminal",
  "spark.markdown",
  "spark.data",
  "spark.explorer",
  "spark.openalex",
  "spark.preview",
] as const;

/** Sentinelle stable du filtre « toutes les catégories ». */
export const ALL_CATEGORIES = "all";

/** Identifiants stables des catégories éditoriales du Store. */
export const CATEGORY_KEYS: Record<string, string> = {
  development: "store.category.development",
  data: "store.category.data",
  files: "store.category.files",
  writing: "store.category.writing",
  research: "store.category.research",
  reading: "store.category.reading",
};

/** Clé de traduction d’une catégorie connue, sinon l’identifiant brut. */
export const categoryKey = (id: string): string => CATEGORY_KEYS[id] ?? id;

/** Libellé traduit d’une catégorie ; les identifiants libres restent tels quels. */
export function categoryLabel(
  id: string | undefined,
  t: (key: string) => string,
): string {
  if (!id) return "";
  return t(categoryKey(id));
}

export const TIER_LABEL_KEY: Record<ExtensionTier, string> = {
  core: "store.tier.core",
  official: "store.tier.official",
  community: "store.tier.community",
};

export const TIER_SECTION_KEY: Record<ExtensionTier, string> = {
  core: "store.tier.core.section",
  official: "store.tier.official.section",
  community: "store.tier.community.section",
};

export const tierOf = (manifest: Manifest): ExtensionTier =>
  manifest.tier ?? "core";

const featuredRank = (manifest: Manifest) => {
  const index = FEATURED_IDS.indexOf(
    manifest.id as (typeof FEATURED_IDS)[number],
  );
  return index === -1 ? FEATURED_IDS.length : index;
};

export const storeOrder = (first: Manifest, second: Manifest, locale: Locale) =>
  featuredRank(first) - featuredRank(second) ||
  resolveText(first.name, locale).localeCompare(
    resolveText(second.name, locale),
    locale,
  );

export const isCertified = (manifest: Manifest) =>
  manifest.certification === "spark";

/** Recherche insensible aux accents et à la casse. */
export const normalize = (value: string, locale: Locale) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase(locale);

export function matchesQuery(
  manifest: Manifest,
  query: string,
  locale: Locale,
) {
  const needle = normalize(query.trim(), locale);
  if (!needle) return true;
  return normalize(
    [
      resolveText(manifest.name, locale),
      resolveText(manifest.summary, locale),
      resolveText(manifest.description, locale),
      manifest.category,
      categoryLabel(manifest.category, (key) => translate(locale, key)),
      resolveText(manifest.subtitle, locale),
      manifest.id,
    ]
      .filter(Boolean)
      .join(" "),
    locale,
  ).includes(needle);
}

export type StoreState = "active" | "inactive" | "not-installed";

export const stateOf = (
  manifest: Manifest,
  active: boolean,
  installed: boolean,
): StoreState =>
  active
    ? "active"
    : installed || tierOf(manifest) !== "community"
      ? "inactive"
      : "not-installed";
