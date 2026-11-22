import { Table2 } from "lucide-react";
import tableShot from "./media/data-table.webp";
import chartShot from "./media/data-chart.webp";
import type { Manifest } from "../../sdk/index.ts";
import { localized } from "../../core/i18n.ts";
import { SPECTRUM } from "../../shared/brand/index.tsx";

export const tableType = "data.table";
export const chartType = "data.chart";

export default {
  id: "spark.data",
  name: localized("manifest.data.name"),
  version: "0.1.0",
  icon: Table2,
  color: SPECTRUM.cyan,
  tier: "core",
  tileTypes: [tableType, chartType],
  certification: "spark",
  subtitle: localized("manifest.data.subtitle"),
  summary: localized("manifest.data.summary"),
  description: localized("manifest.data.description"),
  screenshots: [tableShot, chartShot],
  category: "data",
} satisfies Manifest;
