import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { toast } from "sonner";
import { t as translateNow } from "../../i18n/index.ts";
import { useI18n } from "../../i18n/react.ts";
import type { ExtensionAPI, TileViewProps } from "../../sdk/react.ts";
import type { CellType, Table, TablesService } from "./api.ts";
import { chartType } from "./manifest.ts";
import {
  MAX_COLUMNS,
  MAX_ROWS,
  cellValue,
  filterRows,
  newColumn,
  newRow,
  parseTsv,
  sortRows,
  toTsv,
} from "./model.ts";

interface Selection {
  rowId: string;
  columnId: string;
}

interface Editing extends Selection {
  draft: string;
}

interface Sort {
  columnId: string;
  direction: "asc" | "desc";
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

const cellId = (rowId: string, columnId: string) => `cell-${rowId}-${columnId}`;

export function TableView({
  api,
  tables,
  tile,
}: TileViewProps & { api: ExtensionAPI; tables: TablesService }) {
  const { t, tp, locale } = useI18n();
  const table = useSyncExternalStore(tables.subscribe, () =>
    tables.get(tile.data.table),
  );
  const grid = useRef<HTMLTableElement>(null);
  const cancelEdit = useRef(false);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort | null>(null);

  const sortIndex = sort
    ? (table?.columns.findIndex((column) => column.id === sort.columnId) ?? -1)
    : -1;
  const sortType = sortIndex >= 0 ? table?.columns[sortIndex]?.type : "text";
  const visibleRows = useMemo(() => {
    if (!table) return [];
    const filtered = filterRows(table.rows, query, locale);
    if (!sort || sortIndex < 0) return filtered;
    return sortRows(
      filtered,
      sortIndex,
      sort.direction,
      (sortType as CellType | undefined) ?? "text",
      locale,
    );
  }, [table, query, sort, sortIndex, sortType, locale]);

  useEffect(() => {
    if (!table) {
      setSelected(null);
      return;
    }
    setSelected((current) => {
      if (
        current &&
        table.rows.some((row) => row.id === current.rowId) &&
        table.columns.some((column) => column.id === current.columnId)
      )
        return current;
      const row = table.rows[0];
      const column = table.columns[0];
      return row && column ? { rowId: row.id, columnId: column.id } : null;
    });
  }, [table]);

  useEffect(() => {
    if (!table) {
      api.tiles.publish(tile.id, {});
      return;
    }
    const column = table.columns.find((item) => item.id === selected?.columnId);
    const row = selected
      ? visibleRows.findIndex((item) => item.id === selected.rowId) + 1
      : 0;
    const sorted =
      sort && sortIndex >= 0 ? table.columns[sortIndex]?.name : undefined;
    api.tiles.publish(tile.id, {
      table: table.id,
      name: table.name,
      rows: String(table.rows.length),
      columns: String(table.columns.length),
      selection:
        column && row > 0
          ? translateNow("data.surface.selection", {
              column: column.name,
              row,
            })
          : "",
      sort: sorted
        ? translateNow(
            sort?.direction === "asc"
              ? "data.surface.sort.asc"
              : "data.surface.sort.desc",
            { column: sorted },
          )
        : "",
      filter: query,
    });
  }, [api, tile.id, table, selected, visibleRows, sort, sortIndex, query]);

  if (!table) {
    return (
      <section className="data-table" aria-label={t("data.tile.table.title")}>
        <div className="data-table-missing">
          <p>{t("data.table.missing")}</p>
          <button
            type="button"
            onClick={() => {
              try {
                const created = tables.create();
                api.tabs.updateTileData(tile.id, { table: created.id });
              } catch (error) {
                toast.error(t("data.error.createFailed"), {
                  description: String(error),
                });
              }
            }}
          >
            {t("data.table.create")}
          </button>
        </div>
      </section>
    );
  }

  const data: Table = table;
  const columnIndex = (columnId: string) =>
    data.columns.findIndex((column) => column.id === columnId);

  function focusGrid() {
    grid.current?.focus();
  }

  function select(rowId: string, columnId: string) {
    setSelected({ rowId, columnId });
    focusGrid();
  }

  function move(rowDelta: number, columnDelta: number) {
    if (!selected) return;
    const rowIndex = visibleRows.findIndex((row) => row.id === selected.rowId);
    const index = columnIndex(selected.columnId);
    if (rowIndex < 0 || index < 0) return;
    const row = visibleRows[rowIndex + rowDelta];
    const column = data.columns[index + columnDelta];
    if (row && column) {
      setSelected({ rowId: row.id, columnId: column.id });
      focusGrid();
    }
  }

  function startEdit(selection: Selection, seed?: string) {
    const value = cellValue(data, selection.rowId, selection.columnId);
    cancelEdit.current = false;
    setEditing({ ...selection, draft: seed ?? value });
  }

  function commitEdit() {
    if (cancelEdit.current) {
      cancelEdit.current = false;
      setEditing(null);
      return;
    }
    const current = editing;
    if (!current) return;
    setEditing(null);
    if (!data) return;
    const index = columnIndex(current.columnId);
    if (index < 0) return;
    if (cellValue(data, current.rowId, current.columnId) === current.draft)
      return;
    tables.update(data.id, {
      ...data,
      rows: data.rows.map((row) =>
        row.id === current.rowId
          ? {
              ...row,
              cells: row.cells.map((value, cell) =>
                cell === index ? current.draft : value,
              ),
            }
          : row,
      ),
    });
  }

  function clearCell(selection: Selection) {
    const index = columnIndex(selection.columnId);
    if (index < 0) return;
    tables.update(data.id, {
      ...data,
      rows: data.rows.map((row) =>
        row.id === selection.rowId
          ? {
              ...row,
              cells: row.cells.map((value, cell) =>
                cell === index ? "" : value,
              ),
            }
          : row,
      ),
    });
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTableElement>) {
    if (!selected || !data) return;
    if (event.target !== event.currentTarget) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      copyTable();
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1, 0);
        return;
      case "ArrowUp":
        event.preventDefault();
        move(-1, 0);
        return;
      case "ArrowLeft":
        event.preventDefault();
        move(0, -1);
        return;
      case "ArrowRight":
        event.preventDefault();
        move(0, 1);
        return;
      case "Home":
        event.preventDefault();
        setSelected({
          rowId: selected.rowId,
          columnId: data.columns[0].id,
        });
        return;
      case "End":
        event.preventDefault();
        setSelected({
          rowId: selected.rowId,
          columnId: data.columns.at(-1)!.id,
        });
        return;
      case "Enter":
        event.preventDefault();
        startEdit(selected);
        return;
      case "Tab":
        event.preventDefault();
        move(0, event.shiftKey ? -1 : 1);
        return;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        clearCell(selected);
        return;
      default:
        if (
          event.key.length === 1 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          event.preventDefault();
          startEdit(selected, event.key);
        }
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTableElement>) {
    if (editing || !selected) return;
    if (event.target !== event.currentTarget) return;
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    const matrix = parseTsv(text);
    if (!matrix.length) return;
    const startRow = visibleRows.findIndex((row) => row.id === selected.rowId);
    const startColumn = columnIndex(selected.columnId);
    if (startRow < 0 || startColumn < 0) return;
    const width = Math.max(...matrix.map((row) => row.length));
    const columns = [...data.columns];
    while (columns.length < startColumn + width && columns.length < MAX_COLUMNS)
      columns.push(
        newColumn(t("data.default.column", { index: columns.length + 1 })),
      );
    const rows = data.rows.map((row) => ({
      ...row,
      cells: [
        ...row.cells,
        ...Array.from(
          { length: Math.max(0, columns.length - row.cells.length) },
          () => "",
        ),
      ],
    }));
    matrix.forEach((values, rowOffset) => {
      const target = visibleRows[startRow + rowOffset];
      const index = target ? rows.findIndex((row) => row.id === target.id) : -1;
      if (index < 0) return;
      values.forEach((value, columnOffset) => {
        const column = startColumn + columnOffset;
        if (column < columns.length) rows[index].cells[column] = value;
      });
    });
    const missing = Math.max(
      0,
      matrix.length - (visibleRows.length - startRow),
    );
    for (let index = 0; index < missing; index++)
      rows.push(newRow(columns.length));
    tables.update(data.id, { ...data, columns, rows });
    if (columns.length !== startColumn + width)
      toast.warning(t("data.limit.columns", { count: MAX_COLUMNS }));
    else toast.success(tp("data.toast.pasted", matrix.length));
  }

