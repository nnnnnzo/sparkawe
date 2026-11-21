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
  tier: "core",
  tileTypes: [editorType, previewType],
  certification: "spark",
  summary: "Écrivez et prévisualisez vos documents côte à côte.",
  description:
    "Un éditeur Markdown et son aperçu, dans le même espace. Les documents sont lus et écrits directement sur le disque, avec une confirmation avant de fermer un fichier modifié.",
  category: "Écriture",
  tagline: "Écrivez et prévisualisez côte à côte.",
} satisfies Manifest;
