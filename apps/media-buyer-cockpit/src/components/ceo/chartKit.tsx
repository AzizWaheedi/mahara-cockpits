import { ChartColumn, ChartLine, Table2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { DateInput } from "@/components/ui/date-input";
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

// --- Timeframe -------------------------------------------------------------
//
// Every chart carries its own timeframe, chosen from the same short list, so
// a graph can be read over a week or a year without the page changing. The
// rows arrive oldest first; the control keeps the ones inside the range.

export type RangeKey =
  | "7d"
  | "30d"
  | "mtd"
  | "lastMonth"
  | "90d"
  | "6m"
  | "12m"
  | "all"
  | "custom";
export type CustomRange = { from: string; to: string };
export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "mtd", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "90d", label: "90 days" },
  { key: "6m", label: "6 months" },
  { key: "12m", label: "12 months" },
  { key: "all", label: "Everything" },
  { key: "custom", label: "Pick dates" },
];

const isMonth = (x: string) => /^\d{4}-\d{2}$/.test(x);

function shiftDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function shiftMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** The first x kept for a preset, given the newest x in the data. */
export function rangeStart(key: RangeKey, last: string): string | null {
  if (key === "all" || key === "custom") return null;
  if (key === "mtd") return isMonth(last) ? last : `${last.slice(0, 7)}-01`;
  if (key === "lastMonth")
    return isMonth(last)
      ? shiftMonths(last, -1)
      : `${shiftMonths(last.slice(0, 7), -1)}-01`;
  if (isMonth(last)) {
    const months = { "7d": 1, "30d": 1, "90d": 3, "6m": 6, "12m": 12 }[key];
    return shiftMonths(last, -(months - 1));
  }
  if (key === "6m" || key === "12m") {
    // The same day of the month, that many months back, clamped to the
    // month's length (31 March minus six months is 30 September), then
    // the day after: the window is everything since.
    const back = shiftMonths(last.slice(0, 7), key === "6m" ? -6 : -12);
    const [y, m] = back.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const day = Math.min(Number(last.slice(8, 10)), daysInMonth);
    return shiftDays(`${back}-${String(day).padStart(2, "0")}`, 1);
  }
  const days = { "7d": 7, "30d": 30, "90d": 90 }[key];
  return shiftDays(last, -(days - 1));
}

/** The rows inside the range, oldest first. */
export function filterRange(
  data: ChartRow[],
  x: string,
  range: RangeKey,
  custom: CustomRange,
): ChartRow[] {
  if (!data.length) return data;
  const last = String(data[data.length - 1][x] ?? "");
  if (range === "custom") {
    const grain = isMonth(last) ? 7 : 10;
    const from = custom.from.slice(0, grain);
    const to = custom.to.slice(0, grain);
    return data.filter(r => {
      const v = String(r[x] ?? "");
      return (!from || v >= from) && (!to || v <= to);
    });
  }
  const start = rangeStart(range, last);
  const end = rangeEnd(range, last);
  return start
    ? data.filter(r => {
        const v = String(r[x] ?? "");
        return v >= start && (!end || v <= end);
      })
    : data;
}

