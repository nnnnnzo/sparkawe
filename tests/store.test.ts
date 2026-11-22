import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FEATURED_IDS,
  activeStoreView,
  backRoute,
  isCertified,
  matchesQuery,
  normalize,
  stateOf,
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
    category: "data",
  });
  assert.equal(matchesQuery(entry, "editeur", "fr"), true);
  assert.equal(matchesQuery(entry, "DONNEES", "fr"), true);
  assert.equal(matchesQuery(entry, "spark", "fr"), false);
  assert.equal(normalize("Éditeur", "fr"), "editeur");
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
  assert.equal(stateOf(manifest(), true, true), "active");
  assert.equal(stateOf(manifest({ tier: "core" }), false, false), "inactive");
  assert.equal(
    stateOf(manifest({ tier: "community" }), false, false),
    "not-installed",
  );
  assert.equal(
    stateOf(manifest({ tier: "community" }), false, true),
    "inactive",
  );
});

test("la sélection À la une est stable et sans doublon", () => {
  assert.ok(FEATURED_IDS.includes("spark.terminal"));
  assert.ok(FEATURED_IDS.includes("spark.openalex"));
  assert.equal(new Set(FEATURED_IDS).size, FEATURED_IDS.length);
});

test("le retour d’une fiche revient à la vue qui l’a ouverte", () => {
  assert.deepEqual(
    backRoute({ view: "detail", id: "demo", from: "installed" }),
    { view: "installed" },
  );
  assert.deepEqual(backRoute({ view: "detail", id: "demo" }), {
    view: "home",
  });
  assert.deepEqual(backRoute({ view: "installed" }), { view: "home" });
  assert.deepEqual(
    backRoute({ view: "repository", url: "https://example.org/index.json" }),
    { view: "sources" },
  );
  assert.equal(
    activeStoreView({ view: "detail", id: "demo", from: "installed" }),
    "installed",
  );
  assert.equal(
    activeStoreView({
      view: "repository",
      url: "https://example.org/index.json",
    }),
    "sources",
  );
});
