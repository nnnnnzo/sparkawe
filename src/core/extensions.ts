import type { SparkExtension, Manifest, Tile } from "../sdk/index.ts";
import type { Registry } from "./registry.ts";

export interface CatalogEntry {
  manifest: Manifest;
  load(): Promise<SparkExtension>;
}

export function restoreInstalledExtensions(
  saved: string[] | undefined,
  catalog: CatalogEntry[],
  tiles: Tile[],
): string[] {
  if (saved) return [...new Set(saved)];
  // Sans choix enregistré, un espace neuf active le socle. Un espace antérieur
  // au système d'extensions récupère en plus celles qui ont déjà des tuiles.
  const types = new Set(tiles.map((tile) => tile.type));
  return catalog
    .filter(
      ({ manifest }) =>
        (manifest.tier ?? "core") === "core" ||
        manifest.tileTypes?.some((type) => types.has(type)),
    )
    .map(({ manifest }) => manifest.id);
}

/**
 * Propose chaque extension du socle une seule fois à un espace. Une extension
 * désactivée après avoir été proposée reste désactivée ; une nouvelle
 * intégrée arrive active sans réactiver les précédentes.
 */
export function seedCoreExtensions(
  saved: string[] | undefined,
  seeded: string[] | undefined,
  catalog: CatalogEntry[],
  tiles: Tile[],
): { installed: string[]; seeded: string[] } {
  const known = new Set(seeded ?? []);
  const core = catalog
    .filter(({ manifest }) => (manifest.tier ?? "core") === "core")
    .map(({ manifest }) => manifest.id);
  const fresh = core.filter((id) => !known.has(id));
  const installed = restoreInstalledExtensions(saved, catalog, tiles);
  return {
    installed: [...new Set([...installed, ...fresh])],
    seeded: [...new Set([...known, ...core])],
  };
}

export function createExtensionManager(
  registry: Registry,
  catalog: CatalogEntry[],
  getInstalled: () => string[],
  saveInstalled: (ids: string[]) => void,
  onError: (error: unknown) => void,
  installEntry: (source: string) => Promise<CatalogEntry> = async () => {
    throw new Error("Installation indisponible.");
  },
) {
  const entries = new Map<string, CatalogEntry>();
  for (const entry of catalog) {
    const { id } = entry.manifest;
    if (entries.has(id)) throw new Error(`Extension en double : ${id}`);
    entries.set(id, entry);
  }
  const pending = new Set<string>();
  const catalogListeners = new Set<() => void>();
  let catalogVersion = 0;
  const isActive = (id: string) =>
    registry.getExtensions().some((manifest) => manifest.id === id);
  const notifyCatalog = () => {
    catalogVersion += 1;
    for (const listener of catalogListeners) listener();
  };

  async function enable(entry: CatalogEntry) {
    if (!isActive(entry.manifest.id))
      await registry.activate(await entry.load());
  }

  return {
    get catalog() {
      return [...entries.values()].map(({ manifest }) => manifest);
    },
    get catalogVersion() {
      return catalogVersion;
    },
    subscribeCatalog(listener: () => void) {
      catalogListeners.add(listener);
      return () => {
        catalogListeners.delete(listener);
      };
    },
    async restore() {
      for (const id of getInstalled() ?? []) {
        const entry = entries.get(id);
        if (!entry) continue;
        try {
          await enable(entry);
        } catch (error) {
          onError(error);
        }
      }
    },
    async install(source: string) {
      const entry = await installEntry(source);
      entries.set(entry.manifest.id, entry);
      try {
        if (isActive(entry.manifest.id))
          await registry.deactivate(entry.manifest.id);
        await enable(entry);
        saveInstalled([
          ...new Set([...(getInstalled() ?? []), entry.manifest.id]),
        ]);
      } finally {
        notifyCatalog();
      }
      return entry.manifest;
    },
    async setEnabled(id: string, enabled: boolean) {
      const entry = entries.get(id);
      if (!entry || pending.has(id)) return;
      pending.add(id);
      try {
        if (enabled) {
          await enable(entry);
          saveInstalled([...new Set([...(getInstalled() ?? []), id])]);
        } else {
          try {
            await registry.deactivate(id);
          } finally {
            saveInstalled(
              (getInstalled() ?? []).filter((installed) => installed !== id),
            );
          }
        }
      } finally {
        pending.delete(id);
      }
    },
  };
}
