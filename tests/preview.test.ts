import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fileNameOf,
  isPreviewable,
  kindOf,
} from "../src/extensions/preview/kind.ts";

test("classe les formats de l’aperçu", () => {
  assert.equal(kindOf("Article.PDF"), "pdf");
  assert.equal(kindOf("photo.jpeg"), "image");
  assert.equal(kindOf("voix.m4a"), "audio");
  assert.equal(kindOf("clip.MOV"), "video");
  assert.equal(kindOf("notes.txt"), "text");
  assert.equal(kindOf("source.ts"), "text");
  assert.equal(kindOf("index.html"), "html");
  assert.equal(kindOf("https://example.org/a.pdf?download=1"), "pdf");
});

test("le Markdown reste hors de l’aperçu", () => {
  assert.equal(kindOf("notes.md"), undefined);
  assert.equal(kindOf("notes.markdown"), undefined);
  assert.equal(isPreviewable("notes.md"), false);
  assert.equal(isPreviewable("index.htm"), true);
});

test("extrait un nom lisible d’une URL ou d’un chemin", () => {
  assert.equal(fileNameOf("https://example.org/a%20b.pdf?x=1"), "a b.pdf");
  assert.equal(fileNameOf("/Users/enzo/Mon fichier.png"), "Mon fichier.png");
});
