import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useI18n } from "../../i18n/react.ts";
import { SPECTRUM_ORDER } from "../../shared/brand/index.tsx";
import type { ExtensionAPI, TileViewProps } from "../../sdk/react.ts";
import type { ChartType, TablesService } from "./api.ts";
import { dateOf, displayDate, numberOf } from "./model.ts";

const WIDTH = 720;
const HEIGHT = 400;
const MARGIN = { top: 30, right: 18, bottom: 48, left: 58 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

const TYPES: ChartType[] = ["bar", "line", "area", "scatter"];

const seriesColor = (index: number) =>
  SPECTRUM_ORDER[(index + 2) % SPECTRUM_ORDER.length];

function truncate(value: string, length = 14) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

interface Point {
  x: number;
  index: number;
  label: string;
  y: number;
}

function chartType(value: string | undefined): ChartType {
  return value === "line" || value === "area" || value === "scatter"
    ? value
    : "bar";
}

export function ChartView({
  api,
  tables,
  tile,
}: TileViewProps & { api: ExtensionAPI; tables: TablesService }) {
  const { t, locale } = useI18n();
  const table = useSyncExternalStore(tables.subscribe, () =>
    tables.get(tile.data.table),
  );
  const svg = useRef<SVGSVGElement>(null);
  const type = chartType(tile.data.type);
  const format = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  );

  const xIndex = table
    ? table.columns.findIndex((column) => column.id === tile.data.x)
    : -1;
  const xColumn = table && xIndex >= 0 ? table.columns[xIndex] : undefined;
  const yColumns = useMemo(() => {
    if (!table) return [];
    return (tile.data.y ?? "")
      .split(",")
      .map((id) => table.columns.find((column) => column.id === id))
      .filter((column): column is NonNullable<typeof column> =>
        Boolean(column),
      );
  }, [table, tile.data.y]);

  const model = useMemo(() => {
    if (!table || !xColumn || !yColumns.length) return null;
    const numericX = xColumn.type === "number" || xColumn.type === "date";
    const base = table.rows.map((row, index) => {
      const raw = row.cells[xIndex] ?? "";
      const parsed =
        xColumn.type === "number"
          ? numberOf(raw)
          : xColumn.type === "date"
            ? dateOf(raw)
            : undefined;
      return {
        row,
        index,
        x: numericX && parsed !== undefined ? parsed : index,
        label: raw || String(index + 1),
      };
    });
    const series = yColumns.map((column) => {
      const columnIndex = table.columns.findIndex(
        (item) => item.id === column.id,
      );
      const points: Point[] = [];
      for (const item of base) {
        const value = numberOf(item.row.cells[columnIndex] ?? "");
        if (value !== undefined)
          points.push({
            x: item.x,
            index: item.index,
            label: item.label,
            y: value,
          });
      }
      return { column, points };
    });
    const all = series.flatMap((item) => item.points);
    if (!all.length) return null;
    const linear =
      numericX && (type === "scatter" || type === "line" || type === "area");
    const values = all.map((point) => point.y);
    const yMin = Math.min(0, ...values);
    let yMax = Math.max(0, ...values);
    if (yMin === yMax) yMax = yMin + 1;
    const xValues = all.map((point) => point.x);
    let xMin = Math.min(...xValues);
    let xMax = Math.max(...xValues);
    if (xMin === xMax) {
      xMin -= 1;
      xMax += 1;
    }
    const categories = base.filter((item) =>
      series.some((entry) =>
        entry.points.some((point) => point.index === item.index),
      ),
    );
    const positions = new Map(
      categories.map((item, index) => [item.index, index]),
    );
    return {
      series,
      base,
      categories,
      positions,
      linear,
      yMin,
      yMax,
      xMin,
      xMax,
      numericX,
    };
  }, [table, xColumn, yColumns, xIndex, type]);

  useEffect(() => {
    if (!table) {
      api.tiles.publish(tile.id, {});
      return;
    }
    api.tiles.publish(tile.id, {
      table: table.id,
      type,
      x: (xColumn?.name ?? "").slice(0, 80),
      y: yColumns
        .map((column) => column.name)
        .join(", ")
        .slice(0, 500),
      series: String(yColumns.length),
      points: String(
        model?.series.reduce((total, item) => total + item.points.length, 0) ??
          0,
      ),
    });
  }, [api, tile.id, table, type, xColumn, yColumns, model]);

  function update(patch: Record<string, string>) {
    api.tabs.updateTileData(tile.id, { ...tile.data, ...patch });
  }

  function chooseTable(id: string) {
    const next = tables.get(id);
    if (!next) {
      update({ table: "", x: "", y: "" });
      return;
    }
    const x = next.columns[0];
    const y =
      next.columns.find(
        (column) => column.type === "number" && column.id !== x?.id,
      ) ??
      next.columns.find((column) => column.id !== x?.id) ??
      x;
    update({
      table: next.id,
      x: x?.id ?? "",
      y: y?.id ?? "",
    });
  }

  function toggleY(columnId: string) {
    const current = new Set(yColumns.map((column) => column.id));
    if (current.has(columnId)) current.delete(columnId);
    else current.add(columnId);
    update({ y: [...current].join(",") });
  }

  function exportSvg() {
    if (!svg.current) return;
    const markup = new XMLSerializer().serializeToString(svg.current);
    const blob = new Blob([markup], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${table?.name ?? t("data.chart.defaultName")}.svg`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(t("data.chart.exported"));
  }

  const xPosition = (value: number) =>
    model?.linear
      ? MARGIN.left +
        ((value - model.xMin) / (model.xMax - model.xMin)) * PLOT_WIDTH
      : 0;
  const band = model ? PLOT_WIDTH / Math.max(1, model.categories.length) : 0;
  const bandPosition = (index: number) =>
    MARGIN.left + band * ((model?.positions.get(index) ?? index) + 0.5);
  const yPosition = (value: number) =>
    MARGIN.top +
    PLOT_HEIGHT -
    ((value - (model?.yMin ?? 0)) / ((model?.yMax ?? 1) - (model?.yMin ?? 0))) *
      PLOT_HEIGHT;

  const ticks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return (
      (model?.yMin ?? 0) + ((model?.yMax ?? 1) - (model?.yMin ?? 0)) * ratio
    );
  });

  const xTicks = (() => {
    if (!model) return [];
    if (model.linear) {
      return Array.from({ length: 5 }, (_, index) => {
        const value = model.xMin + ((model.xMax - model.xMin) * index) / 4;
        return {
          position: xPosition(value),
          label:
            xColumn?.type === "date"
              ? displayDate(value, locale)
              : format.format(value),
        };
      });
    }
    const step = Math.max(1, Math.ceil(model.categories.length / 8));
    return model.categories
      .filter((_, index) => index % step === 0)
      .map((item) => ({
        position: bandPosition(item.index),
        label: truncate(item.label),
      }));
  })();

  return (
    <section className="data-chart" aria-label={t("data.tile.chart.title")}>
      <header className="data-chart-toolbar">
        <select
          aria-label={t("data.chart.source")}
          value={table?.id ?? ""}
          onChange={(event) => chooseTable(event.target.value)}
        >
          <option value="">{t("data.chart.chooseTable")}</option>
          {tables.list().map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t("data.chart.x")}
          value={xColumn?.id ?? ""}
          disabled={!table}
          onChange={(event) => update({ x: event.target.value })}
        >
          <option value="">X…</option>
          {table?.columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.name}
            </option>
          ))}
        </select>
        <details className="data-chart-series">
          <summary>Y{yColumns.length ? ` (${yColumns.length})` : ""}</summary>
          <div className="data-chart-series-list">
            {table?.columns.map((column) => (
              <label key={column.id}>
                <input
                  type="checkbox"
                  checked={yColumns.some((item) => item.id === column.id)}
                  onChange={() => toggleY(column.id)}
                />
                {column.name}
                <span className="data-chart-type-tag">
                  {t(`data.type.${column.type}`)}
                </span>
              </label>
            ))}
          </div>
        </details>
        <select
          aria-label={t("data.chart.type")}
          value={type}
          onChange={(event) => update({ type: event.target.value })}
        >
          {TYPES.map((item) => (
            <option key={item} value={item}>
              {t(`data.chart.type.${item}`)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={exportSvg}
          disabled={!model}
          className="data-chart-export"
        >
          SVG
        </button>
      </header>
      <div className="data-chart-canvas">
        {!table && (
          <p className="data-chart-note">{t("data.chart.note.chooseTable")}</p>
        )}
        {table && (!xColumn || !yColumns.length) && (
          <p className="data-chart-note">
            {t("data.chart.note.chooseColumns")}
          </p>
        )}
        {table && xColumn && yColumns.length > 0 && !model && (
          <p className="data-chart-note">{t("data.chart.note.noValues")}</p>
        )}
        {model && (
          <svg
            ref={svg}
            className="data-chart-svg"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={t("data.chart.aria", {
              type: t(`data.chart.type.${type}`),
              series: yColumns.map((column) => column.name).join(", "),
              x: xColumn?.name ?? "",
            })}
          >
            {ticks.map((tick, index) => (
              <g key={index}>
                <line
                  x1={MARGIN.left}
                  x2={MARGIN.left + PLOT_WIDTH}
                  y1={yPosition(tick)}
                  y2={yPosition(tick)}
                  className="data-chart-grid"
                />
                <text
                  x={MARGIN.left - 8}
                  y={yPosition(tick)}
                  className="data-chart-axis"
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {format.format(tick)}
                </text>
              </g>
            ))}
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + PLOT_WIDTH}
              y1={MARGIN.top + PLOT_HEIGHT}
              y2={MARGIN.top + PLOT_HEIGHT}
              className="data-chart-axis-line"
            />
            {xTicks.map((tick, index) => (
              <text
                key={index}
                x={tick.position}
                y={MARGIN.top + PLOT_HEIGHT + 18}
                className="data-chart-axis"
                textAnchor="middle"
              >
                {tick.label}
              </text>
            ))}
            <text
              x={MARGIN.left + PLOT_WIDTH / 2}
              y={HEIGHT - 8}
              className="data-chart-axis-title"
              textAnchor="middle"
            >
              {xColumn?.name}
            </text>
            {model.series.map((item, seriesIndex) => {
              const color = seriesColor(seriesIndex);
              if (type === "bar") {
                const width = (band * 0.8) / model.series.length;
                if (!item.points.length) return null;
                return (
                  <g key={item.column.id}>
                    {item.points.map((point) => {
                      const position =
                        model.positions.get(point.index) ?? point.index;
                      return (
                        <rect
                          key={point.index}
                          x={
                            MARGIN.left +
                            band * position +
                            band * 0.1 +
                            width * seriesIndex
                          }
                          y={yPosition(Math.max(0, point.y))}
                          width={width - 1}
                          height={Math.abs(
                            yPosition(point.y) -
                              yPosition(Math.max(0, model.yMin)),
                          )}
                          fill={color}
                          rx={1}
                        />
                      );
                    })}
                  </g>
                );
              }
              if (!item.points.length) return null;
              const points = model.linear
                ? [...item.points].sort((first, second) => first.x - second.x)
                : item.points;
              const path = points
                .map((point, index) => {
                  const x = model.linear
                    ? xPosition(point.x)
                    : bandPosition(point.index);
                  return `${index ? "L" : "M"}${x},${yPosition(point.y)}`;
                })
                .join(" ");
              if (type === "scatter")
                return (
                  <g key={item.column.id}>
                    {points.map((point, index) => (
                      <circle
                        key={index}
                        cx={
                          model.linear
                            ? xPosition(point.x)
                            : bandPosition(point.index)
                        }
                        cy={yPosition(point.y)}
                        r={4}
                        fill={color}
                      />
                    ))}
                  </g>
                );
              return (
                <g key={item.column.id}>
                  {type === "area" && (
                    <path
                      d={`${path} L${model.linear ? xPosition(points.at(-1)!.x) : bandPosition(points.at(-1)!.index)},${yPosition(Math.max(0, model.yMin))} L${model.linear ? xPosition(points[0].x) : bandPosition(points[0].index)},${yPosition(Math.max(0, model.yMin))} Z`}
                      fill={color}
                      fillOpacity={0.18}
                    />
                  )}
                  <path
                    d={path}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </g>
              );
            })}
            {model.series.map((item, index) => (
              <g
                key={item.column.id}
                transform={`translate(${MARGIN.left + index * 130}, ${MARGIN.top - 4})`}
              >
                <rect
                  x={0}
                  y={-7}
                  width={9}
                  height={9}
                  fill={seriesColor(index)}
                  rx={1}
                />
                <text x={14} y={2} className="data-chart-legend">
                  {truncate(item.column.name, 16)}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
    </section>
  );
}
