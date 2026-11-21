import { FolderTree } from "lucide-react";
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
  summary: "Parcourez vos dossiers et ouvrez vos fichiers.",
  description:
    "Parcourez vos dossiers, ouvrez un fichier Markdown ou un PDF. Spark ne garde que les chemins que vous avez explicitement choisis.",
  category: "Fichiers",
  tagline: "Vos fichiers, sans quitter Spark.",
} satisfies Manifest;
