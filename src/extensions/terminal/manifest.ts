import { Terminal } from "lucide-react";
import type { Manifest } from "../../sdk/index.ts";
import { SPECTRUM } from "../../shared/brand/index.tsx";

export const sessionType = "terminal.session";

export default {
  id: "spark.terminal",
  name: "Terminal",
  version: "0.1.0",
  icon: Terminal,
  color: SPECTRUM.blue,
  tier: "core",
  tileTypes: [sessionType],
  certification: "spark",
  summary: "Un shell complet dans une tuile, sans quitter l’espace.",
  description:
    "Ouvrez un shell complet dans une tuile. Spark garde la session vivante quand vous changez d’onglet, et les agents peuvent ouvrir un terminal dans un dossier précis.",
  category: "Développement",
  tagline: "Un vrai shell, dans une tuile.",
} satisfies Manifest;
