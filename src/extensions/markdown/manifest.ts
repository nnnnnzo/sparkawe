import { FileText } from "lucide-react";
import type { Manifest } from "../../sdk/index.ts";
import { SPECTRUM } from "../../shared/brand/index.tsx";

export const editorType = "markdown.editor";
export const previewType = "markdown.preview";

export default {
  id: "spark.markdown",
  name: "Markdown",
  version: "0.1.0",
  icon: FileText,
  color: SPECTRUM.coral,
  tileTypes: [editorType, previewType],
} satisfies Manifest;
