import { FileSearch } from "lucide-react";
import screenshot from "./media/preview.webp";
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
  subtitle: "Lecteur PDF",
  summary:
    "Affiche un PDF avec zoom et chargement page par page.",
  description:
    "Le fichier est téléchargé dans le cache local puis rendu avec pdf.js. Le zoom et le défilement restent dans la tuile. Le PDF n’est pas renvoyé ailleurs.",
  screenshots: [screenshot],
  category: "Lecture",
} satisfies Manifest;
