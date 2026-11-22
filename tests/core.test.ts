import assert from "node:assert/strict";
import { test } from "node:test";
import { Registry } from "../src/core/registry.ts";
import { setLocale } from "../src/i18n/index.ts";
import {
  Workspace,
  initialWorkspace,
  restoreWorkspace,
} from "../src/core/workspace.ts";
import { createPersistence } from "../src/core/persistence.ts";
import { Settings, restoreSettings } from "../src/core/settings.ts";
import {
  createExtensionManager,
  restoreInstalledExtensions,
  seedCoreExtensions,
  type CatalogEntry,
} from "../src/core/extensions.ts";
import type {
  EventKey,
  SparkAPI,
  Manifest,
  ServiceKey,
} from "../src/sdk/index.ts";

setLocale("fr");

const manifest = (id: string): Manifest => ({
  id,
  name: id,
  version: "1",
});
const catalogEntry = (
  id: string,
  tier: Manifest["tier"],
  type?: string,
): CatalogEntry => {
  const definition: Manifest = {
    ...manifest(id),
    tier,
    ...(type ? { tileTypes: [type] } : {}),
  };
  return {
    manifest: definition,
    load: async () => ({
      manifest: definition,
      activate() {},
    }),
  };
};
const tile = { type: "demo.tile", title: "Demo" };
const service: ServiceKey<number> = { id: "demo.service@1" };
const event: EventKey<number> = { id: "demo.event" };
function setup(options: { activationTimeout?: number } = {}) {
  const workspace = new Workspace(initialWorkspace());
  const snapshots = new Map<string, unknown>();
  const registry = new Registry(
    {
      openTile: (type, data = {}) => workspace.addTile(type, data),
      focusTile: (id) => workspace.focusTile(id),
      updateTileData: (id, data) => workspace.updateTileData(id, data),
      getTiles: () => workspace.active().tiles,
      getAllTiles: () => workspace.get().tabs.flatMap((tab) => tab.tiles),
      getFocusedTile: () =>
        workspace
          .active()
          .tiles.find((tile) => tile.id === workspace.active().focused),
    },
    {
      read: (id) => snapshots.get(id),
      save: (id, value) => {
        snapshots.set(id, value);
      },
    },
    options,
  );
  return { workspace, registry, snapshots };
}

test("extension contributions and listeners follow activation lifecycle", async () => {
  const { registry } = setup();
  let api!: SparkAPI;
  let total = 0;
  await registry.activate({
    manifest: manifest("demo"),
    activate(spark) {
      api = spark;
      api.tiles.register(tile);
      api.services.provide(service, 7);
      api.commands.register({
        id: "demo.open",
        title: "Open",
        run: () => api.tabs.openTile(tile.type),
      });
      api.events.on(event, (value) => {
        total += value;
      });
    },
  });
  assert.equal(registry.getTile(tile.type)?.owner.id, "demo");
  assert.equal(registry.getCommands()[0].run() instanceof Object, true);
  assert.equal(api.services.get(service), 7);
  assert.equal(api.services.get({ id: "demo.service@2" }), undefined);
  api.events.emit(event, 4);
  await Promise.resolve();
  assert.equal(total, 4);
  await registry.deactivate("demo");
  api.events.emit(event, 6);
  await Promise.resolve();
  assert.equal(total, 4);
  assert.equal(api.services.get(service), undefined);
  assert.equal(registry.getTile(tile.type), undefined);
  assert.deepEqual(registry.getCommands(), []);
  assert.deepEqual(registry.getExtensions(), []);
});

test("colliding identifiers roll back partially activated extensions", async () => {
  const { registry } = setup();
  await registry.activate({
    manifest: manifest("one"),
    activate: (api) => {
      api.tiles.register(tile);
    },
  });
  await assert.rejects(
    registry.activate({
      manifest: manifest("two"),
      activate(api) {
        api.commands.register({
          id: "two.command",
          title: "Temporary",
          run() {},
        });
        api.tiles.register(tile);
      },
    }),
    /Identifiant déjà enregistré/,
  );
  assert.equal(registry.getTile(tile.type)?.owner.id, "one");
  assert.deepEqual(registry.getCommands(), []);
  assert.deepEqual(
    registry.getExtensions().map((extension) => extension.id),
    ["one"],
  );
  await assert.rejects(
    registry.activate({ manifest: manifest("one"), activate() {} }),
    /Identifiant déjà enregistré/,
  );
});

