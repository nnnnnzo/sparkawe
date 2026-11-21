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
} satisfies Manifest;
