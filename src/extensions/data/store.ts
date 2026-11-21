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

export class TableStore implements TablesService {
  private state: DataState;
  private readonly save: (value: unknown) => void;
  private readonly onChange: (id: string) => void;
  private readonly onTruncated: (message: string) => void;
  private readonly listeners = new Set<() => void>();

  constructor(
    initial: unknown,
    save: (value: unknown) => void,
    onChange: (id: string) => void,
    onTruncated: (message: string) => void,
  ) {
    this.state = restoreDataState(initial);
    this.save = save;
    this.onChange = onChange;
    this.onTruncated = onTruncated;
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
      throw new Error(`Limite de ${MAX_TABLES} tableaux atteinte.`);
    const names = columns?.length
      ? columns
          .map((column) => column.trim())
          .filter(Boolean)
          .slice(0, MAX_COLUMNS)
      : ["Colonne 1", "Colonne 2", "Colonne 3"];
    const table = createTable(name, names.length, 8);
    table.columns = table.columns.map((column, index) => ({
      ...column,
      name: names[index] ?? column.name,
    }));
    this.state = { version: 1, tables: [...this.state.tables, table] };
    this.commit(table.id);
    return table;
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
        `Tableau limité à ${MAX_ROWS} lignes, ${MAX_COLUMNS} colonnes ou 1 Mo.`,
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
        `Espace Données limité à ${Math.round(MAX_TOTAL_BYTES / 1_000_000)} Mo : lignes retirées.`,
      );
    this.save(this.state);
    this.onChange(id);
    for (const listener of this.listeners) listener();
  }
}
