import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer, ChartTooltip } from "./ui/chart";

/**
 * One small trend, one series, one hue. Several of these side by side beat
 * one chart with two axes. The title names the series, so there is no legend;
 * the header carries the last value and the change against the period before.
 * Money is USD; a percentage is shown as one.
 *
 * A point can carry notes: what the media buyer changed that day (or week).
 * Each one is a thin mark on the chart and reads in the tooltip, so a jump
 * sits next to its cause.
 */
export type TrendPoint = {
  x: string;
  y: number | null;
  note?: string[];
  /** The bucket holds today: still filling, so it never sets the change or the headline. */
  partial?: boolean;
  /** A ratio's parts (spend and leads for cost per lead), so periods compare as sum over sum. */
  num?: number;
  den?: number;
};

/** The marks: one hairline per point that has a change on it. */
function changeMarks(points: TrendPoint[]) {
  return points
    .filter(p => p.note?.length)
    .map(p => (
      <ReferenceLine
        key={`mark-${p.x}`}
        x={p.x}
        stroke="var(--foreground)"
        strokeOpacity={0.45}
        strokeDasharray="2 3"
      />
    ));
}

const fmt = (v: number | null | undefined, unit: string) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  if (unit === "$")
    return `$${v >= 100 ? Math.round(v) : v.toFixed(2).replace(/\.00$/, "")}`;
  if (unit === "%") return `${Math.round(v)}%`;
  return v >= 1000
    ? `${(v / 1000).toFixed(1)}k`
    : String(Math.round(v * 10) / 10);
};

/**
 * Change of the last third of the complete points against the third before
 * it, as a percentage. A ratio compares sum over sum (all the spend over all
 * the leads), not the average of daily ratios, and a bucket still filling
 * (today, this week) is left out so a half day never reads as a fall.
 */
export function delta(
  points: TrendPoint[],
  mode: "sum" | "avg",
): number | null {
  const done = points.filter(p => !p.partial);
  const ratio = mode === "avg" && done.some(p => p.den !== undefined);
  const use = ratio
    ? done.filter(p => p.den !== undefined)
    : done.filter(p => typeof p.y === "number" && !Number.isNaN(p.y));
  if (use.length < 6) return null;
  const n = Math.floor(use.length / 3);
  const recent = use.slice(-n);
  const before = use.slice(-2 * n, -n);
  const total = (a: TrendPoint[], k: "y" | "num" | "den") =>
    a.reduce((s, p) => s + Number(p[k] ?? 0), 0);
  const agg = (a: TrendPoint[]): number | null => {
    if (ratio) {
      const d = total(a, "den");
      return d ? total(a, "num") / d : null;
    }
    return mode === "sum" ? total(a, "y") : total(a, "y") / a.length;
  };
  const b = agg(before);
  const r = agg(recent);
  if (!b || r === null) return null;
  return Math.round(((r - b) / Math.abs(b)) * 100);
}

/** Whether a day (or the week starting on that Monday) still includes today. */
export function partialBucket(key: string, weekly: boolean, today: string) {
  if (!weekly) return key >= today;
  const end = new Date(`${key}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return end.toISOString().slice(0, 10) >= today;
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
  // The last complete point: today's half day would read as a drop.
  const lastPoint = [...points]
    .reverse()
    .find(p => typeof p.y === "number" && !p.partial);
  const last = lastPoint?.y ?? null;
  const d = delta(points, mode);
  const good = d === null ? null : goodWhen === "up" ? d >= 0 : d <= 0;
  const hasData = points.some(p => typeof p.y === "number");
  const label = (x: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(x);
    return m ? `${Number(m[3])}/${Number(m[2])}` : x;
  };
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 truncate text-xs text-muted-foreground">
          {title}
        </div>
        <div className="flex shrink-0 items-baseline gap-2 text-sm">
          <span className="font-semibold tabular-nums">{fmt(last, unit)}</span>
          {d !== null ? (
            <span
              className={`text-xs tabular-nums ${good ? "txt-good" : "txt-bad"}`}
              title="The last third of the charted days against the third before them. Today is left out until it is over."
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
          className="mt-2 h-24 w-full aspect-auto text-[color:var(--chart-1)]"
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
                fontSize={11}
              />
              <YAxis
                width={36}
                tickLine={false}
                axisLine={false}
                fontSize={11}
                tickFormatter={v => fmt(Number(v), unit)}
              />
              <ChartTooltip
                cursor={{ fill: "var(--muted)" }}
                content={<Tip unit={unit} />}
              />
              {changeMarks(points)}
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
                fontSize={11}
              />
              <YAxis
                width={36}
                tickLine={false}
                axisLine={false}
                fontSize={11}
                tickFormatter={v => fmt(Number(v), unit)}
              />
              <ChartTooltip
                cursor={{ stroke: "var(--border)" }}
                content={<Tip unit={unit} />}
              />
              {changeMarks(points)}
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
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
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
  const notes = p.note ?? [];
  return (
    <div className="max-w-64 rounded-lg border bg-popover px-2 py-1 text-xs shadow-sm dark:shadow-none">
      <div className="text-muted-foreground">{p.x}</div>
      <div className="font-semibold tabular-nums">{fmt(p.y, unit)}</div>
      {notes.length ? (
        <div className="mt-1 space-y-0.5 border-t pt-1">
          {notes.slice(0, 3).map(n => (
            <div key={n} dir="auto">
              {n}
            </div>
          ))}
          {notes.length > 3 ? (
            <div className="text-muted-foreground">
              and {notes.length - 3} more
            </div>
          ) : null}
        </div>
      ) : null}
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
  const keyOf = (date: string) => {
    let key = date.slice(0, 10);
    if (weekly) {
      const d = new Date(`${key}T00:00:00Z`);
      const day = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - day);
      key = d.toISOString().slice(0, 10);
    }
    return key;
  };
  const buckets = new Map<string, T[]>();
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    const key = keyOf(r.date);
    (buckets.get(key) ?? buckets.set(key, []).get(key))?.push(r);
  }
  // A quiet day between two days with data is a zero, not a gap: keep it on
  // the axis so the thirds compare like with like. The edges are not filled,
  // since before the first row or after the last the data may simply not
  // have arrived yet.
  const keys = [...buckets.keys()].sort();
  if (keys.length > 1) {
    const step = weekly ? 7 : 1;
    const d = new Date(`${keys[0]}T00:00:00Z`);
    const lastKey = keys[keys.length - 1];
    while (d.toISOString().slice(0, 10) < lastKey) {
      d.setUTCDate(d.getUTCDate() + step);
      const k = d.toISOString().slice(0, 10);
      if (!buckets.has(k)) buckets.set(k, []);
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, rows]) => ({ key, rows }));
}
