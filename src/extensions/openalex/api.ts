/**
 * OpenAlex, sans clé et sans proxy : l'API publique répond en CORS.
 * On ne demande que les champs utiles, et l'abstract est reconstruit depuis
 * l'index inversé — c'est là que se joue le coût en tokens.
 */

export interface Work {
  id: string;
  title: string;
  year?: number;
  doi?: string;
  citedBy: number;
  references: number;
  openAccess: boolean;
  authors: string[];
  institutions: string[];
  abstract: string;
  venue?: string;
  type?: string;
  language?: string;
  topic?: string;
  pdfUrl?: string;
  pdfCandidates: string[];
}

export interface SearchOptions {
  query: string;
  limit?: number;
  yearFrom?: number;
  yearTo?: number;
  openAccess?: boolean;
  type?: string;
  sort?: "relevance" | "citations" | "date";
  by?: "topic" | "author" | "doi";
  /** Identifiant d'auteur résolu, pour le mode auteur. */
  authorId?: string;
}

interface RawWork {
  id?: string;
  title?: string;
  publication_year?: number;
  doi?: string;
  cited_by_count?: number;
  referenced_works_count?: number;
  type?: string;
  language?: string;
  open_access?: { is_oa?: boolean; oa_url?: string };
  primary_location?: {
    pdf_url?: string;
    source?: { display_name?: string };
  };
  best_oa_location?: { pdf_url?: string };
  locations?: { pdf_url?: string }[];
  primary_topic?: { display_name?: string };
  authorships?: {
    author?: { display_name?: string };
    institutions?: { display_name?: string }[];
  }[];
  abstract_inverted_index?: Record<string, number[]> | null;
}

const API = "https://api.openalex.org/works";
const SELECT = [
  "id",
  "title",
  "publication_year",
  "doi",
  "cited_by_count",
  "referenced_works_count",
  "type",
  "language",
  "open_access",
  "primary_location",
  "best_oa_location",
  "locations",
  "primary_topic",
  "authorships",
  "abstract_inverted_index",
].join(",");

