import { Info } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useMemo, useRef } from "react";
import { BarList, type BarListItem } from "@/components/ceo/BarList";
import { useTabParam } from "@/components/ceo/CeoTabs";
import { type Column, DataTable } from "@/components/ceo/DataTable";
import { Delta, type DeltaKind, type GoodWhen } from "@/components/ceo/Delta";
import { FunnelStrip } from "@/components/ceo/FunnelStrip";
import {
  change,
  count,
  date,
  decimal,
  diff,
  humanize,
  isNum,
  kuwaitDay,
  money,
  NA,
  pct,
  plural,
  shortDate,
  type Unit,
} from "@/components/ceo/format";
import { Hint } from "@/components/ceo/Hint";
import { Value } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { TimeSeriesChart } from "@/components/ceo/TimeSeriesChart";
import { cn } from "@/lib/utils";
import type {
  FunnelWindow,
  GrowthPayload,
  Note,
} from "../../../convex/ceo/payloads";
import type { CeoTabProps } from "./types";

// --- Windows ---

const WINDOW_KEYS = ["yesterday", "last7", "mtd", "lastMonth"] as const;
type WindowKey = (typeof WINDOW_KEYS)[number];

const WINDOW_LABEL: Record<WindowKey, string> = {
  yesterday: "Yesterday",
  last7: "Last 7 days",
  mtd: "Month to date",
  lastMonth: "Last month",
};

/** The matching earlier window for deltas; yesterday and last month have none in the payload. */
const COMPARE_WITH: Record<WindowKey, keyof GrowthPayload["windows"] | null> = {
  yesterday: null,
  last7: "prevLast7",
  mtd: "lastMonthToDate",
  lastMonth: null,
};

/** "Mon 14 Sep", "1 to 15 Sep" or "28 Aug to 3 Sep". */
function range(from: string, to: string): string {
  if (from === to) return date(from);
  if (from.slice(0, 7) === to.slice(0, 7))
    return `${Number(from.slice(8, 10))} to ${shortDate(to)}`;
  return `${shortDate(from)} to ${shortDate(to)}`;
}

// --- Notes: each caveat beside the card it qualifies; the rest on the scorecard ---

type CardKey = "scorecard" | "funnel" | "daily" | "reps" | "ads" | "sources";

const NOTE_ROUTES: readonly (readonly [RegExp, CardKey])[] = [
  [/^reps:|rep scorecard/i, "reps"],
  [/top ads/i, "ads"],
  [/lead sources|leads are every/i, "sources"],
  [/daily series/i, "daily"],
  [/each stage is dated/i, "funnel"],
];

function routeNotes(notes: Note[] | null | undefined) {
  const out: Partial<Record<CardKey, Note[]>> = {};
  for (const note of notes ?? []) {
    const key =
      NOTE_ROUTES.find(([re]) => re.test(note.text))?.[1] ?? "scorecard";
    out[key] = [...(out[key] ?? []), note];
  }
  return out;
}

function ratio(v: number | null | undefined): string {
  return isNum(v) ? `${decimal(v)}x` : NA;
}

