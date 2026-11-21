import { invoke } from "@tauri-apps/api/core";
import { buildBrief } from "../core/brief.ts";
import {
  createExtensionManager,
  seedCoreExtensions,
} from "../core/extensions.ts";
import { Journal, type JournalSource } from "../core/journal.ts";
import { createPersistence } from "../core/persistence.ts";
import { Registry } from "../core/registry.ts";
import { Settings, restoreSettings } from "../core/settings.ts";
import {
  Workspace,
  restoreWorkspace,
  initialWorkspace,
  type WorkspaceState,
} from "../core/workspace.ts";
import type { Data, Tile } from "../sdk/index.ts";
import { TileViews } from "../ui/contracts.ts";
import { report } from "../ui/errors.ts";
import { discoverExtensions, installedEntry } from "./extensions.ts";
import type { InstalledRecord } from "./installed.ts";
import { Marketplace } from "./marketplace.ts";

export async function createRuntime() {
  let state: WorkspaceState;
  let recovery = false;
  try {
    const snapshot = await invoke<string | null>("workspace_load");
    const parsed = snapshot ? JSON.parse(snapshot) : null;
    state = restoreWorkspace(parsed);
  } catch (error) {
    report(error);
    state = initialWorkspace();
    recovery = true;
  }

  const views = new TileViews();
  const catalog = await discoverExtensions(views);
  const snapshots = new Map(Object.entries(state.extensions ?? {}));
  const journal = new Journal();
  let savedSettings: unknown = null;
  try {
    const snapshot = await invoke<string | null>("settings_load");
    savedSettings = snapshot ? JSON.parse(snapshot) : null;
  } catch (error) {
    report(error);
  }
  const settings = new Settings(restoreSettings(savedSettings));
  const settingsPersistence = createPersistence(
    (snapshot) => invoke("settings_save", { snapshot }),
    report,
  );
  settings.subscribe(() =>
    settingsPersistence.queue(JSON.stringify(settings.get())),
  );
  const seed = seedCoreExtensions(
    state.installedExtensions,
    state.seededCore,
    catalog,
    state.tabs.flatMap((tab) => tab.tiles),
  );
  const workspace = new Workspace(
    {
      ...state,
      installedExtensions: seed.installed,
      seededCore: seed.seeded,
    },
    journal.record,
  );
  const persistence = createPersistence(
    (snapshot) => invoke("workspace_save", { snapshot, recovery }),
    report,
  );
  function queue() {
    persistence.queue(
      JSON.stringify({
        ...workspace.get(),
        extensions: Object.fromEntries(snapshots),
      }),
    );
  }
  const getAllTiles = () => workspace.get().tabs.flatMap((tab) => tab.tiles);
  const registry = new Registry(
    {
      openTile(type: string, data: Data = {}, alongside?: string): Tile {
        const definition = registry.getTile(type);
        if (!definition) throw new Error(`Tuile indisponible : ${type}`);
        const tab = alongside
          ? workspace.tabForTile(alongside)
          : workspace.active();
        if (!tab) throw new Error("La tuile d’origine a été fermée.");
        return workspace.addTile(
          type,
          definition.prepare?.(data) ?? data,
          tab.id,
        );
      },
      focusTile: (id) => workspace.focusTile(id),
      updateTileData: (id, data) => workspace.updateTileData(id, data),
      getTiles: () => workspace.active().tiles,
      getAllTiles,
      getFocusedTile: () => {
        const tab = workspace.active();
        return tab.tiles.find((tile) => tile.id === tab.focused);
      },
    },
    {
      read: (id) => structuredClone(snapshots.get(id)),
      save(id, value) {
        // Validate and detach the snapshot before replacing the previous value.
        const json = JSON.stringify(value);
        if (json === undefined) snapshots.delete(id);
        else snapshots.set(id, JSON.parse(json));
        queue();
      },
    },
    {
      record: journal.record,
      tabForTile: (tileId) => workspace.tabForTile(tileId)?.id,
    },
  );
  async function installEntry(source: string) {
    const record = await invoke<InstalledRecord>("extension_install", {
      source,
    });
    return installedEntry(record, views);
  }
  async function removeEntry(id: string) {
    await invoke("extension_remove", { id });
  }
  const extensions = createExtensionManager(
    registry,
    catalog,
    () => workspace.get().installedExtensions ?? [],
    (installedExtensions) => workspace.patch({ installedExtensions }),
    report,
    installEntry,
    removeEntry,
  );
  await extensions.restore();
  const marketplace = new Marketplace();
  marketplace.setInstaller(async (remote) => {
    const record = await invoke<InstalledRecord>("extension_install_zip", {
      url: remote.version.url,
      sha256: remote.version.sha256,
      source: remote.source.url,
    });
    return extensions.addEntry(installedEntry(record, views));
  });
  void marketplace.restore().catch(report);
  workspace.subscribe(queue);

  let closing = false;
  return {
    workspace,
    registry,
    extensions,
    marketplace,
    views,
    persistence,
    journal,
    settings,
    brief(tabId?: string) {
      return buildBrief({ workspace, catalog: registry, journal }, tabId);
    },
    /** Exécute une suite d'actions en attribuant leurs effets à une source. */
    async runAs<T>(source: JournalSource, run: () => T | Promise<T>) {
      const previous = workspace.source;
      workspace.source = source;
      try {
        return await run();
      } finally {
        workspace.source = previous;
      }
    },
    async closeTiles(ids: string[], apply: () => void) {
      if (closing) return false;
      closing = true;
      try {
        const tiles = getAllTiles().filter((tile) => ids.includes(tile.id));
        const closingIds = new Set(ids);
        for (const tile of tiles) {
          if (
            (await registry
              .getTile(tile.type)
              ?.canClose?.(tile, closingIds)) === false
          )
            return false;
        }
        apply();
        for (const tile of tiles) {
          try {
            await registry.getTile(tile.type)?.close?.(tile);
          } catch (error) {
            report(error);
          } finally {
            registry.clearSurface(tile.id);
          }
        }
        return true;
      } finally {
        closing = false;
      }
    },
  };
}

export type Runtime = Awaited<ReturnType<typeof createRuntime>>;
