import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_COLUMNS,
  MAX_ROWS,
  clampTable,
  createTable,
  filterRows,
  newRow,
  numberOf,
  parseTsv,
  restoreDataState,
  sortRows,
  toTsv,
} from "../src/extensions/data/model.ts";
import { TableStore } from "../src/extensions/data/store.ts";

test("parseTsv accepte les fins de ligne Windows et ignore la ligne vide finale", () => {
  assert.deepEqual(parseTsv("nom\tvaleur\r\nalpha\t1\r\n"), [
    ["nom", "valeur"],
    ["alpha", "1"],
  ]);
  assert.deepEqual(parseTsv(""), []);
});

test("toTsv est l’inverse de parseTsv", () => {
  const rows = [
    ["nom", "valeur"],
    ["alpha", "1"],
    ["bêta", "2"],
  ];
  assert.deepEqual(parseTsv(toTsv(rows)), rows);
});

test("numberOf comprend la virgule décimale et les espaces", () => {
  assert.equal(numberOf("1 234,5"), 1234.5);
  assert.equal(numberOf(" -3 "), -3);
  assert.equal(numberOf(""), undefined);
  assert.equal(numberOf("abc"), undefined);
});

test("sortRows trie les nombres, les dates et le texte", () => {
  const table = createTable("Tri", 2, 0);
  table.rows = [
    { ...newRow(2), cells: ["b", "10"] },
    { ...newRow(2), cells: ["a", "2"] },
    { ...newRow(2), cells: ["c", ""] },
    { ...newRow(2), cells: ["d", "1,5"] },
  ];
  assert.deepEqual(
    sortRows(table.rows, 1, "asc", "number").map((row) => row.cells[1]),
    ["1,5", "2", "10", ""],
  );
  assert.deepEqual(
    sortRows(table.rows, 0, "desc", "text").map((row) => row.cells[0]),
    ["d", "c", "b", "a"],
  );
});

test("filterRows cherche dans toutes les cellules sans tenir compte de la casse", () => {
  const table = createTable("Filtre", 2, 0);
  table.rows = [
    { ...newRow(2), cells: ["Alpha", "1"] },
    { ...newRow(2), cells: ["beta", "2"] },
  ];
  assert.equal(filterRows(table.rows, "ALP").length, 1);
  assert.equal(filterRows(table.rows, "2").length, 1);
  assert.equal(filterRows(table.rows, "").length, 2);
});

test("clampTable borne les colonnes, les lignes et la taille", () => {
  const table = createTable("Grand", MAX_COLUMNS + 4, MAX_ROWS + 4);
  const clamped = clampTable(table);
  assert.equal(clamped.truncated, true);
  assert.equal(clamped.table.columns.length, MAX_COLUMNS);
  assert.equal(clamped.table.rows.length, MAX_ROWS);
  assert.ok(
    clamped.table.rows.every(
      (row) => row.cells.length === MAX_COLUMNS,
    ),
  );
});

test("restoreDataState ignore les tableaux invalides et déduplique les ids", () => {
  const table = createTable();
  const duplicate = { ...table, name: "Copie" };
  const restored = restoreDataState({
    version: 1,
    tables: [table, duplicate, { nope: true }],
  });
  assert.equal(restored.tables.length, 1);
  assert.equal(restored.tables[0].name, table.name);
  assert.deepEqual(restoreDataState(null), { version: 1, tables: [] });
  assert.deepEqual(restoreDataState({ version: 2, tables: [] }), {
    version: 1,
    tables: [],
  });
});

test("le store persiste les créations et les mises à jour", () => {
  const saved: unknown[] = [];
  const changes: string[] = [];
  const warnings: string[] = [];
  const store = new TableStore(
    undefined,
    (value) => saved.push(value),
    (id) => changes.push(id),
    (message) => warnings.push(message),
  );
  const table = store.create("Essai", ["Mois", "Ventes"]);
  assert.equal(store.list().length, 1);
  assert.deepEqual(
    store.get(table.id)?.columns.map((column) => column.name),
    ["Mois", "Ventes"],
  );
  assert.deepEqual(store.list()[0], {
    id: table.id,
    name: "Essai",
    rows: 8,
    columns: 2,
  });

  store.update(table.id, { ...store.get(table.id)!, rows: [] });
  assert.equal(store.get(table.id)?.rows.length, 0);
  assert.deepEqual(changes, [table.id, table.id]);
  assert.equal(saved.length, 2);
  assert.deepEqual(warnings, []);
});
