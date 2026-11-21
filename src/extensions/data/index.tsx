import { toast } from "sonner";
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
      );

      function tableOf(tile: Tile, input: Record<string, ActionValue>) {
        const id =
          typeof input.table === "string" && input.table
            ? input.table
            : tile.data.table;
        const table = id ? tables.get(id) : undefined;
        if (!table)
          throw new Error(
            "Aucun tableau lié à cette tuile. Utilisez create_table.",
          );
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
        title: "Tableau",
        icon: manifest.icon,
        view: (props) => <TableView {...props} api={api} tables={tables} />,
        dataKeys: ["table"],
        guide:
          "Tableau de données typées (pas un tableur : aucune formule, aucune adresse A1). Colonnes texte, nombre ou date ; chaque ligne a un id stable. Actions : create_table { name?, columns? } lie un nouveau tableau à la tuile ; read_table renvoie les colonnes et 10 lignes ; read_rows { from?, limit? } renvoie des lignes par id ; append_rows { rows } ajoute du TSV ; set_cell { row, column, value } ; add_column { name, type? } ; create_chart { x?, y?, type? } ouvre un graphique à côté. Les écritures sont mutates. Plafonds : 2 000 lignes, 32 colonnes.",
        describe: (tile, surface) => {
          const table = tables.get(tile.data.table);
          if (!table) return "aucun tableau";
          return `${table.name} · ${table.rows.length} lignes × ${table.columns.length} colonnes${surface.sort ? ` · ${surface.sort}` : ""}`;
        },
        actions: {
          create_table: {
            title: "Créer un tableau",
            description:
              "Crée un tableau et le lie à cette tuile. Renvoie sa référence.",
            mutates: true,
            input: {
              name: {
                type: "string",
                required: false,
                description: "Nom du tableau.",
              },
              columns: {
                type: "string",
                required: false,
                description: "Noms de colonnes séparés par des virgules.",
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
            title: "Lire le tableau",
            description:
              "Renvoie les colonnes, le nombre de lignes et les 10 premières lignes.",
            input: {
              table: {
                type: "string",
                required: false,
                description:
                  "Identifiant du tableau. Par défaut, celui de la tuile.",
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
            title: "Lire des lignes",
            description:
              "Renvoie des lignes par id, dans l’ordre du tableau. Limité à 50 lignes.",
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
            title: "Ajouter des lignes",
            description:
              "Ajoute des lignes depuis du TSV (copié d’Excel ou Sheets).",
            mutates: true,
            input: {
              table: { type: "string", required: false },
              rows: {
                type: "string",
                description: "Lignes TSV, une ligne par ligne.",
              },
            },
            run: (tile, input) => {
              const table = tableOf(tile, input);
              const matrix = parseTsv(String(input.rows ?? ""));
              if (!matrix.length) throw new Error("Aucune ligne à ajouter.");
              const width = Math.max(...matrix.map((row) => row.length));
              const columns = [...table.columns];
              while (columns.length < width && columns.length < MAX_COLUMNS)
                columns.push(newColumn(`Colonne ${columns.length + 1}`));
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
            title: "Écrire une cellule",
            description:
              "Écrit une valeur dans une cellule identifiée par l’id de ligne et de colonne.",
            mutates: true,
            input: {
              table: { type: "string", required: false },
              row: { type: "string", description: "Identifiant de ligne." },
              column: {
                type: "string",
                description: "Identifiant de colonne.",
              },
              value: { type: "string", description: "Valeur à écrire." },
            },
            run: (tile, input) => {
              const table = tableOf(tile, input);
              const rowId = String(input.row ?? "");
              const columnId = String(input.column ?? "");
              const index = table.columns.findIndex(
                (column) => column.id === columnId,
              );
              if (index < 0) throw new Error("Colonne inconnue.");
              if (!table.rows.some((row) => row.id === rowId))
                throw new Error("Ligne inconnue.");
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
            title: "Ajouter une colonne",
            description: "Ajoute une colonne typée à la fin du tableau.",
            mutates: true,
            input: {
              table: { type: "string", required: false },
              name: { type: "string", description: "Nom de la colonne." },
              type: {
                type: "string",
                required: false,
                enum: ["text", "number", "date"],
              },
            },
            run: (tile, input) => {
              const table = tableOf(tile, input);
              if (table.columns.length >= MAX_COLUMNS)
                throw new Error(`Limite de ${MAX_COLUMNS} colonnes atteinte.`);
              const name =
                String(input.name ?? "").trim() ||
                `Colonne ${table.columns.length + 1}`;
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
            title: "Créer un graphique",
            description:
              "Ouvre un graphique lié à ce tableau. X par défaut : la première colonne ; Y par défaut : la première colonne numérique.",
            input: {
              table: { type: "string", required: false },
              x: { type: "string", required: false },
              y: {
                type: "string",
                required: false,
                description:
                  "Un ou plusieurs ids de colonnes, séparés par des virgules.",
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
              if (!x) throw new Error("Le tableau n’a aucune colonne.");
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
        title: "Graphique",
        icon: manifest.icon,
        view: (props) => <ChartView {...props} api={api} tables={tables} />,
        dataKeys: ["table", "x", "y", "type"],
        guide:
          "Graphique lié à un tableau Données. dataKeys : table, x (id de colonne), y (ids séparés par des virgules), type (bar, line, area, scatter). set_chart { x?, y?, type? } met à jour la configuration. La source reste le tableau ; aucune donnée n’est dupliquée.",
        describe: (tile) => {
          const table = tables.get(tile.data.table);
          if (!table) return "aucun tableau source";
          const x = table.columns.find((column) => column.id === tile.data.x);
          const y = (tile.data.y ?? "")
            .split(",")
            .map((id) => table.columns.find((column) => column.id === id))
            .filter(Boolean)
            .map((column) => column!.name);
          return `${chartTypeOf(tile.data.type)} · ${y.join(", ") || "aucune série"}${x ? ` par ${x.name}` : ""}`;
        },
        actions: {
          set_chart: {
            title: "Configurer le graphique",
            description:
              "Change la colonne X, les colonnes Y ou le type du graphique.",
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
            title: "Ouvrir le tableau",
            description:
              "Ouvre le tableau source à côté du graphique. Renvoie sa référence.",
            run: (tile) => {
              const table = tables.get(tile.data.table);
              if (!table) throw new Error("Aucun tableau source.");
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
        title: "Nouveau tableau",
        icon: manifest.icon,
        tileType: tableType,
        keywords: ["tableau", "données", "table", "csv", "tsv"],
        run: () => {
          const table = tables.create();
          return api.tabs.openTile(tableType, { table: table.id });
        },
      });
      api.commands.register({
        id: "data.chart.open",
        title: "Nouveau graphique",
        icon: manifest.icon,
        tileType: chartType,
        keywords: ["graphique", "courbe", "barres", "données", "chart"],
        run: () => api.tabs.openTile(chartType),
      });
    },
  };
}