test("extensions load on demand and keep their state when disabled", async () => {
  const { registry, workspace, snapshots } = setup();
  const definition = { ...manifest("demo"), tileTypes: [tile.type] };
  let loads = 0;
  let restored: unknown;
  const catalog = [
    {
      manifest: definition,
      async load() {
        loads++;
        return {
          manifest: definition,
          activate(api: SparkAPI) {
            restored = api.state.read();
            api.tiles.register(tile);
            api.state.save({ draft: "notes" });
          },
        };
      },
    },
  ];
  const manager = createExtensionManager(
    registry,
    catalog,
    () => workspace.get().installedExtensions!,
    (installedExtensions) => workspace.patch({ installedExtensions }),
    (error) => assert.fail(String(error)),
  );

  await manager.restore();
  assert.deepEqual(manager.catalog, [definition]);
  assert.equal(loads, 0);
  await Promise.all([
    manager.setEnabled("demo", true),
    manager.setEnabled("demo", true),
  ]);
  const existing = workspace.addTile(tile.type, {});
  assert.equal(loads, 1);
  assert.deepEqual(workspace.get().installedExtensions, ["demo"]);

  await manager.setEnabled("demo", false);
  assert.deepEqual(workspace.get().installedExtensions, []);
  assert.equal(registry.getTile(tile.type), undefined);
  assert.deepEqual(workspace.active().tiles, [existing]);
  assert.deepEqual(snapshots.get("demo"), { draft: "notes" });
  assert.deepEqual(restoreInstalledExtensions([], catalog, [existing]), []);
  assert.deepEqual(restoreInstalledExtensions(undefined, catalog, [existing]), [
    "demo",
  ]);

  await manager.setEnabled("demo", true);
  assert.equal(loads, 2);
  assert.deepEqual(restored, { draft: "notes" });
});

test("un espace sans choix active le socle et récupère les tuiles existantes", () => {
  const catalog = [
    catalogEntry("core.one", "core"),
    catalogEntry("official.one", "official"),
    catalogEntry("legacy", "official", "legacy.tile"),
  ];
  const legacy = { id: "legacy-1", type: "legacy.tile", data: {} };
  assert.deepEqual(restoreInstalledExtensions(undefined, catalog, []), [
    "core.one",
  ]);
  assert.deepEqual(restoreInstalledExtensions(undefined, catalog, [legacy]), [
    "core.one",
    "legacy",
  ]);
  assert.deepEqual(restoreInstalledExtensions([], catalog, [legacy]), []);
});

test("chaque extension du socle est proposée une seule fois", () => {
  const first = seedCoreExtensions(
    ["core.one"],
    undefined,
    [
      catalogEntry("core.one", "core"),
      catalogEntry("core.two", "core"),
      catalogEntry("official.one", "official"),
    ],
    [],
  );
  assert.deepEqual(first.installed, ["core.one", "core.two"]);
  assert.deepEqual(first.seeded, ["core.one", "core.two"]);

  const disabled = seedCoreExtensions(
    ["core.one"],
    first.seeded,
    [catalogEntry("core.one", "core"), catalogEntry("core.two", "core")],
    [],
  );
  assert.deepEqual(disabled.installed, ["core.one"]);
  assert.deepEqual(disabled.seeded, first.seeded);

  const next = seedCoreExtensions(
    ["core.one"],
    first.seeded,
    [
      catalogEntry("core.one", "core"),
      catalogEntry("core.two", "core"),
      catalogEntry("core.three", "core"),
    ],
    [],
  );
  assert.deepEqual(next.installed, ["core.one", "core.three"]);
  assert.deepEqual(next.seeded, ["core.one", "core.two", "core.three"]);
});

test("a failing activation preserves the previous extension snapshot", async () => {
  const { registry, snapshots } = setup();
  const definition = manifest("demo");
  snapshots.set(definition.id, "old");
  await assert.rejects(
    registry.activate({
      manifest: definition,
      activate(api) {
        api.state.save("new");
        assert.equal(api.state.read(), "new");
        throw new Error("activation failed");
      },
    }),
    /activation failed/,
  );
  assert.equal(snapshots.get(definition.id), "old");
});

test("a tile can be updated and open a second tile in its original tab", () => {
  const workspace = new Workspace(initialWorkspace());
  const source = workspace.active().id;
  const explorer = workspace.addTile("explorer.tree", {});
  workspace.create();
  const current = workspace.active().id;
  workspace.updateTileData(explorer.id, { token: "project" });
  const tabId = workspace.tabForTile(explorer.id)!.id;
  const editor = workspace.addTile("markdown.editor", {}, tabId);
  assert.equal(workspace.active().id, current);
  assert.equal(tabId, source);
  assert.deepEqual(
    workspace.tabForTile(editor.id)?.tiles.map((tile) => tile.type),
    ["explorer.tree", "markdown.editor"],
  );
  assert.equal(
    workspace.tabForTile(explorer.id)?.tiles[0].data.token,
    "project",
  );
  workspace.focusTile(explorer.id);
  assert.equal(workspace.tabForTile(editor.id)?.focused, explorer.id);
});

test("two modes and tabs retain independent layouts and tile identities across restoration", () => {
  const { workspace } = setup();
  const first = workspace.active().id;
  const instance = workspace.addTile(tile.type, { key: "draft" });
  workspace.updateTab(first, {
    layouts: { side: { width: 240 }, tiling: { direction: "above" } },
    mode: "tiling",
  });
  workspace.create();
  assert.equal(workspace.active().tiles.length, 0);
  const restored = new Workspace(
    restoreWorkspace(JSON.parse(JSON.stringify(workspace.get()))),
  );
  restored.activate(first);
  restored.updateTab(first, { mode: "side" });
  assert.deepEqual(restored.active().tiles, [instance]);
  assert.equal(restored.active().focused, instance.id);
  assert.deepEqual(restored.active().layouts, {
    side: { width: 240 },
    tiling: { direction: "above" },
  });
});

