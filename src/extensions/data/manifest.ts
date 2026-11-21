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
} satisfies Manifest;
