import type { ExtensionTier, Manifest } from "../../sdk/index.ts";

export type StoreView = "home" | "updates" | "installed" | "sources";

export type StoreRoute =
  | { view: StoreView }
  | { view: "detail"; id: string };

export const FEATURED_IDS = [
  "spark.terminal",
  "spark.data",
  "spark.markdown",
  "spark.explorer",
  "spark.openalex",
  "spark.preview",
] as const;

export const TIER_LABEL: Record<ExtensionTier, string> = {
  core: "Intégrée",
  official: "Officielle",
  community: "Communauté",
};

export const TIER_SECTION: Record<ExtensionTier, string> = {
  core: "Le socle",
  official: "Officielles",
  community: "Communauté",
};

export const tierOf = (manifest: Manifest): ExtensionTier =>
  manifest.tier ?? "core";

export const isCertified = (manifest: Manifest) =>
  manifest.certification === "spark";

/** Recherche insensible aux accents et à la casse. */
export const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr");

export function matchesQuery(manifest: Manifest, query: string) {
  const needle = normalize(query.trim());
  if (!needle) return true;
  return normalize(
    [
      manifest.name,
      manifest.summary,
      manifest.description,
      manifest.category,
      manifest.tagline,
      manifest.id,
    ]
      .filter(Boolean)
      .join(" "),
  ).includes(needle);
}

export const stateLabel = (
  manifest: Manifest,
  active: boolean,
  installed: boolean,
) =>
  active
    ? "Active"
    : installed || tierOf(manifest) !== "community"
      ? "Inactive"
      : "Non installée";
