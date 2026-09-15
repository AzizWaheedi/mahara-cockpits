import { Receipt, Target } from "lucide-react";
import { useMemo } from "react";
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
  humanize,
  isNum,
  kuwaitDay,
  money,
  moneyCompact,
  month,
  pct,
  plural,
} from "@/components/ceo/format";
import { HeroFigure } from "@/components/ceo/HeroFigure";
import { Meter } from "@/components/ceo/Meter";
import { Value } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { gateTone, StatusChip } from "@/components/ceo/StatusChip";
import { TimeSeriesChart } from "@/components/ceo/TimeSeriesChart";
import type { MoneyPayload, Note } from "../../../convex/ceo/payloads";
import type { CeoTabProps } from "./types";

type Deal = MoneyPayload["deals"]["recent"][number];
type TargetItem = MoneyPayload["targets"]["items"][number];
type CardKey = "cash" | "tiles" | "monthly" | "targets" | "expenses" | "deals";

// Each caveat sits beside the number it qualifies. Order matters: "Failed
// charges ... Whop checkouts" must reach the tiles before the Whop rule, and
// "Expenses and bank transfers" the expenses card before it. Anything
// unmatched lands on the cash card, so no note is ever dropped.
const NOTE_ROUTES: readonly (readonly [RegExp, CardKey])[] = [
  [/failed charge/i, "tiles"],
  [/closer form (last|has never) synced/i, "tiles"],
  [/expense/i, "expenses"],
  [/target/i, "targets"],
  [/whop/i, "cash"],
  [/contracted value was not captured|earlier months/i, "monthly"],
  [/deal/i, "deals"],
];

function routeNotes(notes: Note[] | null | undefined) {
  const out: Partial<Record<CardKey, Note[]>> = {};
  for (const note of notes ?? []) {
    const key = NOTE_ROUTES.find(([re]) => re.test(note.text))?.[1] ?? "cash";
    out[key] = [...(out[key] ?? []), note];
  }
  return out;
}

/** "2026-09" shifted by whole months. */
function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function sum(values: number[]): number {
  return values.reduce((t, v) => t + (isNum(v) ? v : 0), 0);
}

/** Cash, deals, refunds, failed checkouts, expenses and targets. */
export function MoneyTab({ sections, now, day }: CeoTabProps) {
  const section = sections.money;
  const payload = section?.payload ?? null;
  const today = day ?? kuwaitDay(now);
  const monthKey = payload?.month ?? today.slice(0, 7);
  const notes = useMemo(() => routeNotes(payload?.notes), [payload]);

  // With nothing to show, one card says so instead of six identical empty states.
  if (!payload)
    return (
      <div className="grid min-w-0">
        <SectionCard title="Money" section={section}>
          {() => null}
        </SectionCard>
      </div>
    );

  return (
    <div className="grid gap-4 lg:gap-6">
      <SectionCard
        id="money-cash"
        kicker={month(monthKey, { long: true, year: true })}
        title="Cash collected"
        section={section}
        notes={notes.cash}
        order={0}
      >
        {p => <CashBody p={p} today={today} />}
      </SectionCard>

      <SectionCard
        title="Deals, refunds and failed checkouts"
        section={section}
        notes={notes.tiles}
        order={1}
      >
        {p => <MoneyTiles p={p} />}
      </SectionCard>

      {/* Full width so any number of targets lays out as a grid, not a tall column. */}
      <SectionCard
        kicker={month(monthKey, { long: true })}
        title="Targets"
        section={section}
        notes={notes.targets}
        order={2}
      >
        {p => <TargetsBody p={p} />}
      </SectionCard>

      <div className="grid gap-4 lg:gap-6 xl:grid-cols-12">
        <SectionCard
          kicker="Last 12 months"
          title="Cash and contracted by month"
          section={section}
          notes={notes.monthly}
          order={3}
          className="xl:col-span-8"
        >
          {p => <MonthlyBody p={p} />}
        </SectionCard>
        <SectionCard
          kicker="Latest month loaded"
          title="Expenses"
          section={section}
          notes={notes.expenses}
          order={4}
          className="xl:col-span-4"
        >
          {p => <ExpensesBody p={p} />}
        </SectionCard>
      </div>

      <SectionCard
        kicker="Newest 10"
        title="Recent deals"
        section={section}
        notes={notes.deals}
        order={5}
      >
        {p => <DealsTable deals={p.deals.recent} />}
      </SectionCard>
    </div>
  );
}

// --- Cash: the hero, pace facts and cash per day ---

