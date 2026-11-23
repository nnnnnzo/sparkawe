import assert from "node:assert/strict";
import { test } from "node:test";
import { sortEntries, type Entry } from "../src/extensions/explorer/files.ts";

const names = (entries: Entry[]) => entries.map((entry) => entry.name);

test("l’arborescence place les dossiers avant les fichiers", () => {
  const entries: Entry[] = [
    { name: "zebra.txt", kind: "file" },
    { name: "Alpha", kind: "folder" },
    { name: "notes.md", kind: "file" },
  ];
  assert.deepEqual(names(sortEntries(entries, "fr")), [
    "Alpha",
    "notes.md",
    "zebra.txt",
  ]);
});

test("les noms numérotés suivent l’ordre des nombres", () => {
  const entries: Entry[] = [
    { name: "chapitre10.md", kind: "file" },
    { name: "chapitre2.md", kind: "file" },
    { name: "chapitre1.md", kind: "file" },
  ];
  assert.deepEqual(names(sortEntries(entries, "en")), [
    "chapitre1.md",
    "chapitre2.md",
    "chapitre10.md",
  ]);
});

test("le tri compare les noms sans tenir compte de la casse", () => {
  const entries: Entry[] = [
    { name: "Banane", kind: "file" },
    { name: "abricot", kind: "file" },
    { name: "Cerise", kind: "file" },
  ];
  assert.deepEqual(names(sortEntries(entries, "fr")), [
    "abricot",
    "Banane",
    "Cerise",
  ]);
});

test("le tri suit la langue demandée", () => {
  const entries: Entry[] = [
    { name: "漢字.txt", kind: "file" },
    { name: "Alpha.txt", kind: "file" },
  ];
  const chinese = new Intl.Collator("zh", {
    numeric: true,
    sensitivity: "base",
  });
  assert.deepEqual(
    names(sortEntries([...entries], "zh")),
    names([...entries].sort((a, b) => chinese.compare(a.name, b.name))),
  );
});
