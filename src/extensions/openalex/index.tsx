import { SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@spark/ui/components/popover";
import type {
  ExtensionAPI,
  ExtensionModule,
  TileViewProps,
} from "../../sdk/react.ts";
import type { Tile, TileSurface } from "../../sdk/index.ts";
import { previewPdf } from "../preview/api.ts";
import {
  cite,
  fetchWork,
  searchWorks,
  type SearchOptions,
  type Work,
} from "./api.ts";
import manifest, { searchType, workType } from "./manifest.ts";
import "./style.css";

interface Snapshot {
  results: Work[];
  selected?: string;
  status: "idle" | "loading" | "error";
  error?: string;
  query: string;
  total: number;
}

const snapshots = new Map<string, Snapshot>();
const works = new Map<string, Work>();
const listeners = new Set<() => void>();
let api: ExtensionAPI;

function notify() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function snapshotOf(tileId: string): Snapshot {
  return (
    snapshots.get(tileId) ?? {
      results: [],
      status: "idle",
      query: "",
      total: 0,
    }
  );
}
function update(tileId: string, change: Partial<Snapshot>) {
  snapshots.set(tileId, { ...snapshotOf(tileId), ...change });
  notify();
}
function surfaceOf(tileId: string): TileSurface {
  const state = snapshotOf(tileId);
  const selected = state.results.find((work) => work.id === state.selected);
  return {
    query: state.query,
    results: String(state.results.length),
    total: String(state.total),
    selection: selected?.title ?? "",
  };
}
function publish(tileId: string) {
  api.tiles.publish(tileId, surfaceOf(tileId));
}

async function getWork(id: string): Promise<Work> {
  const cached = works.get(id);
  if (cached) return cached;
  const work = await fetchWork(id);
  works.set(work.id, work);
  return work;
}

function optionsFrom(input: Record<string, unknown>): SearchOptions {
  return {
    query: String(input.query ?? ""),
    limit: input.limit === undefined ? 10 : Number(input.limit),
    yearFrom: input.yearFrom === undefined ? undefined : Number(input.yearFrom),
    yearTo: input.yearTo === undefined ? undefined : Number(input.yearTo),
    openAccess: input.openAccess === true ? true : undefined,
    type: typeof input.type === "string" && input.type ? input.type : undefined,
    by:
      input.by === "author" || input.by === "doi"
        ? input.by
        : input.by === "topic"
          ? "topic"
          : undefined,
    sort:
      input.sort === "citations" || input.sort === "date"
        ? input.sort
        : "relevance",
  };
}

async function runSearch(tile: Tile, options: SearchOptions) {
  const query = options.query.trim();
  if (!query) throw new Error("Recherche vide.");
  update(tile.id, { status: "loading", query, error: undefined });
  publish(tile.id);
  api.tabs.updateTileData(tile.id, { ...tile.data, query });
  try {
    const { results, total } = await searchWorks({ ...options, query });
    for (const work of results) works.set(work.id, work);
    update(tile.id, {
      results,
      total,
      status: "idle",
      selected: results[0]?.id,
    });
    publish(tile.id);
    return { results, total };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    update(tile.id, { status: "error", error: message });
    publish(tile.id);
    throw error;
  }
}

function selectWork(tile: Tile, wanted: string): Work {
  const state = snapshotOf(tile.id);
  const clean = wanted.replace(/^https:\/\/openalex\.org\//, "");
  const work = state.results.find((candidate) => candidate.id === clean);
  if (!work) throw new Error(`Travail inconnu : ${wanted}.`);
  update(tile.id, { selected: work.id });
  publish(tile.id);
  return work;
}

function selectedWork(tile: Tile): Work {
  const state = snapshotOf(tile.id);
  const work = state.results.find(
    (candidate) => candidate.id === state.selected,
  );
  if (!work)
    throw new Error(
      "Aucun travail sélectionné. Appelez select avec un identifiant de la recherche.",
    );
  return work;
}

function fieldsOf(work: Work, fields: string[]) {
  const all: Record<string, unknown> = {
    id: work.id,
    title: work.title,
    year: work.year,
    doi: work.doi,
    citations: work.citedBy,
    references: work.references,
    openAccess: work.openAccess,
    authors: work.authors,
    institutions: work.institutions,
    abstract: work.abstract,
    venue: work.venue,
    type: work.type,
    language: work.language,
    topic: work.topic,
    pdfUrl: work.pdfUrl,
  };
  if (!fields.length) return all;
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field in all))
      throw new Error(
        `Champ inconnu : ${field}. Champs : ${Object.keys(all).join(", ")}.`,
      );
    picked[field] = all[field];
  }
  return picked;
}

