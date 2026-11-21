import { FileText } from "lucide-react";
import type { Manifest } from "../../sdk/index.ts";

export const editorType = "markdown.editor";
export const previewType = "markdown.preview";

export default {
  id: "lab.markdown",
  name: "Markdown",
  version: "0.1.0",
  icon: FileText,
  color: "#E8AD58",
  tileTypes: [editorType, previewType],
} satisfies Manifest;
