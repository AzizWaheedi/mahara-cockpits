import { Lock, Target, Users } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useTabParam } from "@/components/ceo/CeoTabs";
import { type Column, DataTable } from "@/components/ceo/DataTable";
import { Delta, type DeltaKind, type GoodWhen } from "@/components/ceo/Delta";
import { EmptyState } from "@/components/ceo/EmptyState";
import { FilterChips } from "@/components/ceo/FilterChips";
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
  month,
  NA,
  pct,
  plural,
  shiftMonth,
} from "@/components/ceo/format";
import {
  CANCEL_RATE,
  CLOSE_RATE,
  contractedHeadline,
  INTRO_SHOW_RATE,
  INTRO_TO_DEMO,
  QUALIFIED_CLOSE_RATE,
  ROAS_CASH,
  ROAS_CONTRACTED,
  SHOW_RATE,
} from "@/components/ceo/metrics";
import { Na, Value } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip } from "@/components/ceo/StatusChip";
import { TabLink } from "@/components/ceo/TabLink";
import {
  SALES_TARGET_METRICS,
  TargetMeter,
} from "@/components/ceo/TargetMeter";
import { TimeSeriesChart } from "@/components/ceo/TimeSeriesChart";
import {
  COMPARE_WITH,
  range,
  WINDOW_CHIPS,
  WINDOW_KEYS,
  WINDOW_LABEL,
} from "@/components/ceo/windows";
import { cn } from "@/lib/utils";
import type {
  AssetsPayload,
  FunnelWindow,
  GrowthPayload,
  MoneyPayload,
  Note,
} from "../../../convex/ceo/payloads";
import type { CeoTabKey, CeoTabProps } from "./types";

/** a over b, null when b cannot carry a rate. A real zero stays 0. */
function per(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  if (!isNum(a) || !isNum(b) || b <= 0) return null;
  return a / b;
}

/** "5.8x" for a return, n/a when there is none. */
function ratio(v: number | null | undefined): string {
  return isNum(v) ? `${decimal(v)}x` : NA;
}

// --- Notes: each caveat beside the number it qualifies ---

type GrowthCard = "calls" | "closing" | "daily" | "reps" | "marketing";

// Order matters. The rep note also names top ads, so the rep rule runs first,
// and the marketing rule is last so it only catches what no sales card needs.
// Notes routed to "marketing" are not dropped: the Marketing tab carries them
// and each card that gives one up says how many and where they went.
const GROWTH_NOTE_ROUTES: readonly (readonly [RegExp, GrowthCard])[] = [
  [/rep scorecard|^reps:/i, "reps"],
  [/daily series/i, "daily"],
  [/demos due|show rate|still marked confirmed|GHL calls/i, "calls"],
  [
    /closed-deal form|contracted and cash|each stage is dated|close rate/i,
    "closing",
  ],
  [
    /lead-gen|retargeting|leads are every|top ads|lead source|Meta ad spend|GHL leads/i,
    "marketing",
  ],
];

type MoneyCard = "deals" | "targets" | "money";

// Anything this tab does not show (Whop cash, refunds, failed checkouts,
// expenses) lands on "money" and is pointed at rather than repeated here.
const MONEY_NOTE_ROUTES: readonly (readonly [RegExp, MoneyCard])[] = [
  [/target|actuals/i, "targets"],
  [/deal|closer form|contracted value/i, "deals"],
];

function route<K extends string>(
  notes: Note[] | null | undefined,
  routes: readonly (readonly [RegExp, K])[],
  fallback: K,
): Partial<Record<K, Note[]>> {
  const out = new Map<string, Note[]>();
  for (const note of notes ?? []) {
    const key = routes.find(([re]) => re.test(note.text))?.[1] ?? fallback;
    out.set(key, [...(out.get(key) ?? []), note]);
  }
  return Object.fromEntries(out) as Partial<Record<K, Note[]>>;
}

