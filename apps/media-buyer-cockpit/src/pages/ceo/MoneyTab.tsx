import { Receipt, Target, Wallet } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { BarList, type BarListItem } from "@/components/ceo/BarList";
import { ColumnChart } from "@/components/ceo/ColumnChart";
import type { ChartSeries } from "@/components/ceo/chartKit";
import { type Column, DataTable } from "@/components/ceo/DataTable";
import { Delta } from "@/components/ceo/Delta";
import { EmptyState } from "@/components/ceo/EmptyState";
import {
  change,
  count,
  date,
  dateTime,
  humanize,
  isNum,
  kuwaitDay,
  money,
  moneyCompact,
  month,
  NA,
  pct,
  plural,
  relative,
  shiftMonth,
} from "@/components/ceo/format";
import { HeroFigure } from "@/components/ceo/HeroFigure";
import { cashHeadline, contractedHeadline } from "@/components/ceo/metrics";
import { Value } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { ShowMore } from "@/components/ceo/ShowMore";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip, type StatusTone } from "@/components/ceo/StatusChip";
import { TargetMeter } from "@/components/ceo/TargetMeter";
import { TimeSeriesChart } from "@/components/ceo/TimeSeriesChart";
import type { CeoSection } from "@/components/ceo/useCeo";
import type {
  CashRail,
  ExpenseGroup,
  ExpenseLine,
  ExpensesPayload,
  MoneyPayload,
  Note,
} from "../../../convex/ceo/payloads";
import {
  DuplicatesCard,
  LogPaymentCard,
  ManualEntriesCard,
} from "./moneyManual";
import type { CeoTabProps } from "./types";

type Deal = MoneyPayload["deals"]["recent"][number];
type CardKey =
  | "cash"
  | "rails"
  | "manual"
  | "dupes"
  | "tiles"
  | "monthly"
  | "targets"
  | "mrr"
  | "collection"
  | "expenses"
  | "deals";
/** The cards on the P&L half, which reads the expenses section. */
type PnlKey = "month" | "software" | "overhead" | "labour" | "ads" | "totals";

// Each caveat sits beside the number it qualifies. Order matters: anything
// naming the possible duplicates reaches that card first, "Failed charges ...
// Whop checkouts" must reach the tiles before the Whop rule, the cash scope
// sentence and the refund rule must reach the cash card before the rail rule,
// the hand-logged notes (which name Tap) the Logged by hand card before it,
// and "Expenses and bank transfers" the expenses card before it. Anything
// unmatched lands on the cash card, so no note is ever dropped.
const NOTE_ROUTES: readonly (readonly [RegExp, CardKey])[] = [
  // The MRR card's own notes first: several of them name Whop, a target or a
  // client, which the generic routes further down would otherwise claim.
  [
    /^mrr is the figure typed|^not all of it is monthly money|live client cards? carr(y|ies) no mrr|^payment method is filled on none|have no churn date|have no paused on date|client cards' (mrr|billing fields)/i,
    "mrr",
  ],
  [
    /can be tied to a signed deal|not been shown to be unpaid|^contracted is what the closing form|deal collection could not be read/i,
    "collection",
  ],
  [/possible duplicates|duplicate check/i, "dupes"],
  [/failed charge/i, "tiles"],
  [/closer form (last|has never) synced|deal check/i, "tiles"],
  [/^cash (is whop only|on the rails)|^whop cash is net of refunds/i, "cash"],
  [/^deal cash/i, "deals"],
  [
    /^payments logged by hand|logged by hand as tap|logged by hand than/i,
    "manual",
  ],
  [/\brails?\b|\btap\b/i, "rails"],
  [/expense/i, "expenses"],
  [/target/i, "targets"],
  [/whop/i, "cash"],
  [/contracted value was not captured|earlier months/i, "monthly"],
  [/deal/i, "deals"],
];

// The same idea for the P&L half. The first four routes catch the expense
// adapter's whole-half notes, which name every group and would otherwise land
// on whichever group they mention first. Anything unmatched lands on the card
// that frames the month, which is the first card of the half.
const PNL_ROUTES: readonly (readonly [RegExp, PnlKey])[] = [
  [/^how the p&l is grouped/i, "month"],
  [/^money out in/i, "totals"],
  [/^cash in (for|could not)/i, "totals"],
  [/^client media/i, "ads"],
  [/software|subscription|saas|\btools?\b/i, "software"],
  [
    /overhead|rent|utilit|insurance|accounting|legal|licen[cs]e|government|office/i,
    "overhead",
  ],
  [/labour|labor|salar|payroll|wage|staff|head ?count|\beod\b/i, "labour"],
  [/ad spend|advertis|lead[- ]gen|media spend|\bmeta\b/i, "ads"],
  [/profit|margin|revenue|unload|categor|\btotal\b/i, "totals"],
];

function routeBy<K extends string>(
  notes: Note[] | null | undefined,
  routes: readonly (readonly [RegExp, K])[],
  fallback: K,
) {
  const out: Partial<Record<K, Note[]>> = {};
  for (const note of notes ?? []) {
    const key = routes.find(([re]) => re.test(note.text))?.[1] ?? fallback;
    out[key] = [...(out[key] ?? []), note];
  }
  return out;
}

function withNotes(
  routed: Note[] | undefined,
  extra: (Note | null)[],
): Note[] | undefined {
  const added = extra.filter((n): n is Note => n !== null);
  const all = [...added, ...(routed ?? [])];
  return all.length ? all : undefined;
}

/** The month before this one as a long name, for the pace comparisons. */
function previousMonthName(ym: string): string {
  const prev = shiftMonth(ym, -1);
  return prev ? month(prev, { long: true }) : "last month";
}

function sum(values: number[]): number {
  return values.reduce((t, v) => t + (isNum(v) ? v : 0), 0);
}

/** Small uppercase label that separates the two halves of the tab. */
function HalfHeading({
  title,
  text,
  first = false,
}: {
  title: string;
  text: string;
  first?: boolean;
}) {
  return (
    <div className={first ? "min-w-0" : "min-w-0 border-t pt-5"}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {text}
      </p>
    </div>
  );
}

/**
 * Money in two halves. Cash in: what was collected, by rail, with deals,
 * refunds, targets and the last twelve months. Then the P&L: what was spent on
 * software, overhead, labour and ads, and the profit when it can be drawn.
 */
