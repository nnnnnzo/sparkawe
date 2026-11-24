import { t as translateNow } from "../../i18n/index.ts";
import type { TablesService, TableSummary, Table } from "./api.ts";
import {
  MAX_COLUMNS,
  MAX_ROWS,
  MAX_TABLES,
  MAX_TOTAL_BYTES,
  clampTable,
  createTable,
  restoreDataState,
  type DataState,
} from "./model.ts";

/** Noms par défaut résolus au moment de la création, dans la langue active. */
export interface TableStoreLabels {
  name: () => string;
  column: (index: number) => string;
}

const fallbackLabels: TableStoreLabels = {
  name: () => "Table",
  column: (index) => `Column ${index + 1}`,
};

export class TableStore implements TablesService {
  private state: DataState;
  private readonly save: (value: unknown) => void;
  private readonly onChange: (id: string) => void;
  private readonly onTruncated: (message: string) => void;
  private readonly listeners = new Set<() => void>();
  private readonly labels: TableStoreLabels;

  constructor(
    initial: unknown,
    save: (value: unknown) => void,
    onChange: (id: string) => void,
    onTruncated: (message: string) => void,
    labels: Partial<TableStoreLabels> = {},
  ) {
    this.state = restoreDataState(initial);
    this.save = save;
    this.onChange = onChange;
    this.onTruncated = onTruncated;
    this.labels = { ...fallbackLabels, ...labels };
  }

  list = (): TableSummary[] =>
    this.state.tables.map((table) => ({
      id: table.id,
      name: table.name,
      rows: table.rows.length,
      columns: table.columns.length,
    }));

  get = (id: string): Table | undefined =>
    this.state.tables.find((table) => table.id === id);

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  create = (name?: string, columns?: string[]): Table => {
    if (this.state.tables.length >= MAX_TABLES)
      throw new Error(translateNow("data.limit.tables", { count: MAX_TABLES }));
    const names = columns?.length
      ? columns
          .map((column) => column.trim())
          .filter(Boolean)
          .slice(0, MAX_COLUMNS)
      : [1, 2, 3].map((index) => this.labels.column(index));
    const table = createTable(
      name ?? this.labels.name(),
      names.length,
      8,
      this.labels.column,
    );
    table.columns = table.columns.map((column, index) => ({
      ...column,
      name: names[index] ?? column.name,
    }));
    this.state = { version: 1, tables: [...this.state.tables, table] };
    this.commit(table.id);
    return table;
  };

  /** Retire une table créée par une action annulée. */
  remove = (id: string) => {
    if (!this.get(id)) return;
    this.state = {
      version: 1,
      tables: this.state.tables.filter((table) => table.id !== id),
    };
    this.commit(id);
  };

  update = (id: string, next: Table) => {
    const current = this.get(id);
    if (!current) return;
    const clamped = clampTable({
      ...next,
      id,
      version: 1,
      updatedAt: Date.now(),
    });
    this.state = {
      version: 1,
      tables: this.state.tables.map((table) =>
        table.id === id ? clamped.table : table,
      ),
    };
    this.commit(id);
    if (clamped.truncated)
      this.onTruncated(
        translateNow("data.limit.table", {
          rows: MAX_ROWS,
          columns: MAX_COLUMNS,
        }),
      );
  };

  private fits(tables: Table[]) {
    return JSON.stringify({ version: 1, tables }).length <= MAX_TOTAL_BYTES;
  }

  /** Ramène l'espace sous son budget en trimmant les lignes des tableaux. */
  private fit(id: string) {
    if (this.fits(this.state.tables)) return false;
    const tables = this.state.tables.map((table) => ({
      ...table,
      rows: [...table.rows],
    }));
    const order = [
      id,
      ...tables.map((table) => table.id).filter((key) => key !== id),
    ];
    let trimmed = false;
    for (const tableId of order) {
      const table = tables.find((item) => item.id === tableId);
      if (!table) continue;
      const original = table.rows;
      let low = 0;
      let high = original.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        table.rows = original.slice(0, middle);
        if (this.fits(tables)) low = middle;
        else high = middle - 1;
      }
      table.rows = original.slice(0, low);
      if (table.rows.length !== original.length) trimmed = true;
      if (this.fits(tables)) break;
    }
    this.state = { version: 1, tables };
    return trimmed;
  }

  private commit(id: string) {
    if (this.fit(id))
      this.onTruncated(
        translateNow("data.limit.workspace", {
          size: Math.round(MAX_TOTAL_BYTES / 1_000_000),
        }),
      );
    this.save(this.state);
    this.onChange(id);
    for (const listener of this.listeners) listener();
  }
}
