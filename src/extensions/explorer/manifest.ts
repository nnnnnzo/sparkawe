import { FolderTree } from "lucide-react";
import screenshot from "./media/explorer.webp";
import type { Manifest } from "../../sdk/index.ts";
import { SPECTRUM } from "../../shared/brand/index.tsx";

export const explorerType = "explorer.tree";

export default {
  id: "spark.explorer",
  name: "Explorateur",
  version: "0.1.0",
  icon: FolderTree,
  color: SPECTRUM.violet,
  tier: "core",
  tileTypes: [explorerType],
  certification: "spark",
  subtitle: "Arborescence de fichiers",
  summary:
    "Parcourt les dossiers autorisés et ouvre les fichiers dans Spark.",
  description:
    "L’explorateur affiche les dossiers que vous avez choisis. Il ouvre les fichiers Markdown dans l’éditeur et les PDF dans l’aperçu. Aucun autre chemin n’est accessible.",
  screenshots: [screenshot],
  category: "Fichiers",
} satisfies Manifest;
