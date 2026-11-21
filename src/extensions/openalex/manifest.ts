import { BookOpen } from "lucide-react";
import screenshot from "./media/openalex.webp";
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
  subtitle: "Recherche scientifique",
  summary:
    "Cherche des travaux OpenAlex et ouvre les PDF libres dans l’aperçu.",
  description:
    "La recherche interroge l’API OpenAlex. Les résultats affichent les auteurs, l’année et le DOI. Quand un PDF libre est disponible, il s’ouvre dans l’aperçu.",
  screenshots: [screenshot],
  category: "Recherche",
} satisfies Manifest;
