import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Activity,
  restoreStep,
  type ActivityPersistence,
  type ActivityStep,
} from "../src/core/activity.ts";
import { Journal } from "../src/core/journal.ts";
import { previousPlacement } from "../src/core/layoutInverse.ts";
import { agentForClient } from "../src/shared/agents/data.ts";

class Memory implements ActivityPersistence {
  stored = new Map<string, ActivityStep[]>();
  seenAt = new Map<string, number>();

  async load(tabId: string) {
    return {
      steps: this.stored.get(tabId) ?? [],
      lastSeenAt: this.seenAt.get(tabId) ?? 0,
    };
  }
  async append(step: ActivityStep) {
    const list = this.stored.get(step.tabId) ?? [];
    this.stored.set(
      step.tabId,
      [step, ...list.filter((item) => item.id !== step.id)].slice(0, 30),
    );
  }
  async revert(id: string, at: number) {
    for (const list of this.stored.values())
      for (const step of list) if (step.id === id) step.revertedAt = at;
  }
  async forget(id: string) {
    for (const [tabId, list] of this.stored)
      this.stored.set(
        tabId,
        list.filter((step) => step.id !== id),
      );
  }
  async seen(tabId: string, at: number) {
    this.seenAt.set(tabId, at);
  }
  async clear() {
    this.stored.clear();
    this.seenAt.clear();
  }
}

function setup() {
  const persistence = new Memory();
  const errors: unknown[] = [];
  const journal = new Journal();
  const activity = new Activity(persistence, (error) => errors.push(error));
  journal.onRecord(activity.record);
  activity.registerAgent({
    id: "session-1",
    brand: "claude",
    name: "Claude Code",
    label: "Claude Code",
  });
  return { activity, journal, persistence, errors };
}

test("regroupe les effets d’un même appel MCP en une seule étape", () => {
  const { activity, journal } = setup();
  journal.record({
    source: "agent",
    op: "op-1",
    agent: "session-1",
    activityTabId: "tab",
    kind: "tile.open",
    tabId: "tab",
    tileId: "tile-1",
    data: { type: "demo.tile" },
  });
  journal.record({
    source: "agent",
    op: "op-1",
    agent: "session-1",
    activityTabId: "tab",
    kind: "action:demo.tile.write",
    tabId: "tab",
    tileId: "tile-1",
    data: { mutates: true, result: { characters: 12 } },
  });
  const steps = activity.stepsFor("tab");
  assert.equal(steps.length, 1);
  assert.equal(steps[0].entries.length, 2);
  assert.equal(steps[0].kind, "action:demo.tile.write");
  assert.equal(steps[0].detail?.key, "activity.detail.characters");
  assert.deepEqual(
    steps[0].inverse.map((effect) => effect.type),
    ["closeTile"],
  );
  assert.equal(steps[0].agent.label, "Claude Code");
});

test("ignore les actions non mutantes et les autres sources", () => {
  const { activity, journal } = setup();
  journal.record({
    source: "agent",
    op: "op-1",
    agent: "session-1",
    activityTabId: "tab",
    kind: "action:demo.tile.read",
    tabId: "tab",
    data: { mutates: false },
  });
  journal.record({
    source: "human",
    kind: "tile.open",
    tabId: "tab",
    tileId: "tile",
    data: { type: "demo.tile" },
  });
  assert.equal(activity.stepsFor("tab").length, 0);
});

test("une action avec inverse reste suivie même sans mutates", () => {
  const { activity, journal } = setup();
  journal.record({
    source: "agent",
    op: "op-1",
    agent: "session-1",
    activityTabId: "tab",
    kind: "action:markdown.editor.write",
    tabId: "tab",
    tileId: "tile",
    data: { mutates: false, tracked: true, result: { characters: 3 } },
  });
  assert.equal(activity.stepsFor("tab").length, 1);
});

test("attache la capture d’une action mutable et la garde bornée", () => {
  const { activity, journal } = setup();
  const entry = journal.record({
    source: "agent",
    op: "op-1",
    agent: "session-1",
    activityTabId: "tab",
    kind: "action:demo.tile.write",
    tabId: "tab",
    tileId: "tile-1",
    data: { mutates: true, result: { characters: 4 } },
  });
  assert.ok(entry);
  activity.attachAction({
    entry,
    tile: { id: "tile-1", type: "demo.tile", data: {} },
    action: "write",
    snapshot: { text: "avant" },
    result: { characters: 4 },
    mutates: true,
    tracked: true,
  });
  const step = activity.stepsFor("tab")[0];
  assert.equal(step.inverse.length, 1);
  assert.equal(step.inverse[0].type, "action");
  assert.deepEqual(step.inverse[0].snapshot, { text: "avant" });
});

test("garde trente étapes, les plus récentes d’abord", () => {
  const { activity, journal } = setup();
  for (let index = 0; index < 31; index += 1)
    journal.record({
      source: "agent",
      op: `op-${index}`,
      agent: "session-1",
      activityTabId: "tab",
      kind: "tile.open",
      tabId: "tab",
      tileId: `tile-${index}`,
      data: { type: "demo.tile" },
    });
  const steps = activity.stepsFor("tab");
  assert.equal(steps.length, 30);
  assert.equal(steps[0].entries[0].tileId, "tile-30");
  assert.equal(steps.at(-1)?.entries[0].tileId, "tile-1");
});

