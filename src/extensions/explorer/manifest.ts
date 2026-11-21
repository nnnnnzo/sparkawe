import { FolderTree } from "lucide-react";
import type { Manifest } from "../../sdk/index.ts";

export const explorerType = "explorer.tree";

export default {
  id: "lab.explorer",
  name: "Explorateur",
  version: "0.1.0",
  icon: FolderTree,
  color: "#86CDB7",
  tileTypes: [explorerType],
} satisfies Manifest;
