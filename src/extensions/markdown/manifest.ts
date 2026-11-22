import { FileText } from "lucide-react";
import editorShot from "./media/markdown-editor.webp";
import previewShot from "./media/markdown-preview.webp";
import type { Manifest } from "../../sdk/index.ts";
import { localized } from "../../core/i18n.ts";
import { SPECTRUM } from "../../shared/brand/index.tsx";

export const editorType = "markdown.editor";
export const previewType = "markdown.preview";

export default {
  id: "spark.markdown",
  name: localized("manifest.markdown.name"),
  version: "0.1.0",
  icon: FileText,
  color: SPECTRUM.coral,
  tier: "core",
  tileTypes: [editorType, previewType],
  certification: "spark",
  subtitle: localized("manifest.markdown.subtitle"),
  summary: localized("manifest.markdown.summary"),
  description: localized("manifest.markdown.description"),
  screenshots: [editorShot, previewShot],
  category: "writing",
} satisfies Manifest;
