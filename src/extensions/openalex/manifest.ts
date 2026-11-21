import { BookOpen } from "lucide-react";
import type { Manifest } from "../../sdk/index.ts";

export const searchType = "openalex.search";
export const workType = "openalex.work";

export default {
  id: "spark.openalex",
  name: "OpenAlex",
  version: "0.1.0",
  icon: BookOpen,
  tier: "official",
  tileTypes: [searchType, workType],
} satisfies Manifest;
