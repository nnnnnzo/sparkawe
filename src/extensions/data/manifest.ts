import { Table2 } from "lucide-react";
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
  summary: "Tableaux, graphiques et import CSV dans le même espace.",
  description:
    "Créez des tableaux, importez des CSV et affichez des graphiques. Les données restent dans l’espace et sont exposées aux agents par des actions bornées.",
  category: "Données",
  tagline: "Tableaux et graphiques, dans le même espace.",
} satisfies Manifest;
