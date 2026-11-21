import assert from "node:assert/strict";
import { test } from "node:test";
import {
  abstractFrom,
  cite,
  mdpiCandidates,
  normalizeDoi,
  searchUrl,
  toWork,
} from "../src/extensions/openalex/api.ts";

test("reconstruit l’abstract depuis l’index inversé", () => {
  assert.equal(
    abstractFrom({ monde: [1], bonjour: [0], le: [2] }),
    "bonjour monde le",
  );
  assert.equal(abstractFrom(null), "");
  assert.equal(abstractFrom({ long: [0] }, 2), "lo…");
});

test("normalise un travail OpenAlex", () => {
  const work = toWork({
    id: "https://openalex.org/W1",
    title: "Un titre",
    publication_year: 2019,
    doi: "https://doi.org/10.1/x",
    cited_by_count: 12,
    referenced_works_count: 5,
    type: "article",
    language: "fr",
    open_access: { is_oa: true },
    primary_location: {
      source: { display_name: "Revue" },
      pdf_url: "https://exemple.fr/primaire.pdf",
    },
    best_oa_location: { pdf_url: "https://exemple.fr/libre.pdf" },
    primary_topic: { display_name: "Sujet" },
    authorships: [
      {
        author: { display_name: "Ada" },
        institutions: [{ display_name: "CNRS" }],
      },
      {
        author: { display_name: "Ada" },
        institutions: [{ display_name: "CNRS" }],
      },
    ],
    abstract_inverted_index: { Un: [0], test: [1] },
  });
  assert.equal(work.id, "W1");
  assert.equal(work.title, "Un titre");
  assert.equal(work.year, 2019);
  assert.equal(work.doi, "10.1/x");
  assert.equal(work.citedBy, 12);
  assert.equal(work.references, 5);
  assert.equal(work.type, "article");
  assert.equal(work.language, "fr");
  assert.equal(work.venue, "Revue");
  assert.equal(work.topic, "Sujet");
  assert.equal(work.pdfUrl, "https://exemple.fr/libre.pdf");
  assert.deepEqual(work.pdfCandidates, [
    "https://exemple.fr/libre.pdf",
    "https://exemple.fr/primaire.pdf",
  ]);
  assert.equal(work.openAccess, true);
  assert.deepEqual(work.authors, ["Ada"]);
  assert.deepEqual(work.institutions, ["CNRS"]);
  assert.equal(work.abstract, "Un test");
});

test("construit l’URL de recherche avec filtres et tri", () => {
  const url = searchUrl({
    query: "opéra",
    yearFrom: 2000,
    yearTo: 2020,
    openAccess: true,
    type: "article",
    sort: "citations",
    limit: 5,
  });
  assert.match(url, /search=op%C3%A9ra/);
  assert.match(url, /per-page=5/);
  assert.match(url, /from_publication_date%3A2000-01-01/);
  assert.match(url, /to_publication_date%3A2020-12-31/);
  assert.match(url, /is_oa%3Atrue/);
  assert.match(url, /type%3Aarticle/);
  assert.match(url, /sort=cited_by_count%3Adesc/);
  assert.match(url, /select=/);
});

test("détecte un DOI et construit les modes auteur et DOI", () => {
  assert.equal(normalizeDoi("https://doi.org/10.1234/abc"), "10.1234/abc");
  assert.equal(normalizeDoi("doi:10.1234/abc"), "10.1234/abc");
  assert.equal(normalizeDoi("10.1234/abc"), "10.1234/abc");
  assert.equal(normalizeDoi("opéra"), undefined);

  const doiUrl = searchUrl({ query: "https://doi.org/10.1234/abc" });
  assert.match(doiUrl, /filter=doi%3A10.1234%2Fabc/);
  assert.doesNotMatch(doiUrl, /search=/);

  const authorUrl = searchUrl({ query: "Ada Lovelace", by: "author" });
  assert.match(authorUrl, /raw_author_name.search%3AAda\+Lovelace/);
  assert.doesNotMatch(authorUrl, /search=Ada/);

  const precise = searchUrl({
    query: "Christopher Manning",
    by: "author",
    authorId: "A123",
  });
  assert.match(precise, /authorships.author.id%3AA123/);
});

test("construit l’URL du CDN MDPI quand www.mdpi.com bloque", () => {
  const urls = mdpiCandidates(
    "https://www.mdpi.com/2071-1050/13/16/9209/pdf?version=1",
    "Sustainability",
  );
  assert.deepEqual(urls, [
    "https://mdpi-res.com/d_attachment/sustainability/sustainability-13-09209/article_deploy/sustainability-13-09209.pdf",
  ]);
  const applied = mdpiCandidates(
    "https://www.mdpi.com/2076-3417/10/1/1/pdf",
    "Applied Sciences",
  );
  assert.ok(applied.some((url) => url.includes("/applsci/applsci-10-00001/")));
  assert.deepEqual(mdpiCandidates("https://example.org/x.pdf", "X"), []);
});

test("cite en BibTeX et en APA", () => {
  const work = toWork({
    id: "https://openalex.org/W1",
    title: "Un {titre}",
    publication_year: 2019,
    doi: "10.1/x",
    authorships: [{ author: { display_name: "Ada" } }],
  });
  const bibtex = cite(work, "bibtex");
  assert.match(bibtex, /@article\{W1,/);
  assert.ok(bibtex.includes("title   = {Un titre}"));
  assert.ok(bibtex.includes("doi     = {10.1/x}"));
  const apa = cite(work, "apa");
  assert.match(apa, /^Ada \(2019\)\. Un \{titre\}\./);
  assert.match(apa, /https:\/\/doi\.org\/10\.1\/x/);
});
