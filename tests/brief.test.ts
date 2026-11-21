import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBrief } from "../src/core/brief.ts";
import { Journal, summarize } from "../src/core/journal.ts";
import { Registry } from "../src/core/registry.ts";
import { Workspace, initialWorkspace } from "../src/core/workspace.ts";
import type { LabAPI, Manifest } from "../src/sdk/index.ts";

const manifest = (id: string): Manifest => ({
  id,
  name: id,
  version: "1",
});

function setup() {
  const journal = new Journal();
  const workspace = new Workspace(initialWorkspace(), journal.record);
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
    {
      record: journal.record,
      tabForTile: (tileId) => workspace.tabForTile(tileId)?.id,
    },
  );
  return { journal, workspace, registry };
}

test("le journal ordonne, borne et reprend les événements", () => {
  const journal = new Journal(3);
  journal.record({ kind: "a" });
  journal.record({ kind: "b", source: "agent" });
  journal.record({ kind: "c" });
  const last = journal.record({ kind: "d" });
  assert.equal(last.seq, 4);
  assert.equal(last.at > 0, true);
  assert.deepEqual(
    journal.list().map((entry) => entry.kind),
    ["b", "c", "d"],
  );
  assert.deepEqual(
    journal.since(2).map((entry) => entry.kind),
    ["c", "d"],
  );
  assert.deepEqual(
    journal.since(3, 1).map((entry) => entry.kind),
    ["d"],
  );
  assert.equal(journal.lastSeq, 4);
  assert.equal(journal.list(2).length, 2);
});

