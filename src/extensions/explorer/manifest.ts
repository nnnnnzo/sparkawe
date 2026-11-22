import { FolderTree } from "lucide-react";
import screenshot from "./media/explorer.webp";
import type { Manifest } from "../../sdk/index.ts";
import { localized } from "../../core/i18n.ts";
import { SPECTRUM } from "../../shared/brand/index.tsx";

export const explorerType = "explorer.tree";

export default {
  id: "spark.explorer",
  name: localized("manifest.explorer.name"),
  version: "0.1.0",
  icon: FolderTree,
  color: SPECTRUM.violet,
  tier: "core",
  tileTypes: [explorerType],
  certification: "spark",
  subtitle: localized("manifest.explorer.subtitle"),
  summary: localized("manifest.explorer.summary"),
  description: localized("manifest.explorer.description"),
  screenshots: [screenshot],
  category: "files",
} satisfies Manifest;