function openWorkTile(tile: Tile, work: Work) {
  return api.tabs.openTile(workType, { work: work.id }, tile.id);
}

async function openPdfTile(tile: Tile, work: Work) {
  if (!work.pdfCandidates.length)
    throw new Error("Aucun PDF libre pour ce travail. Consultez le DOI.");
  const viewer = api.services.get(previewPdf);
  if (!viewer) throw new Error("L’extension Aperçu est désactivée.");
  return viewer.open(
    { id: work.id, title: work.title, urls: work.pdfCandidates },
    tile.id,
  );
}

function SearchView({ tile }: TileViewProps) {
  const state = useSyncExternalStore(subscribe, () => snapshots.get(tile.id));
  const [query, setQuery] = useState(tile.data.query ?? "");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [openAccess, setOpenAccess] = useState(false);
  const [type, setType] = useState("");
  const [sort, setSort] = useState<"relevance" | "citations" | "date">(
    "relevance",
  );
  const [by, setBy] = useState<"topic" | "author" | "doi">("topic");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pdfError, setPdfError] = useState<string>();
  const [opening, setOpening] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const initial = tile.data.query?.trim();
    if (initial && !snapshots.has(tile.id))
      void runSearch(tile, { query: initial, limit: 10 }).catch(() => {});
  }, [tile]);

  const current = state ?? snapshotOf(tile.id);
  const selected = current.results.find((work) => work.id === current.selected);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPdfError(undefined);
    try {
      await runSearch(tile, {
        query,
        by,
        limit: 10,
        yearFrom: yearFrom ? Number(yearFrom) : undefined,
        yearTo: yearTo ? Number(yearTo) : undefined,
        openAccess: openAccess || undefined,
        type: type || undefined,
        sort,
      });
    } catch {
      // L'erreur est déjà affichée dans la tuile.
    }
  }

  async function openPdf(work: Work) {
    setOpening(true);
    setPdfError(undefined);
    try {
      await openPdfTile(tile, work);
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpening(false);
    }
  }

  const placeholder =
    by === "doi"
      ? "10.1234/abcd ou https://doi.org/…"
      : by === "author"
        ? "Nom d’auteur (ex. Christopher Manning)"
        : "Chercher des travaux…";

  return (
    <section className="openalex" aria-label={manifest.name}>
      <form
        className="openalex-search"
        onSubmit={(event) => void submit(event)}
      >
        <select
          className="openalex-mode"
          value={by}
          onChange={(event) =>
            setBy(event.target.value as "topic" | "author" | "doi")
          }
          aria-label="Type de recherche"
        >
          <option value="topic">Sujet</option>
          <option value="author">Auteur</option>
          <option value="doi">DOI</option>
        </select>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label="Recherche OpenAlex"
        />
        <button type="submit" disabled={current.status === "loading"}>
          {current.status === "loading" ? "Recherche…" : "Chercher"}
        </button>
        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="openalex-filter-trigger"
              aria-label="Filtres de recherche"
              title="Filtres"
            >
              <SlidersHorizontal size={14} aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="openalex-filter-panel">
            <label>
              Année de
              <input
                type="number"
                min="1800"
                max="2100"
                value={yearFrom}
                onChange={(event) => setYearFrom(event.target.value)}
              />
            </label>
            <label>
              à
              <input
                type="number"
                min="1800"
                max="2100"
                value={yearTo}
                onChange={(event) => setYearTo(event.target.value)}
              />
            </label>
            <label>
              Accès ouvert
              <input
                type="checkbox"
                checked={openAccess}
                onChange={(event) => setOpenAccess(event.target.checked)}
              />
            </label>
            <label>
              Type
              <select
                value={type}
                onChange={(event) => setType(event.target.value)}
              >
                <option value="">Tous</option>
                <option value="article">Article</option>
                <option value="review">Revue</option>
                <option value="book-chapter">Chapitre</option>
                <option value="dissertation">Thèse</option>
              </select>
            </label>
            <label>
              Tri
              <select
                value={sort}
                onChange={(event) =>
                  setSort(
                    event.target.value as "relevance" | "citations" | "date",
                  )
                }
              >
                <option value="relevance">Pertinence</option>
                <option value="citations">Citations</option>
                <option value="date">Date</option>
              </select>
            </label>
          </PopoverContent>
        </Popover>
      </form>
      {current.status === "error" && current.error && (
        <p className="openalex-error" role="alert">
          {current.error}
        </p>
      )}
      <div className="openalex-body">
        <ul className="openalex-results" aria-label="Résultats">
          {current.results.map((work) => (
            <li key={work.id}>
              <button
                type="button"
                className="openalex-result"
                aria-pressed={work.id === current.selected}
                onClick={() => {
                  try {
                    selectWork(tile, work.id);
                  } catch {
                    // Une sélection disparue ne doit pas casser la vue.
                  }
                }}
              >
                <span className="openalex-title">{work.title}</span>
                <span className="openalex-meta">
                  {[work.venue, work.year].filter(Boolean).join(" · ") || "—"}
                </span>
                <span className="openalex-meta">
                  {work.citedBy} citations
                  {work.openAccess ? " · accès ouvert" : ""}
                  {work.pdfUrl ? " · PDF" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {selected ? (
          <article className="openalex-detail">
            <h2 className="openalex-title">{selected.title}</h2>
            {selected.authors.length > 0 && (
              <p className="openalex-meta">{selected.authors.join(", ")}</p>
            )}
            {selected.institutions.length > 0 && (
              <p className="openalex-meta">
                {selected.institutions.join(" · ")}
              </p>
            )}
            <p className="openalex-meta">
              {[selected.venue, selected.year, selected.type]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {selected.topic && (
              <p className="openalex-meta">Sujet : {selected.topic}</p>
            )}
            {selected.abstract ? (
              <p className="openalex-abstract">{selected.abstract}</p>
            ) : (
              <p className="openalex-meta">Pas d’abstract disponible.</p>
            )}
            {selected.doi && (
              <p className="openalex-meta">doi:{selected.doi}</p>
            )}
            <div className="openalex-detail-actions">
              <button
                type="button"
                onClick={() => openWorkTile(tile, selected)}
              >
                Ouvrir en tuile
              </button>
              <button
                type="button"
                disabled={!selected.pdfCandidates.length || opening}
                title={
                  selected.pdfCandidates.length
                    ? "Ouvrir le PDF libre dans une tuile"
                    : "Aucun PDF libre pour ce travail"
                }
                onClick={() => void openPdf(selected)}
              >
                {opening ? "Vérification…" : "Lire le PDF"}
              </button>
            </div>
            {pdfError && (
              <p className="openalex-error" role="alert">
                {pdfError}
              </p>
            )}
          </article>
        ) : (
          <p className="openalex-note">
            {current.status === "loading"
              ? "Recherche en cours…"
              : "Cherchez un sujet pour commencer."}
          </p>
        )}
      </div>
    </section>
  );
}

function WorkView({ tile }: TileViewProps) {
  const [work, setWork] = useState<Work | undefined>(works.get(tile.data.work));
  const [error, setError] = useState<string>();
  const [opening, setOpening] = useState(false);
  const [pdfError, setPdfError] = useState<string>();

  useEffect(() => {
    let alive = true;
    setError(undefined);
    void getWork(tile.data.work)
      .then((value) => {
        if (alive) setWork(value);
      })
      .catch((failure) => {
        if (alive)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      });
    return () => {
      alive = false;
    };
  }, [tile.data.work]);

  async function openPdf() {
    if (!work) return;
    setOpening(true);
    setPdfError(undefined);
    try {
      await openPdfTile(tile, work);
    } catch (failure) {
      setPdfError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setOpening(false);
    }
  }

  if (error) return <p className="openalex-error">{error}</p>;
  if (!work) return <p className="openalex-note">Chargement du travail…</p>;

  return (
    <article className="openalex-work">
      <header className="openalex-work-header">
        <h1 className="openalex-work-title">{work.title}</h1>
        {work.authors.length > 0 && (
          <p className="openalex-meta">{work.authors.join(", ")}</p>
        )}
        <p className="openalex-meta">
          {[work.venue, work.year, work.type].filter(Boolean).join(" · ")}
        </p>
        {work.topic && <p className="openalex-meta">Sujet : {work.topic}</p>}
        <div className="openalex-detail-actions">
          {work.pdfCandidates.length > 0 ? (
            <button type="button" disabled={opening} onClick={() => void openPdf()}>
              {opening ? "Ouverture…" : "Lire le PDF"}
            </button>
          ) : (
            <button
              type="button"
              disabled
              title="Aucun PDF libre n’est référencé pour ce travail"
            >
              Aucun PDF libre
            </button>
          )}
          {pdfError && <span className="openalex-error">{pdfError}</span>}
          <span className="openalex-meta">
            {work.citedBy} citations · {work.references} références
            {work.openAccess ? " · accès ouvert" : ""}
          </span>
        </div>
      </header>
      {work.abstract ? (
        <p className="openalex-abstract">{work.abstract}</p>
      ) : (
        <p className="openalex-meta">Pas d’abstract disponible.</p>
      )}
      <footer className="openalex-work-footer">
        {work.doi && <p className="openalex-meta">doi:{work.doi}</p>}
        {work.pdfCandidates[0] && (
          <p className="openalex-meta">PDF : {work.pdfCandidates[0]}</p>
        )}
        <p className="openalex-meta">openalex.org/{work.id}</p>
      </footer>
    </article>
  );
}

export default function createOpenAlex(): ExtensionModule {
  return {
    activate(lab) {
      api = lab;
      api.tiles.register({
        type: searchType,
        title: manifest.name,
        icon: manifest.icon,
        view: SearchView,
        dataKeys: ["query"],
        guide:
          "Recherche bibliographique OpenAlex. search { query, by?, limit?, yearFrom?, yearTo?, openAccess?, type?, sort? } où by vaut topic, author ou doi (un DOI est détecté seul) ; renvoie { ref, count, top }. select { work } choisit un identifiant ; read_fields { fields? } renvoie les champs du travail sélectionné (abstract plafonné) ; cite { format: bibtex|apa } ; open_work { work } ouvre la fiche dans une tuile à côté. Les résultats restent dans la tuile.",
        describe: (tile) => {
          const state = snapshots.get(tile.id);
          if (!state?.query) return "aucune recherche";
          const selected = state.results.find(
            (work) => work.id === state.selected,
          );
          return `${state.query} · ${state.results.length} résultats${
            selected ? ` · ${selected.title}` : ""
          }`;
        },
        actions: {
          search: {
            title: "Chercher",
            description:
              "Interroge OpenAlex avec filtres et tri. Renvoie un compte et les premiers titres, sans contenu lourd.",
            input: {
              query: { type: "string", description: "Sujet ou mots-clés." },
              by: {
                type: "string",
                required: false,
                enum: ["topic", "author", "doi"],
                description:
                  "Mode de recherche. Un DOI est détecté automatiquement.",
              },
              limit: {
                type: "number",
                required: false,
                description: "Nombre de résultats (1 à 25, défaut 10).",
              },
              yearFrom: {
                type: "number",
                required: false,
                description: "Année minimale.",
              },
              yearTo: {
                type: "number",
                required: false,
                description: "Année maximale.",
              },
              openAccess: {
                type: "boolean",
                required: false,
                description: "Ne garder que les accès ouverts.",
              },
              type: {
                type: "string",
                required: false,
                description: "article, review, book-chapter, dissertation…",
              },
              sort: {
                type: "string",
                required: false,
                enum: ["relevance", "citations", "date"],
                description: "Ordre des résultats.",
              },
            },
            run: async (tile, input) => {
              const { results, total } = await runSearch(
                tile,
                optionsFrom(input),
              );
              return {
                ref: tile.id,
                count: results.length,
                total,
                top: results.slice(0, 5).map((work) => ({
                  id: work.id,
                  title: work.title,
                  year: work.year,
                })),
              };
            },
          },
          select: {
            title: "Sélectionner un travail",
            description:
              "Choisit un résultat de la recherche par son identifiant.",
            input: {
              work: {
                type: "string",
                description: "Identifiant OpenAlex, par exemple W2741809807.",
              },
            },
            run: (tile, input) => {
              const work = selectWork(tile, String(input.work));
              return {
                id: work.id,
                title: work.title,
                year: work.year,
                pdf: Boolean(work.pdfUrl),
              };
            },
          },
          read_fields: {
            title: "Lire le travail sélectionné",
            description:
              "Renvoie les champs du travail sélectionné. L’abstract est plafonné.",
            input: {
              fields: {
                type: "string",
                required: false,
                description:
                  "Champs séparés par des virgules : title, authors, institutions, venue, year, type, doi, citations, references, openAccess, topic, abstract, pdfUrl.",
              },
            },
            run: (tile, input) => {
              const fields =
                typeof input.fields === "string"
                  ? input.fields
                      .split(",")
                      .map((field) => field.trim())
                      .filter(Boolean)
                  : [];
              return fieldsOf(selectedWork(tile), fields);
            },
          },
          cite: {
            title: "Citer le travail",
            description:
              "Renvoie une citation BibTeX ou APA du travail sélectionné.",
            input: {
              format: {
                type: "string",
                enum: ["bibtex", "apa"],
                description: "Format de citation.",
              },
            },
            run: (tile, input) => ({
              citation: cite(
                selectedWork(tile),
                input.format === "apa" ? "apa" : "bibtex",
              ),
            }),
          },
          open_work: {
            title: "Ouvrir la fiche",
            description:
              "Ouvre le travail sélectionné dans une tuile de fiche, à côté de la recherche.",
            input: {
              work: {
                type: "string",
                required: false,
                description:
                  "Identifiant à ouvrir. Par défaut, le travail sélectionné.",
              },
            },
            run: (tile, input) => {
              const work =
                typeof input.work === "string" && input.work
                  ? selectWork(tile, input.work)
                  : selectedWork(tile);
              const created = openWorkTile(tile, work);
              return { ref: created.id, title: work.title };
            },
          },
        },
      });

      api.tiles.register({
        type: workType,
        title: "Travail",
        icon: manifest.icon,
        view: WorkView,
        dataKeys: ["work"],
        guide:
          "Fiche d’un travail OpenAlex. open_pdf { } ouvre son PDF libre dans Aperçu et renvoie sa référence. Sans PDF libre, l’action refuse et propose le DOI ; si Aperçu est désactivé, l’action est indisponible.",
        describe: (tile) => {
          const work = works.get(tile.data.work);
          return work
            ? `${work.title}${work.year ? ` · ${work.year}` : ""}`
            : tile.data.work;
        },
        actions: {
          open_pdf: {
            title: "Lire le PDF",
            description:
              "Ouvre le PDF libre du travail dans une tuile Aperçu.",
            requires: [previewPdf],
            run: async (tile) => {
              const work = works.get(tile.data.work);
              if (!work) throw new Error("Travail non chargé.");
              const created = await openPdfTile(tile, work);
              return { ref: created.id };
            },
          },
        },
      });

      api.commands.register({
        id: "openalex.search",
        title: "Recherche OpenAlex",
        icon: manifest.icon,
        tileType: searchType,
        keywords: ["papier", "article", "science", "bibliographie", "pdf"],
        run: () => api.tabs.openTile(searchType),
      });
    },
  };
}