test("un effacement attend une écriture SQLite lente sans effacer les étapes suivantes", async () => {
  const { activity, journal, persistence } = setup();
  const append = persistence.append.bind(persistence);
  let release!: () => void;
  const delay = new Promise<void>((resolve) => {
    release = resolve;
  });
  persistence.append = async (step) => {
    if (step.id === "before") await delay;
    await append(step);
  };
  const record = (op: string) => {
    journal.record({ source: "agent", kind: "tile.open", tabId: "tab", op });
  };

  record("before");
  const cleared = activity.clear();
  record("after");
  await Promise.resolve();
  assert.equal(persistence.stored.size, 0);
  release();
  await Promise.all([cleared, activity.flush()]);
  assert.deepEqual(
    persistence.stored.get("tab")?.map((step) => step.id),
    ["after"],
  );
});

test("un chargement en cours ne réaffiche pas un historique effacé", async () => {
  const { activity, journal } = setup();
  journal.record({
    source: "agent",
    kind: "tile.open",
    tabId: "tab",
    op: "old",
  });
  await activity.flush();
  const loading = activity.ensure("tab");
  const cleared = activity.clear();
  await Promise.all([loading, cleared]);
  assert.deepEqual(activity.stepsFor("tab"), []);
  await activity.ensure("tab");
  assert.deepEqual(activity.stepsFor("tab"), []);
});

test("charge la suite persistée et la fusionne avec les actions fraîches", async () => {
  const { activity, journal, persistence } = setup();
  const old = restoreStep({
    id: "old",
    at: 10,
    tabId: "tab",
    kind: "tile.open",
    agent: {
      id: "session-1",
      brand: "claude",
      name: "Claude Code",
      label: "Claude Code",
    },
    entries: [{ kind: "tile.open", at: 10, tileId: "old-tile" }],
    inverse: [],
  });
  assert.ok(old);
  persistence.stored.set("tab", [old]);
  journal.record({
    source: "agent",
    op: "fresh",
    agent: "session-1",
    activityTabId: "tab",
    kind: "tile.open",
    tabId: "tab",
    tileId: "fresh-tile",
  });
  await activity.ensure("tab");
  assert.equal(activity.stepsFor("tab").length, 2);
  assert.equal(activity.stepsFor("tab")[0].entries[0].tileId, "fresh-tile");
});

test("un point non lu se referme quand on marque l’onglet vu", async () => {
  const { activity, journal } = setup();
  journal.record({
    source: "agent",
    op: "op-1",
    agent: "session-1",
    activityTabId: "tab",
    kind: "tile.open",
    tabId: "tab",
    tileId: "tile",
  });
  assert.equal(activity.unread("tab"), true);
  activity.markSeen("tab");
  assert.equal(activity.unread("tab"), false);
  await activity.flush();
});

test("une étape annulée peut être effacée de l’historique", async () => {
  const { activity, journal } = setup();
  journal.record({
    source: "agent",
    op: "op-1",
    agent: "session-1",
    activityTabId: "tab",
    kind: "tile.open",
    tabId: "tab",
    tileId: "tile",
  });
  const step = activity.stepsFor("tab")[0];
  activity.markReverted(step);
  await activity.forget(step.id);
  assert.equal(activity.stepsFor("tab").length, 0);
});

test("une étape malformée est écartée au chargement", () => {
  assert.equal(restoreStep({ id: "x" }), undefined);
  assert.equal(
    restoreStep({
      id: "x",
      at: 1,
      tabId: "tab",
      kind: "tile.open",
      agent: { id: "a", brand: "claude", name: "Claude", label: "Claude" },
      entries: [],
      inverse: [],
    })?.id,
    "x",
  );
});

test("retrouve l’ancrage précédent d’une tuile", () => {
  const horizontal = {
    grid: {
      orientation: "HORIZONTAL",
      root: {
        type: "branch",
        data: [
          { type: "leaf", data: { views: ["left"] } },
          { type: "leaf", data: { views: ["right"] } },
        ],
      },
    },
  };
  assert.deepEqual(previousPlacement(horizontal, "right"), {
    target: "left",
    side: "right",
  });
  assert.deepEqual(previousPlacement(horizontal, "left"), {
    target: "right",
    side: "left",
  });
  const group = {
    grid: {
      orientation: "HORIZONTAL",
      root: { type: "leaf", data: { views: ["a", "b"] } },
    },
  };
  assert.deepEqual(previousPlacement(group, "b"), {
    target: "a",
    side: "center",
  });
  const nested = {
    grid: {
      orientation: "HORIZONTAL",
      root: {
        type: "branch",
        data: [
          { type: "leaf", data: { views: ["top"] } },
          {
            type: "branch",
            data: [
              { type: "leaf", data: { views: ["nested"] } },
              { type: "leaf", data: { views: ["other"] } },
            ],
          },
        ],
      },
    },
  };
  assert.deepEqual(previousPlacement(nested, "nested"), {
    target: "other",
    side: "top",
  });
});

test("reconnaît un client MCP connu ou fabrique un monogramme", () => {
  assert.equal(agentForClient("claude-code", "Claude Code").id, "claude");
  assert.equal(agentForClient("opencode").id, "opencode");
  const unknown = agentForClient("Acme", "Acme Agent");
  assert.equal(unknown.icon, undefined);
  assert.equal(unknown.name, "Acme Agent");
  assert.equal(unknown.glyph, "A");
});
