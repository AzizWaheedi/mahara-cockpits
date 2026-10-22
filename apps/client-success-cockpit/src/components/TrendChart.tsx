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
import { dayLabel, shiftDay } from "@/lib/reportPeriod";
import { ChartContainer, ChartTooltip } from "./ui/chart";

/**
 * One small trend, one series, one hue. Several of these side by side beat
 * one chart with two axes. The title names the series, so there is no legend;
 * the header carries the last value, or the headline its caller sets (a
 * ratio card: the named days' sum over sum, see ratioHead), and the change
 * against the period before.
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
  // Half a cent rounds up, as the truth does: summed spend lands a hair
  // under it ($15.71 / 2 read $7.85, not $7.86).
  // $100 and over in whole dollars with a comma ("$1,592"), under it in cents.
  if (unit === "$")
    return `$${v >= 100 ? Math.round(v).toLocaleString("en-US") : (Math.round(v * 100 + 1e-6) / 100).toFixed(2).replace(/\.00$/, "")}`;
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

/**
 * A pool of points' parts, sum over sum, over every complete bucket: the
 * overview's weekly show rate, where only the weeks are on hand. `scale`
 * turns counts into a percentage. Null when nothing complete carries the
 * parts. A card headlines a pool only when its caller names the days (see
 * Headline): it never replaces the last point silently.
 */
export function ratioHeadline(
  points: TrendPoint[],
  scale = 1,
): { value: number | null; num: number; den: number } | null {
  const use = points.filter(p => !p.partial && p.den !== undefined);
  if (!use.length) return null;
  const num = use.reduce((s, p) => s + Number(p.num ?? 0), 0);
  const den = use.reduce((s, p) => s + Number(p.den ?? 0), 0);
  return { value: den ? (num / den) * scale : null, num, den };
}

/**
 * A ratio's two sides from different rows (ad spend by day, sheet bookings
 * by day), paired bucket by bucket over every bucket either side has. Built
 * on the denominator's buckets alone, spend on a day nobody booked fell out
 * of the period (2026-10-21).
 */
export function pairedRatio<
  N extends { date: string },
  D extends { date: string },
>(
  numRows: N[],
  denRows: D[],
  from: string,
  to: string,
  num: (rows: N[]) => number,
  den: (rows: D[]) => number,
): TrendPoint[] {
  const nums = new Map(bucketDays(numRows, from, to).map(b => [b.key, b.rows]));
  const dens = new Map(bucketDays(denRows, from, to).map(b => [b.key, b.rows]));
  const both = bucketDays(
    [...numRows, ...denRows].map(r => ({ date: String(r.date).slice(0, 10) })),
    from,
    to,
  );
  return both.map(({ key }) => {
    const n = num(nums.get(key) ?? []);
    const d = den(dens.get(key) ?? []);
    return {
      x: key,
      y: n && d ? Math.round((n / d) * 100) / 100 : null,
      num: n,
      den: d,
    };
  });
}

/** "1–20 Oct", "28 Sep – 4 Oct", "20 Oct": the days a headline adds up. */
export function spanLabel(from: string, to: string): string {
  if (from === to) return dayLabel(to);
  const [fy, fm] = from.split("-");
  const [ty, tm] = to.split("-");
  if (fy !== ty) return `${dayLabel(from)} ${fy} – ${dayLabel(to)} ${ty}`;
  if (fm !== tm) return `${dayLabel(from)} – ${dayLabel(to)}`;
  return `${Number(from.slice(8, 10))}–${dayLabel(to)}`;
}

/**
 * The complete days of a range: up to yesterday, since the ad spend runs to
 * yesterday, or the range's own end once it is over. Days, never weeks: on a
 * range charted by week, the days of this week that are over still count (a
 * headline cut at the Sunday before read Khalida's All time as "No bookings
 * yet" on $80, though she booked on 20 Oct, 2026-10-22). Undefined while
 * none is complete.
 */
export function completeDays(
  from: string,
  to: string,
  today: string,
): { from: string; to: string } | undefined {
  const last = shiftDay(today, -1);
  const end = to < last ? to : last;
  return from <= end ? { from, to: end } : undefined;
}

