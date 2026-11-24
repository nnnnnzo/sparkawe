import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOCALES,
  LANGUAGES,
  detectLocale,
  isLocale,
  resolveText,
  translate,
  translatePlural,
} from "../src/core/i18n.ts";
import { restoreSettings } from "../src/core/settings.ts";
import activity from "../src/core/locales/activity.ts";
import data from "../src/core/locales/data.ts";
import errors from "../src/core/locales/errors.ts";
import explorer from "../src/core/locales/explorer.ts";
import manifests from "../src/core/locales/manifests.ts";
import markdown from "../src/core/locales/markdown.ts";
import openalex from "../src/core/locales/openalex.ts";
import preview from "../src/core/locales/preview.ts";
import shell from "../src/core/locales/shell.ts";
import store from "../src/core/locales/store.ts";
import terminal from "../src/core/locales/terminal.ts";
import web from "../src/core/locales/web.ts";

const domains = {
  activity,
  data,
  errors,
  explorer,
  manifests,
  markdown,
  openalex,
  preview,
  shell,
  store,
  terminal,
  web,
};

const placeholders = (value: string) =>
  [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

test("chaque clé possède les huit langues", () => {
  for (const [domain, messages] of Object.entries(domains)) {
    for (const [key, entry] of Object.entries(messages)) {
      assert.equal(
        Object.keys(entry).length,
        LOCALES.length,
        `${domain}/${key} n’a pas exactement ${LOCALES.length} langues`,
      );
      for (const locale of LOCALES) {
        assert.equal(
          typeof entry[locale],
          "string",
          `${domain}/${key} n’a pas de texte ${locale}`,
        );
        assert.ok(
          entry[locale].trim().length > 0,
          `${domain}/${key} est vide en ${locale}`,
        );
      }
    }
  }
});

test("les domaines ne se chevauchent pas", () => {
  const entries = Object.entries(domains);
  for (let first = 0; first < entries.length; first++) {
    for (let second = first + 1; second < entries.length; second++) {
      const [firstName, firstMessages] = entries[first];
      const [secondName, secondMessages] = entries[second];
      const overlap = Object.keys(firstMessages).filter(
        (key) => key in secondMessages,
      );
      assert.deepEqual(
        overlap,
        [],
        `${firstName} et ${secondName} partagent ${overlap.join(", ")}`,
      );
    }
  }
});

test("les espaces réservés sont identiques dans toutes les langues", () => {
  for (const [domain, messages] of Object.entries(domains)) {
    for (const [key, entry] of Object.entries(messages)) {
      const reference = placeholders(entry.fr);
      for (const locale of LOCALES) {
        assert.deepEqual(
          placeholders(entry[locale]),
          reference,
          `${domain}/${key} n’a pas les mêmes espaces réservés en ${locale}`,
        );
      }
    }
  }
});

test("la détection choisit la langue de base et retombe sur l’anglais", () => {
  assert.equal(detectLocale(["fr-CA", "en-US"]), "fr");
  assert.equal(detectLocale(["en_GB"]), "en");
  assert.equal(detectLocale(["zh-Hant"]), "zh");
  assert.equal(detectLocale(["ja-JP"]), "ja");
  assert.equal(detectLocale(["de-AT"]), "de");
  assert.equal(detectLocale(["ru-RU"]), "en");
  assert.equal(detectLocale(["ru-RU"], "fr"), "fr");
  assert.equal(isLocale("pt"), true);
  assert.equal(isLocale("pt-BR"), false);
});

test("chaque langue a un nom natif et un drapeau", () => {
  for (const locale of LOCALES) {
    assert.ok(LANGUAGES[locale].native.trim());
    assert.ok(LANGUAGES[locale].flag.trim());
  }
});

test("traduction, interpolation et repli", () => {
  assert.equal(translate("fr", "shell.tabs.new"), "Nouvel onglet");
  assert.equal(translate("de", "shell.tabs.new"), "Neuer Tab");
  assert.equal(
    translate("fr", "shell.tabs.close", { name: "Notes" }),
    "Fermer Notes",
  );
  assert.equal(translate("fr", "clé.inconnue"), "clé.inconnue");
});

test("les pluriels suivent la langue", () => {
  assert.equal(
    translatePlural("fr", "shell.brief.character", 1, { count: 1 }),
    "1 caractère",
  );
  assert.equal(
    translatePlural("fr", "shell.brief.character", 3, { count: 3 }),
    "3 caractères",
  );
  assert.equal(
    translatePlural("ja", "shell.brief.character", 3, { count: 3 }),
    "3 文字",
  );
});

test("resolveText accepte un littéral ou une référence", () => {
  assert.equal(resolveText("Notes", "fr"), "Notes");
  assert.equal(resolveText({ key: "shell.tabs.new" }, "fr"), "Nouvel onglet");
  assert.equal(resolveText(undefined, "fr"), "");
  assert.equal(resolveText({ key: "clé.inconnue" }, "fr"), "clé.inconnue");
});

test("les réglages restaurent une langue valide ou le repli", () => {
  assert.deepEqual(restoreSettings(null, "fr"), { dev: false, locale: "fr" });
  assert.deepEqual(restoreSettings({}, "fr"), { dev: false, locale: "fr" });
  assert.deepEqual(restoreSettings({ dev: true, locale: "ja" }, "fr"), {
    dev: true,
    locale: "ja",
  });
  assert.deepEqual(restoreSettings({ locale: "xx" }, "fr"), {
    dev: false,
    locale: "fr",
  });
  assert.deepEqual(restoreSettings({ dev: "oui" }, "fr"), {
    dev: false,
    locale: "fr",
  });
});