/** Sales: Mahara's own closing, from a booked call to a signed deal. */
export function SalesTab({ sections, now, day, goTab }: CeoTabProps) {
  const growthSection = sections.growth;
  const moneySection = sections.money;
  const g = growthSection?.payload ?? null;
  const m = moneySection?.payload ?? null;
  const today = day ?? kuwaitDay(now);
  const [win, setWin] = useTabParam(WINDOW_KEYS, "mtd", "window");

  const gNotes = useMemo(
    () => route(g?.notes, GROWTH_NOTE_ROUTES, "calls" as GrowthCard),
    [g],
  );
  const mNotes = useMemo(
    () => route(m?.notes, MONEY_NOTE_ROUTES, "money" as MoneyCard),
    [m],
  );

  const compareKey = COMPARE_WITH[win];
  const current = g?.windows[win] ?? null;
  const previous = compareKey ? (g?.windows[compareKey] ?? null) : null;
  const monthKey = m?.month ?? today.slice(0, 7);
  const repsRefused = (gNotes.reps ?? []).some(
    n => n.level === "warn" && /rep scorecard could not be read/i.test(n.text),
  );

  return (
    <div className="grid gap-4 lg:gap-6">
      {g ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <FilterChips
            options={WINDOW_CHIPS}
            value={win}
            onChange={setWin}
            ariaLabel="Window for the calls and closing cards"
          />
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
      ) : null}

      <div className="grid gap-4 lg:gap-6 xl:grid-cols-12">
        <SectionCard
          kicker={WINDOW_LABEL[win]}
          title="Calls booked and shown"
          section={growthSection}
          notes={gNotes.calls}
          actions={<TabLink tab="marketing" label="Marketing" goTab={goTab} />}
          order={0}
          className="xl:col-span-7"
        >
          {p => (
            <CallsBody
              w={p.windows[win]}
              prev={compareKey ? p.windows[compareKey] : null}
              vs={previous ? `vs ${range(previous.from, previous.to)}` : null}
              elsewhere={
                <NotesElsewhere
                  notes={gNotes.marketing}
                  topic="leads, spend and ads"
                  tab="marketing"
                  label="Marketing"
                  goTab={goTab}
                />
              }
            />
          )}
        </SectionCard>

        <SectionCard
          kicker={WINDOW_LABEL[win]}
          title="Closing"
          section={growthSection}
          notes={gNotes.closing}
          order={1}
          className="xl:col-span-5"
        >
          {p => (
            <ClosingBody
              w={p.windows[win]}
              prev={compareKey ? p.windows[compareKey] : null}
              vs={previous ? `vs ${range(previous.from, previous.to)}` : null}
              label={WINDOW_LABEL[win]}
            />
          )}
        </SectionCard>
      </div>

      <SectionCard
        kicker={month(monthKey, { long: true, year: true })}
        title="Deals signed and deal size"
        section={moneySection}
        notes={mNotes.deals}
        actions={<TabLink tab="money" label="Money" goTab={goTab} />}
        order={2}
      >
        {p => (
          <DealSizeBody
            p={p}
            elsewhere={
              <NotesElsewhere
                notes={mNotes.money}
                topic="cash, refunds and expenses"
                tab="money"
                label="Money"
                goTab={goTab}
              />
            }
          />
        )}
      </SectionCard>

      <SectionCard
        kicker="Daily, through yesterday"
        title="Calls booked and closes"
        section={growthSection}
        notes={gNotes.daily}
        order={3}
      >
        {p => <DailyBody rows={p.daily} today={today} />}
      </SectionCard>

      <SectionCard
        kicker="What a rep has to send"
        title="Sales assets"
        section={sections.assets}
        order={5}
      >
        {(a: AssetsPayload) => <AssetsBody p={a} />}
      </SectionCard>

      <SectionCard
        kicker="Right now"
        title="What the funnel is waiting on"
        section={growthSection}
        order={4}
      >
        {p => <BacklogBody p={p} />}
      </SectionCard>

      <SectionCard
        kicker="Month to date"
        title="Reps"
        section={growthSection}
        notes={gNotes.reps}
        actions={
          repsRefused ? (
            <StatusChip
              tone="serious"
              label="Refused by the database"
              hint="The B2B database denies the cockpit's read-only role permission to run the rep scorecard function, so no rep row can be read."
            />
          ) : undefined
        }
        order={4}
      >
        {p => <RepsBody reps={p.reps} refused={repsRefused} />}
      </SectionCard>

      <SectionCard
        kicker="Newest 10, whatever month they were signed in"
        title="Deals on the closer form"
        section={moneySection}
        order={5}
      >
        {p => <DealsTable deals={p.deals.recent} />}
      </SectionCard>

      <SectionCard
        kicker={month(m?.targets.month ?? monthKey, { long: true, year: true })}
        title="Targets that belong to sales"
        section={moneySection}
        notes={mNotes.targets}
        actions={<TabLink tab="money" label="Money" goTab={goTab} />}
        order={6}
      >
        {p => <TargetsBody p={p} />}
      </SectionCard>

      <SectionCard kicker="Sales" title="Not measured yet" order={7}>
        <NotMeasured />
      </SectionCard>
    </div>
  );
}