  async function copyTable() {
    const tsv = toTsv(
      data.rows.map((row) =>
        data.columns.map((_, index) => row.cells[index] ?? ""),
      ),
    );
    try {
      await copyText(tsv);
      toast.success(t("data.toast.copied"));
    } catch (error) {
      toast.error(t("data.error.copyFailed"), {
        description: String(error),
      });
    }
  }

  function addColumn() {
    if (data.columns.length >= MAX_COLUMNS) {
      toast.warning(t("data.limit.columns", { count: MAX_COLUMNS }));
      return;
    }
    const column = newColumn(
      t("data.default.column", { index: data.columns.length + 1 }),
    );
    tables.update(data.id, {
      ...data,
      columns: [...data.columns, column],
      rows: data.rows.map((row) => ({
        ...row,
        cells: [...row.cells, ""],
      })),
    });
    if (data.rows[0])
      setSelected({ rowId: data.rows[0].id, columnId: column.id });
  }

  function addRow() {
    if (data.rows.length >= MAX_ROWS) {
      toast.warning(t("data.limit.rows", { count: MAX_ROWS }));
      return;
    }
    const row = newRow(data.columns.length);
    tables.update(data.id, { ...data, rows: [...data.rows, row] });
    if (data.columns[0])
      setSelected({ rowId: row.id, columnId: data.columns[0].id });
  }

