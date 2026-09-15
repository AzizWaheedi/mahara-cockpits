import { ChartColumn, ChartLine, Table2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { isNum } from "./format";

/** One plotted series. */
export type ChartSeries = {
  /** Row key holding this series' numbers. */
  key: string;
  /** Name in the legend, tooltip and table. */
  label: string;
  /** "context" draws a series in the de-emphasis gray behind the others. */
  tone?: "context";
};

/** A chart row: the x value plus one number (or null) per series key. */
export type ChartRow = Record<string, string | number | null | undefined>;

/**
 * Colors by role: one series is the emphasis teal, 2+ take categorical slots
 * in order. Context series do not count, so adding a gray context series
 * never repaints the one that matters.
 */
export function seriesColors(series: ChartSeries[]): string[] {
  const main = series.filter(s => s.tone !== "context").length;
  let slot = 0;
  return series.map(s => {
    if (s.tone === "context") return "var(--ceo-deemphasis)";
    if (main === 1) return "var(--ceo-emphasis)";
    slot += 1;
    return `var(--ceo-cat-${Math.min(slot, 8)})`;
  });
}

/** True when no series has a single real number. */
export function isEmptyChart(data: ChartRow[], series: ChartSeries[]): boolean {
  return (
    data.length === 0 || !series.some(s => data.some(r => isNum(r[s.key])))
  );
}

export const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 };

/** Title or legend on the left, the chart and table switch on the right. */
export function ChartHeader({
  title,
  summary,
  series,
  colors,
  mark,
  view,
  onView,
}: {
  title?: string;
  summary?: ReactNode;
  series: ChartSeries[];
  colors: string[];
  mark: "line" | "rect";
  view: "chart" | "table";
  onView: (v: "chart" | "table") => void;
}) {
  const showLegend = series.length > 1;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
        {title ? (
          <p className="text-[13px] font-medium text-foreground">{title}</p>
        ) : null}
        {summary ? (
          <span className="text-[13px] text-muted-foreground">{summary}</span>
        ) : null}
        {showLegend ? (
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {series.map((s, i) => (
              <li
                key={s.key}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span
                  aria-hidden
                  className={cn(
                    "inline-block shrink-0",
                    mark === "line"
                      ? "h-0.5 w-3.5 rounded-full"
                      : "size-2.5 rounded-[3px]",
                  )}
                  style={{ backgroundColor: colors[i] }}
                />
                {s.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <ViewToggle view={view} onView={onView} mark={mark} />
    </div>
  );
}

function ViewToggle({
  view,
  onView,
  mark,
}: {
  view: "chart" | "table";
  onView: (v: "chart" | "table") => void;
  mark: "line" | "rect";
}) {
  const ChartIcon = mark === "line" ? ChartLine : ChartColumn;
  const btn = (active: boolean) =>
    cn(
      "inline-flex h-6 items-center gap-1 rounded-[5px] px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "bg-card text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground",
    );
  return (
    <div
      role="group"
      aria-label="Show as"
      className="inline-flex shrink-0 items-center rounded-md bg-muted p-0.5"
    >
      <button
        type="button"
        aria-pressed={view === "chart"}
        onClick={() => onView("chart")}
        className={btn(view === "chart")}
      >
        <ChartIcon className="size-3" aria-hidden />
        Chart
      </button>
      <button
        type="button"
        aria-pressed={view === "table"}
        onClick={() => onView("table")}
        className={btn(view === "table")}
      >
        <Table2 className="size-3" aria-hidden />
        Table
      </button>
    </div>
  );
}

/** The tooltip body: x label, then every series with its value first and strong. */
export function TooltipCard({
  label,
  row,
  series,
  colors,
  format,
  note,
}: {
  label: string;
  row: ChartRow;
  series: ChartSeries[];
  colors: string[];
  format: (v: number | null | undefined) => string;
  note?: string;
}) {
  return (
    <div className="min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1.5 text-muted-foreground">{label}</p>
      <ul className="space-y-1">
        {series.map((s, i) => {
          const v = row[s.key];
          return (
            <li key={s.key} className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-0.5 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: colors[i] }}
              />
              <span className="font-semibold tabular-nums text-foreground">
                {format(isNum(v) ? v : null)}
              </span>
              {series.length > 1 ? (
                <span className="truncate text-muted-foreground">
                  {s.label}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {note ? <p className="mt-1.5 text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/** The chart's accessible twin: the same rows as a table. */
export function SeriesTable({
  data,
  x,
  xHeader,
  series,
  formatX,
  format,
  newestFirst,
  height,
}: {
  data: ChartRow[];
  x: string;
  xHeader: string;
  series: ChartSeries[];
  formatX: (v: string) => string;
  format: (v: number | null | undefined) => string;
  newestFirst: boolean;
  height: number;
}) {
  const rows = newestFirst ? [...data].reverse() : data;
  return (
    <div
      className="ceo-table-scroll overflow-auto rounded-lg border"
      style={{ maxHeight: Math.max(height, 240) }}
    >
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-[1] bg-card">
          <tr className="border-b">
            <th
              scope="col"
              className="h-8 px-3 text-left text-xs font-medium text-muted-foreground"
            >
              {xHeader}
            </th>
            {series.map(s => (
              <th
                key={s.key}
                scope="col"
                className="h-8 px-3 text-right text-xs font-medium text-muted-foreground"
              >
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${String(r[x])}-${i}`}
              className="border-b border-[color:var(--ceo-grid)] last:border-0"
            >
              <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground tabular-nums">
                {formatX(String(r[x] ?? ""))}
              </td>
              {series.map(s => {
                const v = r[s.key];
                return (
                  <td
                    key={s.key}
                    className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-foreground"
                  >
                    {format(isNum(v) ? v : null)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
