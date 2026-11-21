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
  tileTypes: [explorerType],
} satisfies Manifest;