  function removeRow(rowId: string) {
    tables.update(data.id, {
      ...data,
      rows: data.rows.filter((row) => row.id !== rowId),
    });
    if (selected?.rowId === rowId) setSelected(null);
  }

  function removeColumn(columnId: string) {
    if (data.columns.length <= 1) return;
    tables.update(data.id, {
      ...data,
      columns: data.columns.filter((column) => column.id !== columnId),
      rows: data.rows.map((row) => ({
        ...row,
        cells: row.cells.filter(
          (_, index) => data.columns[index]?.id !== columnId,
        ),
      })),
    });
    if (selected?.columnId === columnId) setSelected(null);
  }

  function renameColumn(columnId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    tables.update(data.id, {
      ...data,
      columns: data.columns.map((column) =>
        column.id === columnId ? { ...column, name: trimmed } : column,
      ),
    });
  }

  function setType(columnId: string, type: CellType) {
    tables.update(data.id, {
      ...data,
      columns: data.columns.map((column) =>
        column.id === columnId ? { ...column, type } : column,
      ),
    });
  }

  function renameTable(name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === data.name) return;
    tables.update(data.id, { ...data, name: trimmed });
  }

  function createChart() {
    if (!data.columns.length) {
      toast.warning(t("data.toast.needColumn"));
      return;
    }
    const x = data.columns[0];
    const y =
      data.columns.find(
        (column) => column.type === "number" && column.id !== x.id,
      ) ??
      data.columns.find((column) => column.id !== x.id) ??
      x;
    api.tabs.openTile(
      chartType,
      { data: data.id, x: x.id, y: y.id, type: "bar" },
      tile.id,
    );
  }

  const activeRow = selected
    ? visibleRows.findIndex((row) => row.id === selected.rowId)
    : -1;

  return (
    <section className="data-table" aria-label={t("data.tile.table.title")}>
      <header className="data-table-toolbar">
        <input
          className="data-table-name"
          defaultValue={data.name}
          key={`${data.id}-${data.name}`}
          aria-label={t("data.table.name")}
          onBlur={(event) => renameTable(event.target.value)}
        />
        <span className="data-table-count">
          {data.rows.length} × {data.columns.length}
        </span>
        <input
          className="data-table-filter"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={200}
          placeholder={t("data.table.filter.placeholder")}
          aria-label={t("data.table.filter.aria")}
        />
        <button type="button" onClick={addRow}>
          {t("data.table.addRow")}
        </button>
        <button type="button" onClick={addColumn}>
          {t("data.table.addColumn")}
        </button>
        <button type="button" onClick={() => void copyTable()}>
          {t("data.table.copy")}
        </button>
        <button type="button" onClick={createChart}>
          {t("data.table.chart")}
        </button>
      </header>
      <div className="data-table-scroll">
        <table
          ref={grid}
          className="data-table-grid"
          role="grid"
          tabIndex={0}
          aria-rowcount={visibleRows.length + 1}
          aria-colcount={data.columns.length + 2}
          aria-activedescendant={
            selected ? cellId(selected.rowId, selected.columnId) : undefined
          }
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        >
          <thead>
            <tr>
              <th className="data-table-gutter" scope="col">
                #
              </th>
              {data.columns.map((column) => (
                <th key={column.id} scope="col" role="columnheader">
                  <div className="data-table-head">
                    <input
                      className="data-table-column-name"
                      defaultValue={column.name}
                      key={`${column.id}-${column.name}`}
                      maxLength={80}
                      aria-label={t("data.table.column.name", {
                        name: column.name,
                      })}
                      onBlur={(event) =>
                        renameColumn(column.id, event.target.value)
                      }
                      onClick={(event) => event.stopPropagation()}
                    />
                    <select
                      value={column.type}
                      aria-label={t("data.table.column.type", {
                        name: column.name,
                      })}
                      onChange={(event) =>
                        setType(column.id, event.target.value as CellType)
                      }
                      onClick={(event) => event.stopPropagation()}
                    >
                      <option value="text">{t("data.type.text")}</option>
                      <option value="number">{t("data.type.number")}</option>
                      <option value="date">{t("data.type.date")}</option>
                    </select>
                    <button
                      type="button"
                      className="data-table-icon"
                      aria-label={t("data.table.column.sort", {
                        name: column.name,
                      })}
                      title={t("data.table.column.sortTitle")}
                      onClick={() =>
                        setSort((current) =>
                          current?.columnId === column.id
                            ? {
                                columnId: column.id,
                                direction:
                                  current.direction === "asc" ? "desc" : "asc",
                              }
                            : { columnId: column.id, direction: "asc" },
                        )
                      }
                    >
                      {sort?.columnId === column.id
                        ? sort.direction === "asc"
                          ? "↑"
                          : "↓"
                        : "↕"}
                    </button>
                    <button
                      type="button"
                      className="data-table-icon"
                      aria-label={t("data.table.column.remove", {
                        name: column.name,
                      })}
                      title={t("data.table.column.removeTitle")}
                      onClick={() => removeColumn(column.id)}
                    >
                      ×
                    </button>
                  </div>
                </th>
              ))}
              <th className="data-table-add" scope="col">
                <button
                  type="button"
                  aria-label={t("data.table.column.add")}
                  onClick={addColumn}
                >
                  +
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr key={row.id}>
                <th
                  className="data-table-gutter"
                  scope="row"
                  aria-selected={activeRow === rowIndex}
                >
                  {rowIndex + 1}
                </th>
                {data.columns.map((column) => {
                  const isSelected =
                    selected?.rowId === row.id &&
                    selected.columnId === column.id;
                  const isEditing =
                    editing?.rowId === row.id && editing.columnId === column.id;
                  return (
                    <td
                      key={column.id}
                      id={cellId(row.id, column.id)}
                      role="gridcell"
                      aria-selected={isSelected}
                      className={
                        isSelected
                          ? "data-table-cell is-selected"
                          : "data-table-cell"
                      }
                      onClick={() => select(row.id, column.id)}
                      onDoubleClick={() =>
                        startEdit({
                          rowId: row.id,
                          columnId: column.id,
                        })
                      }
                    >
                      {isEditing ? (
                        <input
                          className="data-table-input"
                          autoFocus
                          value={editing.draft}
                          onChange={(event) =>
                            setEditing({
                              ...editing,
                              draft: event.target.value,
                            })
                          }
                          onBlur={commitEdit}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.stopPropagation();
                              commitEdit();
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              event.stopPropagation();
                              cancelEdit.current = true;
                              setEditing(null);
                            } else if (event.key === "Tab") {
                              event.preventDefault();
                              event.stopPropagation();
                              const index = columnIndex(column.id);
                              commitEdit();
                              const next = data.columns[index + 1];
                              if (next) {
                                setSelected({
                                  rowId: row.id,
                                  columnId: next.id,
                                });
                                focusGrid();
                              }
                            }
                          }}
                        />
                      ) : (
                        row.cells[columnIndex(column.id)]
                      )}
                    </td>
                  );
                })}
                <td className="data-table-row-end">
                  <button
                    type="button"
                    className="data-table-icon"
                    aria-label={t("data.table.row.remove", {
                      index: rowIndex + 1,
                    })}
                    title={t("data.table.row.removeTitle")}
                    onClick={() => removeRow(row.id)}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
