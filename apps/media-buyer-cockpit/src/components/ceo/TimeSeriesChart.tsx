import { LineChart as LineChartIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Customized,
  Line,
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
  SeriesTable,
  seriesColors,
  TooltipCard,
} from "./chartKit";
import { EmptyState } from "./EmptyState";
import { date, formatters, isNum, shortDate, type Unit } from "./format";

type Props = {
  /** Rows oldest first, each with the x value and one number per series. */
  data: ChartRow[];
  /** Key of the x value in each row; "YYYY-MM-DD" days by default. */
  x?: string;
  /** One to four series. One draws in the emphasis teal; 2+ get a legend. */
  series: ChartSeries[];
  /** line (default) or area (line plus a 10% wash). */
  kind?: "line" | "area";
  /** Sets the tooltip, table and axis formats together. */
  unit?: Unit;
  /** Small title naming a single series (small multiples). */
  title?: string;
  /** Muted text beside the title, e.g. the latest value. */
  summary?: ReactNode;
  /** Axis tick label for x; defaults to "15 Sep". */
  formatX?: (x: string) => string;
  /** Tooltip and table label for x; defaults to "Tue 15 Sep". */
  formatXLong?: (x: string) => string;
  /** Header of the x column in the table view. */
  xHeader?: string;
  /** Plot height in px, x-axis band included. */
  height?: number;
  /** Value labels at the end of each line, dropped where they would collide. */
  endLabels?: boolean;
  /** Screen reader summary of what the chart shows. */
  ariaLabel: string;
  /** Empty state text when there is no number to plot. */
  emptyText?: string;
  /** Charts sharing an id move their crosshairs together (small multiples). */
  syncId?: string;
  className?: string;
};

/** Line or area over days, with a snapping crosshair, one tooltip for every series and a table twin. */
export function TimeSeriesChart({
  data,
  x = "date",
  series,
  kind = "line",
  unit = "count",
  title,
  summary,
  formatX = shortDate,
  formatXLong = date,
  xHeader = "Day",
  height = 220,
  endLabels = true,
  ariaLabel,
  emptyText = "No data for this range yet.",
  syncId,
  className,
}: Props) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const shown = series.slice(0, 4);
  const colors = seriesColors(shown);
  const { full, compact } = formatters(unit);
  const empty = isEmptyChart(data, shown);

  return (
    <div className={cn("ceo-chart min-w-0", className)}>
      <ChartHeader
        title={title}
        summary={summary}
        series={shown}
        colors={colors}
        mark="line"
        view={view}
        onView={setView}
      />
      {empty ? (
        <div
          className="flex items-center justify-center"
          style={{ minHeight: height }}
        >
          <EmptyState icon={LineChartIcon} title={emptyText} compact />
        </div>
      ) : view === "table" ? (
        <SeriesTable
          data={data}
          x={x}
          xHeader={xHeader}
          series={shown}
          formatX={formatXLong}
          format={full}
          newestFirst
          height={height}
        />
      ) : (
        <div role="figure" aria-label={ariaLabel} style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              syncId={syncId}
              margin={{
                top: 8,
                right: endLabels ? 52 : 12,
                bottom: 0,
                left: 0,
              }}
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
                minTickGap={28}
                interval="preserveStartEnd"
              />
              <YAxis
                width={48}
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
                tickFormatter={v => compact(Number(v))}
                tickCount={4}
                domain={[(min: number) => Math.min(0, min), "auto"]}
              />
              <Tooltip
                isAnimationActive={false}
                cursor={{ stroke: "var(--ceo-crosshair)", strokeWidth: 1 }}
                wrapperStyle={{ outline: "none" }}
                offset={14}
                content={({ active, payload, label }) => {
                  const row = payload?.[0]?.payload as ChartRow | undefined;
                  if (!active || !row) return null;
                  return (
                    <TooltipCard
                      label={formatXLong(String(label ?? row[x] ?? ""))}
                      row={row}
                      series={shown}
                      colors={colors}
                      format={full}
                    />
                  );
                }}
              />
              {shown.map((s, i) =>
                kind === "area" ? (
                  <Area
                    key={s.key}
                    type="monotoneX"
                    dataKey={s.key}
                    name={s.label}
                    stroke={colors[i]}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill={colors[i]}
                    fillOpacity={0.1}
                    dot={false}
                    activeDot={{
                      r: 4,
                      fill: colors[i],
                      stroke: "var(--ceo-surface)",
                      strokeWidth: 2,
                    }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ) : (
                  <Line
                    key={s.key}
                    type="monotoneX"
                    dataKey={s.key}
                    name={s.label}
                    stroke={colors[i]}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    dot={false}
                    activeDot={{
                      r: 4,
                      fill: colors[i],
                      stroke: "var(--ceo-surface)",
                      strokeWidth: 2,
                    }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ),
              )}
              {endLabels ? (
                <Customized
                  component={
                    <EndLabels
                      labelSeries={shown}
                      labelColors={colors}
                      labelFormat={compact}
                    />
                  }
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

type GraphicalItem = {
  item?: { props?: { dataKey?: unknown } };
  props?: {
    points?: { x?: number; y?: number | null; payload?: ChartRow }[];
  };
};

/**
 * End-of-line value labels. Recharts hands Customized its internal state, which
 * holds each line's pixel points; labels that would overlap are dropped rather
 * than nudged away from their lines.
 */
function EndLabels(props: {
  labelSeries: ChartSeries[];
  labelColors: string[];
  labelFormat: (v: number | null | undefined) => string;
  formattedGraphicalItems?: GraphicalItem[];
}) {
  const { labelSeries, labelColors, labelFormat } = props;
  const items = props.formattedGraphicalItems ?? [];
  const found: {
    key: string;
    x: number;
    y: number;
    text: string;
    color: string;
  }[] = [];
  labelSeries.forEach((s, i) => {
    const item = items.find(g => g.item?.props?.dataKey === s.key);
    const points = item?.props?.points ?? [];
    for (let k = points.length - 1; k >= 0; k--) {
      const p = points[k];
      const v = p.payload?.[s.key];
      if (isNum(v) && isNum(p.x) && isNum(p.y)) {
        found.push({
          key: s.key,
          x: p.x,
          y: p.y,
          text: labelFormat(v),
          color: labelColors[i],
        });
        break;
      }
    }
  });
  const sorted = [...found].sort((a, b) => a.y - b.y);
  const kept = sorted.filter((l, i) => {
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    return (!prev || l.y - prev.y >= 14) && (!next || next.y - l.y >= 14);
  });
  // With two converging lines, both labels drop and the legend plus tooltip carry the values.
  return (
    <g aria-hidden>
      {kept.map(l => (
        <g key={l.key}>
          <circle
            cx={l.x}
            cy={l.y}
            r={4}
            fill={l.color}
            stroke="var(--ceo-surface)"
            strokeWidth={2}
          />
          <text
            x={l.x + 9}
            y={l.y}
            dy="0.35em"
            fontSize={11}
            fontWeight={500}
            fill="var(--foreground)"
            className="ceo-end-label"
          >
            {l.text}
          </text>
        </g>
      ))}
    </g>
  );
}