export function MoneyTab({ sections, now, day }: CeoTabProps) {
  const section = sections.money;
  const payload = section?.payload ?? null;
  const expensesSection = sections.expenses;
  const expenses = expensesSection?.payload ?? null;
  const today = day ?? kuwaitDay(now);
  const monthKey = payload?.month ?? today.slice(0, 7);
  const notes = useMemo(
    () => routeBy(payload?.notes, NOTE_ROUTES, "cash" as CardKey),
    [payload],
  );
  // The one month summary on `money` stays until the expenses section is live,
  // then the P&L below replaces it and its caveats move with it.
  const showLegacy = expenses === null;

  return (
    <div className="grid gap-4 lg:gap-6">
      <HalfHeading
        first
        title="Cash in"
        text="What was collected, which rail it came in on, and what was signed."
      />

      {payload === null ? (
        <SectionCard title="Money" section={section}>
          {() => null}
        </SectionCard>
      ) : (
        <>
          <SectionCard
            id="money-cash"
            kicker={month(monthKey, { long: true, year: true })}
            title="Cash collected"
            section={section}
            notes={withNotes(notes.cash, [cashHeadline(payload).note])}
            order={0}
          >
            {p => <CashBody p={p} today={today} />}
          </SectionCard>

          <SectionCard
            kicker={`${month(monthKey, { long: true, year: true })}, with today and last month beside it`}
            title="Cash by rail"
            section={section}
            notes={withNotes(notes.rails, [cashHeadline(payload).note])}
            order={1}
          >
            {p => <RailsBody p={p} today={today} now={now} />}
          </SectionCard>
        </>
      )}

      {/* Logging works whether or not the money section has been computed. */}
      <LogPaymentCard
        today={today}
        recentDeals={payload?.deals.recent ?? null}
        order={2}
      />
      <ManualEntriesCard
        section={section}
        payload={payload}
        today={today}
        now={now}
        notes={notes.manual}
        order={3}
      />
      {payload === null ? null : (
        <>
          <DuplicatesCard section={section} notes={notes.dupes} order={4} />

          <SectionCard
            kicker="This month, with the last 30 and 90 days beside it"
            title="Deals, refunds and failed checkouts"
            section={section}
            notes={notes.tiles}
            order={5}
          >
            {p => <MoneyTiles p={p} />}
          </SectionCard>

          {/* Full width so any number of targets lays out as a grid, not a tall column. */}
          <SectionCard
            kicker={month(monthKey, { long: true })}
            title="Targets"
            section={section}
            notes={notes.targets}
            order={6}
          >
            {p => <TargetsBody p={p} />}
          </SectionCard>

          <SectionCard
            kicker="What the client cards say, not a measured charge"
            title="MRR on the books"
            section={section}
            notes={notes.mrr}
            order={7}
          >
            {p => <MrrBody p={p} />}
          </SectionCard>

          <SectionCard
            kicker="What was signed, against what we can prove arrived"
            title="Deals and collection"
            section={section}
            notes={notes.collection}
            order={8}
          >
            {p => <CollectionBody p={p} />}
          </SectionCard>

          <div className="grid gap-4 lg:gap-6 xl:grid-cols-12">
            <SectionCard
              kicker="Last 12 months"
              title="Cash and contracted by month"
              section={section}
              notes={notes.monthly}
              order={9}
              className={showLegacy ? "xl:col-span-8" : "xl:col-span-12"}
            >
              {p => <MonthlyBody p={p} />}
            </SectionCard>
            {showLegacy ? (
              <SectionCard
                kicker="Latest month loaded"
                title="Expenses"
                section={section}
                notes={notes.expenses}
                order={10}
                className="xl:col-span-4"
              >
                {p => <LegacyExpensesBody p={p} />}
              </SectionCard>
            ) : null}
          </div>

          <SectionCard
            kicker="Newest 10"
            title="Recent deals"
            section={section}
            notes={notes.deals}
            order={11}
          >
            {p => <DealsTable deals={p.deals.recent} />}
          </SectionCard>
        </>
      )}

      <HalfHeading
        title="Money out and profit"
        text="From the bank statement import: software, overhead, labour and our own ad spend, with profit only where both sides are real."
      />
      <PnlHalf
        section={expensesSection}
        expenses={expenses}
        now={now}
        carried={showLegacy ? undefined : notes.expenses}
      />
    </div>
  );
}

// --- Cash: the hero, pace facts and cash per day ---

function CashBody({ p, today }: { p: MoneyPayload; today: string }) {
  // The same rule the Today and Frontend tabs use, so the three headline cash
  // figures are one number under one name. The rail split is the card below.
  const headline = cashHeadline(p);
  const cash = headline.rail;
  const lastMonthName = previousMonthName(p.month);
  const thisMonthName = month(p.month, { long: true });
  // Today is still running; a partial last day would read as a drop.
  const daily = cash.daily.filter(d => d.date < today);
  const best = daily.reduce<(typeof daily)[number] | null>(
    (top, d) => (top === null || d.value > top.value ? d : top),
    null,
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
      <div className="flex min-w-0 flex-col">
        <HeroFigure
          label={headline.label}
          value={cash.mtd}
          format={money}
          delta={
            <Delta
              value={change(cash.mtd, cash.lastMonthToDate)}
              size="md"
              vs={`vs the same days in ${lastMonthName}`}
            />
          }
          sub={`Projected ${money(cash.projectedMonth)} for ${thisMonthName}, day ${p.dayOfMonth} of ${p.daysInMonth}`}
          naHint="No connected cash rail gives a figure for this month."
        />
        <dl className="mt-6 grid grid-cols-3 gap-4 border-t pt-4 lg:mt-auto">
          <Fact label="Today so far" value={money(cash.today)} />
          <Fact label="Yesterday" value={money(cash.yesterday)} />
          <Fact
            label={`${lastMonthName} in full`}
            value={money(cash.lastMonth)}
          />
        </dl>
      </div>
      <TimeSeriesChart
        data={daily}
        series={[{ key: "value", label: "Cash" }]}
        kind="area"
        unit="money"
        title={`Cash per day, ${headline.scope}`}
        summary="last 90 days, through yesterday"
        height={240}
        ariaLabel={`Cash per day over the last ${daily.length} complete days${
          best && best.value > 0
            ? `, best day ${date(best.date)} at ${money(best.value)}`
            : ""
        }.`}
        emptyText="No cash days to plot yet."
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold tracking-tight text-foreground">
        <Value value={value} />
      </dd>
    </div>
  );
}

// --- Cash by rail: Whop, Tap and the total over the connected rails ---

