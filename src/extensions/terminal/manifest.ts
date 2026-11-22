import { Terminal } from "lucide-react";
import screenshot from "./media/terminal.webp";
import type { Manifest } from "../../sdk/index.ts";
import { localized } from "../../core/i18n.ts";
import { SPECTRUM } from "../../shared/brand/index.tsx";

export const sessionType = "terminal.session";

export default {
  id: "spark.terminal",
  name: localized("manifest.terminal.name"),
  version: "0.1.0",
  icon: Terminal,
  color: SPECTRUM.blue,
  tier: "core",
  tileTypes: [sessionType],
  certification: "spark",
  subtitle: localized("manifest.terminal.subtitle"),
  summary: localized("manifest.terminal.summary"),
  description: localized("manifest.terminal.description"),
  screenshots: [screenshot],
  category: "development",
} satisfies Manifest;