/** A ratio paired over the days both sides are on record. */
export type Paired = {
  /** The chart's buckets, the range's own days or weeks, both sides cut to the record. */
  points: TrendPoint[];
  /** The complete days the headline adds up. */
  days?: { from: string; to: string };
  /** The headline's two sides over `days`, summed day by day. */
  total?: { num: number; den: number };
  /** The first day of the top on record, when it falls after the range starts. */
  since?: string;
  /** Nothing of the top is on record in those days ("No spend found"). */
  noTop: boolean;
  /** The bottom's source holds none of the range's complete days. */
  noBottom: boolean;
};

/**
 * A paired ratio whose sides are each on record for some days only, summed
 * day by day over the complete days both are on record for, whatever the
 * chart's buckets are.
 *
 * The top (the profile's ad spend) starts with the first day of the
 * campaigns we still hold, so before it the spend is missing, not $0 (a
 * stopped campaign's days fall out). Paired over the whole range, bookings
 * before that day were bought with nothing: Atlantis's last 30 days read
 * $28.01, 12 bookings over 7–20 Oct's $336, against a true $69.28
 * (2026-10-21). So once the first day on record falls inside the complete
 * days, both sides start there and `since` names it. With nothing on record
 * by then, the range stands and `noTop` says the top was not found.
 *
 * The bottom (the client's sheet) holds `denOn`'s days only: a sheet read
 * from its month tabs starts on the first of last month, and one no longer
 * read ends the day before its last read. Its days bound both sides, and
 * `noBottom` says when none of the range's complete days is on it.
 *
 * `numRows` is every row on record, not just the range's: the first one is
 * where the record starts.
 */
export function pairedFromRecord<
  N extends { date: string },
  D extends { date: string },
>(
  numRows: N[],
  denRows: D[],
  from: string,
  to: string,
  today: string,
  num: (rows: N[]) => number,
  den: (rows: D[]) => number,
  denOn: { from?: string; to?: string } = {},
): Paired {
  const dayOf = (r: { date: string }) => String(r.date).slice(0, 10);
  let first: string | undefined;
  for (const r of numRows) {
    const day = dayOf(r);
    if (!first || day < first) first = day;
  }
  const since = first && first > from ? first : undefined;
  const lo = denOn.from && denOn.from > from ? denOn.from : from;
  const hi = denOn.to && denOn.to < to ? denOn.to : to;
  const range = completeDays(from, to, today);
  const full = completeDays(lo, hi, today);
  const noTop = !first || !full || first > full.to;
  const start = since && !noTop && since > lo ? since : lo;
  const on = (r: { date: string }) => dayOf(r) >= start && dayOf(r) <= hi;
  // The buckets stay the range's own, days or weeks, as on the other cards.
  const points = pairedRatio(
    numRows.filter(on),
    denRows.filter(on),
    from,
    to,
    num,
    den,
  );
  if (!range || !full) return { points, since, noTop, noBottom: !!range };
  const days = { from: start, to: full.to };
  const inDays = (r: { date: string }) =>
    dayOf(r) >= days.from && dayOf(r) <= days.to;
  return {
    points,
    days,
    total: {
      num: num(numRows.filter(inDays)),
      den: den(denRows.filter(inDays)),
    },
    since,
    noTop,
    noBottom: false,
  };
}

/** A headline's colour: the cost grid's bands (kpi.ts), in index.css. */
export type Tone = "good" | "warn" | "bad";
const TONE_TEXT: Record<Tone, string> = {
  good: "txt-good",
  warn: "txt-warn",
  bad: "txt-bad",
};

/**
 * What a card says at the top when its caller sets it: the words, their
 * colour, and the line under them naming the days and what they add up.
 */
export type Headline = { text: string; tone?: Tone; basis?: string };

/**
 * How a cost is judged on a card: good up to `gate`, a warning up to `bad`,
 * bad above it, as the media buyer's grid colours it. Nothing booked on more
 * than `gate` of spend is not neutral: the spend is the least one booking
 * costs, so it reads "None on $233" in that spend's colour (the CEO's rule,
 * kpi.ts gridCell; the media buyer's cpbDisplay says the same). Up to `gate`
 * it is too early to judge and the card keeps its own words. The gates come
 * from the caller, from kpi.ts: this file holds none.
 */
