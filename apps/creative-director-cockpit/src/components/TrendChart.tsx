import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer, ChartTooltip } from "./ui/chart";

/**
 * One small trend, one series, one hue. Several of these side by side beat
 * one chart with two axes. The title names the series, so there is no legend;
 * the header carries the last value and the change against the period before.
 * Money is USD; a percentage is shown as one.
 */
export type TrendPoint = { x: string; y: number | null };

const fmt = (v: number | null | undefined, unit: string) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  if (unit === "$")
    return `$${v >= 100 ? Math.round(v) : v.toFixed(2).replace(/\.?0+$/, "")}`;
  if (unit === "%") return `${Math.round(v)}%`;
  return v >= 1000
    ? `${(v / 1000).toFixed(1)}k`
    : String(Math.round(v * 10) / 10);
};

/** Change of the last third of the points against the third before it, as a percentage. */
function delta(points: TrendPoint[], mode: "sum" | "avg"): number | null {
  const ys = points.map(p => p.y).filter((y): y is number => y !== null);
  if (ys.length < 6) return null;
  const n = Math.floor(ys.length / 3);
  const recent = ys.slice(-n);
  const before = ys.slice(-2 * n, -n);
  const agg = (a: number[]) =>
    mode === "sum"
      ? a.reduce((s, v) => s + v, 0)
      : a.reduce((s, v) => s + v, 0) / a.length;
  const b = agg(before);
  if (!b) return null;
  return Math.round(((agg(recent) - b) / Math.abs(b)) * 100);
}

export function TrendChart({
  title,
  points,
  unit = "",
  kind = "line",
  mode = "sum",
  goodWhen = "up",
  hint,
}: {
  title: string;
  points: TrendPoint[];
  unit?: "$" | "%" | "";
  kind?: "line" | "bar";
  /** How to compare periods: totals (leads, spend) or averages (rates, cost per X). */
  mode?: "sum" | "avg";
  /** Which direction is good news, for the colour of the change. */
  goodWhen?: "up" | "down";
  hint?: string;
}) {
  const last = [...points].reverse().find(p => p.y !== null)?.y ?? null;
  const d = delta(points, mode);
  const good = d === null ? null : goodWhen === "up" ? d >= 0 : d <= 0;
  const hasData = points.some(p => p.y !== null);
  const label = (x: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(x);
    return m ? `${Number(m[3])}/${Number(m[2])}` : x;
  };
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        <div className="flex items-baseline gap-2 text-sm">
          <span className="font-semibold tabular-nums">{fmt(last, unit)}</span>
          {d !== null ? (
            <span
              className={`text-[11px] tabular-nums ${good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
              title="Last third of the period against the third before it"
            >
              {d > 0 ? "+" : ""}
              {d}%
            </span>
          ) : null}
        </div>
      </div>
      {hasData ? (
        <ChartContainer
          config={{ y: { label: title } }}
          className="mt-1 h-24 w-full aspect-auto text-teal-700 dark:text-teal-300"
        >
          {kind === "bar" ? (
            <BarChart
              data={points}
              margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} strokeDasharray="2 4" />
              <XAxis
                dataKey="x"
                tickFormatter={label}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
                fontSize={10}
              />
              <YAxis
                width={34}
                tickLine={false}
                axisLine={false}
                fontSize={10}
                tickFormatter={v => fmt(Number(v), unit)}
              />
              <ChartTooltip
                cursor={{ fill: "var(--muted)" }}
                content={<Tip unit={unit} />}
              />
              <Bar
                dataKey="y"
                fill="currentColor"
                radius={[3, 3, 0, 0]}
                maxBarSize={18}
              />
            </BarChart>
          ) : (
            <AreaChart
              data={points}
              margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="currentColor"
                    stopOpacity={0.22}
                  />
                  <stop
                    offset="100%"
                    stopColor="currentColor"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="2 4" />
              <XAxis
                dataKey="x"
                tickFormatter={label}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
                fontSize={10}
              />
              <YAxis
                width={34}
                tickLine={false}
                axisLine={false}
                fontSize={10}
                tickFormatter={v => fmt(Number(v), unit)}
              />
              <ChartTooltip
                cursor={{ stroke: "var(--border)" }}
                content={<Tip unit={unit} />}
              />
              <Area
                type="monotone"
                dataKey="y"
                stroke="currentColor"
                strokeWidth={2}
                fill="url(#trendFill)"
                connectNulls={false}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          )}
        </ChartContainer>
      ) : (
        <p className="mt-2 h-24 text-xs text-muted-foreground">
          No data in this range yet.
        </p>
      )}
      {hint ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function Tip({
  active,
  payload,
  unit,
}: {
  active?: boolean;
  payload?: { payload: TrendPoint }[];
  unit: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-background px-2 py-1 text-xs shadow-sm">
      <div className="text-muted-foreground">{p.x}</div>
      <div className="font-semibold tabular-nums">{fmt(p.y, unit)}</div>
    </div>
  );
}

/** Group daily rows into ISO weeks when the span is long; keep days when short. */
export function bucketDays<T extends { date: string }>(
  rows: T[],
  from: string,
  to: string,
): { key: string; rows: T[] }[] {
  const days =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
    86400_000;
  const weekly = days > 45;
  const buckets = new Map<string, T[]>();
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    let key = r.date.slice(0, 10);
    if (weekly) {
      const d = new Date(`${key}T00:00:00Z`);
      const day = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - day);
      key = d.toISOString().slice(0, 10);
    }
    (buckets.get(key) ?? buckets.set(key, []).get(key))?.push(r);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, rows]) => ({ key, rows }));
}