type RailRow = { key: string; rail: CashRail };

function railNaHint(rail: CashRail, what: string): string {
  return rail.connected
    ? `The ${rail.label} rail cannot give ${what} yet.`
    : `${rail.label} is not connected yet, so ${what} is not read at all.`;
}

function railColumns(lastMonthName: string, now: number): Column<RailRow>[] {
  const amount = (
    pick: (r: CashRail) => number | null,
    what: string,
  ): ((row: RailRow) => ReactNode) => {
    return row => (
      <Value value={money(pick(row.rail))} hint={railNaHint(row.rail, what)} />
    );
  };
  return [
    {
      key: "rail",
      header: "Rail",
      cell: row => (
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">
              {row.rail.label}
            </span>
            <StatusChip
              tone={row.rail.connected ? "good" : "neutral"}
              label={
                row.rail.connected
                  ? "Connected"
                  : row.key === "manual"
                    ? "Nothing logged"
                    : "Not connected"
              }
              hint={
                row.rail.connected
                  ? row.key === "manual"
                    ? "Payments logged by hand on this tab. They are in the total."
                    : "This rail is read and its money is in the total."
                  : row.key === "manual"
                    ? "Nothing has been logged by hand yet, so every number on this rail is n/a and it is not in the total."
                    : "This rail is not read, so every number on it is n/a and it is not in the total."
              }
            />
          </div>
          <span className="block text-xs text-muted-foreground">
            {!row.rail.connected
              ? row.key === "manual"
                ? "Log a payment below to start it"
                : "Nothing on this rail reaches the cockpit yet"
              : row.key === "manual"
                ? row.rail.lastPaymentAt === null
                  ? "No counted entry in the last 12 months"
                  : `Newest entry received ${date(row.rail.lastPaymentAt)}`
                : `Newest payment ${relative(row.rail.lastPaymentAt, now)}`}
          </span>
        </div>
      ),
      sortValue: row => row.rail.label,
    },
    {
      key: "today",
      header: "Today",
      cell: amount(r => r.today, "today's cash"),
      sortValue: row => row.rail.today,
      numeric: true,
    },
    {
      key: "yesterday",
      header: "Yesterday",
      cell: amount(r => r.yesterday, "yesterday's cash"),
      sortValue: row => row.rail.yesterday,
      numeric: true,
      hideBelow: "sm",
    },
    {
      key: "mtd",
      header: "Month to date",
      cell: amount(r => r.mtd, "cash for this month"),
      sortValue: row => row.rail.mtd,
      numeric: true,
    },
    {
      key: "lastMonthToDate",
      header: `${lastMonthName} to date`,
      cell: amount(r => r.lastMonthToDate, "last month to the same day"),
      sortValue: row => row.rail.lastMonthToDate,
      numeric: true,
      hideBelow: "lg",
    },
    {
      key: "lastMonth",
      header: `${lastMonthName} in full`,
      cell: amount(r => r.lastMonth, "the whole of last month"),
      sortValue: row => row.rail.lastMonth,
      numeric: true,
      hideBelow: "lg",
    },
    {
      key: "projectedMonth",
      header: "Projected",
      cell: amount(r => r.projectedMonth, "a projection for this month"),
      sortValue: row => row.rail.projectedMonth,
      numeric: true,
      hideBelow: "md",
    },
    {
      key: "refundsMtd",
      header: "Refunds",
      cell: amount(r => r.refundsMtd, "refunds for this month"),
      sortValue: row => row.rail.refundsMtd,
      numeric: true,
      hideBelow: "md",
    },
  ];
}

function RailsBody({
  p,
  today,
  now,
}: {
  p: MoneyPayload;
  today: string;
  now: number;
}) {
  const rails = p.rails;
  const lastMonthName = previousMonthName(p.month);
  const columns = useMemo(
    () => railColumns(lastMonthName, now),
    [lastMonthName, now],
  );
  // One line per connected rail, once more than Whop is in the total.
  const lines = useMemo(() => {
    if (!rails) return { data: [], series: [] as ChartSeries[] };
    const extra = [
      { key: "tap", rail: rails.tap, label: "Tap" },
      { key: "manual", rail: rails.manual, label: "Logged by hand" },
    ].filter(x => x.rail?.connected);
    if (!extra.length) return { data: [], series: [] as ChartSeries[] };
    const maps = extra.map(
      x =>
        [
          x.key,
          new Map((x.rail?.daily ?? []).map(d => [d.date, d.value])),
        ] as const,
    );
    return {
      data: rails.whop.daily
        .filter(d => d.date < today)
        .map(d => {
          const row: Record<string, string | number> = {
            date: d.date,
            whop: d.value,
          };
          for (const [key, m] of maps) row[key] = m.get(d.date) ?? 0;
          return row;
        }),
      series: [
        { key: "whop", label: "Whop" },
        ...extra.map(x => ({ key: x.key, label: x.label })),
      ] as ChartSeries[],
    };
  }, [rails, today]);

  if (!rails)
    return (
      <EmptyState
        icon={Wallet}
        title="Cash rails are not computed yet"
        text="Until the money adapter fills them, the cash card above is the whole picture and it is Whop only."
        compact
      />
    );

  const manual = rails.manual ?? null;
  const rows: RailRow[] = [
    { key: "whop", rail: rails.whop },
    { key: "tap", rail: rails.tap },
    ...(manual ? [{ key: "manual", rail: manual }] : []),
    { key: "total", rail: rails.total },
  ];
  const liveRails = [rails.whop, rails.tap, manual].filter(
    r => r?.connected,
  ).length;

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 xl:grid-cols-4">
        <StatTile
          variant="plain"
          label="Whop, month to date"
          value={money(rails.whop.mtd)}
          sub={`Today ${money(rails.whop.today)}`}
          naHint={railNaHint(rails.whop, "cash for this month")}
        />
        <StatTile
          variant="plain"
          label="Tap, month to date"
          value={money(rails.tap.mtd)}
          sub={
            rails.tap.connected
              ? `Today ${money(rails.tap.today)}`
              : "Not read yet, so it is not in the total."
          }
          naHint={railNaHint(rails.tap, "cash for this month")}
        />
        <StatTile
          variant="plain"
          label="Logged by hand, month to date"
          value={money(manual?.mtd ?? null)}
          sub={
            manual
              ? manual.connected
                ? `Today ${money(manual.today)}`
                : "Nothing logged yet, so it is not in the total."
              : "Not read on the last refresh, so it is not in the total."
          }
          naHint={
            manual
              ? manual.connected
                ? "The Manual rail cannot give cash for this month yet."
                : "Nothing has been logged by hand yet, so there is no figure. A payment nobody logged is missing, not zero."
              : "Payments logged by hand were not read on the last money refresh, so there is no figure and they are not in the total. The note on the Logged by hand card says why."
          }
        />
        <StatTile
          variant="plain"
          label={`${rails.total.label}, month to date`}
          value={money(rails.total.mtd)}
          sub={
            liveRails > 1
              ? `${count(liveRails)} rails in the total`
              : "One rail in the total, so this is not the whole business."
          }
          naHint="A connected rail cannot give a figure for this month, so a total would be a guess."
          status={
            liveRails > 1 ? undefined : (
              <StatusChip
                tone="warning"
                label="Whop only"
                hint={
                  manual
                    ? "Tap is not read and nothing has been logged by hand, so the total is the Whop rail alone."
                    : "Tap is not read and the payments logged by hand were not read on the last refresh, so the total is the Whop rail alone."
                }
              />
            )
          }
        />
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={row => row.key}
        caption="Cash on each rail and the total over the connected rails"
        emptyText="No rails to show yet."
      />

      {lines.data.length ? (
        <TimeSeriesChart
          data={lines.data}
          series={lines.series}
          unit="money"
          title="Cash per day by rail"
          summary="through yesterday"
          height={220}
          ariaLabel={`Cash per day on the ${lines.series.map(x => x.label).join(", ")} rails over the last ${count(lines.data.length)} complete days.`}
          emptyText="No rail days to plot yet."
        />
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Only the Whop rail is in the total, so the cash per day chart above
          already covers it. A line per rail appears here once Tap is read or a
          payment is logged by hand.
        </p>
      )}
    </div>
  );
}

