import assert from "node:assert/strict";
import { test } from "node:test";
import { createMcpServer } from "../src/app/mcp.ts";
import { BRIEF_TILE_LIMIT } from "../src/app/mcpSchemas.ts";
import { buildBrief } from "../src/core/brief.ts";
import { Journal } from "../src/core/journal.ts";
import { Registry } from "../src/core/registry.ts";
import { Workspace, initialWorkspace } from "../src/core/workspace.ts";

type Schema = {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  maxItems?: number;
};

type Tool = {
  name: string;
  outputSchema?: Schema;
  annotations?: { readOnlyHint?: boolean };
};

type Result = {
  content: { type: string; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: true;
};

async function setup() {
  const journal = new Journal();
  const workspace = new Workspace(initialWorkspace(), journal.record);
  const registry = new Registry(
    {
      openTile: (type, data = {}) => workspace.addTile(type, data),
      focusTile: (id) => workspace.focusTile(id),
      updateTileData: (id, data) => workspace.updateTileData(id, data),
      getTiles: () => workspace.active().tiles,
      getAllTiles: () => workspace.get().tabs.flatMap(({ tiles }) => tiles),
      getFocusedTile: () => undefined,
    },
    { read: () => undefined, save() {} },
    { record: journal.record },
  );
  await registry.activate({
    manifest: { id: "demo", name: "Demo", version: "1.0.0" },
    activate(api) {
      api.tiles.register({
        type: "demo.tile",
        title: "Neutral sample",
        guide: "Guide",
        actions: {
          inspect: {
            title: "Inspect",
            description: "Return a small summary",
            input: { label: { type: "string" } },
            run: (_tile, args) => ({ label: args.label }),
          },
        },
      });
    },
  });
  const server = createMcpServer({
    workspace,
    registry,
    journal,
    brief: (tab) => buildBrief({ workspace, catalog: registry, journal }, tab),
    closeTiles: async (_ids, apply) => {
      apply();
      return true;
    },
  });
  const request = async <T>(method: string, params?: object): Promise<T> => {
    const id = crypto.randomUUID();
    const line = await server.handle(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    );
    assert.ok(line);
    const reply = JSON.parse(line) as { id: string; result: T; error?: object };
    assert.equal(reply.id, id);
    assert.equal(reply.error, undefined);
    return reply.result;
  };
  const call = (name: string, args: object = {}) =>
    request<Result>("tools/call", { name, arguments: args });
  return { request, call, workspace, registry, journal };
}

function latch() {
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { done, release };
}

// Vérifie le sous-ensemble de JSON Schema utilisé par les sorties du pont.
function conforms(value: unknown, schema: Schema) {
  if (schema.enum) assert.ok(schema.enum.includes(value));
  if (schema.type === "object") {
    assert.equal(typeof value, "object");
    assert.ok(value !== null && !Array.isArray(value));
    const fields = value as Record<string, unknown>;
    for (const key of schema.required ?? [])
      assert.ok(Object.hasOwn(fields, key));
    for (const [key, def] of Object.entries(schema.properties ?? {}))
      if (Object.hasOwn(fields, key)) conforms(fields[key], def);
  } else if (schema.type === "array") {
    assert.ok(Array.isArray(value));
    if (schema.maxItems !== undefined)
      assert.ok(value.length <= schema.maxItems);
    if (schema.items) for (const item of value) conforms(item, schema.items);
  } else if (schema.type === "integer") {
    assert.ok(Number.isInteger(value));
  } else if (schema.type) {
    assert.equal(typeof value, schema.type);
  }
}

test("les lectures MCP annoncent des sorties compatibles avec les résultats texte", async () => {
  const { request, call, workspace } = await setup();
  const tile = workspace.addTile("demo.tile", { label: "alpha" });
  const { tools } = await request<{ tools: Tool[] }>("tools/list");
  const reads = [
    ["spark_brief", {}, "text"],
    ["spark_tabs", {}, "tabs"],
    ["spark_tiles", {}, "tiles"],
    ["spark_tiles", { detail: "full" }, "tiles"],
    ["spark_tile_read", { tile: tile.id }, undefined],
    ["spark_events_since", { seq: 0 }, "events"],
    ["spark_events_since", { seq: 100 }, "events"],
  ] as const;
  const readNames = new Set<string>(reads.map(([name]) => name));
  for (const tool of tools) {
    assert.equal(
      tool.annotations?.readOnlyHint === true,
      readNames.has(tool.name),
    );
    assert.equal(Boolean(tool.outputSchema), readNames.has(tool.name));
  }
  for (const [name, args, key] of reads) {
    const result = await call(name, args);
    const schema = tools.find((tool) => tool.name === name)?.outputSchema;
    assert.ok(schema);
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0].type, "text");
    conforms(result.structuredContent, schema);
    const fallback = result.content[0].text;
    if (name === "spark_brief")
      assert.equal(fallback, result.structuredContent.text);
    else
      assert.deepEqual(
        JSON.parse(fallback),
        key ? result.structuredContent[key] : result.structuredContent,
      );
  }
});

