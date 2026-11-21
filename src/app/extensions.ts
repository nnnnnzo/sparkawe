import { invoke } from "@tauri-apps/api/core";
import type { CatalogEntry } from "../core/extensions.ts";
import type { Manifest } from "../sdk/index.ts";
import type { ExtensionModule } from "../sdk/react.ts";
import type { TileViews } from "../ui/contracts.ts";
import { report } from "../ui/errors.ts";
import {
  installedManifest,
  loadInstalledExtension,
  type InstalledRecord,
} from "./installed.ts";

const manifests = import.meta.glob<Manifest>("../extensions/*/manifest.ts", {
  eager: true,
  import: "default",
});
const factories = import.meta.glob<() => ExtensionModule>(
  "../extensions/*/index.{ts,tsx}",
  { import: "default" },
);

export function installedEntry(
  record: InstalledRecord,
  views: TileViews,
): CatalogEntry {
  return {
    manifest: installedManifest(record),
    load: () => loadInstalledExtension(record, views),
  };
}

export async function discoverExtensions(
  views: TileViews,
): Promise<CatalogEntry[]> {
  const builtIn = Object.entries(manifests).map(([path, manifest]) => ({
    manifest,
    async load() {
      const directory = path.slice(0, -"/manifest.ts".length);
      const load =
        factories[`${directory}/index.ts`] ??
        factories[`${directory}/index.tsx`];
      if (!load) throw new Error(`Module introuvable : ${manifest.name}`);
      return views.adapt(manifest, (await load())());
    },
  }));

  let installed: InstalledRecord[] = [];
  try {
    installed = await invoke<InstalledRecord[]>("extension_list");
  } catch (error) {
    // Une ancienne build sans commande d’import ne doit pas empêcher le socle
    // de démarrer.
    report(error);
  }

  return [
    ...builtIn,
    ...installed.map((record) => installedEntry(record, views)),
  ];
}