export function costJudge(gate: number, bad: number) {
  const band = (v: number): Tone => {
    const c = Math.round(v * 100) / 100;
    return c <= gate ? "good" : c <= bad ? "warn" : "bad";
  };
  return (
    num: number,
    den: number,
  ): { text?: string; tone?: Tone } | undefined => {
    if (den > 0) return num > 0 ? { tone: band(num / den) } : undefined;
    // Judged and written as the media buyer's cell writes it (costTone.ts
    // cpbDisplay): on the cents shown, so $60.40 reads "None on $60.40" in
    // the warning colour and $60.004 is still too early (2026-10-22).
    if (Math.round(num * 100) / 100 > gate)
      return { text: `None on ${fmt(num, "$")}`, tone: band(num) };
    return undefined;
  };
}

/**
 * A ratio card's headline: its two sides summed over the days it names (R9,
 * 2026-10-21: "Cost per booking" headlined the last complete day's own
 * ratio and named no day; City Wood read $11.59 against a month of $224.88).
 * `none` is the words for no denominator, `noTop` for a top not on record
 * (missing is never $0), `judge` the caller's gate for its colour. Nothing
 * complete yet reads blank, with no days named.
 */
export function ratioHead(
  r: Pick<Paired, "days" | "total"> & { noTop?: boolean },
  o: {
    unit: "$" | "%";
    none: string;
    noTop?: string;
    parts?: (num: number, den: number) => string;
    judge?: (
      num: number,
      den: number,
    ) => { text?: string; tone?: Tone } | undefined;
  },
): Headline {
  if (!r.days || !r.total) return { text: "" };
  const { num, den } = r.total;
  const basis = [spanLabel(r.days.from, r.days.to), o.parts?.(num, den)]
    .filter(Boolean)
    .join(" · ");
  if (o.noTop && (r.noTop || (!num && den))) return { text: o.noTop, basis };
  const verdict = o.judge?.(num, den);
  if (!den)
    return { text: verdict?.text ?? o.none, tone: verdict?.tone, basis };
  const value = (num / den) * (o.unit === "%" ? 100 : 1);
  return {
    text: verdict?.text ?? fmt(value, o.unit),
    tone: verdict?.tone,
    basis,
  };
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
  head,
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
  /**
   * The headline, when the caller sets it: a ratio card's sum over sum over
   * the days it names (ratioHead). Without it the card shows its last
   * complete point, so no card pools its points without naming the days.
   */
  head?: Headline;
}) {
  // The last complete point: today's half day would read as a drop.
  const lastPoint = [...points]
    .reverse()
    .find(p => typeof p.y === "number" && !p.partial);
  const last = lastPoint?.y ?? null;
  const shown = head ? head.text : fmt(last, unit);
  const d = delta(points, mode);
  const good = d === null ? null : goodWhen === "up" ? d >= 0 : d <= 0;
  const hasData = points.some(p => typeof p.y === "number");
  // A point with no value either side draws no line, so it gets a dot: City
  // Wood's month has one booked day, and its chart drew nothing at all.
  const alone = new Set(
    points.flatMap((p, i) =>
      typeof p.y === "number" &&
      typeof points[i - 1]?.y !== "number" &&
      typeof points[i + 1]?.y !== "number"
        ? [i]
        : [],
    ),
  );
  const dotIfAlone = (props: { cx?: number; cy?: number; index?: number }) =>
    alone.has(props.index ?? -1) ? (
      <circle
        key={`dot-${props.index}`}
        cx={props.cx}
        cy={props.cy}
        r={2.5}
        fill="currentColor"
      />
    ) : (
      <g key={`dot-${props.index}`} />
    );
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
          <span
            className={`font-semibold tabular-nums ${head?.tone ? TONE_TEXT[head.tone] : ""}`}
          >
            {shown}
          </span>
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
      {head?.basis ? (
        <p className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">
          {head.basis}
        </p>
      ) : null}
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
                dot={dotIfAlone}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          )}
        </ChartContainer>
      ) : (
        <p className="mt-2 h-24 text-xs text-muted-foreground">
          {/* A headline with its days but no point to draw still has data above. */}
          {head?.basis
            ? "Nothing to chart in this range yet."
            : "No data in this range yet."}
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