// --- Small shared pieces ---

/** Says how many caveats this card handed to another tab, so none reads as lost. */
function NotesElsewhere({
  notes,
  topic,
  tab,
  label,
  goTab,
}: {
  notes: Note[] | undefined;
  topic: string;
  tab: CeoTabKey;
  label: string;
  goTab: CeoTabProps["goTab"];
}) {
  const n = notes?.length ?? 0;
  if (n === 0) return null;
  return (
    <p className="mt-5 border-t pt-3 text-xs text-muted-foreground">
      {plural(n, "more caveat")} about {topic} {n === 1 ? "sits" : "sit"} on the{" "}
      <button
        type="button"
        onClick={() => goTab(tab)}
        className="rounded-sm font-medium text-foreground underline decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
      </button>{" "}
      tab.
    </p>
  );
}

type Tile = {
  label: string;
  value: string;
  delta?: ReactNode;
  sub?: ReactNode;
  hint?: string;
  naHint?: string;
};

function Tiles({ tiles, className }: { tiles: Tile[]; className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3",
        className,
      )}
    >
      {tiles.map(t => (
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
  );
}

/** A delta only when there is a window to compare with. */
function deltaFor(
  vs: string | null,
  value: number | null,
  goodWhen: GoodWhen,
  kind: DeltaKind = "pct",
): ReactNode {
  if (vs === null || !isNum(value)) return undefined;
  return <Delta value={value} goodWhen={goodWhen} kind={kind} vs={vs} />;
}

// --- Card 1: calls booked and shown ---

function CallsBody({
  w,
  prev,
  vs,
  elsewhere,
}: {
  w: FunnelWindow;
  prev: FunnelWindow | null;
  vs: string | null;
  elsewhere: ReactNode;
}) {
  const demosDue = w.raw.demos_due;
  const tiles: Tile[] = [
    {
      label: "Intro calls booked",
      value: count(w.introsBooked),
      delta: deltaFor(vs, change(w.introsBooked, prev?.introsBooked), "up"),
      hint: "Intro calls on a rep's GHL calendar, dated by the day the booking was made.",
    },
    {
      label: "Demos booked",
      value: count(w.demosBooked),
      delta: deltaFor(vs, change(w.demosBooked, prev?.demosBooked), "up"),
      hint: "Demos on a rep's GHL calendar, dated by the day the booking was made.",
    },
    {
      label: "Demos shown",
      value: count(w.demosShown),
      delta: deltaFor(vs, change(w.demosShown, prev?.demosShown), "up"),
      hint: "Dated by the day of the call, not the day it was booked, so a demo booked last week and held this week lands in two different windows.",
    },
    {
      label: SHOW_RATE.label,
      value: SHOW_RATE.format(w.demoShowRate),
      delta: deltaFor(
        vs,
        diff(w.demoShowRate, prev?.demoShowRate),
        "up",
        "points",
      ),
      sub: SHOW_RATE.sub(w),
      hint: SHOW_RATE.hint,
      naHint: SHOW_RATE.naHint,
    },
    {
      label: INTRO_SHOW_RATE.label,
      value: INTRO_SHOW_RATE.format(w.introShowRate),
      delta: deltaFor(
        vs,
        diff(w.introShowRate, prev?.introShowRate),
        "up",
        "points",
      ),
      hint: INTRO_SHOW_RATE.hint,
      naHint: INTRO_SHOW_RATE.naHint,
    },
    {
      label: "Demos due",
      value: count(demosDue),
      sub:
        isNum(demosDue) && demosDue - w.demosShown > 0
          ? `${count(demosDue - w.demosShown)} of them are not counted as shown`
          : undefined,
      hint: "Demos whose call time has passed in this window, cancelled and no-show included. This is what the show rate divides by. A past demo still marked confirmed or invalid counts as shown, so the gap is no-shows, cancellations and calls still marked new.",
      naHint: "The window function did not return a demos due count.",
    },
    {
      label: "Intro calls shown",
      value: count(w.introsShown),
      delta: deltaFor(vs, change(w.introsShown, prev?.introsShown), "up"),
      sub: `of ${plural(w.introsDue, "intro call")} due`,
      hint: "Intro calls in this window marked showed, or confirmed or invalid once their time has passed, over the intro calls whose time has passed. Cancelled and future calls are never in it.",
    },
    {
      label: CANCEL_RATE.label,
      value: CANCEL_RATE.format(w.cancel.total),
      delta: deltaFor(
        vs,
        diff(w.cancel.total, prev?.cancel.total),
        "down",
        "points",
      ),
      sub: `intros ${CANCEL_RATE.format(w.cancel.intro)} · demos ${CANCEL_RATE.format(w.cancel.demo)}`,
      hint: CANCEL_RATE.hint,
      naHint: CANCEL_RATE.naHint,
    },
  ];
  return (
    <div className="min-w-0">
      <Tiles tiles={tiles} />
      {elsewhere}
    </div>
  );
}

// --- Card 2: closing ---

function ClosingBody({
  w,
  prev,
  vs,
  label,
}: {
  w: FunnelWindow;
  prev: FunnelWindow | null;
  vs: string | null;
  label: string;
}) {
  const avgContract = per(w.contracted, w.closes);
  const fe = w.frontEndCash;
  const tiles: Tile[] = [
    {
      label: "Closes",
      value: count(w.closes),
      delta: deltaFor(vs, change(w.closes, prev?.closes), "up"),
      hint: "Deals signed on the closed-deal form, dated by the day the form was submitted.",
    },
    {
      label: CLOSE_RATE.label,
      value: CLOSE_RATE.format(w.closeRate),
      delta: deltaFor(vs, diff(w.closeRate, prev?.closeRate), "up", "points"),
      sub: `${count(w.closes)} signed, ${plural(w.demosShown, "demo")} shown`,
      hint: CLOSE_RATE.hint,
      naHint: CLOSE_RATE.naHint,
    },
    {
      label: QUALIFIED_CLOSE_RATE.label,
      value: QUALIFIED_CLOSE_RATE.format(w.qualifiedCloseRate),
      delta: deltaFor(
        vs,
        diff(w.qualifiedCloseRate, prev?.qualifiedCloseRate),
        "up",
        "points",
      ),
      sub: `${count(w.closes)} signed, ${plural(isNum(w.raw.demos_qualified) ? w.raw.demos_qualified : 0, "qualified demo")}`,
      hint: QUALIFIED_CLOSE_RATE.hint,
      naHint: QUALIFIED_CLOSE_RATE.naHint,
    },
    {
      label: "Contracted on the closer form",
      value: money(w.contracted),
      delta: deltaFor(vs, change(w.contracted, prev?.contracted), "up"),
      hint: "The contract value the closer typed on the form, in this window. Deal values logged by hand on the Money tab are not in it; the contracted this month figure on the deals card adds them.",
    },
    {
      label: "Front-end cash",
      value: money(fe.total),
      delta: deltaFor(vs, change(fe.total, prev?.frontEndCash.total), "up"),
      sub:
        fe.deposit > 0
          ? `${pct(fe.confirmedShare)} confirmed on Whop or by transfer · kickoff cash not read yet`
          : "kickoff cash not read yet",
      hint: "The deposit the closer typed at signing, for deals signed in this window, plus the kickoff cash the CSM collects on the onboarding call. The kickoff form is not read yet, so this is the deposit alone. Confirmed means a Whop payment or a bank transfer on record backs the deposit; Tap is not checked here.",
    },
    {
      label: ROAS_CASH.label,
      value: ratio(w.roasCash),
      delta: deltaFor(vs, change(w.roasCash, prev?.roasCash), "up"),
      hint: ROAS_CASH.hint,
      naHint: ROAS_CASH.naHint,
    },
    {
      label: ROAS_CONTRACTED.label,
      value: ratio(w.roasContracted),
      delta: deltaFor(vs, change(w.roasContracted, prev?.roasContracted), "up"),
      hint: ROAS_CONTRACTED.hint,
      naHint: ROAS_CONTRACTED.naHint,
    },
    {
      label: "Average contract in this window",
      value: money(avgContract),
      hint: "Contracted value in this window over closes in this window.",
      naHint: "No closes in this window, so there is no average contract.",
    },
  ];

  return (
    <div className="grid min-w-0 gap-6">
      <Tiles tiles={tiles} className="sm:grid-cols-3 xl:grid-cols-2" />
      <div className="border-t pt-5">
        <FunnelStrip
          ariaLabel={`Booked calls to closes, ${label.toLowerCase()}`}
          steps={[
            { label: "Intros booked", value: w.introsBooked },
            // The dashboard's intro to demo: intros shown that went on to book a demo.
            {
              label: "Demos booked",
              value: w.demosBooked,
              rateFromPrevious: w.introToDemo ?? null,
              rateFormat: INTRO_TO_DEMO.format,
            },
            {
              label: "Demos shown",
              value: w.demosShown,
              rateFromPrevious: w.demoShowRate,
              rateFormat: SHOW_RATE.format,
            },
            {
              label: "Closes",
              value: w.closes,
              rateFromPrevious: w.closeRate,
              rateFormat: CLOSE_RATE.format,
            },
          ]}
        />
      </div>
    </div>
  );
}

// --- Card 3: deals signed and deal size ---

function DealSizeBody({
  p,
  elsewhere,
}: {
  p: MoneyPayload;
  elsewhere: ReactNode;
}) {
  const prev = shiftMonth(p.month, -1);
  const lastMonthName = prev ? month(prev, { long: true }) : "last month";
  const d = p.deals;
  // Closer form plus deal values logged by hand, as on Today, Frontend and Money.
  const contracted = contractedHeadline(p);
  const avgThisMonth = per(contracted.value, contracted.deals);
  const tiles: Tile[] = [
    // No delta on these two: last month is a whole month and this one is not,
    // so a percentage between them would read as a fall every time. The fair
    // pace comparison, the same days last month, sits on the closing card.
    {
      label: "Deals signed this month",
      value: count(d.mtd),
      sub: `${count(d.lastMonth)} in all of ${lastMonthName}`,
    },
    {
      label: contracted.label,
      value: money(contracted.value),
      sub: `${contracted.split ? `${contracted.split}. ` : ""}${money(contracted.lastMonth)} in all of ${lastMonthName}`,
      hint: contracted.hint,
    },
    {
      label: "Average contract this month",
      value: money(avgThisMonth),
      hint: "Contracted value this month over the deals behind it: closer form deals plus any new deal logged by hand with a payment.",
      naHint: "No deal has been signed this month yet.",
    },
    {
      label: "Average contract, 90 days",
      value: money(d.avgContract90d),
      hint: "Mean contracted value of deals signed in the last 90 days that have one.",
      naHint: "No deal signed in the last 90 days has a contracted value.",
    },
  ];
  return (
    <div className="min-w-0">
      <Tiles tiles={tiles} className="xl:grid-cols-4" />
      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
        Contracted value is the promise on the form, not money collected. The{" "}
        {lastMonthName} figures beside each number are whole months, so a month
        to date figure will sit under them early on. The fair pace comparison,
        this month against the same days last month, is on the closing card
        above.
      </p>
      {elsewhere}
    </div>
  );
}

// --- Card 4: what moved, day by day ---

function DailyBody({
  rows,
  today,
}: {
  rows: GrowthPayload["daily"];
  today: string;
}) {
  // Today is still running; a partial last day would read as a drop on the chart.
  const days = rows.filter(r => r.date < today);
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;
  const span = first && last ? `from ${date(first)} to ${date(last)}` : "";

  return (
    <div className="grid gap-x-8 gap-y-8 sm:grid-cols-2">
      <TimeSeriesChart
        initialRange="90d"
        data={days}
        series={[{ key: "booked", label: "Calls booked" }]}
        title="Calls booked"
        height={180}
        syncId="ceo-sales-daily"
        ariaLabel={`Intro and demo calls booked per day ${span}.`}
        emptyText="No days to plot yet."
      />
      <TimeSeriesChart
        initialRange="90d"
        data={days}
        series={[{ key: "closes", label: "Closes" }]}
        title="Closes"
        height={180}
        syncId="ceo-sales-daily"
        ariaLabel={`Deals signed per day ${span}.`}
        emptyText="No days to plot yet."
      />
    </div>
  );
}

// --- Card 5: reps ---

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
        value={CLOSE_RATE.format(r.closeRate)}
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

function RepsBody({ reps, refused }: { reps: Rep[]; refused: boolean }) {
  if (reps.length === 0)
    return refused ? (
      <EmptyState
        icon={Lock}
        title="The B2B database refuses the rep scorecard"
        text="The cockpit reads that database with a role that is not allowed to run the rep scorecard function, so there are no rep rows to show. The refusal in the database's own words is in the note below. Nothing on this card is estimated to cover the gap: a grant on that function is what brings it back."
        compact
      />
    ) : (
      <EmptyState
        icon={Users}
        title="No rep activity this month yet"
        text="A rep appears here once a call sits on their calendar or a close carries their name."
        compact
      />
    );

  return (
    <div className="min-w-0">
      <DataTable
        rows={reps}
        columns={REP_COLUMNS}
        rowKey={(r, i) => `${r.name}-${i}`}
        initialSort={{ key: "contracted", dir: "desc" }}
        caption="Reps this month: calls booked and shown, closes, close rate, contracted and cash"
        emptyText="No rep activity this month yet."
        stickyFirst
      />
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Booked and shown are credited by whose calendar the call sat on, closes
        by the closer named on the form, so the two can disagree for the same
        person.
      </p>
    </div>
  );
}

// --- Card 6: the newest deals ---

type Deal = MoneyPayload["deals"]["recent"][number];

const DEAL_COLUMNS: Column<Deal>[] = [
  {
    key: "date",
    header: "Date",
    cell: d => (
      <span className="whitespace-nowrap tabular-nums text-muted-foreground">
        {date(d.date)}
      </span>
    ),
    sortValue: d => d.date,
    hideBelow: "sm",
  },
  {
    key: "business",
    header: "Business",
    cell: d => (
      <div className="min-w-0">
        <span
          className="block max-w-[9.5rem] truncate font-medium text-foreground sm:max-w-[16rem]"
          title={d.business ?? undefined}
        >
          <Value
            value={d.business}
            hint="The closer did not type a business name."
          />
        </span>
        {/* On a phone the date column hides, so the date rides under the name. */}
        <span className="block whitespace-nowrap text-xs tabular-nums text-muted-foreground sm:hidden">
          {date(d.date)}
        </span>
      </div>
    ),
    sortValue: d => d.business,
  },
  {
    key: "closer",
    header: "Closer",
    cell: d => <Value value={d.closer} hint="No closer on the form." />,
    sortValue: d => d.closer,
    hideBelow: "sm",
  },
  {
    key: "contracted",
    header: "Contracted",
    cell: d => (
      <Value
        value={money(d.contracted)}
        hint="Contracted value was not captured on this deal."
      />
    ),
    sortValue: d => d.contracted,
    numeric: true,
  },
  {
    key: "cash",
    header: "Upfront cash",
    cell: d => (
      <Value value={money(d.cash)} hint="No upfront cash on the form." />
    ),
    sortValue: d => d.cash,
    numeric: true,
  },
  {
    key: "plan",
    header: "Plan",
    cell: d => (
      <span
        className="block max-w-[18rem] truncate text-muted-foreground"
        title={d.plan ?? undefined}
      >
        <Value value={d.plan} hint="No payment plan on the form." />
      </span>
    ),
    sortValue: d => d.plan,
    hideBelow: "md",
  },
];

function DealsTable({ deals }: { deals: Deal[] }) {
  return (
    <DataTable
      rows={deals}
      columns={DEAL_COLUMNS}
      rowKey={(d, i) => `${d.date}-${d.business ?? ""}-${i}`}
      initialSort={{ key: "date", dir: "desc" }}
      caption="The newest 10 deals from the closer form"
      emptyText="No deals on the closer form yet."
    />
  );
}

// --- Card 7: the targets that belong to sales ---

function TargetsBody({ p }: { p: MoneyPayload }) {
  // The same six metrics, the same labels and the same pace rule as Money and
  // Frontend: only the list is narrowed to the ones sales owns.
  const items = p.targets.items.filter(i =>
    (SALES_TARGET_METRICS as readonly string[]).includes(i.metric),
  );
  const targetMonth = p.targets.month;
  if (items.length === 0)
    return (
      <EmptyState
        icon={Target}
        title={`No sales targets for ${month(p.month, { long: true })}`}
        text="Targets come from the monthly targets table in the B2B dashboard. Lead and spend targets sit on the Marketing tab, and the whole list is on Money."
        compact
      />
    );
  const otherMonth = targetMonth !== null && targetMonth !== p.month;
  return (
    <div className="min-w-0">
      {otherMonth ? (
        <p className="mb-5 text-xs leading-relaxed text-muted-foreground">
          These targets are filed for{" "}
          {month(targetMonth, { long: true, year: true })}, not{" "}
          {month(p.month, { long: true, year: true })}, so read the pace as a
          comparison with an older plan.
        </p>
      ) : null}
      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
        {items.map(item => (
          <TargetMeter
            key={item.metric}
            item={item}
            dayOfMonth={p.dayOfMonth}
            daysInMonth={p.daysInMonth}
            pace={!otherMonth}
          />
        ))}
      </div>
    </div>
  );
}

// --- Card 8: the sales numbers no source can give ---

const NOT_MEASURED: { label: string; why: string }[] = [
  {
    label: "Open pipeline: deals, stage, value, age",
    why: "Nothing in the B2B project holds an unclosed deal. The closer form is signed deals only, so the only pipeline the cockpit can see is calls that are already booked.",
  },
  {
    label: "Sales cycle length",
    why: "A deal carries only the day the form was submitted. There is no first touch date on it to measure from.",
  },
  {
    label: "Cash collected against cash contracted",
    why: "No payment is linked back to the deal that produced it, so a collection rate cannot be computed. The upfront share on the closing card is the closer's own two numbers on the same form.",
  },
  {
    label: "Speed to first contact on a Mahara lead",
    why: "The speed to lead numbers the cockpit has are the client call centre on the Calls tab, not Mahara's own sales.",
  },
  {
    label: "A target per rep",
    why: "The monthly targets table is company wide and has no rep column.",
  },
  {
    label: "Call quality: talk ratio, objections, recordings",
    why: "Fathom is synced as a feed, but no per call sales metric reaches the cockpit.",
  },
  {
    label: "Follow up after a lost or no-show call",
    why: "No outcome or task table exists, so nothing records what happened after the call.",
  },
];

function NotMeasured() {
  return (
    <div className="min-w-0">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Every one of these is a real sales number. No source the cockpit reads
        can give it today, so each is left as n/a rather than filled with a
        stand-in figure.
      </p>
      <dl className="mt-5 grid gap-x-10 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        {NOT_MEASURED.map(item => (
          <div key={item.label} className="min-w-0">
            <dt className="text-[13px] leading-5 text-muted-foreground">
              {item.label}
            </dt>
            <dd className="mt-1 text-lg font-semibold tracking-tight">
              <Na hint={item.why} />
            </dd>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {item.why}
            </p>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * What the sales system is waiting on somebody to fix.
 *
 * Counts only, deliberately. Every row behind these numbers carries a lead's
 * name, email and phone, and none of that reaches the payload.
 */
function BacklogBody({ p }: { p: GrowthPayload }) {
  const q = p.actionQueue;
  const st = p.stalled;
  if (!q && !st)
    return (
      <EmptyState
        title="The backlog has not been read yet"
        text="It arrives on the next refresh."
        icon={Lock}
      />
    );
  const worst = q ? [...q.buckets].sort((a, b) => b.count - a.count) : [];
  const ageLabel = (age: string) =>
    age === ">30d"
      ? "Over a month"
      : age === "<14d"
        ? "Still warm"
        : "Two to four weeks";
  return (
    <div className="grid gap-6">
      {q ? (
        <div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            <StatTile
              variant="plain"
              label="Records waiting on someone"
              value={count(q.total)}
              status={<StatusChip tone="serious" label="Backlog" />}
              hint="Every rate on this tab is computed over these records, so they stay soft until it is cleared."
            />
            {worst.slice(0, 2).map(b => (
              <StatTile
                key={b.key}
                variant="plain"
                label={b.label}
                value={count(b.count)}
                hint={b.hint}
              />
            ))}
          </div>
          {worst.length > 2 ? (
            <ul className="mt-4 grid gap-1 border-t pt-3 sm:grid-cols-2">
              {worst.slice(2).map(b => (
                <li key={b.key} className="text-sm">
                  <span className="text-muted-foreground">{`${b.label}: `}</span>
                  {count(b.count)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {st ? (
        <div className="border-t pt-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {`Open deals not touched in ${st.staleDays} days`}
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <StatTile
              variant="plain"
              label="Gone quiet"
              value={`${st.stale} of ${st.total}`}
              status={
                st.stale > st.total / 2 ? (
                  <StatusChip tone="serious" label="Most of them" />
                ) : undefined
              }
            />
            {st.buckets.map(b => (
              <StatTile
                key={b.age}
                variant="plain"
                label={ageLabel(b.age)}
                value={count(b.deals)}
              />
            ))}
          </div>
          {st.byOwner.length ? (
            <p className="mt-3 text-muted-foreground">
              {`Owners, from the sample the database returns rather than the whole set: ${st.byOwner
                .map(o => `${o.owner || "unassigned"} ${o.deals}`)
                .join(", ")}.`}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * What a rep has to send, and whether anybody sends it.
 *
 * The two readings pull apart and are kept apart. Coverage is what exists to
 * reach for; sends are whether it was reached for. 203 assets against four
 * sends ever is not a performance ranking, it is a library nobody opens, and
 * the card says that rather than dressing four sends as a top ten.
 */
function AssetsBody({ p }: { p: AssetsPayload }) {
  const lt = p.liveTraining;
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <StatTile
          variant="plain"
          label="Assets ready to send"
          value={count(p.live)}
          sub={`${count(p.arabic)} in Arabic`}
          hint="Each one carries what it proves, the objection it answers, where in a call it belongs, and paste-ready text."
        />
        <StatTile
          variant="plain"
          label="Sends ever recorded"
          value={count(p.sends)}
          status={
            p.sends < 20 ? (
              <StatusChip tone="serious" label="Barely used" />
            ) : undefined
          }
          hint="From asset_sends: what a rep actually sent. Small numbers make every performance figure an anecdote."
        />
        <StatTile
          variant="plain"
          label="Gaps in the library"
          value={`${p.gaps.length} of ${p.combinations}`}
          sub="objection and stage pairs with nothing"
          status={
            p.gaps.length ? (
              <StatusChip tone="warning" label="Nothing to send" />
            ) : undefined
          }
        />
        <StatTile
          variant="plain"
          label="Broken links"
          value={count(p.broken)}
          sub={p.broken ? "sending one sends a dead page" : "all resolving"}
          status={
            p.broken ? <StatusChip tone="serious" label="Dead" /> : undefined
          }
        />
      </div>

      {p.byType.length ? (
        <p className="text-xs text-muted-foreground">
          {p.byType
            .map(
              (t: AssetsPayload["byType"][number]) =>
                `${t.type.replace(/_/g, " ")} ${t.count}`,
            )
            .join(" · ")}
        </p>
      ) : null}

      {p.gaps.length ? (
        <div className="border-t pt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Moments in a call with nothing to send
          </p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {p.gaps.map((g: AssetsPayload["gaps"][number]) => (
              <li key={`${g.stage}-${g.objection}`} className="text-sm">
                <span className="text-muted-foreground">{`${g.stage}: `}</span>
                {g.objection}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {lt && !lt.everUsed ? (
        <div className="border-t pt-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Live Training
          </p>
          <p className="text-sm text-muted-foreground">
            Built, wired and never run. Six tables and eight views are waiting:
            registrants with their full UTM and ad, adset and campaign ids,
            attendance, engagement, a retention curve, pitch attribution, and
            outcomes carrying contract value and cash collected. That is
            attribution from a webinar through to closed money. No figure is
            shown, because zero events and a webinar that went badly would print
            the same zeros.
          </p>
        </div>
      ) : null}
    </div>
  );
}
