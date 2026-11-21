import { BookOpen } from "lucide-react";
import type { Manifest } from "../../sdk/index.ts";
import { SPECTRUM } from "../../shared/brand/index.tsx";

export const searchType = "openalex.search";
export const workType = "openalex.work";

export default {
  id: "spark.openalex",
  name: "OpenAlex",
  version: "0.1.0",
  icon: BookOpen,
  color: SPECTRUM.blue,
  tier: "official",
  tileTypes: [searchType, workType],
  certification: "spark",
  summary: "Cherchez des travaux scientifiques et ouvrez leurs PDF libres.",
  description:
    "Cherchez des travaux scientifiques, parcourez les métadonnées et ouvrez les PDF libres dans l’aperçu. Aucune clé n’est nécessaire.",
  category: "Recherche",
  tagline: "La recherche scientifique ouverte.",
} satisfies Manifest;