export function abstractFrom(
  index: Record<string, number[]> | null | undefined,
  limit = 4000,
): string {
  if (!index) return "";
  const words: [number, string][] = [];
  for (const [word, positions] of Object.entries(index))
    for (const position of positions) words.push([position, word]);
  const text = words
    .sort((first, second) => first[0] - second[0])
    .map(([, word]) => word)
    .join(" ");
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

/** MDPI bloque les clients automatiques sur www.mdpi.com, mais son CDN
 *  statique sert les mêmes PDF sans anti-bot. On construit l'URL du CDN. */
const MDPI_SLUGS: Record<string, string> = {
  "2071-1050": "sustainability",
  "2072-4292": "remotesensing",
  "1424-8220": "sensors",
  "1996-1073": "energies",
  "2079-9292": "electronics",
  "2227-7390": "mathematics",
  "2304-8158": "foods",
  "2073-4441": "water",
  "1996-1944": "materials",
  "2075-1702": "machines",
  "2076-3417": "applsci",
  "1660-4601": "ijerph",
  "2078-2489": "information",
  "2073-8994": "symmetry",
  "1420-3049": "molecules",
  "2079-6412": "coatings",
  "2076-2615": "animals",
  "2077-0472": "agriculture",
  "2076-3298": "environments",
  "2073-4395": "agronomy",
  "2073-4360": "polymers",
  "2073-4468": "membranes",
  "2077-1312": "jmse",
  "2072-6643": "nutrients",
  "2077-0383": "jcm",
  "2075-4418": "diagnostics",
  "1999-4907": "forests",
  "2073-4433": "atmosphere",
  "2076-3425": "brainsci",
  "2075-1729": "life",
  "2079-7737": "biology",
  "2076-2607": "microorganisms",
};

export function mdpiCandidates(pdfUrl: string, venue?: string): string[] {
  const match =
    /^https:\/\/www\.mdpi\.com\/(\d{4}-\d{3}[\dX])\/(\d+)\/\d+\/(\d+)\/pdf/i.exec(
      pdfUrl,
    );
  if (!match) return [];
  const [, issn, volume, article] = match;
  const padded = article.padStart(5, "0");
  const slugs = new Set<string>();
  const guessed = venue?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (guessed) slugs.add(guessed);
  if (MDPI_SLUGS[issn]) slugs.add(MDPI_SLUGS[issn]);
  return [...slugs].map(
    (slug) =>
      `https://mdpi-res.com/d_attachment/${slug}/${slug}-${volume}-${padded}/article_deploy/${slug}-${volume}-${padded}.pdf`,
  );
}

export function toWork(raw: RawWork): Work {
  const authors = unique(
    (raw.authorships ?? []).map(
      (authorship) => authorship.author?.display_name ?? "",
    ),
  );
  const institutions = unique(
    (raw.authorships ?? []).flatMap((authorship) =>
      (authorship.institutions ?? []).map(
        (institution) => institution.display_name ?? "",
      ),
    ),
  );
  const venue = raw.primary_location?.source?.display_name;
  const direct = unique([
    raw.best_oa_location?.pdf_url ?? "",
    raw.primary_location?.pdf_url ?? "",
    ...(raw.locations ?? []).map((location) => location.pdf_url ?? ""),
  ]);
  const pdfCandidates = unique([
    ...direct.flatMap((url) => mdpiCandidates(url, venue)),
    ...direct,
  ]).slice(0, 8);
  return {
    id: (raw.id ?? "").split("/").pop() ?? "",
    title: raw.title ?? "Sans titre",
    year: raw.publication_year,
    doi: raw.doi?.replace(/^https:\/\/doi\.org\//, ""),
    citedBy: raw.cited_by_count ?? 0,
    references: raw.referenced_works_count ?? 0,
    openAccess: raw.open_access?.is_oa === true,
    authors,
    institutions,
    abstract: abstractFrom(raw.abstract_inverted_index),
    venue,
    type: raw.type,
    language: raw.language,
    topic: raw.primary_topic?.display_name,
    pdfCandidates,
    pdfUrl: pdfCandidates[0],
  };
}

export function normalizeDoi(value: string): string | undefined {
  const match =
    /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)?(10\.\d{4,9}\/\S+)$/i.exec(
      value.trim(),
    );
  return match?.[1];
}

export function searchUrl(options: SearchOptions): string {
  const query = options.query.trim();
  const doi = normalizeDoi(query);
  const by = options.by ?? (doi ? "doi" : "topic");
  const filters: string[] = [];
  if (options.yearFrom)
    filters.push(`from_publication_date:${options.yearFrom}-01-01`);
  if (options.yearTo)
    filters.push(`to_publication_date:${options.yearTo}-12-31`);
  if (options.openAccess) filters.push("is_oa:true");
  if (options.type) filters.push(`type:${options.type}`);
  if (by === "doi") {
    if (!doi) throw new Error("DOI invalide.");
    filters.unshift(`doi:${doi}`);
  } else if (by === "author") {
    filters.unshift(
      options.authorId
        ? `authorships.author.id:${options.authorId}`
        : `raw_author_name.search:${query}`,
    );
  }
  const perPage = Math.min(Math.max(Math.trunc(options.limit ?? 10), 1), 25);
  const params = new URLSearchParams({
    "per-page": String(perPage),
    select: SELECT,
  });
  if (by === "topic") params.set("search", query);
  if (filters.length) params.set("filter", filters.join(","));
  if (options.sort === "citations") params.set("sort", "cited_by_count:desc");
  else if (options.sort === "date") params.set("sort", "publication_date:desc");
  return `${API}?${params.toString()}`;
}

async function resolveAuthorId(query: string): Promise<string | undefined> {
  try {
    const response = await fetch(
      `https://api.openalex.org/authors?search=${encodeURIComponent(query)}&per-page=1&select=id`,
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok) return undefined;
    const payload = (await response.json()) as { results?: { id?: string }[] };
    return payload.results?.[0]?.id?.split("/").pop();
  } catch {
    return undefined;
  }
}

export async function searchWorks(
  options: SearchOptions,
): Promise<{ total: number; results: Work[] }> {
  if (!options.query.trim()) throw new Error("Recherche vide.");
  if (options.by === "doi" && !normalizeDoi(options.query))
    throw new Error("DOI invalide.");
  const by = options.by ?? (normalizeDoi(options.query) ? "doi" : "topic");
  const authorId =
    by === "author" ? await resolveAuthorId(options.query) : undefined;
  const response = await fetch(searchUrl({ ...options, authorId }), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(
      `OpenAlex a répondu ${response.status}. Réessayez plus tard.`,
    );
  const payload = (await response.json()) as {
    meta?: { count?: number };
    results?: RawWork[];
  };
  return {
    total: payload.meta?.count ?? 0,
    results: (payload.results ?? []).map(toWork),
  };
}

export async function fetchWork(id: string): Promise<Work> {
  const clean = id.replace(/^https:\/\/openalex\.org\//, "");
  const response = await fetch(
    `${API}/${encodeURIComponent(clean)}?select=${SELECT}`,
    {
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok)
    throw new Error(`OpenAlex a répondu ${response.status} pour ${clean}.`);
  return toWork((await response.json()) as RawWork);
}

export function cite(work: Work, format: "bibtex" | "apa"): string {
  const url = `https://openalex.org/${work.id}`;
  if (format === "apa") {
    const authors = work.authors.length
      ? work.authors.join(", ")
      : "Auteur inconnu";
    const year = work.year ? `(${work.year}).` : "(s. d.).";
    const doi = work.doi ? ` https://doi.org/${work.doi}` : ` ${url}`;
    return `${authors} ${year} ${work.title}.${doi}`;
  }
  const fields = [
    `  title   = {${work.title.replace(/[{}]/g, "")}}`,
    work.authors.length
      ? `  author  = {${work.authors.join(" and ")}}`
      : undefined,
    work.year ? `  year    = {${work.year}}` : undefined,
    work.doi ? `  doi     = {${work.doi}}` : undefined,
    `  url     = {${url}}`,
  ].filter(Boolean);
  return `@article{${work.id},\n${fields.join(",\n")}\n}`;
}
