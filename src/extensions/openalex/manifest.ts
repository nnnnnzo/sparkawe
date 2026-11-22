import { BookOpen } from "lucide-react";
import searchShot from "./media/openalex-search.webp";
import workShot from "./media/openalex-work.webp";
import type { Manifest } from "../../sdk/index.ts";
import { localized } from "../../core/i18n.ts";
import { SPECTRUM } from "../../shared/brand/index.tsx";

export const searchType = "openalex.search";
export const workType = "openalex.work";

export default {
  id: "spark.openalex",
  name: localized("manifest.openalex.name"),
  version: "0.1.0",
  icon: BookOpen,
  color: SPECTRUM.blue,
  tier: "official",
  tileTypes: [searchType, workType],
  certification: "spark",
  subtitle: localized("manifest.openalex.subtitle"),
  summary: localized("manifest.openalex.summary"),
  description: localized("manifest.openalex.description"),
  screenshots: [searchShot, workShot],
  category: "research",
} satisfies Manifest;
