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
  tileTypes: [sessionType],
} satisfies Manifest;
