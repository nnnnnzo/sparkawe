import { Terminal } from "lucide-react";
import screenshot from "./media/terminal.webp";
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
  subtitle: "Shell zsh persistant",
  summary:
    "Ouvre un shell zsh dans une tuile. La session reste active quand vous changez d’onglet.",
  description:
    "Le terminal démarre dans le dossier choisi. Il conserve la session lors du changement d’onglet et se ferme avec la tuile. Les agents peuvent ouvrir un terminal dans un dossier précis.",
  screenshots: [screenshot],
  category: "Développement",
} satisfies Manifest;
