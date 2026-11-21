import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareVersions,
  latestVersion,
} from "../src/core/version.ts";

test("compare les versions numériquement", () => {
  assert.ok(compareVersions("1.0.1", "1.0.0") > 0);
  assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.ok(compareVersions("2.0.0", "1.99.99") > 0);
});

test("sélectionne la version la plus haute", () => {
  assert.equal(
    latestVersion([
      { version: "0.2.0" },
      { version: "0.10.0" },
      { version: "0.9.1" },
    ])?.version,
    "0.10.0",
  );
  assert.equal(latestVersion([]), undefined);
});
