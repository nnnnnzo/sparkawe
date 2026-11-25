import assert from "node:assert/strict";
import { test } from "node:test";
import type { SerializedDockview } from "dockview-react";
import { inlineLayout } from "../src/ui/inlineLayout.ts";

test("restaurer un ancien calque conserve les proportions et l’onglet actif", () => {
  const snapshot: SerializedDockview = {
    grid: {
      orientation: "HORIZONTAL" as SerializedDockview["grid"]["orientation"],
      width: 1_000,
      height: 580,
      root: {
        type: "branch",
        data: [
          {
            type: "leaf",
            size: 700,
            data: { id: "left", views: ["a", "b"], activeView: "b" },
          },
          { type: "leaf", size: 300, data: { id: "right", views: ["c"] } },
        ],
      },
    },
    panels: {
      a: { id: "a", renderer: "always", minimumWidth: 120 },
      b: { id: "b", renderer: "onlyWhenVisible" },
      c: { id: "c" },
    },
    activeGroup: "left",
  };

  const restored = inlineLayout(snapshot);
  assert.equal(restored.grid, snapshot.grid);
  assert.equal(restored.activeGroup, snapshot.activeGroup);
  assert.equal(snapshot.panels.a.renderer, "always");
  assert.equal(restored.panels.a.renderer, undefined);
  assert.equal(restored.panels.a.minimumWidth, 120);
  assert.equal(restored.panels.b, snapshot.panels.b);
  assert.equal(restored.panels.c, snapshot.panels.c);
  assert.equal(inlineLayout(restored), restored);
});
