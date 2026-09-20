import { ChartColumn } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import {
  AXIS_TICK,
  ChartHeader,
  type ChartRow,
  type ChartSeries,
  isEmptyChart,
  RangeControl,
  type RangeKey,
  SeriesTable,
  seriesColors,
  TooltipCard,
  useChartRange,
} from "./chartKit";
import { EmptyState } from "./EmptyState";
import { formatters, isNum, type Unit } from "./format";

type Props = {
  /** Rows in display order, each with the x value and one number per series. */
  data: ChartRow[];
  /** Key of the category in each row (month, hour, day). */
  x: string;
  /** One or two series; two draw grouped columns with a legend. */
  series: ChartSeries[];
  /** Sets the tooltip, table and axis formats together. */
  unit?: Unit;
  /** Small title naming a single series. */
  title?: string;
  /** Muted text beside the title. */
  summary?: ReactNode;
  /** Axis tick label for x, e.g. month("2026-09") gives "Sep". */
  formatX?: (x: string) => string;
  /** Tooltip and table label for x; defaults to formatX. */
  formatXLong?: (x: string) => string;
  /** Header of the x column in the table view. */
  xHeader?: string;
  /** Plot height in px, x-axis band included. */
  height?: number;
  /** Value on the cap of one column only: the last or the largest. */
  capLabel?: "none" | "last" | "max";
  /** Draw the last column lighter and say so in its tooltip (a month still in progress). */
  partialLast?: boolean;
  /** Tooltip note for the partial column. */
  partialNote?: string;
  /** Screen reader summary of what the chart shows. */
  ariaLabel: string;
  /** Empty state text when there is no number to plot. */
  emptyText?: string;
  /** The timeframe the chart opens on; the reader can change it. */
  initialRange?: RangeKey;
  className?: string;
};

/** Vertical columns, 24px at most with a 4px rounded top, per-category hover and a table twin. */
export function ColumnChart({
  data,
  x,
  series,
  unit = "count",
  title,
  summary,
  formatX = v => v,
  formatXLong,
  xHeader = "Period",
  height = 220,
  capLabel = "none",
  partialLast = false,
  partialNote = "So far, still in progress",
  ariaLabel,
  emptyText = "No data for this range yet.",
  initialRange = "all",
  className,
}: Props) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const shown = series.slice(0, 2);
  const colors = seriesColors(shown);
  const { full, compact } = formatters(unit);
  const tf = useChartRange(data, x, initialRange);
  const rows = tf.rows;
  const empty = isEmptyChart(rows, shown);
  const longX = formatXLong ?? formatX;
  const lastIndex = rows.length - 1;
  // The newest column is only "still in progress" when it is on screen.
  const partialShown =
    partialLast && rows.length > 0 && rows[lastIndex] === data[data.length - 1];

  const first = shown[0];
  let capIndex = -1;
  if (first && capLabel === "last") capIndex = lastIndex;
  if (first && capLabel === "max") {
    let best = Number.NEGATIVE_INFINITY;
    rows.forEach((r, i) => {
      const v = r[first.key];
      if (isNum(v) && v > best) {
        best = v;
        capIndex = i;
      }
    });
  }

  return (
    <div className={cn("ceo-chart min-w-0", className)}>
      <ChartHeader
        title={title}
        summary={summary}
        series={shown}
        colors={colors}
        mark="rect"
        view={view}
        onView={setView}
        range={
          <RangeControl
            range={tf.range}
            onRange={tf.setRange}
            custom={tf.custom}
            onCustom={tf.setCustom}
            first={tf.first}
            last={tf.last}
          />
        }
      />
      {empty ? (
        <div
          className="flex items-center justify-center"
          style={{ minHeight: height }}
        >
          <EmptyState icon={ChartColumn} title={emptyText} compact />
        </div>
      ) : view === "table" ? (
        <SeriesTable
          data={rows}
          x={x}
          xHeader={xHeader}
          series={shown}
          formatX={longX}
          format={full}
          newestFirst={false}
          height={height}
        />
      ) : (
        <div role="figure" aria-label={ariaLabel} style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              margin={{
                top: capIndex >= 0 ? 22 : 8,
                right: 8,
                bottom: 0,
                left: 0,
              }}
              barGap={2}
              barCategoryGap="22%"
              accessibilityLayer
            >
              <CartesianGrid vertical={false} stroke="var(--ceo-grid)" />
              <XAxis
                dataKey={x}
                tickFormatter={v => formatX(String(v))}
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
                tickMargin={8}
                minTickGap={12}
                interval="preserveStartEnd"
              />
              <YAxis
                width={48}
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
                tickFormatter={v => compact(Number(v))}
                tickCount={4}
              />
              <Tooltip
                isAnimationActive={false}
                cursor={{ fill: "var(--ceo-hover)" }}
                wrapperStyle={{ outline: "none" }}
                offset={14}
                content={({ active, payload, label }) => {
                  const row = payload?.[0]?.payload as ChartRow | undefined;
                  if (!active || !row) return null;
                  const isPartial =
                    partialShown && rows.indexOf(row) === lastIndex;
                  return (
                    <TooltipCard
                      label={longX(String(label ?? row[x] ?? ""))}
                      row={row}
                      series={shown}
                      colors={colors}
                      format={full}
                      note={isPartial ? partialNote : undefined}
                    />
                  );
                }}
              />
              {shown.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={colors[i]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                  isAnimationActive={false}
                  activeBar={{ fillOpacity: 0.78 }}
                >
                  {partialShown
                    ? rows.map((_, k) => (
                        <Cell
                          key={`c-${k}`}
                          fill={colors[i]}
                          fillOpacity={k === lastIndex ? 0.5 : 1}
                        />
                      ))
                    : null}
                  {i === 0 && capIndex >= 0 ? (
                    <LabelList
                      dataKey={s.key}
                      content={(p: {
                        x?: number | string;
                        y?: number | string;
                        width?: number | string;
                        value?: number | string;
                        index?: number;
                      }) => {
                        if (p.index !== capIndex) return null;
                        const v = Number(p.value);
                        if (!Number.isFinite(v)) return null;
                        return (
                          <text
                            x={Number(p.x) + Number(p.width) / 2}
                            y={Number(p.y) - 6}
                            textAnchor="middle"
                            fontSize={11}
                            fontWeight={500}
                            fill="var(--foreground)"
                            className="ceo-end-label"
                          >
                            {compact(v)}
                          </text>
                        );
                      }}
                    />
                  ) : null}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