/** The last x kept for a preset that does not run to the newest x (last month), else null. */
export function rangeEnd(key: RangeKey, last: string): string | null {
  if (key !== "lastMonth") return null;
  if (isMonth(last)) return shiftMonths(last, -1);
  const prev = shiftMonths(last.slice(0, 7), -1);
  const [y, m] = prev.split("-").map(Number);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${prev}-${String(dim).padStart(2, "0")}`;
}

/** Range state for one chart: the choice, the custom dates, and the rows that survive. */
export function useChartRange(
  data: ChartRow[],
  x: string,
  initial: RangeKey = "all",
) {
  const [range, setRange] = useState<RangeKey>(initial);
  const [custom, setCustom] = useState<CustomRange>({ from: "", to: "" });
  const rows = useMemo(
    () => filterRange(data, x, range, custom),
    [data, x, range, custom],
  );
  const first = data.length ? String(data[0][x] ?? "") : null;
  const last = data.length ? String(data[data.length - 1][x] ?? "") : null;
  return { range, setRange, custom, setCustom, rows, first, last };
}

// ceo.css sizes it (the shared select stylesheet is unlayered, so height
// and text utilities would lose): 28px with 12px text, beside the 28px
// Chart/Table switch, and 40px beside a 40px switch on a touch screen.
const control = "ceo-select-compact";

/** The timeframe select, and the two dates when "Pick dates" is chosen. */
export function RangeControl({
  range,
  onRange,
  custom,
  onCustom,
  first,
  last,
}: {
  range: RangeKey;
  onRange: (r: RangeKey) => void;
  custom: CustomRange;
  onCustom: (c: CustomRange) => void;
  first: string | null;
  last: string | null;
}) {
  const monthly = last !== null && isMonth(last);
  const min = first ? (monthly ? `${first}-01` : first) : undefined;
  const max = last ? (monthly ? `${last}-28` : last) : undefined;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <AnimatedSelect
        value={range}
        onChange={e => onRange(e.target.value as RangeKey)}
        aria-label="Timeframe"
        className={control}
      >
        {RANGE_OPTIONS.map(o => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </AnimatedSelect>
      {range === "custom" ? (
        <>
          <DateInput
            value={custom.from}
            min={min}
            max={max}
            onChange={e => onCustom({ ...custom, from: e.target.value })}
            aria-label="From"
            className={control}
          />
          <DateInput
            value={custom.to}
            min={min}
            max={max}
            onChange={e => onCustom({ ...custom, to: e.target.value })}
            aria-label="To"
            className={control}
          />
        </>
      ) : null}
    </span>
  );
}

/** Title or legend on the left, the chart and table switch on the right. */
export function ChartHeader({
  title,
  summary,
  series,
  colors,
  mark,
  view,
  onView,
  range,
}: {
  title?: string;
  summary?: ReactNode;
  series: ChartSeries[];
  colors: string[];
  mark: "line" | "rect";
  view: "chart" | "table";
  onView: (v: "chart" | "table") => void;
  /** The timeframe control, drawn beside the chart and table switch. */
  range?: ReactNode;
}) {
  const showLegend = series.length > 1;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        {title ? (
          <p className="text-sm font-medium text-foreground">{title}</p>
        ) : null}
        {summary ? (
          <span className="text-xs text-muted-foreground">{summary}</span>
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
      <span className="flex flex-wrap items-center gap-2">
        {range}
        <ViewToggle view={view} onView={onView} mark={mark} />
      </span>
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
  // The same height as the range select beside it: 28px, and 40px on a
  // touch screen, where the select takes the coarse-pointer 40px. no-touch
  // keeps the global rule from stretching the buttons past their track.
  const btn = (active: boolean) =>
    cn(
      "no-touch inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors pointer-coarse:h-9 pointer-coarse:px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
        : "text-muted-foreground hover:text-foreground",
    );
  return (
    <div
      role="group"
      aria-label="Show as"
      className="inline-flex h-7 shrink-0 items-center rounded-lg bg-muted p-0.5 pointer-coarse:h-10"
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
    <div className="min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-sm dark:shadow-none">
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
  // No box of its own: inside a card it reads like every other CEO table,
  // hairline rows and a header that stays put while the rows scroll.
  return (
    <div
      className="ceo-table-scroll relative overflow-auto"
      style={{ maxHeight: Math.max(height, 240) }}
    >
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-[1] bg-card">
          <tr className="border-b">
            <th
              scope="col"
              className="h-8 px-3 text-left text-xs font-medium text-muted-foreground first:pl-0"
            >
              {xHeader}
            </th>
            {series.map(s => (
              <th
                key={s.key}
                scope="col"
                className="h-8 px-3 text-right text-xs font-medium text-muted-foreground last:pr-0"
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
              <td className="whitespace-nowrap px-3 py-1.5 pl-0 text-muted-foreground tabular-nums">
                {formatX(String(r[x] ?? ""))}
              </td>
              {series.map(s => {
                const v = r[s.key];
                return (
                  <td
                    key={s.key}
                    className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-foreground last:pr-0"
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
