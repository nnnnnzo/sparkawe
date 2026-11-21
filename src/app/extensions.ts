import type { CatalogEntry } from "../core/extensions.ts";
import type { Manifest } from "../sdk/index.ts";
import type { ExtensionModule } from "../sdk/react.ts";
import type { TileViews } from "../ui/contracts.ts";

const manifests = import.meta.glob<Manifest>("../extensions/*/manifest.ts", {
  eager: true,
  import: "default",
});
const factories = import.meta.glob<() => ExtensionModule>(
  "../extensions/*/index.{ts,tsx}",
  { import: "default" },
);

export function discoverExtensions(views: TileViews): CatalogEntry[] {
  return Object.entries(manifests).map(([path, manifest]) => ({
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
}
