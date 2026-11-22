import type { Locale } from "../../core/i18n.ts";
import type { CellType, Table, TableColumn, TableRow } from "./api.ts";

export const MAX_ROWS = 2_000;
export const MAX_COLUMNS = 32;
export const MAX_TABLES = 20;
export const MAX_BYTES = 1_000_000;
export const MAX_NAME = 80;
/** Budget du workspace entier : un seul document est sérialisé à chaque sauvegarde. */
export const MAX_TOTAL_BYTES = 2_000_000;

export interface DataState {
  version: 1;
  tables: Table[];
}

const uuid = () => crypto.randomUUID();

export function newColumn(name: string, type: CellType = "text"): TableColumn {
  return { id: uuid(), name: name.slice(0, MAX_NAME), type };
}

export function newRow(columns: number): TableRow {
  return { id: uuid(), cells: Array.from({ length: columns }, () => "") };
}

export function createTable(
  name = "Table",
  columns = 3,
  rows = 8,
  columnName: (index: number) => string = (index) => `Column ${index + 1}`,
): Table {
  const headers = Array.from({ length: columns }, (_, index) =>
    newColumn(columnName(index + 1)),
  );
  return {
    version: 1,
    id: uuid(),
    name: name.slice(0, MAX_NAME),
    columns: headers,
    rows: Array.from({ length: rows }, () => newRow(headers.length)),
    updatedAt: Date.now(),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validColumn(value: unknown): value is TableColumn {
  return (
    record(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.type === "text" || value.type === "number" || value.type === "date")
  );
}

function validRow(value: unknown): value is TableRow {
  return (
    record(value) &&
    typeof value.id === "string" &&
    Array.isArray(value.cells) &&
    value.cells.every((cell) => typeof cell === "string")
  );
}

function validTable(value: unknown): value is Table {
  return (
    record(value) &&
    value.version === 1 &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.updatedAt === "number" &&
    Array.isArray(value.columns) &&
    value.columns.every(validColumn) &&
    Array.isArray(value.rows) &&
    value.rows.every(validRow)
  );
}

export function restoreDataState(value: unknown): DataState {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.tables))
    return { version: 1, tables: [] };
  const tables = value.tables
    .filter(validTable)
    .slice(0, MAX_TABLES)
    .map((table) => clampTable(table).table);
  const ids = new Set<string>();
  return {
    version: 1,
    tables: tables.filter((table) => {
      if (ids.has(table.id)) return false;
      ids.add(table.id);
      return true;
    }),
  };
}

export function numberOf(value: string): number | undefined {
  const cleaned = value
    .trim()
    .replace(/\s|\u00a0|\u202f/g, "")
    .replace(",", ".")
    .replace(/^\+/, "");
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function dateOf(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Valeur de tri : les nombres et les dates se comparent, le texte suit la locale. */
function sortValue(
  value: string,
  type: CellType,
  locale: Locale,
): number | string | undefined {
  if (type === "number") return numberOf(value);
  if (type === "date") return dateOf(value);
  return value.toLocaleLowerCase(locale);
}

export function sortRows(
  rows: readonly TableRow[],
  column: number,
  direction: "asc" | "desc",
  type: CellType,
  locale: Locale = "en",
): TableRow[] {
  const compare = (first: TableRow, second: TableRow) => {
    const left = sortValue(first.cells[column] ?? "", type, locale);
    const right = sortValue(second.cells[column] ?? "", type, locale);
    if (left === undefined && right === undefined) return 0;
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    if (typeof left === "number" && typeof right === "number")
      return left - right;
    return String(left).localeCompare(String(right), locale, {
      numeric: true,
      sensitivity: "base",
    });
  };
  const sorted = [...rows].sort(compare);
  return direction === "asc" ? sorted : sorted.reverse();
}

export function filterRows(
  rows: readonly TableRow[],
  query: string,
  locale: Locale = "en",
): TableRow[] {
  const wanted = query.trim().toLocaleLowerCase(locale);
  if (!wanted) return [...rows];
  return rows.filter((row) =>
    row.cells.some((cell) => cell.toLocaleLowerCase(locale).includes(wanted)),
  );
}

export function parseTsv(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && lines.at(-1) === "") lines.pop();
  return lines.map((line) => line.split("\t"));
}

export function toTsv(rows: readonly string[][]): string {
  return rows.map((row) => row.join("\t")).join("\n");
}

/**
 * Ramène un tableau dans les bornes du stockage. Le workspace entier est
 * sérialisé dans un seul document : un tableau trop lourd doit être tronqué,
 * pas laisser grossir l'espace sans limite.
 */
export function clampTable(table: Table): { table: Table; truncated: boolean } {
  let truncated = false;
  const columns = table.columns.slice(0, MAX_COLUMNS).map((column) => ({
    ...column,
    name: column.name.slice(0, MAX_NAME),
  }));
  if (columns.length !== table.columns.length) truncated = true;
  const rows = table.rows.slice(0, MAX_ROWS).map((row) => {
    const cells = columns.map((_, index) => row.cells[index] ?? "");
    if (cells.length !== row.cells.length) truncated = true;
    return { ...row, cells };
  });
  if (rows.length !== table.rows.length) truncated = true;
  let next: Table = { ...table, columns, rows };
  if (JSON.stringify(next).length > MAX_BYTES) {
    let low = 1;
    let high = next.rows.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = { ...next, rows: next.rows.slice(0, middle) };
      if (JSON.stringify(candidate).length <= MAX_BYTES) low = middle;
      else high = middle - 1;
    }
    next = { ...next, rows: next.rows.slice(0, Math.max(1, low)) };
    truncated = true;
  }
  return { table: next, truncated };
}

export function cellColumn(table: Table, columnId: string) {
  return table.columns.findIndex((column) => column.id === columnId);
}

export function cellValue(table: Table, rowId: string, columnId: string) {
  const column = cellColumn(table, columnId);
  const row = table.rows.find((item) => item.id === rowId);
  return column < 0 || !row ? "" : (row.cells[column] ?? "");
}

export function displayDate(value: number, locale: Locale = "en") {
  return new Date(value).toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
