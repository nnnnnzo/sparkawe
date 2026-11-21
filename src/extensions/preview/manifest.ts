import { FileSearch } from "lucide-react";
import type { Manifest } from "../../sdk/index.ts";
import { SPECTRUM } from "../../shared/brand/index.tsx";

export const pdfType = "preview.pdf";

export default {
  id: "spark.preview",
  name: "Aperçu",
  version: "0.1.0",
  icon: FileSearch,
  color: SPECTRUM.lime,
  tier: "core",
  tileTypes: [pdfType],
  certification: "spark",
  summary: "Lisez les PDF dans une tuile, avec zoom et cache local.",
  description:
    "Lisez les PDF dans une tuile, avec zoom et chargement paresseux. Les fichiers sont mis en cache localement, sans les renvoyer ailleurs.",
  category: "Lecture",
  tagline: "Un PDF, directement dans l’espace.",
} satisfies Manifest;