test("un résumé borné ne transporte jamais un document entier", () => {
  const document = "x".repeat(500);
  assert.equal(String(summarize(document)).includes("500 caractères"), true);
  assert.deepEqual(summarize({ path: "a.md", text: document }), {
    path: "a.md",
    text: `${"x".repeat(160)}… (500 caractères)`,
  });
  assert.deepEqual(summarize([1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(summarize([1, 2, 3, 4, 5, 6]), ["6 entrées"]);
});

test("le workspace journalise ses changements structurels", () => {
  const records: { kind: string }[] = [];
  const workspace = new Workspace(initialWorkspace(), (record) =>
    records.push(record),
  );
  const first = workspace.active().id;
  const tile = workspace.addTile("demo.tile", {});
  workspace.create();
  workspace.activate(first);
  workspace.focusTile(tile.id);
  workspace.removeTile(first, tile.id);
  assert.deepEqual(
    records.map((record) => record.kind),
    ["tile.open", "tab.create", "tab.activate", "tile.close"],
  );
});

test("le brief décrit l’onglet actif et filtre le bruit", async () => {
  const { journal, workspace, registry } = setup();
  await registry.activate({
    manifest: manifest("demo"),
    activate(api) {
      api.tiles.register({
        type: "demo.tile",
        title: "Démo",
        describe: (tile) => `dossier ${tile.data.directory}`,
      });
    },
  });
  const tab = workspace.active();
  const tile = workspace.addTile("demo.tile", { directory: "~/Lab" });
  workspace.focusTile(tile.id);
  journal.record({ kind: "tile.focus", tabId: tab.id, tileId: tile.id });
  journal.record({
    kind: "event:demo.saved",
    tabId: tab.id,
    source: "agent",
    data: { path: "notes.md" },
  });
  workspace.create();

  const brief = buildBrief({ workspace, catalog: registry, journal }, tab.id);
  assert.equal(brief.tab.name, "Espace 1");
  assert.equal(brief.tab.active, false);
  assert.equal(brief.tab.focused, tile.id);
  assert.deepEqual(brief.tab.tiles, [
    { id: tile.id, type: "demo.tile", title: "Démo", summary: "dossier ~/Lab" },
  ]);
  assert.deepEqual(
    brief.events.map((entry) => entry.kind),
    ["tile.open", "event:demo.saved"],
  );
  assert.deepEqual(
    brief.others.map((other) => other.name),
    ["Espace 2"],
  );
  assert.equal(brief.text.includes("Démo — dossier ~/Lab (focus)"), true);
  assert.equal(brief.text.includes("(agent)"), true);
  assert.equal(brief.lastSeq, journal.lastSeq);
});

test("une surface volatile alimente le brief et reste bornée", async () => {
  const { journal, workspace, registry } = setup();
  let api!: LabAPI;
  await registry.activate({
    manifest: manifest("demo"),
    activate(lab) {
      api = lab;
      api.tiles.register({
        type: "demo.tile",
        title: "Démo",
        describe: (_tile, surface) => `sélection ${surface.selection}`,
      });
    },
  });
  const tile = workspace.addTile("demo.tile", {});
  api.tiles.publish(tile.id, { selection: "src/ui/shell.tsx", kind: "file" });
  assert.deepEqual(registry.surface(tile.id), {
    selection: "src/ui/shell.tsx",
    kind: "file",
  });
  const brief = buildBrief({ workspace, catalog: registry, journal });
  assert.equal(brief.tab.tiles[0].summary, "sélection src/ui/shell.tsx");
  assert.equal(brief.text.includes("sélection src/ui/shell.tsx"), true);

  assert.throws(
    () => api.tiles.publish(tile.id, { selection: "x".repeat(2100) }),
    /résumé, pas un contenu/,
  );
  api.tiles.publish("absent", { selection: "x" });

  await registry.activate({
    manifest: manifest("other"),
    activate(other) {
      other.tiles.register({ type: "other.tile", title: "Autre" });
    },
  });
  const theirs = workspace.addTile("other.tile", {});
  assert.throws(
    () => api.tiles.publish(theirs.id, { selection: "x" }),
    /Tuile d’une autre extension/,
  );

  await registry.deactivate("demo");
  assert.equal(registry.surface(tile.id), undefined);
});

test("le brief refuse un onglet inconnu", () => {
  const { journal, workspace, registry } = setup();
  assert.throws(
    () => buildBrief({ workspace, catalog: registry, journal }, "absent"),
    /Onglet inconnu/,
  );
});

test("une tuile expose des actions typées et validées", async () => {
  const { workspace, registry } = setup();
  let received: unknown;
  await registry.activate({
    manifest: manifest("demo"),
    activate(api) {
      api.tiles.register({
        type: "demo.tile",
        title: "Démo",
        actions: {
          bump: {
            title: "Incrémenter",
            input: { by: { type: "number" } },
            run: (_tile, input) => {
              received = input.by;
              return { ok: true };
            },
          },
        },
      });
    },
  });
  const tile = workspace.addTile("demo.tile", {});
  assert.deepEqual(await registry.callAction(tile.id, "bump", { by: 2 }), {
    ok: true,
  });
  assert.equal(received, 2);
  assert.equal(registry.getActions()[0].name, "bump");
  await assert.rejects(
    registry.callAction(tile.id, "bump", { by: "2" }),
    /doit être de type number/,
  );
  await assert.rejects(
    registry.callAction(tile.id, "bump", {}),
    /Argument manquant/,
  );
  await assert.rejects(
    registry.callAction(tile.id, "bump", { by: 1, other: 2 }),
    /Argument inconnu/,
  );
  await assert.rejects(
    registry.callAction(tile.id, "absent", {}),
    /Action indisponible/,
  );
  await assert.rejects(
    registry.callAction("absent", "bump", { by: 1 }),
    /Tuile inconnue/,
  );
});

test("une action ne peut pas renvoyer un contenu non borné", async () => {
  const { workspace, registry } = setup();
  await registry.activate({
    manifest: manifest("demo"),
    activate(api) {
      api.tiles.register({
        type: "demo.tile",
        title: "Démo",
        actions: {
          dump: { title: "Tout", run: () => "x".repeat(20_000) },
        },
      });
    },
  });
  const tile = workspace.addTile("demo.tile", {});
  await assert.rejects(
    registry.callAction(tile.id, "dump"),
    /Renvoyez un identifiant plutôt que le contenu/,
  );
});

test("une action mal déclarée empêche l’activation", async () => {
  const { registry } = setup();
  await assert.rejects(
    registry.activate({
      manifest: manifest("bad"),
      activate(api) {
        api.tiles.register({
          type: "bad.tile",
          title: "Mauvais",
          actions: {
            "Pas Valide": { title: "X", run: () => null },
          },
        });
      },
    }),
    /Nom d’action invalide/,
  );
  assert.equal(registry.getTile("bad.tile"), undefined);
});

test("les événements émis rejoignent le journal sous une forme bornée", async () => {
  const { journal, registry } = setup();
  let api!: LabAPI;
  await registry.activate({
    manifest: manifest("demo"),
    activate(lab) {
      api = lab;
    },
  });
  api.events.emit(
    { id: "demo.saved" },
    { path: "notes.md", text: "y".repeat(400) },
  );
  const entry = journal.list().at(-1)!;
  assert.equal(entry.kind, "event:demo.saved");
  assert.equal(entry.source, "system");
  assert.deepEqual(entry.data, {
    path: "notes.md",
    text: `${"y".repeat(160)}… (400 caractères)`,
  });
});
