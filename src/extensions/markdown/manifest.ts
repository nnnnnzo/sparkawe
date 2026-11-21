import { FileText } from "lucide-react";
import editorShot from "./media/markdown-editor.webp";
import previewShot from "./media/markdown-preview.webp";
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
  subtitle: "Éditeur Markdown avec aperçu",
  summary:
    "Édite un fichier Markdown et affiche son rendu dans une tuile voisine.",
  description:
    "L’éditeur lit et écrit directement le fichier choisi. L’aperçu se met à jour pendant la frappe. Une confirmation est demandée avant de fermer un document modifié.",
  screenshots: [editorShot, previewShot],
  category: "Écriture",
} satisfies Manifest;
