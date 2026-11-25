import assert from "node:assert/strict";
import { test } from "node:test";
import { tabDropTarget } from "../src/ui/tabDrop.ts";

const tabs = ["a", "b", "c", "d"].map((id) => ({ id }));

test("le dépôt choisit l’insertion avant ou après, dans les deux sens", () => {
  assert.equal(tabDropTarget(tabs, "a", "c", "before"), "b");
  assert.equal(tabDropTarget(tabs, "a", "c", "after"), "c");
  assert.equal(tabDropTarget(tabs, "d", "b", "before"), "b");
  assert.equal(tabDropTarget(tabs, "d", "b", "after"), "c");
  assert.equal(tabDropTarget(tabs, "a", "d", "after"), "d");
  assert.equal(tabDropTarget(tabs, "d", "a", "before"), "a");
});

test("un dépôt à sa place ou hors des onglets ne change rien", () => {
  assert.equal(tabDropTarget(tabs, "a", "b", "before"), undefined);
  assert.equal(tabDropTarget(tabs, "b", "a", "after"), undefined);
  assert.equal(tabDropTarget(tabs, "a", "a", "after"), undefined);
  assert.equal(tabDropTarget(tabs, "a", "inconnu", "after"), undefined);
  assert.equal(tabDropTarget(tabs, "inconnu", "a", "before"), undefined);
});