test("les paramètres applicatifs sont restaurés et validés", () => {
  assert.deepEqual(restoreSettings(null, "fr"), {
    dev: false,
    locale: "fr",
  });
  assert.deepEqual(restoreSettings({}, "fr"), { dev: false, locale: "fr" });
  assert.deepEqual(restoreSettings({ dev: true }, "fr"), {
    dev: true,
    locale: "fr",
  });
  assert.deepEqual(restoreSettings({ dev: "oui" }, "fr"), {
    dev: false,
    locale: "fr",
  });
  assert.deepEqual(restoreSettings(["dev"], "fr"), {
    dev: false,
    locale: "fr",
  });
  const settings = new Settings(restoreSettings({ dev: true }, "fr"));
  let renders = 0;
  const unsubscribe = settings.subscribe(() => renders++);
  settings.patch({ dev: false });
  assert.equal(settings.get().dev, false);
  assert.equal(renders, 1);
  unsubscribe();
  settings.patch({ dev: true });
  assert.equal(renders, 1);
});

test("le thème transparent est conservé et validé au chargement", () => {
  const snapshot = JSON.parse(JSON.stringify(initialWorkspace()));
  assert.equal(
    restoreWorkspace({ ...snapshot, theme: "transparent" }).theme,
    "transparent",
  );
  assert.throws(
    () => restoreWorkspace({ ...snapshot, theme: "glass" }),
    /Format de l’espace Spark invalide/,
  );
});

test("les identifiants d’extension antérieurs au renommage migrent vers Spark", () => {
  const snapshot = JSON.parse(JSON.stringify(initialWorkspace()));
  const restored = restoreWorkspace({
    ...snapshot,
    installedExtensions: ["lab.explorer", "spark.terminal", "lab.explorer"],
    pinned: ["lab.markdown", "spark.explorer"],
    extensions: {
      "lab.terminal": { session: 1 },
      "lab.custom": { keep: true },
    },
  });
  assert.deepEqual(restored.installedExtensions, [
    "spark.explorer",
    "spark.terminal",
  ]);
  assert.deepEqual(restored.pinned, ["spark.markdown", "spark.explorer"]);
  assert.deepEqual(restored.extensions, {
    "spark.terminal": { session: 1 },
    "lab.custom": { keep: true },
  });
});

test("les extensions du socle déjà proposées sont conservées et validées", () => {
  const snapshot = JSON.parse(JSON.stringify(initialWorkspace()));
  const restored = restoreWorkspace({
    ...snapshot,
    seededCore: ["spark.markdown", "spark.markdown"],
  });
  assert.deepEqual(restored.seededCore, ["spark.markdown"]);
  assert.throws(
    () => restoreWorkspace({ ...snapshot, seededCore: [1] }),
    /Format de l’espace Spark invalide/,
  );
});

test("les anciennes tuiles PDF d’OpenAlex deviennent des aperçus", () => {
  const snapshot = JSON.parse(JSON.stringify(initialWorkspace()));
  snapshot.tabs[0].tiles.push({
    id: "pdf-1",
    type: "openalex.pdf",
    data: { work: "W123", url: "https://example.org/article.pdf" },
  });
  const restored = restoreWorkspace(snapshot);
  assert.equal(restored.tabs[0].tiles[0].type, "preview.pdf");
  assert.deepEqual(restored.tabs[0].tiles[0].data, {
    id: "W123",
    title: "",
    url: "https://example.org/article.pdf",
  });
});

test("a failed older write cannot overwrite a newer persisted snapshot", async () => {
  let rejectOld: (error: Error) => void = () => {};
  const written: string[] = [];
  const persistence = createPersistence(
    async (snapshot) => {
      written.push(snapshot);
      if (snapshot === "old")
        await new Promise<void>((_, reject) => {
          rejectOld = reject;
        });
    },
    (error) => assert.fail(String(error)),
  );
  persistence.queue("old");
  const failed = assert.rejects(persistence.flush(), /disk/);
  persistence.queue("new");
  const flushed = persistence.flush();
  await new Promise<void>((resolve) => setImmediate(resolve));
  rejectOld(new Error("disk"));
  await Promise.all([failed, flushed]);
  await persistence.flush();
  assert.deepEqual(written, ["old", "new"]);
});

test("une activation trop longue est interrompue", async () => {
  const { registry } = setup({ activationTimeout: 10 });
  await assert.rejects(
    registry.activate({
      manifest: manifest("slow"),
      activate: () => new Promise<void>(() => {}),
    }),
    /Activation trop longue/,
  );
  assert.deepEqual(registry.getExtensions(), []);
});
