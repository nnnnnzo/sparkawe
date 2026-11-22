import { toast } from "sonner";
import { localized } from "../../core/i18n.ts";
import {
  t as translateNow,
  tp as translatePluralNow,
} from "../../i18n/index.ts";
import type { ActionValue, Tile } from "../../sdk/index.ts";
import type { ExtensionModule } from "../../sdk/react.ts";
import {
  dataCharts,
  dataTables,
  tableChanged,
  type CellType,
  type ChartType,
  type Table,
} from "./api.ts";
import { ChartView } from "./chart.tsx";
import manifest, { chartType, tableType } from "./manifest.ts";
import { MAX_COLUMNS, MAX_ROWS, newColumn, newRow, parseTsv } from "./model.ts";
import { TableStore } from "./store.ts";
import { TableView } from "./table.tsx";
import "./style.css";

const TYPES: ChartType[] = ["bar", "line", "area", "scatter"];

function typeOf(value: ActionValue | undefined): CellType {
  return value === "number" || value === "date" ? value : "text";
}

function chartTypeOf(value: ActionValue | undefined): ChartType {
  return TYPES.includes(value as ChartType) ? (value as ChartType) : "bar";
}

export default function createData(): ExtensionModule {
  return {
    activate(api) {
      const tables = new TableStore(
        api.state.read(),
        (value) => api.state.save(value),
        (id) => api.events.emit(tableChanged, { id }),
        (message) => toast.warning(message),
        {
          name: () => translateNow("data.default.table"),
          column: (index) => translateNow("data.default.column", { index }),
        },
      );

      function tableOf(tile: Tile, input: Record<string, ActionValue>) {
        const id =
          typeof input.table === "string" && input.table
            ? input.table
            : tile.data.table;
        const table = id ? tables.get(id) : undefined;
        if (!table) throw new Error(translateNow("data.error.noTable"));
        return table;
      }

      function rowsOf(table: Table) {
        return table.rows.map((row) => ({
          id: row.id,
          values: Object.fromEntries(
            table.columns.map((column, index) => {
              const value = row.cells[index] ?? "";
              return [
                column.name,
                value.length > 500 ? `${value.slice(0, 500)}…` : value,
              ];
            }),
          ),
        }));
      }

      api.services.provide(dataTables, tables);
      api.services.provide(dataCharts, {
        open(source, alongside) {
          return api.tabs.openTile(
            chartType,
            {
              table: source.table,
              x: source.x,
              y: source.y.join(","),
              type: source.type,
            },
            alongside,
          );
        },
      });

      api.tiles.register({
        type: tableType,
        title: localized("data.tile.table.title"),
        icon: manifest.icon,
        view: (props) => <TableView {...props} api={api} tables={tables} />,
        dataKeys: ["table"],
        guide: localized("data.tile.table.guide"),
        describe: (tile, surface) => {
          const table = tables.get(tile.data.table);
          if (!table) return translateNow("data.describe.noTable");
          const rows = translatePluralNow(
            "data.describe.rows",
            table.rows.length,
          );
          const columns = translatePluralNow(
            "data.describe.columns",
            table.columns.length,
          );
          return `${table.name} · ${rows} × ${columns}${surface.sort ? ` · ${surface.sort}` : ""}`;
        },
        actions: {
          create_table: {
            title: localized("data.action.createTable.title"),
            description: localized("data.action.createTable.description"),
            mutates: true,
            input: {
              name: {
                type: "string",
                required: false,
                description: translateNow("data.action.createTable.name"),
              },
              columns: {
                type: "string",
                required: false,
                description: translateNow("data.action.createTable.columns"),
              },
            },
            run: (tile, input) => {
              const created = tables.create(
                typeof input.name === "string" ? input.name : undefined,
                typeof input.columns === "string"
                  ? input.columns.split(",")
                  : undefined,
              );
              api.tabs.updateTileData(tile.id, { table: created.id });
              return {
                ref: tile.id,
                table: created.id,
                rows: created.rows.length,
                columns: created.columns.length,
              };
            },
          },
          read_table: {
            title: localized("data.action.readTable.title"),
            description: localized("data.action.readTable.description"),
            input: {
              table: {
                type: "string",
                required: false,
                description: translateNow("data.action.readTable.table"),
              },
            },
            run: (tile, input) => {
              const table = tableOf(tile, input);
              return {
                id: table.id,
                name: table.name,
                rows: table.rows.length,
                columns: table.columns.map((column) => ({
                  id: column.id,
                  name: column.name,
                  type: column.type,
                })),
                preview: rowsOf(table)
                  .filter((row) =>
                    Object.values(row.values).some((value) => value !== ""),
                  )
                  .slice(0, 10),
              };
            },
          },
          read_rows: {
            title: localized("data.action.readRows.title"),
            description: localized("data.action.readRows.description"),
            input: {
              table: { type: "string", required: false },
              from: { type: "number", required: false },
              limit: { type: "number", required: false },
            },
            run: (tile, input) => {
              const table = tableOf(tile, input);
              const from = Math.max(
                0,
                typeof input.from === "number" ? input.from : 0,
              );
              const limit = Math.min(
                50,
                Math.max(1, typeof input.limit === "number" ? input.limit : 20),
              );
              return {
                id: table.id,
                from,
                rows: rowsOf(table).slice(from, from + limit),
              };
            },
          },
          append_rows: {
            title: localized("data.action.appendRows.title"),
            description: localized("data.action.appendRows.description"),
            mutates: true,
            input: {
              table: { type: "string", required: false },
              rows: {
                type: "string",
                description: translateNow("data.action.appendRows.rows"),
              },
            },
            run: (tile, input) => {
              const table = tableOf(tile, input);
              const matrix = parseTsv(String(input.rows ?? ""));
              if (!matrix.length)
                throw new Error(translateNow("data.error.noRows"));
              const width = Math.max(...matrix.map((row) => row.length));
              const columns = [...table.columns];
              while (columns.length < width && columns.length < MAX_COLUMNS)
                columns.push(
                  newColumn(
                    translateNow("data.default.column", {
                      index: columns.length + 1,
                    }),
                  ),
                );
              const rows = table.rows.map((row) => ({
                ...row,
                cells: [
                  ...row.cells,
                  ...Array.from(
                    {
                      length: Math.max(0, columns.length - row.cells.length),
                    },
                    () => "",
                  ),
                ],
              }));
              let index = 0;
              const empty = rows.filter((row) =>
                row.cells.every((value) => value === ""),
              );
              for (const row of empty) {
                if (index >= matrix.length) break;
                matrix[index++].forEach((value, cell) => {
                  if (cell < columns.length) row.cells[cell] = value;
                });
              }
              let appended = 0;
              for (; index < matrix.length; index++) {
                if (rows.length >= MAX_ROWS) break;
                const row = newRow(columns.length);
                matrix[index].forEach((value, cell) => {
                  if (cell < columns.length) row.cells[cell] = value;
                });
                rows.push(row);
                appended++;
              }
              tables.update(table.id, { ...table, columns, rows });
              return {
                added: index,
                appended,
                rows: rows.length,
                columns: columns.length,
              };
            },
          },
          set_cell: {
            title: localized("data.action.setCell.title"),
            description: localized("data.action.setCell.description"),
            mutates: true,
            input: {
              table: { type: "string", required: false },
              row: {
                type: "string",
                description: translateNow("data.action.setCell.row"),
              },
              column: {
                type: "string",
                description: translateNow("data.action.setCell.column"),
              },
              value: {
                type: "string",
                description: translateNow("data.action.setCell.value"),
              },
            },
            run: (tile, input) => {
              const table = tableOf(tile, input);
              const rowId = String(input.row ?? "");
              const columnId = String(input.column ?? "");
              const index = table.columns.findIndex(
                (column) => column.id === columnId,
              );
              if (index < 0)
                throw new Error(translateNow("data.error.unknownColumn"));
              if (!table.rows.some((row) => row.id === rowId))
                throw new Error(translateNow("data.error.unknownRow"));
              tables.update(table.id, {
                ...table,
                rows: table.rows.map((row) =>
                  row.id === rowId
                    ? {
                        ...row,
                        cells: row.cells.map((value, cell) =>
                          cell === index ? String(input.value ?? "") : value,
                        ),
                      }
                    : row,
                ),
              });
              return { table: table.id, row: rowId, column: columnId };
            },
          },
          add_column: {
            title: localized("data.action.addColumn.title"),
            description: localized("data.action.addColumn.description"),
            mutates: true,
            input: {
              table: { type: "string", required: false },
              name: {
                type: "string",
                description: translateNow("data.action.addColumn.name"),
              },
              type: {
                type: "string",
                required: false,
                enum: ["text", "number", "date"],
              },
            },
            run: (tile, input) => {
              const table = tableOf(tile, input);
              if (table.columns.length >= MAX_COLUMNS)
                throw new Error(
                  translateNow("data.limit.columns", { count: MAX_COLUMNS }),
                );
              const name =
                String(input.name ?? "").trim() ||
                translateNow("data.default.column", {
                  index: table.columns.length + 1,
                });
              const column = newColumn(name, typeOf(input.type));
              tables.update(table.id, {
                ...table,
                columns: [...table.columns, column],
                rows: table.rows.map((row) => ({
                  ...row,
                  cells: [...row.cells, ""],
                })),
              });
              return { id: column.id, columns: table.columns.length + 1 };
            },
          },
          create_chart: {
            title: localized("data.action.createChart.title"),
            description: localized("data.action.createChart.description"),
            input: {
              table: { type: "string", required: false },
              x: { type: "string", required: false },
              y: {
                type: "string",
                required: false,
                description: translateNow("data.action.createChart.y"),
              },
              type: {
                type: "string",
                required: false,
                enum: TYPES,
              },
            },
            run: (tile, input) => {
              const table = tableOf(tile, input);
              const requested =
                typeof input.x === "string" && input.x ? input.x : "";
              const x =
                (table.columns.some((column) => column.id === requested)
                  ? requested
                  : table.columns[0]?.id) ?? "";
              if (!x) throw new Error(translateNow("data.error.noColumns"));
              let y = String(input.y ?? "")
                .split(",")
                .map((id) => id.trim())
                .filter((id) =>
                  table.columns.some((column) => column.id === id),
                );
              if (!y.length) {
                const fallback =
                  table.columns.find(
                    (column) => column.type === "number" && column.id !== x,
                  ) ?? table.columns.find((column) => column.id !== x);
                y = fallback ? [fallback.id] : [x];
              }
              const created = api.tabs.openTile(
                chartType,
                {
                  table: table.id,
                  x,
                  y: y.join(","),
                  type: chartTypeOf(input.type),
                },
                tile.id,
              );
              return {
                ref: created.id,
                table: table.id,
                x,
                y: y.join(","),
              };
            },
          },
        },
      });

      api.tiles.register({
        type: chartType,
        title: localized("data.tile.chart.title"),
        icon: manifest.icon,
        view: (props) => <ChartView {...props} api={api} tables={tables} />,
        dataKeys: ["table", "x", "y", "type"],
        guide: localized("data.tile.chart.guide"),
        describe: (tile) => {
          const table = tables.get(tile.data.table);
          if (!table) return translateNow("data.describe.noSource");
          const x = table.columns.find((column) => column.id === tile.data.x);
          const y = (tile.data.y ?? "")
            .split(",")
            .map((id) => table.columns.find((column) => column.id === id))
            .filter(Boolean)
            .map((column) => column!.name);
          const type = translateNow(
            `data.chart.type.${chartTypeOf(tile.data.type)}`,
          );
          const series = y.join(", ") || translateNow("data.describe.noSeries");
          return `${type} · ${series}${x ? ` · ${translateNow("data.describe.byX", { x: x.name })}` : ""}`;
        },
        actions: {
          set_chart: {
            title: localized("data.action.setChart.title"),
            description: localized("data.action.setChart.description"),
            input: {
              x: { type: "string", required: false },
              y: { type: "string", required: false },
              type: {
                type: "string",
                required: false,
                enum: TYPES,
              },
            },
            run: (tile, input) => {
              const next: Record<string, string> = {
                ...tile.data,
                ...(typeof input.x === "string" && { x: input.x }),
                ...(typeof input.y === "string" && { y: input.y }),
                ...(typeof input.type === "string" && {
                  type: chartTypeOf(input.type),
                }),
              };
              api.tabs.updateTileData(tile.id, next);
              return {
                table: tile.data.table ?? "",
                x: next.x ?? "",
                y: next.y ?? "",
                type: chartTypeOf(next.type),
              };
            },
          },
          open_source: {
            title: localized("data.action.openSource.title"),
            description: localized("data.action.openSource.description"),
            run: (tile) => {
              const table = tables.get(tile.data.table);
              if (!table) throw new Error(translateNow("data.error.noSource"));
              const created = api.tabs.openTile(
                tableType,
                { table: table.id },
                tile.id,
              );
              return { ref: created.id, table: table.id };
            },
          },
        },
      });

      api.commands.register({
        id: "data.table.open",
        title: localized("data.command.table.title"),
        category: localized("data.category"),
        icon: manifest.icon,
        tileType: tableType,
        keywords: ["tableau", "données", "table", "data", "csv", "tsv"],
        run: () => {
          const table = tables.create();
          return api.tabs.openTile(tableType, { table: table.id });
        },
      });
      api.commands.register({
        id: "data.chart.open",
        title: localized("data.command.chart.title"),
        category: localized("data.category"),
        icon: manifest.icon,
        tileType: chartType,
        keywords: ["graphique", "courbe", "barres", "données", "chart", "data"],
        run: () => api.tabs.openTile(chartType),
      });
    },
  };
}
