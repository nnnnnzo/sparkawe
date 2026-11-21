import { Table2 } from "lucide-react";
import screenshot from "./media/data.webp";
import type { Manifest } from "../../sdk/index.ts";
import { SPECTRUM } from "../../shared/brand/index.tsx";

export const tableType = "data.table";
export const chartType = "data.chart";

export default {
  id: "spark.data",
  name: "Données",
  version: "0.1.0",
  icon: Table2,
  color: SPECTRUM.cyan,
  tier: "core",
  tileTypes: [tableType, chartType],
  certification: "spark",
  subtitle: "Tableaux, CSV et graphiques",
  summary:
    "Crée des tableaux, importe des CSV et affiche des graphiques.",
  description:
    "Les tableaux acceptent le copier-coller TSV et les fichiers CSV. Les graphiques se lient à un tableau. Les données restent dans l’espace et sont exposées aux agents par des actions bornées.",
  screenshots: [screenshot],
  category: "Données",
} satisfies Manifest;
