import { FileSearch } from "lucide-react";
import screenshot from "./media/preview.webp";
import type { Manifest } from "../../sdk/index.ts";
import { localized } from "../../core/i18n.ts";
import { SPECTRUM } from "../../shared/brand/index.tsx";

export const pdfType = "preview.pdf";

export default {
  id: "spark.preview",
  name: localized("manifest.preview.name"),
  version: "0.1.0",
  icon: FileSearch,
  color: SPECTRUM.honey,
  tier: "core",
  tileTypes: [pdfType],
  certification: "spark",
  subtitle: localized("manifest.preview.subtitle"),
  summary: localized("manifest.preview.summary"),
  description: localized("manifest.preview.description"),
  screenshots: [screenshot],
  category: "reading",
} satisfies Manifest;
