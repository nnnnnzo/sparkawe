import type { EventKey, ServiceKey, Tile } from "../../sdk/index.ts";

export type CellType = "text" | "number" | "date";

export interface TableColumn {
  id: string;
  name: string;
  type: CellType;
}

export interface TableRow {
  id: string;
  cells: string[];
}

export interface Table {
  version: 1;
  id: string;
  name: string;
  columns: TableColumn[];
  rows: TableRow[];
  updatedAt: number;
}

export interface TableSummary {
  id: string;
  name: string;
  rows: number;
  columns: number;
}

export interface TablesService {
  list(): TableSummary[];
  get(id: string): Table | undefined;
  create(name?: string, columns?: string[]): Table;
  update(id: string, next: Table): void;
  subscribe(listener: () => void): () => void;
}

export const dataTables: ServiceKey<TablesService> = {
  id: "data.tables@1",
};

export const tableChanged: EventKey<{ id: string }> = {
  id: "data.table.changed",
};

export interface ChartSource {
  table: string;
  x: string;
  y: string[];
  type: ChartType;
}

export type ChartType = "bar" | "line" | "area" | "scatter";

export interface ChartViewer {
  open(source: ChartSource, alongside?: string): Tile;
}

export const dataCharts: ServiceKey<ChartViewer> = {
  id: "data.charts@1",
};
