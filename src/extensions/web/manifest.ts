import { Globe } from "lucide-react";
import { localized } from "../../core/i18n.ts";
import type { Manifest } from "../../sdk/index.ts";
import { SPECTRUM } from "../../shared/brand/index.tsx";

export const pageType = "web.page";

export default {
  id: "spark.web",
  name: localized("manifest.web.name"),
  version: "0.1.0",
  icon: Globe,
  color: SPECTRUM.cyan,
  tier: "core",
  tileTypes: [pageType],
  certification: "spark",
  subtitle: localized("manifest.web.subtitle"),
  summary: localized("manifest.web.summary"),
  description: localized("manifest.web.description"),
  category: "reading",
} satisfies Manifest;
