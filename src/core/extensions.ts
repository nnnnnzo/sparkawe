import type { LabExtension, Manifest, Tile } from "../sdk/index.ts";
import type { Registry } from "./registry.ts";

export interface CatalogEntry {
  manifest: Manifest;
  load(): Promise<LabExtension>;
}

export function restoreInstalledExtensions(
  saved: string[] | undefined,
  catalog: CatalogEntry[],
  tiles: Tile[],
): string[] {
  if (saved) return [...new Set(saved)];
  // Older workspaces had extensions enabled implicitly. Recover those in use.
  const types = new Set(tiles.map((tile) => tile.type));
  return catalog
    .filter(({ manifest }) =>
      manifest.tileTypes?.some((type) => types.has(type)),
    )
    .map(({ manifest }) => manifest.id);
}

export function createExtensionManager(
  registry: Registry,
  catalog: CatalogEntry[],
  getInstalled: () => string[],
  saveInstalled: (ids: string[]) => void,
  onError: (error: unknown) => void,
) {
  const entries = new Map<string, CatalogEntry>();
  for (const entry of catalog) {
    const { id } = entry.manifest;
    if (entries.has(id)) throw new Error(`Extension en double : ${id}`);
    entries.set(id, entry);
  }
  const pending = new Set<string>();
  const isActive = (id: string) =>
    registry.getExtensions().some((manifest) => manifest.id === id);

  async function enable(entry: CatalogEntry) {
    if (!isActive(entry.manifest.id))
      await registry.activate(await entry.load());
  }

  return {
    catalog: catalog.map(({ manifest }) => manifest),
    async restore() {
      for (const id of getInstalled()) {
        const entry = entries.get(id);
        if (!entry) continue;
        try {
          await enable(entry);
        } catch (error) {
          onError(error);
        }
      }
    },
    async setEnabled(id: string, enabled: boolean) {
      const entry = entries.get(id);
      if (!entry || pending.has(id)) return;
      pending.add(id);
      try {
        if (enabled) {
          await enable(entry);
          saveInstalled([...new Set([...getInstalled(), id])]);
        } else {
          try {
            await registry.deactivate(id);
          } finally {
            saveInstalled(
              getInstalled().filter((installed) => installed !== id),
            );
          }
        }
      } finally {
        pending.delete(id);
      }
    },
  };
}