test("un client peut passer du brief à une tuile sans analyser le texte", async () => {
  const { call, workspace } = await setup();
  const inactive = workspace.create("Background", "stack", false);
  const empty = await call("spark_brief", { tab: inactive.id });
  assert.deepEqual(empty.structuredContent.tileRefs, []);
  assert.equal(empty.structuredContent.tileRefsTruncated, false);

  const tabs = await call("spark_tabs");
  assert.ok(Array.isArray(tabs.structuredContent.tabs));
  assert.equal(
    tabs.structuredContent.tabs.find(({ id }) => id === inactive.id)?.mode,
    "stack",
  );

  const tiles = Array.from({ length: BRIEF_TILE_LIMIT + 1 }, () =>
    workspace.addTile("demo.tile", {}, inactive.id),
  );
  const brief = await call("spark_brief", { tab: inactive.id });
  const refs = brief.structuredContent.tileRefs;
  assert.deepEqual(
    refs,
    tiles.slice(0, BRIEF_TILE_LIMIT).map(({ id, type }) => ({ ref: id, type })),
  );
  assert.equal(brief.structuredContent.tileRefsTruncated, true);
  assert.ok(Array.isArray(refs));
  const ref = refs.at(-1)?.ref;
  assert.ok(typeof ref === "string");
  assert.ok(!brief.content[0].text.includes(ref));

  const [tile, events, failed] = await Promise.all([
    call("spark_tile_read", { tile: ref }),
    call("spark_events_since", { seq: brief.structuredContent.lastSeq }),
    call("spark_tile_read", { tile: "missing" }),
  ]);
  assert.equal(tile.structuredContent.ref, ref);
  assert.deepEqual(events.structuredContent.events, []);
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /Tuile inconnue/);
});

test("une session MCP est identifiable dans le journal", async () => {
  const { request, call, journal, workspace } = await setup();
  await request("initialize", {
    protocolVersion: "2025-06-18",
    clientInfo: { name: "opencode", version: "2.3.2" },
  });
  const cursor = journal.lastSeq;
  await call("spark_tile_open", { type: "demo.tile" });
  const [entry] = journal.since(cursor);
  assert.equal(entry.kind, "tile.open");
  assert.equal(entry.source, "agent");
  assert.equal(typeof entry.agent, "string");
  assert.equal(typeof entry.op, "string");
  assert.equal(entry.activityTabId, workspace.get().active);
});

test("des appels agent qui se terminent dans le désordre ne polluent pas le journal", async () => {
  const { call, workspace, registry, journal } = await setup();
  const pending = [latch(), latch()];
  await registry.activate({
    manifest: { id: "slow", name: "Slow", version: "1.0.0" },
    activate(api) {
      api.tiles.register({
        type: "slow.tile",
        title: "Slow",
        actions: {
          open: {
            title: "Open",
            mutates: true,
            input: { index: { type: "number" } },
            async run(_tile, { index }) {
              await pending[Number(index)].done;
              return { ref: api.tabs.openTile("demo.tile").id };
            },
          },
        },
      });
    },
  });
  const tile = workspace.addTile("slow.tile", {});
  const cursor = journal.lastSeq;
  const writes = pending.map((_, index) =>
    call("spark_tile_call", { tile: tile.id, action: "open", args: { index } }),
  );

  pending[0].release();
  assert.equal((await writes[0]).isError, undefined);
  const brief = await call("spark_brief");
  pending[1].release();
  assert.equal((await writes[1]).isError, undefined);
  workspace.addTile("demo.tile", {});

  const events = journal.since(cursor);
  assert.equal(brief.structuredContent.lastSeq, cursor + 2);
  assert.deepEqual(
    events.map(({ kind, source }) => [kind, source]),
    [
      ["tile.open", "agent"],
      ["action:slow.tile.open", "agent"],
      ["tile.open", "agent"],
      ["action:slow.tile.open", "agent"],
      ["tile.open", "human"],
    ],
  );
});
