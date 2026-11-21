import { Terminal } from "lucide-react";
import type { Manifest } from "../../sdk/index.ts";

export const sessionType = "terminal.session";

export default {
  id: "lab.terminal",
  name: "Terminal",
  version: "0.1.0",
  icon: Terminal,
  color: "#6DA8F5",
  tileTypes: [sessionType],
} satisfies Manifest;