// --- Signed deals against the cash tied to them ---

/**
 * Contracted value beside the cash that can actually be matched to a deal.
 *
 * The one thing this card must never imply is that an unmatched deal went
 * unpaid. Two thirds of collected Whop money is tied to no deal at all, so an
 * empty row here is a gap in the matching, not evidence of a debt.
 */
function CollectionBody({ p }: { p: MoneyPayload }) {
  const [showAll, setShowAll] = useState(false);
  const c = p.collection;
  if (!c)
    return (
      <EmptyState
        title="Deal collection has not been read yet"
        text="It comes from the B2B database's own deal-to-cash function on the next refresh."
        icon={Receipt}
      />
    );

  const total = c.linkedCash + c.unlinkedCash;
  const share = total > 0 ? c.linkedCash / total : null;
  const rows = showAll ? c.unmatched : c.unmatched.slice(0, 5);

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <StatTile
          variant="plain"
          label="Contracted, all deals"
          value={money(c.contracted)}
          sub={`${plural(c.deals, "signed deal")}`}
          hint="What the closing form recorded. April 2026 reads as nothing because the form did not ask for a contract value yet."
        />
        <StatTile
          variant="plain"
          label="Cash tied to a deal"
          value={money(c.linkedCash)}
          sub={share === null ? undefined : `${pct(share)} of Whop cash`}
          hint="Whop payments carrying a deal response id. This is cash we can prove belongs to a deal, not cash collected."
        />
        <StatTile
          variant="plain"
          label="Cash tied to nothing"
          value={money(c.unlinkedCash)}
          sub={`${plural(c.unlinkedRows, "payment")}, no deal or client`}
          status={<StatusChip tone="serious" label="Unattributed" />}
          hint="Real money, collected, that reaches no deal, no client and no lifetime value."
        />
        <StatTile
          variant="plain"
          label="Deals with no payment matched"
          value={`${c.deals - c.dealsWithCash} of ${c.deals}`}
          sub="Not the same as unpaid"
          hint="No Whop payment carries their deal id. Because the only matching rule is an email match, this is very likely a matching gap rather than a debt."
        />
      </div>

      <div className="border-t pt-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Contracted and matched cash, by month signed
        </p>
        <div className="overflow-x-auto">
          <table
            className="w-full text-sm"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Month</th>
                <th className="pb-2 pr-4 text-right font-medium">Deals</th>
                <th className="pb-2 pr-4 text-right font-medium">Contracted</th>
                <th className="pb-2 text-right font-medium">Cash matched</th>
              </tr>
            </thead>
            <tbody>
              {c.byMonth.map(m => (
                <tr key={m.month} className="border-t">
                  <td className="py-1.5 pr-4">
                    {month(m.month, { long: true })}
                  </td>
                  <td className="py-1.5 pr-4 text-right">{count(m.deals)}</td>
                  <td className="py-1.5 pr-4 text-right">
                    {m.contracted > 0 ? (
                      money(m.contracted)
                    ) : (
                      <span className="text-muted-foreground">not asked</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right">{money(m.linked)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {rows.length ? (
        <div className="border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {`Signed, with no payment matched (${c.unmatched.length})`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Check Whop before treating any of these as money owed.
          </p>
          <ul className="mt-3 grid gap-1">
            {rows.map(u => (
              <li key={`${u.client}-${u.month}`} className="text-sm">
                {u.client}
                <span className="text-muted-foreground">
                  {` · ${money(u.contracted)} · ${month(u.month, { long: true })}${u.plan ? ` · ${u.plan}` : ""}`}
                </span>
              </li>
            ))}
          </ul>
          {c.unmatched.length > 5 ? (
            <ShowMore
              total={c.unmatched.length}
              expanded={showAll}
              onToggle={() => setShowAll(v => !v)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// --- MRR on the client cards ---

/** How each Client Status group is named on screen. */
const MRR_GROUP: Record<string, { label: string; hint: string }> = {
  active: {
    label: "Active",
    hint: "Cards whose Client Status is Active.",
  },
  paused: {
    label: "Paused",
    hint: "Cards whose Client Status is Paused. Still on the books, not yet gone.",
  },
  pipeline: {
    label: "Not yet live",
    hint: "Signed or onboarding cards that have not reached Active: Launch Booked, Ready For Launch, Brand Blueprint Booked and the rest.",
  },
};

/**
 * The MRR field on the ClickUp client cards.
 *
 * The three groups are never added into one figure. Who counts as a paying
 * client is Aziz's decision and it is still open, so this card shows the parts
 * and lets him read whichever total he means. The split underneath says how
 * much of the money is a real subscription and how much is a slice of a
 * one-off contract, because the same field holds both.
 */
function MrrBody({ p }: { p: MoneyPayload }) {
  const [showBlank, setShowBlank] = useState(false);
  const mrr = p.mrr;
  if (!mrr)
    return (
      <EmptyState
        title="The client cards have not been read yet"
        text="The CSM sync writes these fields every ten minutes through the working day. Until it runs, MRR is missing, not zero."
        icon={Wallet}
      />
    );

  const live = mrr.groups.filter(
    g => g.group !== "gone" && g.group !== "sales",
  );
  const sales = mrr.groups.find(g => g.group === "sales");
  const recurring = sum(live.map(g => g.recurringUsd));
  const oneOff = sum(live.map(g => g.oneOffUsd));
  const unclassified = sum(live.map(g => g.unclassifiedUsd));
  const blank = mrr.blank;
  const shown = showBlank ? blank : blank.slice(0, 6);

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        {live.map(g => {
          const meta = MRR_GROUP[g.group];
          return (
            <StatTile
              key={g.group}
              variant="plain"
              label={meta?.label ?? g.group}
              value={money(g.bookUsd)}
              sub={`${g.filled} of ${plural(g.cards, "card")} filled`}
              hint={`${meta?.hint ?? ""} The figure is the MRR field added up over those cards, as typed.`}
              naHint="No card in this group carries an MRR figure."
            />
          );
        })}
        <StatTile
          variant="plain"
          label="On the sales list"
          value={plural(sales?.cards ?? 0, "card")}
          sub="Not clients yet, counted apart"
          hint="Cards parked on SALES TEAM TO CONTACT. The CSM roster drops the whole stage, and eleven of these are clients the payment sheet already marks cancelled, so their money is never added to the groups beside them."
        />
      </div>

      <div className="border-t pt-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Of the live cards, what kind of money it is
        </p>
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-3">
          <StatTile
            variant="plain"
            label="On a recurring plan"
            value={money(recurring)}
            sub="Monthly money"
            hint="Cards whose Payment Plan is a subscription rather than Paid In Full or Split Pay."
          />
          <StatTile
            variant="plain"
            label="On Paid In Full or Split Pay"
            value={money(oneOff)}
            sub="A slice of a one-off contract, not monthly money"
            hint="The MRR field is filled on these cards too, but the contract was paid once. How that converts to MRR is undecided, so it is never added to the recurring figure here."
            status={
              oneOff > 0 ? (
                <StatusChip tone="warning" label="Not recurring" />
              ) : undefined
            }
          />
          <StatTile
            variant="plain"
            label="Payment Plan blank"
            value={money(unclassified)}
            sub="Cannot be sorted into either"
            hint="Cards carrying an MRR figure with no Payment Plan set, so nobody can say whether that money repeats."
            naHint="Every live card with an MRR figure has a Payment Plan."
          />
        </div>
      </div>

      <div className="border-t pt-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <StatTile
            variant="plain"
            label="Payment Method filled"
            value={`${mrr.paymentMethod.filled} of ${mrr.cards}`}
            sub={
              mrr.paymentMethod.filled === 0
                ? "Nobody has ever set it"
                : mrr.paymentMethod.mix
                    .map(m => `${m.method} ${m.cards}`)
                    .join(", ")
            }
            hint="Which rail a client pays on. Filling this is the cheapest way to find the cash that never touches Whop."
            status={
              mrr.paymentMethod.filled === 0 ? (
                <StatusChip tone="serious" label="Empty" />
              ) : undefined
            }
          />
          <StatTile
            variant="plain"
            label="LTV field total"
            value={money(mrr.ltv.totalUsd)}
            sub={`${mrr.ltv.filled} of ${plural(mrr.cards, "card")} filled`}
            hint="The LTV field added up. It is a number typed once by hand, not cash received, and it disagrees with Whop on most of the cards that have both."
          />
          <StatTile
            variant="plain"
            label="Stopped clients with a churn date"
            value={`${mrr.lifecycle.goneWithChurnDate} of ${mrr.lifecycle.gone}`}
            sub="Tenure and cohorts need this filled"
            status={
              mrr.lifecycle.goneWithChurnDate < mrr.lifecycle.gone ? (
                <StatusChip tone="serious" label="Mostly empty" />
              ) : undefined
            }
            hint="A stopped card with no Churn Date cannot be dated, so average client life and any cohort view leave it out."
          />
          <StatTile
            variant="plain"
            label="Paused clients with a start date"
            value={`${mrr.lifecycle.pausedWithDate} of ${mrr.lifecycle.paused}`}
            sub="The 14-day pause clock needs this"
            status={
              mrr.lifecycle.pausedWithDate < mrr.lifecycle.paused ? (
                <StatusChip tone="serious" label="No clock running" />
              ) : undefined
            }
            hint="Your rule ends an engagement after a 14-day pause. Without a Paused On date there is nothing to count from."
          />
        </div>
      </div>

      {blank.length ? (
        <div className="border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {`Live cards with no MRR figure (${blank.length})`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Their money is missing from every total above, not zero.
          </p>
          <ul className="mt-3 grid gap-1 sm:grid-cols-2">
            {shown.map(c => (
              <li key={c.taskId} className="text-sm">
                {c.name}
                <span className="text-muted-foreground">
                  {c.stage ? ` · ${c.stage}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {blank.length > 6 ? (
            <ShowMore
              total={blank.length}
              expanded={showBlank}
              onToggle={() => setShowBlank(v => !v)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// --- Tiles ---

function MoneyTiles({ p }: { p: MoneyPayload }) {
  const lastMonthName = previousMonthName(p.month);
  const failed = p.failedCharges;
  // The same rule Today, Frontend and Sales use for contracted this month.
  const contracted = contractedHeadline(p);
  const handDeals = contracted.handDeals;
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-5">
      <StatTile
        variant="plain"
        label="Deals this month"
        value={count(p.deals.mtd)}
        sub={
          <>
            {`${count(p.deals.lastMonth)} in ${lastMonthName}, closer form`}
            {handDeals ? (
              <span className="block">{`Plus ${plural(handDeals, "deal")} logged by hand`}</span>
            ) : null}
          </>
        }
        hint="Deals on the closer form. A new deal logged with a payment is counted beside it, never inside it."
      />
      <StatTile
        variant="plain"
        label={contracted.label}
        value={money(contracted.value)}
        sub={
          <>
            {contracted.split ? (
              <span className="block">{contracted.split}</span>
            ) : null}
            <span className="block">{`${money(contracted.lastMonth)} in ${lastMonthName}`}</span>
          </>
        }
        hint={contracted.hint}
      />
      <StatTile
        variant="plain"
        label="Average contract, 90 days"
        value={money(p.deals.avgContract90d)}
        hint="Mean contracted value of deals signed in the last 90 days that have one."
        naHint="No deal signed in the last 90 days has a contracted value."
      />
      <StatTile
        variant="plain"
        label="Refunds this month"
        value={money(p.refunds.mtd)}
        sub={`${money(p.refunds.last90)} in the last 90 days`}
      />
      <StatTile
        variant="plain"
        label="Failed checkouts, 30 days"
        value={count(failed.count30d)}
        sub={`${money(failed.amount30d)} not collected`}
        hint="Declined or abandoned Whop checkouts with no later payment on the same membership."
        status={
          failed.count30d > 0 ? (
            <StatusChip tone="warning" label="Follow up" />
          ) : undefined
        }
      />
    </div>
  );
}

// --- Last 12 months: cash (with refunds when there are any) and contracted ---

function MonthlyBody({ p }: { p: MoneyPayload }) {
  const rows = p.monthly;
  const hasRefunds = rows.some(r => r.refunds > 0);
  const lastIsCurrent = rows[rows.length - 1]?.month === p.month;
  const partialNote = `So far, day ${p.dayOfMonth} of ${p.daysInMonth}`;
  // Refunds are context for cash, so they draw in the quiet gray behind it.
  const cashSeries: ChartSeries[] = hasRefunds
    ? [
        { key: "cash", label: "Whop cash" },
        { key: "refunds", label: "Refunds", tone: "context" },
      ]
    : [{ key: "cash", label: "Whop cash" }];
  const handCash = rows.some(r => (r.manualCash ?? 0) > 0);
  const handDeals = rows.some(r => (r.manualContracted ?? 0) > 0);
  const handSeries: ChartSeries[] = [
    ...(handCash ? [{ key: "manualCash", label: "Cash logged by hand" }] : []),
    ...(handDeals
      ? [{ key: "manualContracted", label: "Deal value logged by hand" }]
      : []),
  ];
  const handData = rows.map(r => ({
    month: r.month,
    manualCash: r.manualCash ?? null,
    manualContracted: r.manualContracted ?? null,
  }));
  const cashTotal = sum(rows.map(r => r.cash));
  const contractedTotal = sum(rows.map(r => r.contracted));
  const dealsTotal = sum(rows.map(r => r.deals));
  const bestOf = (key: "cash" | "contracted") =>
    rows.reduce<(typeof rows)[number] | null>(
      (top, r) => (top === null || r[key] > top[key] ? r : top),
      null,
    );
  const bestCash = bestOf("cash");
  const bestContracted = bestOf("contracted");
  const monthLong = (m: string) => month(m, { long: true, year: true });

  return (
    <div className="grid gap-8">
      <ColumnChart
        data={rows}
        x="month"
        series={cashSeries}
        unit="money"
        title={hasRefunds ? undefined : "Whop cash"}
        summary={`${moneyCompact(cashTotal)} in 12 months`}
        formatX={m => month(m)}
        formatXLong={monthLong}
        xHeader="Month"
        height={210}
        capLabel="max"
        partialLast={lastIsCurrent}
        partialNote={partialNote}
        ariaLabel={`Cash by month over the last 12 months${
          hasRefunds ? ", with refunds beside it" : ""
        }${
          bestCash && bestCash.cash > 0
            ? `. Best month ${monthLong(bestCash.month)} at ${money(bestCash.cash)}`
            : ""
        }.`}
        emptyText="No months to plot yet."
      />
      <ColumnChart
        data={rows}
        x="month"
        series={[{ key: "contracted", label: "Contracted" }]}
        unit="money"
        title="Contracted, closer form"
        summary={`${moneyCompact(contractedTotal)} from ${plural(dealsTotal, "deal")}`}
        formatX={m => month(m)}
        formatXLong={monthLong}
        xHeader="Month"
        height={210}
        capLabel="max"
        partialLast={lastIsCurrent}
        partialNote={partialNote}
        ariaLabel={`Contracted value by month over the last 12 months${
          bestContracted && bestContracted.contracted > 0
            ? `. Best month ${monthLong(bestContracted.month)} at ${money(bestContracted.contracted)}`
            : ""
        }.`}
        emptyText="No months to plot yet."
      />
      {handSeries.length ? (
        <ColumnChart
          data={handData}
          x="month"
          series={handSeries}
          unit="money"
          title={handSeries.length === 1 ? handSeries[0].label : undefined}
          summary={`${moneyCompact(sum(rows.map(r => r.manualCash ?? 0)))} cash logged by hand in 12 months`}
          formatX={m => month(m)}
          formatXLong={monthLong}
          xHeader="Month"
          height={180}
          partialLast={lastIsCurrent}
          partialNote={partialNote}
          ariaLabel="Cash and deal values logged by hand, by month, over the last 12 months. They sit beside the Whop cash and closer form figures above, not inside them."
          emptyText="Nothing logged by hand in these months."
        />
      ) : null}
    </div>
  );
}

// --- Targets ---

function TargetsBody({ p }: { p: MoneyPayload }) {
  const items = p.targets.items;
  if (items.length === 0)
    return (
      <EmptyState
        icon={Target}
        title={`No targets set for ${month(p.month, { long: true })}`}
        text="Targets come from the monthly targets table in the B2B dashboard."
        compact
      />
    );
  // The shared meter, so a target reads the same here, on Frontend and on Sales.
  const pace = p.targets.month === null || p.targets.month === p.month;
  return (
    <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(item => (
        <TargetMeter
          key={item.metric}
          item={item}
          dayOfMonth={p.dayOfMonth}
          daysInMonth={p.daysInMonth}
          pace={pace}
        />
      ))}
    </div>
  );
}

// --- The one month expense summary on `money`, until the P&L half is live ---

const CATEGORY_ROWS = 7;

/** Top categories with the tail folded into one row, biggest first. */
function categoryItems(
  rows: { category: string; amount: number; rows?: number }[],
): BarListItem[] {
  const sorted = [...rows].sort((a, b) => b.amount - a.amount);
  const head = sorted.slice(0, CATEGORY_ROWS);
  const tail = sorted.slice(CATEGORY_ROWS);
  const items: BarListItem[] = head.map(c => ({
    key: c.category,
    label: humanize(c.category),
    value: c.amount,
    sub: isNum(c.rows) ? plural(c.rows, "line") : undefined,
  }));
  // Past a handful of bars the tail folds into one row instead of more rows.
  if (tail.length)
    items.push({
      key: "other",
      label: `Other, ${plural(tail.length, "category", "categories")}`,
      value: sum(tail.map(c => c.amount)),
    });
  return items;
}

function LegacyExpensesBody({ p }: { p: MoneyPayload }) {
  const e = p.expenses;
  if (!e.month || e.byCategory.length === 0)
    return (
      <EmptyState
        icon={Receipt}
        title="No expenses loaded"
        text="Expenses arrive from a bank statement import."
        compact
      />
    );

  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">
        Total for {month(e.month, { long: true, year: true })}
      </p>
      <p className="mt-0.5 text-2xl font-semibold tracking-tight text-foreground">
        <Value value={money(e.total)} />
      </p>
      <BarList
        className="mt-5"
        items={categoryItems(e.byCategory)}
        format={money}
        ariaLabel={`Expenses by category for ${month(e.month, { long: true, year: true })}`}
      />
    </div>
  );
}

// --- Recent deals ---

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
    header: "Cash",
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

// --- The P&L half: everything below reads the expenses section ---

const QUALITY: Record<
  ExpenseGroup["quality"],
  { tone: StatusTone; label: string; hint: string }
> = {
  measured: {
    tone: "good",
    label: "Measured",
    hint: "Every line behind this number was read from the import, so this is the real figure and not a floor.",
  },
  floor: {
    tone: "warning",
    label: "A floor",
    hint: "A known undercount. The real number is higher than this one, so never read it as the whole cost.",
  },
  missing: {
    tone: "neutral",
    label: "No source",
    hint: "Nothing defensible exists in the source, so the figure is n/a rather than a guess.",
  },
};

function QualityChip({ quality }: { quality: ExpenseGroup["quality"] }) {
  const q = QUALITY[quality];
  return <StatusChip tone={q.tone} label={q.label} hint={q.hint} />;
}

/**
 * The one caveat about the P&L that the expenses section does not carry in its
 * own notes: it holds a single month's numbers, so no trend can be drawn here
 * even when more than one month has rows.
 */
function trendNote(e: ExpensesPayload): Note | null {
  if (e.monthsLoaded.length <= 1) return null;
  return {
    level: "info",
    text: `${count(e.monthsLoaded.length)} months have expense rows, but this section carries one month's numbers and the list of months, not a total per month, so no month on month trend, run rate or projection is drawn on this half.`,
  };
}

function PnlHalf({
  section,
  expenses,
  now,
  carried,
}: {
  section: CeoSection<"expenses"> | null;
  expenses: ExpensesPayload | null;
  now: number;
  /** Money notes about expenses, once the old summary card is off the tab. */
  carried: Note[] | undefined;
}) {
  const notes = useMemo(
    () => routeBy(expenses?.notes, PNL_ROUTES, "month" as PnlKey),
    [expenses],
  );

  // One card while the section is missing, instead of six identical empty states.
  if (!expenses)
    return (
      <SectionCard
        title="Expenses and profit"
        section={section}
        notes={carried}
        order={0}
      >
        {() => null}
      </SectionCard>
    );

  const monthLabel = expenses.month
    ? month(expenses.month, { long: true, year: true })
    : "no month loaded";

  return (
    <div className="grid gap-4 lg:gap-6">
      <SectionCard
        title={`Expenses, ${monthLabel}`}
        section={section}
        notes={withNotes(notes.month, [
          trendNote(expenses),
          ...(carried ?? []),
        ])}
        order={0}
      >
        <MonthCoveredBody e={expenses} now={now} />
      </SectionCard>

      <SectionCard
        kicker={monthLabel}
        title="Software"
        section={section}
        notes={notes.software}
        order={1}
      >
        <GroupBody group={expenses.software} name="Software" />
      </SectionCard>

      <SectionCard
        kicker={monthLabel}
        title="Overhead"
        section={section}
        notes={notes.overhead}
        order={2}
      >
        <GroupBody
          group={expenses.overhead}
          name="Overhead"
          extra={
            <div className="mt-6 border-t pt-4">
              <StatTile
                variant="plain"
                label="Money moved to a card"
                value={money(expenses.unloads)}
                sub="Moved, not spent. It is never overhead and never a cost."
                hint="Card unload lines from the bank import: money moved onto a card, which is counted again when the card is actually spent."
                naHint="The import carries no card unload lines for this month."
              />
            </div>
          }
        />
      </SectionCard>

      <SectionCard
        kicker={monthLabel}
        title="Labour"
        section={section}
        notes={withNotes(notes.labour, [
          {
            level: "warn",
            text: "Never work out cost per head, payroll as a share of revenue, or a margin from this number. A bank line says money left, not who was paid.",
          },
        ])}
        order={3}
      >
        <GroupBody
          group={expenses.labour}
          name="Labour"
          extra={
            <div className="mt-6 border-t pt-4">
              <StatTile
                variant="plain"
                label="People who filed an EOD in the month"
                value={count(expenses.peopleFilingEods)}
                sub="Shown beside labour so the gap between the payments and the people is visible."
                naHint="EOD filings for this month are not available."
              />
            </div>
          }
        />
      </SectionCard>

      <SectionCard
        kicker={monthLabel}
        title="Ad spend, two different pools"
        section={section}
        notes={withNotes(notes.ads, [
          {
            level: "warn",
            text: "These are two different pools of money and are never added together. The lead-gen figure here is our own ad money as the bank saw it, which is the same money the Marketing and Frontend tabs report from Meta, so it is counted once and never twice. The two figures can differ by a little: the bank settles on its own day and at its own rate.",
          },
        ])}
        order={4}
      >
        <AdSpendBody e={expenses} />
      </SectionCard>

      <SectionCard
        kicker={monthLabel}
        title="Totals and profit"
        section={section}
        notes={notes.totals}
        order={5}
      >
        <TotalsBody e={expenses} />
      </SectionCard>
    </div>
  );
}

function MonthCoveredBody({ e, now }: { e: ExpensesPayload; now: number }) {
  const months = e.monthsLoaded.length
    ? e.monthsLoaded.map(m => month(m, { long: true, year: true })).join(", ")
    : null;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
      <Fact
        label="The month these numbers cover"
        value={e.month ? month(e.month, { long: true, year: true }) : NA}
      />
      <Fact label="Months with rows" value={months ?? NA} />
      <Fact label="Rows imported" value={dateTime(e.importedAt, now)} />
      <Fact
        label="Rate used"
        value={isNum(e.fxUsdPerKwd) ? `$${e.fxUsdPerKwd} per KWD` : NA}
      />
    </dl>
  );
}

const VENDOR_ROWS = 6;

function VendorList({
  vendors,
  name,
}: {
  vendors: ExpenseLine[];
  name: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (vendors.length === 0)
    return (
      <div className="min-w-0">
        <GroupLabel>Vendors inside the figure</GroupLabel>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          No vendor line sits inside this figure.
        </p>
      </div>
    );
  const shown = expanded ? vendors : vendors.slice(0, VENDOR_ROWS);
  const items: BarListItem[] = shown.map((v, i) => ({
    key: `${v.vendor}-${i}`,
    label: v.vendor,
    value: v.amount,
    sub: v.reclass
      ? `${plural(v.rows, "line")}, moved from ${humanize(v.reclass)}`
      : plural(v.rows, "line"),
  }));
  const max = Math.max(...vendors.map(v => v.amount), 0);
  return (
    <div className="min-w-0">
      <GroupLabel>Vendors inside the figure</GroupLabel>
      <BarList
        className="mt-3"
        items={items}
        format={money}
        max={max}
        ariaLabel={`${name} vendors, biggest first`}
      />
      {vendors.length > VENDOR_ROWS ? (
        <ShowMore
          total={vendors.length}
          expanded={expanded}
          onToggle={() => setExpanded(v => !v)}
        />
      ) : null}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        The vendor is the bank card descriptor as it was imported, so one tool
        can appear under more than one name.
      </p>
    </div>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

function ExcludedList({ rows }: { rows: { label: string; amount: number }[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-6 min-w-0 border-t pt-4">
      <GroupLabel>Taken out of the raw total</GroupLabel>
      <dl className="mt-2 space-y-1.5">
        {rows.map(r => (
          <div
            key={r.label}
            className="flex items-baseline justify-between gap-3 text-[13px]"
          >
            <dt
              className="min-w-0 truncate text-muted-foreground"
              title={r.label}
            >
              {r.label}
            </dt>
            <dd className="shrink-0 font-medium tabular-nums text-foreground">
              {money(r.amount)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function GroupBody({
  group,
  name,
  extra,
}: {
  group: ExpenseGroup;
  name: string;
  extra?: ReactNode;
}) {
  const showHeadline = isNum(group.headline) && group.headline !== group.amount;
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
      <div className="min-w-0">
        <StatTile
          variant="plain"
          label={`${name} worth showing`}
          value={money(group.amount)}
          status={<QualityChip quality={group.quality} />}
          sub={
            showHeadline
              ? `${money(group.headline)} was the raw category total before anything was taken out`
              : undefined
          }
          naHint={
            group.why ??
            "The source has no defensible number for this line, so it is n/a rather than a guess."
          }
        />
        {group.why ? (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {group.why}
          </p>
        ) : null}
        <ExcludedList rows={group.excluded} />
        {extra}
      </div>
      <VendorList vendors={group.vendors} name={name} />
    </div>
  );
}

function AdSpendBody({ e }: { e: ExpensesPayload }) {
  const clients = e.clientAdSpend.clients;
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
      <div className="min-w-0">
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <StatTile
            variant="plain"
            label="Lead-gen ad spend, from the bank"
            value={money(e.ownAdSpend.amount)}
            status={<QualityChip quality={e.ownAdSpend.quality} />}
            sub="Our own lead-gen ads, counted once."
            naHint={
              e.ownAdSpend.why ??
              "The import has no lead-gen ad line for this month."
            }
          />
          <StatTile
            variant="plain"
            label="Client ad spend, same month"
            value={money(e.clientAdSpend.amount)}
            sub={
              isNum(clients)
                ? `${plural(clients, "client")} spending in the month`
                : "How many clients this covers is not available."
            }
            hint="Money spent on client ad accounts. It is a delivery cost carried against each client, never company overhead."
            naHint="Client ad spend for this month is not available."
          />
        </div>
        {e.ownAdSpend.why ? (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {e.ownAdSpend.why}
          </p>
        ) : null}
        <ExcludedList rows={e.ownAdSpend.excluded} />
      </div>
      <VendorList vendors={e.ownAdSpend.vendors} name="Lead-gen ad spend" />
    </div>
  );
}

function TotalsBody({ e }: { e: ExpensesPayload }) {
  const items = categoryItems(e.byCategory);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:gap-10">
      <div className="min-w-0">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
          <StatTile
            variant="plain"
            label="Spent in the month"
            value={money(e.spend)}
            hint="Every row in the month with the card unload lines taken out, which is what was actually spent."
            naHint="The import cannot give a spend figure for this month."
          />
          <StatTile
            variant="plain"
            label="Every row in the month"
            value={money(e.total)}
            sub="Card unloads included, so it reads high as a cost."
            naHint="The import cannot give a total for this month."
          />
          <StatTile
            variant="plain"
            label="Card unloads inside it"
            value={money(e.unloads)}
            sub="Money moved to a card, not money spent."
            naHint="The import carries no card unload lines for this month."
          />
          <StatTile
            variant="plain"
            label="Cash in for the same month"
            value={money(e.revenue)}
            naHint="Cash for this month is not available, so no profit can be drawn."
          />
          <StatTile
            variant="plain"
            label="Profit"
            value={money(e.profit.amount)}
            naHint={
              e.profit.why ??
              "Profit is only drawn when every line inside spend is measured."
            }
          />
          <StatTile
            variant="plain"
            label="Margin"
            value={pct(e.profit.margin)}
            naHint={
              e.profit.why ??
              "A margin is only drawn when profit itself can be drawn."
            }
          />
        </div>
        {e.profit.why ? (
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            {e.profit.why}
          </p>
        ) : null}
      </div>
      <div className="min-w-0">
        <GroupLabel>Every category as imported</GroupLabel>
        {items.length ? (
          <BarList
            className="mt-3"
            items={items}
            format={money}
            ariaLabel="Expenses by category, exactly as imported"
          />
        ) : (
          <EmptyState
            icon={Receipt}
            title="No categories to rank"
            text="The month has no expense rows to group."
            compact
          />
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Categories are shown exactly as the import gave them, with nothing
          moved between them, so they do not match the cards above.
        </p>
      </div>
    </div>
  );
}
