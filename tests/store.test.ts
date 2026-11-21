import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FEATURED_IDS,
  isCertified,
  matchesQuery,
  normalize,
  stateLabel,
  tierOf,
} from "../src/ui/store/data.ts";
import type { Manifest } from "../src/sdk/index.ts";

const manifest = (overrides: Partial<Manifest> = {}): Manifest => ({
  id: "demo.extension",
  name: "Démo",
  version: "1.0.0",
  ...overrides,
});

test("la recherche ignore les accents et la casse", () => {
  const entry = manifest({
    summary: "Éditeur de données",
    category: "Données",
  });
  assert.equal(matchesQuery(entry, "editeur"), true);
  assert.equal(matchesQuery(entry, "DONNEES"), true);
  assert.equal(matchesQuery(entry, "spark"), false);
  assert.equal(normalize("Éditeur"), "editeur");
});

test("une extension sans tier est traitée comme intégrée", () => {
  assert.equal(tierOf(manifest()), "core");
  assert.equal(tierOf(manifest({ tier: "community" })), "community");
});

test("seul le sceau Spark marque une extension comme certifiée", () => {
  assert.equal(isCertified(manifest()), false);
  assert.equal(isCertified(manifest({ certification: "spark" })), true);
});

test("l’état distingue une intégrée désactivée d’une tierce non installée", () => {
  assert.equal(stateLabel(manifest(), true, true), "Active");
  assert.equal(stateLabel(manifest({ tier: "core" }), false, false), "Inactive");
  assert.equal(
    stateLabel(manifest({ tier: "community" }), false, false),
    "Non installée",
  );
  assert.equal(
    stateLabel(manifest({ tier: "community" }), false, true),
    "Inactive",
  );
});

test("la sélection À la une est stable et sans doublon", () => {
  assert.ok(FEATURED_IDS.includes("spark.terminal"));
  assert.ok(FEATURED_IDS.includes("spark.openalex"));
  assert.equal(new Set(FEATURED_IDS).size, FEATURED_IDS.length);
});
