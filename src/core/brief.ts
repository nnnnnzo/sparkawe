import type { LocalizedText, Tile, TileSurface } from "../sdk/index.ts";
import { resolveText, translate, type Locale } from "./i18n.ts";
import type { JournalEntry, JournalSource } from "./journal.ts";
import type { Mode, WorkspaceState } from "./workspace.ts";

export interface TileCatalog {
  getTile(type: string):
    | {
        title: LocalizedText;
        describe?(tile: Tile, surface: TileSurface): string;
      }
    | undefined;
  surface?(tileId: string): TileSurface | undefined;
}

export interface BriefInputs {
  workspace: { get(): WorkspaceState };
  catalog: TileCatalog;
  journal: { list(limit?: number): JournalEntry[]; lastSeq: number };
  locale?: Locale;
}

export interface TileBrief {
  id: string;
  type: string;
  title: string;
  summary?: string;
}

export interface TabBrief {
  id: string;
  name: string;
  mode: Mode;
  active: boolean;
  focused?: string;
  tiles: TileBrief[];
}

export interface Brief {
  app: "spark";
  at: string;
  lastSeq: number;
  tab: TabBrief;
  others: { id: string; name: string }[];
  events: {
    seq: number;
    at: number;
    source: JournalSource;
    kind: string;
    tabId?: string;
    tileId?: string;
    data?: unknown;
  }[];
  text: string;
}

/** Entrées trop fréquentes pour renseigner un agent sans le noyer. */
const NOISY = new Set(["tile.focus", "tab.reorder"]);
const EVENT_LIMIT = 8;
const MAX_SUMMARY = 120;
const MAX_TEXT = 1400;

const eventKeys: Record<string, string> = {
  "tab.create": "brief.event.tab.create",
  "tab.remove": "brief.event.tab.remove",
  "tab.activate": "brief.event.tab.activate",
  "tile.open": "brief.event.tile.open",
  "tile.close": "brief.event.tile.close",
};

function summaryOf(catalog: TileCatalog, tile: Tile): string | undefined {
  const definition = catalog.getTile(tile.type);
  if (!definition?.describe) return undefined;
  try {
    const summary = definition
      .describe(tile, catalog.surface?.(tile.id) ?? {})
      .trim()
      .replace(/\s+/g, " ");
    return summary ? summary.slice(0, MAX_SUMMARY) : undefined;
  } catch {
    return undefined;
  }
}

function clock(at: number, locale: Locale) {
  return new Date(at).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildBrief(
  { workspace, catalog, journal, locale = "en" }: BriefInputs,
  tabId?: string,
): Brief {
  const state = workspace.get();
  const id = tabId ?? state.active;
  const tab = state.tabs.find((candidate) => candidate.id === id);
  if (!tab) throw new Error(`Onglet inconnu : ${id}`);

  const tiles: TileBrief[] = tab.tiles.map((tile) => {
    const summary = summaryOf(catalog, tile);
    const definition = catalog.getTile(tile.type);
    return {
      id: tile.id,
      type: tile.type,
      title: definition
        ? resolveText(definition.title, locale) || tile.type
        : tile.type,
      ...(summary ? { summary } : {}),
    };
  });

  const titles = new Map(tiles.map((tile) => [tile.id, tile.title]));
  const events = journal
    .list(EVENT_LIMIT * 4)
    .filter(
      (entry) =>
        !NOISY.has(entry.kind) &&
        (entry.tabId === undefined || entry.tabId === tab.id),
    )
    .slice(-EVENT_LIMIT);

  const brief: Brief = {
    app: "spark",
    at: new Date().toISOString(),
    lastSeq: journal.lastSeq,
    tab: {
      id: tab.id,
      name: tab.name,
      mode: tab.mode,
      active: tab.id === state.active,
      ...(tab.focused ? { focused: tab.focused } : {}),
      tiles,
    },
    others: state.tabs
      .filter((candidate) => candidate.id !== tab.id)
      .map((candidate) => ({ id: candidate.id, name: candidate.name })),
    events: events.map((entry) => ({
      seq: entry.seq,
      at: entry.at,
      source: entry.source,
      kind: entry.kind,
      ...(entry.tabId ? { tabId: entry.tabId } : {}),
      ...(entry.tileId ? { tileId: entry.tileId } : {}),
      ...(entry.data === undefined ? {} : { data: entry.data }),
    })),
    text: "",
  };
  brief.text = renderBrief(brief, titles, locale);
  return brief;
}

function describeEntry(
  entry: Brief["events"][number],
  titles: Map<string, string>,
  locale: Locale,
) {
  const key = eventKeys[entry.kind];
  const label = key
    ? translate(locale, key)
    : entry.kind.replace(/^event:/, "");
  const lines = [`${clock(entry.at, locale)} ${label}`];
  const data = entry.data as { type?: unknown } | undefined;
  const subject =
    (entry.tileId ? titles.get(entry.tileId) : undefined) ??
    (typeof data?.type === "string" ? data.type : undefined);
  if (subject) lines.push(subject);
  if (entry.source === "agent") lines.push(translate(locale, "brief.agent"));
  return lines.join(" · ");
}

export function renderBrief(
  brief: Brief,
  titles = new Map<string, string>(),
  locale: Locale = "en",
) {
  const lines: string[] = [
    `Spark · ${brief.tab.name} · ${brief.tab.mode}${
      brief.tab.active ? ` · ${translate(locale, "brief.active")}` : ""
    }`,
  ];
  if (!brief.tab.tiles.length) lines.push(translate(locale, "brief.noTiles"));
  else {
    lines.push(translate(locale, "brief.tiles"));
    for (const tile of brief.tab.tiles) {
      const mark =
        tile.id === brief.tab.focused
          ? ` ${translate(locale, "brief.focus")}`
          : "";
      const summary = tile.summary ? ` — ${tile.summary}` : "";
      lines.push(`- ${tile.id} · ${tile.title}${summary}${mark}`);
    }
  }
  if (brief.others.length)
    lines.push(
      translate(locale, "brief.otherTabs", {
        tabs: brief.others.map((tab) => tab.name).join(", "),
      }),
    );
  if (brief.events.length) {
    lines.push(translate(locale, "brief.events"));
    for (const entry of brief.events)
      lines.push(`- ${describeEntry(entry, titles, locale)}`);
  }
  const text = lines.join("\n");
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}