function CashBody({ p, today }: { p: MoneyPayload; today: string }) {
  const lastMonthName = month(shiftMonth(p.month, -1), { long: true });
  const thisMonthName = month(p.month, { long: true });
  // Today is still running; a partial last day would read as a drop.
  const daily = p.cash.daily.filter(d => d.date < today);
  const best = daily.reduce<(typeof daily)[number] | null>(
    (top, d) => (top === null || d.value > top.value ? d : top),
    null,
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
      <div className="flex min-w-0 flex-col">
        <HeroFigure
          label="Cash collected this month"
          value={p.cash.mtd}
          format={money}
          delta={
            <Delta
              value={change(p.cash.mtd, p.cash.lastMonthToDate)}
              size="md"
              vs={`vs the same days in ${lastMonthName}`}
            />
          }
          sub={`Projected ${money(p.cash.projectedMonth)} for ${thisMonthName}, day ${p.dayOfMonth} of ${p.daysInMonth}`}
        />
        <dl className="mt-6 grid grid-cols-3 gap-4 border-t pt-4 lg:mt-auto">
          <Fact label="Today so far" value={money(p.cash.today)} />
          <Fact label="Yesterday" value={money(p.cash.yesterday)} />
          <Fact
            label={`${lastMonthName} in full`}
            value={money(p.cash.lastMonth)}
          />
        </dl>
      </div>
      <TimeSeriesChart
        data={daily}
        series={[{ key: "value", label: "Cash" }]}
        kind="area"
        unit="money"
        title="Cash per day"
        summary="through yesterday"
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

// --- Tiles ---

function MoneyTiles({ p }: { p: MoneyPayload }) {
  const lastMonthName = month(shiftMonth(p.month, -1), { long: true });
  const failed = p.failedCharges;
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-5">
      <StatTile
        variant="plain"
        label="Deals this month"
        value={count(p.deals.mtd)}
        sub={`${count(p.deals.lastMonth)} in ${lastMonthName}`}
      />
      <StatTile
        variant="plain"
        label="Contracted this month"
        value={money(p.deals.contractedMtd)}
        sub={`${money(p.deals.contractedLastMonth)} in ${lastMonthName}`}
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
        { key: "cash", label: "Cash" },
        { key: "refunds", label: "Refunds", tone: "context" },
      ]
    : [{ key: "cash", label: "Cash" }];
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
        title={hasRefunds ? undefined : "Cash"}
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
        title="Contracted"
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
    </div>
  );
}

// --- Targets ---

const TARGET_LABELS: Record<string, string> = {
  revenue: "Contracted revenue",
  signed: "Deals signed",
  leads: "Leads",
  spend: "Ad spend",
  cash_collected: "Cash collected",
  intros_booked: "Intros booked",
  demos_booked: "Demos booked",
  demos_shown: "Demos shown",
  close_rate: "Close rate",
  demo_show_rate: "Demo show rate",
  lead_to_demo: "Lead to demo rate",
  ctr: "Click-through rate",
  cost_per_lead: "Cost per lead",
  cost_per_intro: "Cost per intro",
  cac: "Cost per close",
};

type TargetKind = {
  format: (v: number) => string;
  /** total and budget pace to month end; higher and lower compare as is. */
  judge: "total" | "budget" | "higher" | "lower";
};

// Mirrors the money adapter: rates arrive as fractions, costs and totals in dollars or counts.
function targetKind(metric: string): TargetKind {
  if (/(_rate$|^ctr$|^lead_to_)/.test(metric))
    return { format: pct, judge: "higher" };
  if (/(^cost|cost$|^cp[abl]$|^cac$)/.test(metric))
    return { format: money, judge: "lower" };
  if (/(spend|budget)/.test(metric)) return { format: money, judge: "budget" };
  if (/(revenue|cash|contracted|mrr)/.test(metric))
    return { format: money, judge: "total" };
  return { format: count, judge: "total" };
}

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
  return (
    <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(item => (
        <TargetMeter
          key={item.metric}
          item={item}
          dayOfMonth={p.dayOfMonth}
          daysInMonth={p.daysInMonth}
        />
      ))}
    </div>
  );
}

function TargetMeter({
  item,
  dayOfMonth,
  daysInMonth,
}: {
  item: TargetItem;
  dayOfMonth: number;
  daysInMonth: number;
}) {
  const { format, judge } = targetKind(item.metric);
  const label = TARGET_LABELS[item.metric] ?? humanize(item.metric);
  const actual = item.actual;
  let tone: "emphasis" | "warning" | "serious" = "emphasis";
  let sub: string;

  if (!isNum(actual)) {
    sub = "The actual is not available yet.";
  } else if (judge === "total" || judge === "budget") {
    const projected = dayOfMonth > 0 ? (actual / dayOfMonth) * daysInMonth : 0;
    const share = item.target > 0 ? projected / item.target : null;
    sub = `On pace for ${format(projected)}${
      share !== null && judge === "total" ? `, ${pct(share)} of target` : ""
    }`;
    if (judge === "total" && share !== null)
      tone = share >= 1 ? "emphasis" : share >= 0.85 ? "warning" : "serious";
  } else {
    const gate = gateTone(actual, item.target, {
      higherIsBetter: judge === "higher",
    });
    tone =
      gate === "warning"
        ? "warning"
        : gate === "serious"
          ? "serious"
          : "emphasis";
    const words =
      judge === "higher"
        ? {
            good: "At or above target",
            near: "A little under target",
            far: "Under target",
          }
        : {
            good: "At or under target",
            near: "A little over target",
            far: "Over target",
          };
    sub =
      gate === "good"
        ? words.good
        : gate === "warning"
          ? words.near
          : gate === "serious"
            ? words.far
            : "";
  }

  return (
    <Meter
      label={label}
      value={actual}
      target={item.target}
      format={format}
      tone={tone}
      sub={sub || undefined}
    />
  );
}

// --- Expenses ---

const EXPENSE_ROWS = 7;

function ExpensesBody({ p }: { p: MoneyPayload }) {
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
  const sorted = [...e.byCategory].sort((a, b) => b.amount - a.amount);
  const head = sorted.slice(0, EXPENSE_ROWS);
  const tail = sorted.slice(EXPENSE_ROWS);
  const items: BarListItem[] = head.map(c => ({
    key: c.category,
    label: humanize(c.category),
    value: c.amount,
  }));
  // Past a handful of bars the tail folds into one row instead of more hues or rows.
  if (tail.length)
    items.push({
      key: "other",
      label: `Other, ${plural(tail.length, "category", "categories")}`,
      value: sum(tail.map(c => c.amount)),
    });

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
        items={items}
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