/** Mahara's own acquisition funnel by window, reps, top ads and lead sources. */
export function GrowthTab({ sections, now, day }: CeoTabProps) {
  const section = sections.growth;
  const payload = section?.payload ?? null;
  const today = day ?? kuwaitDay(now);
  const [win, setWin] = useTabParam(WINDOW_KEYS, "mtd", "window");
  const notes = useMemo(() => routeNotes(payload?.notes), [payload]);

  const current = payload?.windows?.[win] ?? null;
  const compareKey = COMPARE_WITH[win];
  const previous = compareKey ? (payload?.windows?.[compareKey] ?? null) : null;

  // With nothing to show, one card says so instead of a switcher over seven empty states.
  if (!payload)
    return (
      <div className="grid min-w-0">
        <SectionCard title="Growth" section={section}>
          {() => null}
        </SectionCard>
      </div>
    );

  return (
    <div className="grid gap-4 lg:gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <WindowSwitcher value={win} onChange={setWin} />
        {current ? (
          <p className="text-sm text-muted-foreground tabular-nums">
            <span className="font-medium text-foreground">
              {range(current.from, current.to)}
            </span>
            {previous
              ? `, compared with ${range(previous.from, previous.to)}`
              : ", shown without a comparison"}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:gap-6 xl:grid-cols-12">
        <SectionCard
          kicker={WINDOW_LABEL[win]}
          title="Scorecard"
          section={section}
          notes={notes.scorecard}
          order={0}
          className="xl:col-span-7"
        >
          {p => (
            <Scorecard
              w={p.windows[win]}
              prev={compareKey ? p.windows[compareKey] : null}
            />
          )}
        </SectionCard>
        <SectionCard
          kicker={WINDOW_LABEL[win]}
          title="Funnel"
          section={section}
          notes={notes.funnel}
          order={1}
          className="xl:col-span-5"
        >
          {p => <FunnelBody w={p.windows[win]} label={WINDOW_LABEL[win]} />}
        </SectionCard>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold text-foreground">
          Trends and breakdowns
        </h2>
        <p className="text-xs text-muted-foreground">
          These keep their own ranges and do not follow the window above.
        </p>
      </div>

      <SectionCard
        kicker="Daily, through yesterday"
        title="Spend, leads, bookings and closes"
        section={section}
        notes={notes.daily}
        order={2}
      >
        {p => <DailyBody rows={p.daily} today={today} />}
      </SectionCard>

      <SectionCard
        kicker="Month to date"
        title="Reps"
        section={section}
        notes={notes.reps}
        order={3}
      >
        {p => <RepsTable reps={p.reps} />}
      </SectionCard>

      <div className="grid gap-4 lg:gap-6 md:grid-cols-2">
        <SectionCard
          kicker="Last 7 days"
          title="Top ads by spend"
          section={section}
          notes={notes.ads}
          order={4}
        >
          {p => <TopAds ads={p.topAds} />}
        </SectionCard>
        <SectionCard
          kicker="Month to date"
          title="Lead sources"
          section={section}
          notes={notes.sources}
          order={5}
        >
          {p => <LeadSources sources={p.leadSources} />}
        </SectionCard>
      </div>
    </div>
  );
}

// --- Window switcher: one row above everything it scopes ---

function WindowSwitcher({
  value,
  onChange,
}: {
  value: WindowKey;
  onChange: (key: WindowKey) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = WINDOW_KEYS.length;
    const i = WINDOW_KEYS.indexOf(value);
    let next: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % n;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (i - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else return;
    e.preventDefault();
    onChange(WINDOW_KEYS[next]);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Window for the scorecard and funnel"
      onKeyDown={onKeyDown}
      className="grid w-full grid-cols-2 gap-1 rounded-lg bg-muted p-1 sm:inline-flex sm:w-auto"
    >
      {WINDOW_KEYS.map((key, i) => {
        const active = key === value;
        return (
          <button
            key={key}
            ref={el => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(key)}
            className={cn(
              "h-8 whitespace-nowrap rounded-md px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-card font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {WINDOW_LABEL[key]}
          </button>
        );
      })}
    </div>
  );
}

// --- Scorecard ---

type Tile = {
  label: string;
  value: string;
  delta?: ReactNode;
  sub?: ReactNode;
  hint?: string;
  naHint?: string;
};

function Scorecard({
  w,
  prev,
}: {
  w: FunnelWindow;
  prev: FunnelWindow | null;
}) {
  const vs = prev ? `vs ${range(prev.from, prev.to)}` : undefined;
  const delta = (
    value: number | null,
    goodWhen: GoodWhen,
    kind: DeltaKind = "pct",
  ) =>
    prev && isNum(value) ? (
      <Delta value={value} goodWhen={goodWhen} kind={kind} vs={vs} />
    ) : undefined;

  const groups: { title: string; tiles: Tile[] }[] = [
    {
      title: "Acquisition",
      tiles: [
        {
          label: "Ad spend",
          value: money(w.spend),
          delta: delta(change(w.spend, prev?.spend), "neither"),
          hint: "Lead-gen campaigns only, as on the B2B dashboard overview.",
        },
        {
          label: "Leads",
          value: count(w.leads),
          delta: delta(change(w.leads, prev?.leads), "up"),
        },
        {
          label: "Cost per lead",
          value: money(w.cpl),
          delta: delta(change(w.cpl, prev?.cpl), "down"),
          naHint: "No leads in this window, so there is no cost per lead.",
        },
      ],
    },
    {
      title: "Sales",
      tiles: [
        {
          label: "Demos booked",
          value: count(w.demosBooked),
          delta: delta(change(w.demosBooked, prev?.demosBooked), "up"),
        },
        {
          label: "Show rate",
          value: pct(w.demoShowRate),
          delta: delta(
            diff(w.demoShowRate, prev?.demoShowRate),
            "up",
            "points",
          ),
          sub: (
            <span>
              Marked calls only:{" "}
              <span className="font-medium tabular-nums text-foreground">
                <Value
                  value={pct(w.demoShowRateMarked)}
                  hint="No demo in this window has an outcome marked yet."
                />
              </span>
            </span>
          ),
          hint: "The dashboard's rate, which counts past calls still marked confirmed as shows. The marked rate uses only calls with an outcome.",
          naHint: "No demos were due in this window.",
        },
        {
          label: "Closes",
          value: count(w.closes),
          delta: delta(change(w.closes, prev?.closes), "up"),
        },
        {
          label: "Close rate",
          value: pct(w.closeRate),
          delta: delta(diff(w.closeRate, prev?.closeRate), "up", "points"),
          hint: "Closes over demos shown in the same window, so it can pass 100% in a short window.",
          naHint: "No demos were shown in this window.",
        },
      ],
    },
    {
      title: "Return",
      tiles: [
        {
          label: "Contracted",
          value: money(w.contracted),
          delta: delta(change(w.contracted, prev?.contracted), "up"),
        },
        {
          label: "Cash collected",
          value: money(w.cash),
          delta: delta(change(w.cash, prev?.cash), "up"),
          hint: "The upfront amount typed on the closed-deal form, not Whop payments.",
        },
        {
          label: "CAC",
          value: money(w.cac),
          delta: delta(change(w.cac, prev?.cac), "down"),
          hint: "Ad spend per close. Ads only, not fully loaded.",
          naHint: "No closes in this window, so there is no cost per close.",
        },
        {
          label: "ROAS",
          value: ratio(w.roas),
          delta: delta(change(w.roas, prev?.roas), "up"),
          hint: "Return on ad spend, as the B2B dashboard computes it.",
          naHint: "No ad spend in this window.",
        },
      ],
    },
  ];

  return (
    <div className="grid gap-5">
      {groups.map((g, gi) => (
        <section
          key={g.title}
          aria-label={g.title}
          className={cn(gi > 0 && "border-t pt-5")}
        >
          <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {g.title}
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            {g.tiles.map(t => (
              <StatTile
                key={t.label}
                variant="plain"
                label={t.label}
                value={t.value}
                delta={t.delta}
                sub={t.sub}
                hint={t.hint}
                naHint={t.naHint}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// --- Funnel and what each step costs ---

function perStep(spend: number, n: number): number | null {
  return n > 0 ? spend / n : null;
}

function FunnelBody({ w, label }: { w: FunnelWindow; label: string }) {
  const costs = [
    { label: "Per lead", value: w.cpl },
    { label: "Per intro booked", value: perStep(w.spend, w.introsBooked) },
    { label: "Per demo shown", value: perStep(w.spend, w.demosShown) },
    { label: "Per close", value: w.cac },
  ];
  return (
    <div className="min-w-0">
      <FunnelStrip
        ariaLabel={`Mahara funnel, ${label.toLowerCase()}`}
        steps={[
          { label: "Leads", value: w.leads },
          { label: "Intros booked", value: w.introsBooked },
          { label: "Demos booked", value: w.demosBooked },
          // The source's own rates: show rate by call day, close rate on demos shown.
          {
            label: "Demos shown",
            value: w.demosShown,
            rateFromPrevious: w.demoShowRate,
          },
          { label: "Closes", value: w.closes, rateFromPrevious: w.closeRate },
        ]}
      />
      <div className="mt-6 border-t pt-4">
        <div className="mb-3 flex items-center gap-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Ad spend per step
          </p>
          <Hint content="Lead-gen ad spend in this window divided by each step's count.">
            <button
              type="button"
              aria-label="Lead-gen ad spend in this window divided by each step's count."
              className="inline-flex shrink-0 cursor-help rounded-sm text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Info className="size-3.5" aria-hidden />
            </button>
          </Hint>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {costs.map(c => (
            <div key={c.label} className="min-w-0">
              <dt className="truncate text-xs text-muted-foreground">
                {c.label}
              </dt>
              <dd className="mt-0.5 text-base font-semibold tracking-tight text-foreground">
                <Value value={money(c.value)} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

// --- Daily small multiples ---

const DAILY_SERIES: {
  key: "spend" | "leads" | "booked" | "closes";
  title: string;
  unit: Unit;
  noun: string;
}[] = [
  { key: "spend", title: "Ad spend", unit: "money", noun: "Lead-gen ad spend" },
  { key: "leads", title: "Leads", unit: "count", noun: "Leads" },
  {
    key: "booked",
    title: "Calls booked",
    unit: "count",
    noun: "Intro and demo calls booked",
  },
  { key: "closes", title: "Closes", unit: "count", noun: "Closes" },
];

function DailyBody({
  rows,
  today,
}: {
  rows: GrowthPayload["daily"];
  today: string;
}) {
  // Today is still running; a partial last day would read as a drop on every chart.
  const days = rows.filter(r => r.date < today);
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;
  const span = first && last ? `from ${date(first)} to ${date(last)}` : "";

  return (
    <div className="grid gap-x-8 gap-y-8 sm:grid-cols-2">
      {DAILY_SERIES.map(s => (
        <TimeSeriesChart
          key={s.key}
          data={days}
          series={[{ key: s.key, label: s.title }]}
          unit={s.unit}
          title={s.title}
          height={180}
          syncId="ceo-growth-daily"
          ariaLabel={`${s.noun} per day ${span}.`}
          emptyText="No days to plot yet."
        />
      ))}
    </div>
  );
}

// --- Reps ---

type Rep = GrowthPayload["reps"][number];

const REP_COLUMNS: Column<Rep>[] = [
  {
    key: "name",
    header: "Rep",
    cell: r => (
      <div className="min-w-0">
        <p className="whitespace-nowrap font-medium text-foreground">
          {r.name}
        </p>
        {r.role ? (
          <p className="whitespace-nowrap text-xs text-muted-foreground">
            {humanize(r.role)}
          </p>
        ) : null}
      </div>
    ),
    sortValue: r => r.name,
  },
  {
    key: "booked",
    header: "Booked",
    cell: r => count(r.booked),
    sortValue: r => r.booked,
    numeric: true,
  },
  {
    key: "shown",
    header: "Shown",
    cell: r => count(r.shown),
    sortValue: r => r.shown,
    numeric: true,
  },
  {
    key: "closes",
    header: "Closes",
    cell: r => count(r.closes),
    sortValue: r => r.closes,
    numeric: true,
  },
  {
    key: "closeRate",
    header: "Close rate",
    cell: r => (
      <Value
        value={pct(r.closeRate)}
        hint="No demos shown for this rep this month."
      />
    ),
    sortValue: r => r.closeRate,
    numeric: true,
  },
  {
    key: "contracted",
    header: "Contracted",
    cell: r => money(r.contracted),
    sortValue: r => r.contracted,
    numeric: true,
  },
  {
    key: "cash",
    header: "Cash",
    cell: r => money(r.cash),
    sortValue: r => r.cash,
    numeric: true,
  },
];

function RepsTable({ reps }: { reps: Rep[] }) {
  return (
    <DataTable
      rows={reps}
      columns={REP_COLUMNS}
      rowKey={(r, i) => `${r.name}-${i}`}
      initialSort={{ key: "contracted", dir: "desc" }}
      caption="Reps this month: calls booked and shown, closes, close rate, contracted and cash"
      emptyText="No rep activity this month yet."
      stickyFirst
    />
  );
}

// --- Top ads and lead sources ---

function TopAds({ ads }: { ads: GrowthPayload["topAds"] }) {
  const items: BarListItem[] = ads.map((a, i) => ({
    key: `${a.name}-${i}`,
    label: a.name,
    value: a.spend,
    sub: plural(a.leads, "lead"),
    display: (
      <>
        {money(a.spend)}
        <span className="ml-1 font-normal text-muted-foreground">
          {isNum(a.cpl) ? `at ${money(a.cpl)} a lead` : "no leads"}
        </span>
      </>
    ),
  }));
  return (
    <BarList
      items={items}
      format={money}
      ariaLabel="Top ads by spend over the last 7 days, with cost per lead"
      emptyText="No ad spend in the last 7 days."
    />
  );
}

function LeadSources({ sources }: { sources: GrowthPayload["leadSources"] }) {
  const items: BarListItem[] = sources.map((s, i) => ({
    key: `${s.source}-${i}`,
    label: s.source === "(none)" ? "No source" : s.source,
    value: s.leads,
  }));
  return (
    <BarList
      items={items}
      format={count}
      ariaLabel="Leads by source this month"
      emptyText="No leads this month yet."
    />
  );
}
