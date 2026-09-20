import { Target } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useTabParam } from "@/components/ceo/CeoTabs";
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
  isNum,
  kuwaitDay,
  money,
  month,
  NA,
  plural,
  shiftMonth,
  type Unit,
} from "@/components/ceo/format";
import { HeroFigure } from "@/components/ceo/HeroFigure";
import {
  CAC_AD_SPEND_ONLY,
  CLOSE_RATE,
  COST_TO_WIN,
  cashHeadline,
  contractedHeadline,
  INTRO_TO_DEMO,
  SHOW_RATE,
} from "@/components/ceo/metrics";
import { SectionCard } from "@/components/ceo/SectionCard";
import { Sparkline } from "@/components/ceo/Sparkline";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip } from "@/components/ceo/StatusChip";
import { TabLink } from "@/components/ceo/TabLink";
import { TargetMeter } from "@/components/ceo/TargetMeter";
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
  FunnelWindow,
  GrowthPayload,
  MoneyPayload,
  Note,
} from "../../../convex/ceo/payloads";
import type { CeoTabProps } from "./types";

/** The month before this one as a long name, for the pace comparisons. */
function previousMonthName(ym: string): string {
  const prev = shiftMonth(ym, -1);
  return prev ? month(prev, { long: true }) : "last month";
}

function ratio(v: number | null | undefined): string {
  return isNum(v) ? `${decimal(v)}x` : NA;
}

// --- Notes: every caveat sits on the card that carries the number ---

type CardKey = "cash" | "funnel" | "costs" | "trend" | "targets";

/** A money caveat about something no card here shows. The Money tab carries it. */
type MoneyRoute = CardKey | "moneyTab";

/** A growth caveat about the rep table, the ad table or lead sources, which the Sales and Marketing tabs carry. */
type GrowthRoute = CardKey | "otherTabs";

// Growth caveats land on the funnel, which carries most of its numbers. Order
// matters:
// - The rep note also names top ads and retargeting, and the rep scorecard,
//   top ads and lead sources are tables this tab does not show, so they are
//   claimed first and left to the Sales and Marketing tabs.
// - The show rule and the count of past demos still marked confirmed stay on
//   Sales, which shows demos due; the show rate tile here carries the rule.
// - The daily series feeds the trend card.
// - The spend definition goes to the cost card, because cost per lead, cost
//   to win and return on ad spend are all built on that same spend.
const GROWTH_ROUTES: readonly (readonly [RegExp, GrowthRoute])[] = [
  [/rep scorecard|^reps:|top ads|lead sources/i, "otherTabs"],
  [/still marked confirmed|show rate/i, "otherTabs"],
  [/daily series/i, "trend"],
  [/lead-gen campaigns only|retargeting/i, "costs"],
];

// Only cash caveats may reach the cash card. Order matters:
// - Expenses, the bank statement import, card unloads, failed checkouts and
//   the recent deals list are Money tab matters no card here shows, so they
//   are claimed first. The bank import coverage note names bank transfers,
//   and must not fall through to the cash rule.
// - The closer-form cash rule must reach the funnel card before the deal rule
//   sends it to the cost card.
// - The cash rule is a list of what cash caveats talk about, not a fallback:
//   a caveat no rule claims stays on the Money tab rather than landing here.
const MONEY_ROUTES: readonly (readonly [RegExp, MoneyRoute])[] = [
  [
    /expense|bank statement|card unload|failed charge|recent deals/i,
    "moneyTab",
  ],
  [/closer typed|deal cash/i, "funnel"],
  [/target|actuals/i, "targets"],
  [/deal|contracted|closer form/i, "costs"],
  [
    /cash|whop|\btap\b|rails?\b|refund|manual|by hand|hand entered|payment/i,
    "cash",
  ],
];

function routeNotes<K extends string>(
  notes: Note[] | null | undefined,
  routes: readonly (readonly [RegExp, K])[],
  fallback: K,
): Partial<Record<K, Note[]>> {
  const out: Partial<Record<K, Note[]>> = {};
  for (const note of notes ?? []) {
    const key = routes.find(([re]) => re.test(note.text))?.[1] ?? fallback;
    out[key] = [...(out[key] ?? []), note];
  }
  return out;
}

function join(...lists: (Note[] | undefined)[]): Note[] | null {
  const all = lists.flatMap(l => l ?? []);
  return all.length ? all : null;
}

/** Both kinds of cash sit on this tab, so the difference is spelled out every time. */
const CASH_CLASH_NOTE: Note = {
  level: "warn",
  text: "Cash typed on the closer form is not the cash collected at the top of this tab. One is what the closer typed at signing, the other is what actually landed. Never add the two together.",
};

const COSTS_WINDOW_NOTE: Note = {
  level: "info",
  text: "Cost to win, return on ad spend and cost per lead follow the window chosen above. Average contract, deals signed and contracted value are always this month against last month, whatever window is chosen.",
};

/** Decision 5: the cost to win counts ad spend only, and says which spend. */
const COST_TO_WIN_NOTE: Note = {
  level: "info",
  text: `Cost to win a customer adds retargeting to the lead-gen spend, so it reads higher than the B2B dashboard's own figure. Cost per lead and return on ad spend use lead-gen spend alone, as the dashboard does. ${CAC_AD_SPEND_ONLY}`,
};

const TREND_NOTE: Note = {
  level: "info",
  text: "Today is left off every chart here. A day that is still running would read as a fall.",
};

/**
 * What the cash card must say about the rails behind its numbers. Once the
 * money adapter fills `rails` it writes its own "never add a rail to the
 * total" note, so this one only speaks for a payload stored before that.
 */
function railNotes(p: MoneyPayload | null): Note[] {
  if (!p) return [];
  const headline = cashHeadline(p);
  if (headline.railed) return headline.note ? [headline.note] : [];
  return [
    ...(headline.note ? [headline.note] : []),
    {
      level: "info",
      text: "The Whop rail is the same money the rest of the cockpit calls cash. Never add a rail to the total beside it.",
    },
  ];
}

/** The cost per close target is the dashboard's own CAC, which is not the cost to win tile. */
function cacTargetNote(p: MoneyPayload | null): Note[] {
  if (!p?.targets.items.some(i => i.metric === "cac")) return [];
  return [
    {
      level: "info",
      text: `The cost per close target is judged against the B2B dashboard's own figure: lead-gen spend over deals signed, with retargeting left out. It reads lower than cost to win a customer above, which adds retargeting. ${CAC_AD_SPEND_ONLY}`,
    },
  ];
}

/** Targets that belong to another month have to say so before anyone reads them. */
function targetMonthNote(p: MoneyPayload | null): Note[] {
  if (!p?.targets.month || p.targets.month === p.month) return [];
  return [
    {
      level: "warn",
      text: `These targets are for ${month(p.targets.month, { long: true, year: true })}, not ${month(p.month, { long: true, year: true })}. The actuals beside them are this month's.`,
    },
  ];
}

/** The pace note the month tiles carry, in the same words the Sales tab uses. */
const PART_MONTH_NOTE: Note = {
  level: "info",
  text: "Deals signed and contracted value show this month beside the whole of last month, with no percentage between them: a month that is still running would read as a fall every time. The fair pace comparison, this month against the same days last month, is on the cash figure at the top of this tab.",
};

/**
 * Frontend: Mahara's own marketing and its own sales as one story, from ad
 * spend through leads, calls and closes to the cash that was actually won.
 * The rep table and the ad table stay on the Marketing and Sales tabs.
 */
export function FrontendTab({ sections, now, day, goTab }: CeoTabProps) {
  const growthSection = sections.growth;
  const moneySection = sections.money;
  const g = growthSection?.payload ?? null;
  const m = moneySection?.payload ?? null;
  const today = day ?? kuwaitDay(now);
  const [win, setWin] = useTabParam(WINDOW_KEYS, "mtd", "window");

  const notes = useMemo(
    () => ({
      growth: routeNotes<GrowthRoute>(g?.notes, GROWTH_ROUTES, "funnel"),
      money: routeNotes<MoneyRoute>(m?.notes, MONEY_ROUTES, "moneyTab"),
    }),
    [g, m],
  );

  const compareKey = COMPARE_WITH[win];
  const current = g?.windows[win] ?? null;
  const previous = compareKey ? (g?.windows[compareKey] ?? null) : null;
  const vs = previous ? `vs ${range(previous.from, previous.to)}` : undefined;
  const monthKey = m?.month ?? today.slice(0, 7);

  // With neither section computed, one card says so instead of six empty states.
  if (!g && !m)
    return (
      <div className="grid min-w-0">
        <SectionCard title="Frontend" section={growthSection}>
          {() => null}
        </SectionCard>
      </div>
    );

  return (
    <div className="grid gap-4 lg:gap-6">
      <SectionCard
        id="frontend-cash"
        kicker={month(monthKey, { long: true, year: true })}
        title="Cash collected"
        section={moneySection}
        notes={join(notes.money.cash, railNotes(m))}
        actions={<TabLink tab="money" label="Money" goTab={goTab} />}
        order={0}
      >
        {p => (
          <CashWon
            p={p}
            today={today}
            onMoneyTab={notes.money.moneyTab?.length ?? 0}
            goTab={goTab}
          />
        )}
      </SectionCard>

      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips
          options={WINDOW_CHIPS}
          value={win}
          onChange={setWin}
          ariaLabel="Window for the funnel and what it costs"
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

      <SectionCard
        kicker={WINDOW_LABEL[win]}
        title="The whole funnel"
        section={growthSection}
        notes={join(notes.growth.funnel, notes.money.funnel, [CASH_CLASH_NOTE])}
        actions={
          <>
            <TabLink tab="marketing" label="Marketing" goTab={goTab} />
            <TabLink tab="sales" label="Sales" goTab={goTab} />
          </>
        }
        order={1}
      >
        {p => (
          <FunnelBody
            w={p.windows[win]}
            prev={compareKey ? p.windows[compareKey] : null}
            vs={vs}
            label={WINDOW_LABEL[win]}
            onOtherTabs={notes.growth.otherTabs?.length ?? 0}
            goTab={goTab}
          />
        )}
      </SectionCard>

      <SectionCard
        kicker={WINDOW_LABEL[win]}
        title="What it costs"
        section={growthSection}
        alsoReads={[moneySection]}
        notes={join(notes.growth.costs, notes.money.costs, [
          COST_TO_WIN_NOTE,
          COSTS_WINDOW_NOTE,
          PART_MONTH_NOTE,
        ])}
        order={2}
      >
        {p => (
          <CostsBody
            w={p.windows[win]}
            prev={compareKey ? p.windows[compareKey] : null}
            vs={vs}
            m={m}
          />
        )}
      </SectionCard>

      <SectionCard
        kicker="Daily, through yesterday"
        title="Trend"
        section={growthSection}
        alsoReads={[moneySection]}
        notes={join(notes.growth.trend, [TREND_NOTE])}
        order={3}
      >
        {p => <TrendBody rows={p.daily} m={m} today={today} />}
      </SectionCard>

      <SectionCard
        kicker={month(m?.targets.month ?? monthKey, { long: true })}
        title="Targets"
        section={moneySection}
        notes={join(notes.money.targets, targetMonthNote(m), cacTargetNote(m))}
        order={4}
      >
        {p => <TargetsBody p={p} />}
      </SectionCard>

      <NotMeasurableCard />
    </div>
  );
}

// --- Card 1: cash collected, by rail ---

function CashWon({
  p,
  today,
  onMoneyTab,
  goTab,
}: {
  p: MoneyPayload;
  today: string;
  /** Money caveats about numbers this tab does not show, left on the Money tab. */
  onMoneyTab: number;
  goTab: CeoTabProps["goTab"];
}) {
  const headline = cashHeadline(p);
  const { railed, tap, whop, manual } = headline;
  const total = headline.rail;
  const lastMonthName = previousMonthName(p.month);
  const thisMonthName = month(p.month, { long: true });
  // Today is still running; a partial last day would read as a fall.
  const daily = total.daily.filter(d => d.date < today).slice(-90);
  const best = daily.reduce<(typeof daily)[number] | null>(
    (top, d) => (top === null || d.value > top.value ? d : top),
    null,
  );

  return (
    <div className="min-w-0">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
        <div className="flex min-w-0 flex-col">
          <HeroFigure
            label={headline.label}
            value={total.mtd}
            format={money}
            countKey="frontend-cash-won"
            delta={
              <Delta
                value={change(total.mtd, total.lastMonthToDate)}
                size="md"
                vs={`vs the same days in ${lastMonthName}`}
              />
            }
            sub={`Projected ${money(total.projectedMonth)} for ${thisMonthName}, day ${p.dayOfMonth} of ${p.daysInMonth}`}
            naHint="No connected rail gives a figure for this month."
          />
          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t pt-4 sm:grid-cols-4 lg:mt-auto">
            <StatTile
              variant="plain"
              label="Today so far"
              value={money(total.today)}
            />
            <StatTile
              variant="plain"
              label="Yesterday"
              value={money(total.yesterday)}
            />
            <StatTile
              variant="plain"
              label={`${lastMonthName} in full`}
              value={money(total.lastMonth)}
            />
            {/* The same refunds figure Today and Money show. Only Whop reports
                refunds: Tap refunds are not read and hand-logged money has
                none, so a total across rails would be n/a or wrong. */}
            <StatTile
              variant="plain"
              label="Refunds this month"
              value={money(p.refunds.mtd)}
              sub={
                tap?.connected
                  ? "Whop only. Tap refunds are not read yet."
                  : `${money(p.refunds.last90)} in the last 90 days`
              }
              naHint="Whop gave no refunds figure for this month."
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-col">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            By rail
          </p>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-5">
            <StatTile
              variant="plain"
              label="Whop, month to date"
              value={money(whop.mtd)}
              sub={`Today ${money(whop.today)}`}
              status={<StatusChip tone="good" label="Connected" />}
            />
            <StatTile
              variant="plain"
              label="Tap, month to date"
              value={tap?.connected ? money(tap.mtd) : null}
              sub={
                tap?.connected
                  ? `Today ${money(tap.today)}`
                  : "Not read yet, so it is not in the total."
              }
              status={
                <StatusChip
                  tone={tap?.connected ? "good" : "neutral"}
                  label={tap?.connected ? "Connected" : "Not connected"}
                />
              }
              naHint={
                railed
                  ? "Tap is not read this run: either no live Tap key is set on this deployment or Tap could not be reached. The notes on this card say which."
                  : "Cash rails are not computed yet, so Tap is not read at all."
              }
            />
            {manual ? (
              <StatTile
                variant="plain"
                label="Logged by hand, month to date"
                value={manual.connected ? money(manual.mtd) : null}
                sub={
                  manual.connected
                    ? "Bank transfers, cheques and cash typed in on the Money tab."
                    : "Nothing logged, or not read this run, so it is not in the total."
                }
                status={
                  <StatusChip
                    tone={manual.connected ? "good" : "neutral"}
                    label={
                      manual.connected ? "In the total" : "Not in the total"
                    }
                  />
                }
                naHint="No payment has been logged by hand, or the log could not be read this run. Money that arrived off Whop is missing until someone logs it on the Money tab."
              />
            ) : null}
          </div>

          <div className="mt-8 min-w-0">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-[13px] font-medium text-foreground">
                Cash per day
              </p>
              <p className="text-[13px] text-muted-foreground">
                {daily.length
                  ? `last ${count(daily.length)} complete days`
                  : "no complete days yet"}
              </p>
            </div>
            {daily.length ? (
              <Sparkline
                values={daily.map(d => d.value)}
                labels={daily.map(d => date(d.date))}
                format={money}
                height={132}
                ariaLabel={`Cash per day over the last ${count(daily.length)} complete days${
                  best && best.value > 0
                    ? `, best day ${date(best.date)} at ${money(best.value)}`
                    : ""
                }.`}
              />
            ) : (
              <EmptyState title="No cash days to plot yet." compact />
            )}
          </div>
        </div>
      </div>
      {onMoneyTab > 0 ? (
        <p className="mt-5 border-t pt-3 text-xs text-muted-foreground">
          {plural(onMoneyTab, "more money caveat")} about numbers this tab does
          not show, such as expenses and the bank import,{" "}
          {onMoneyTab === 1 ? "sits" : "sit"} on the{" "}
          <button
            type="button"
            onClick={() => goTab("money")}
            className="rounded-sm font-medium text-foreground underline decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Money
          </button>{" "}
          tab.
        </p>
      ) : null}
    </div>
  );
}

// --- Card 2: the whole funnel, one window at a time ---

type Tile = {
  label: string;
  value: string;
  delta?: ReactNode;
  sub?: ReactNode;
  hint?: string;
  naHint?: string;
};

function FunnelBody({
  w,
  prev,
  vs,
  label,
  onOtherTabs,
  goTab,
}: {
  w: FunnelWindow;
  prev: FunnelWindow | null;
  vs?: string;
  label: string;
  /** Growth caveats about the rep and ad tables, left on the Sales and Marketing tabs. */
  onOtherTabs: number;
  goTab: CeoTabProps["goTab"];
}) {
  const delta = (
    value: number | null,
    goodWhen: GoodWhen,
    kind: DeltaKind = "pct",
  ) =>
    prev && isNum(value) ? (
      <Delta value={value} goodWhen={goodWhen} kind={kind} vs={vs} />
    ) : undefined;

  const tiles: Tile[] = [
    {
      label: "Lead-gen ad spend",
      value: money(w.spend),
      delta: delta(change(w.spend, prev?.spend), "neither"),
      hint: "What Mahara spends on its own lead-gen campaigns, as on the B2B dashboard overview. Retargeting money is not in it, and money spent on client ads is a different pool on the Delivery tab.",
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
    {
      label: "Demos booked",
      value: count(w.demosBooked),
      delta: delta(change(w.demosBooked, prev?.demosBooked), "up"),
    },
    {
      label: "Demos shown",
      value: count(w.demosShown),
      delta: delta(change(w.demosShown, prev?.demosShown), "up"),
    },
    {
      label: SHOW_RATE.label,
      value: SHOW_RATE.format(w.demoShowRate),
      delta: delta(diff(w.demoShowRate, prev?.demoShowRate), "up", "points"),
      hint: SHOW_RATE.hint,
      naHint: SHOW_RATE.naHint,
    },
    {
      label: "Closes",
      value: count(w.closes),
      delta: delta(change(w.closes, prev?.closes), "up"),
    },
    {
      label: "Close rate",
      value: CLOSE_RATE.format(w.closeRate),
      delta: delta(diff(w.closeRate, prev?.closeRate), "up", "points"),
      hint: CLOSE_RATE.hint,
      naHint: CLOSE_RATE.naHint,
    },
    {
      label: "Contracted on the closer form",
      value: money(w.contracted),
      delta: delta(change(w.contracted, prev?.contracted), "up"),
      hint: "The contract value the closer typed on the form, in this window. Deal values logged by hand on the Money tab are not in it; the contracted this month figure further down adds them.",
    },
    {
      label: "Cash typed on the form",
      value: money(w.cash),
      delta: delta(change(w.cash, prev?.cash), "up"),
      hint: "The upfront amount the closer typed at signing, never a Whop payment. Do not add it to the cash won above.",
    },
  ];

  return (
    <div className="min-w-0">
      <FunnelStrip
        ariaLabel={`Mahara's own funnel, ${label.toLowerCase()}`}
        steps={[
          { label: "Leads", value: w.leads },
          { label: "Intros booked", value: w.introsBooked },
          // The dashboard's own rates: intro to demo on intros shown, show rate
          // on calls due, close rate on qualified demos.
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
      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t pt-5 sm:grid-cols-3 lg:grid-cols-5">
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
      {onOtherTabs > 0 ? (
        <p className="mt-5 border-t pt-3 text-xs text-muted-foreground">
          {plural(onOtherTabs, "more caveat")} about call records and the rep
          and ad tables {onOtherTabs === 1 ? "sits" : "sit"} on the{" "}
          <button
            type="button"
            onClick={() => goTab("sales")}
            className="rounded-sm font-medium text-foreground underline decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sales
          </button>{" "}
          and{" "}
          <button
            type="button"
            onClick={() => goTab("marketing")}
            className="rounded-sm font-medium text-foreground underline decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Marketing
          </button>{" "}
          tabs.
        </p>
      ) : null}
    </div>
  );
}

// --- Card 3: what it costs ---

function CostsBody({
  w,
  prev,
  vs,
  m,
}: {
  w: FunnelWindow;
  prev: FunnelWindow | null;
  vs?: string;
  m: MoneyPayload | null;
}) {
  const delta = (value: number | null, goodWhen: GoodWhen) =>
    prev && isNum(value) ? (
      <Delta value={value} goodWhen={goodWhen} vs={vs} />
    ) : undefined;
  const lastMonthName = m ? previousMonthName(m.month) : "last month";
  const moneyNa = "The money section has not been computed yet.";
  // Closer form plus deal values logged by hand, as on Today, Sales and Money.
  const contracted = m ? contractedHeadline(m) : null;
  // Decision 5: one rule for cost to win on every tab, with its caveat printed.
  const costToWin = COST_TO_WIN.of(w);
  const prevCostToWin = prev ? COST_TO_WIN.of(prev).value : null;

  const windowTiles: Tile[] = [
    {
      label: COST_TO_WIN.label,
      value: money(costToWin.value),
      delta: delta(change(costToWin.value, prevCostToWin), "down"),
      sub: COST_TO_WIN.sub,
      hint: COST_TO_WIN.hint,
      naHint: costToWin.naHint,
    },
    {
      label: "Return on ad spend",
      value: ratio(w.roas),
      delta: delta(change(w.roas, prev?.roas), "up"),
      hint: "As the B2B dashboard computes it, against the money the closer typed rather than cash collected.",
      naHint: "No ad spend in this window.",
    },
    {
      label: "Cost per lead",
      value: money(w.cpl),
      delta: delta(change(w.cpl, prev?.cpl), "down"),
      naHint: "No leads in this window, so there is no cost per lead.",
    },
  ];

  const monthTiles: Tile[] = [
    {
      label: "Average contract, 90 days",
      value: m ? money(m.deals.avgContract90d) : NA,
      hint: "Mean contracted value of deals signed in the last 90 days that carry one. Always 90 days, never the window above.",
      naHint: m
        ? "No deal signed in the last 90 days has a contracted value."
        : moneyNa,
    },
    // No percentage between these and last month: last month is a whole month
    // and this one is not, so a delta would read as a fall every time. The
    // Sales tab shows the same two numbers under the same rule.
    {
      label: "Deals signed this month",
      value: m ? count(m.deals.mtd) : NA,
      sub: m
        ? `${count(m.deals.lastMonth)} in all of ${lastMonthName}`
        : undefined,
      naHint: moneyNa,
    },
    {
      label: contracted?.label ?? "Contracted this month",
      value: contracted ? money(contracted.value) : NA,
      sub: contracted
        ? `${contracted.split ? `${contracted.split}. ` : ""}${money(contracted.lastMonth)} in all of ${lastMonthName}`
        : undefined,
      hint: contracted?.hint,
      naHint: moneyNa,
    },
  ];

  const groups: { title: string; tiles: Tile[] }[] = [
    { title: "In the chosen window", tiles: windowTiles },
    { title: "This month against last month", tiles: monthTiles },
  ];

  return (
    <div className="grid gap-5">
      {groups.map((group, i) => (
        <section
          key={group.title}
          aria-label={group.title}
          className={cn(i > 0 && "border-t pt-5")}
        >
          <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {group.title}
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            {group.tiles.map(t => (
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

// --- Card 4: trend ---

const DAILY_SERIES: {
  key: "spend" | "leads" | "booked" | "closes";
  title: string;
  unit: Unit;
  noun: string;
}[] = [
  {
    key: "spend",
    title: "Lead-gen ad spend",
    unit: "money",
    noun: "Lead-gen ad spend",
  },
  { key: "leads", title: "Leads", unit: "count", noun: "Leads" },
  {
    key: "booked",
    title: "Calls booked",
    unit: "count",
    noun: "Intro and demo calls booked",
  },
  { key: "closes", title: "Closes", unit: "count", noun: "Closes" },
];

function TrendBody({
  rows,
  m,
  today,
}: {
  rows: GrowthPayload["daily"];
  m: MoneyPayload | null;
  today: string;
}) {
  const days = rows.filter(r => r.date < today);
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;
  const span = first && last ? `from ${date(first)} to ${date(last)}` : "";
  const cashDaily = (m ? (m.rails?.total.daily ?? m.cash.daily) : []).filter(
    d => d.date < today,
  );
  const cashLabel = m?.rails ? "Cash per day, all rails" : "Cash per day, Whop";

  return (
    <div className="grid gap-8">
      <div className="grid gap-x-8 gap-y-8 sm:grid-cols-2">
        {DAILY_SERIES.map(s => (
          <TimeSeriesChart
            initialRange="90d"
            key={s.key}
            data={days}
            series={[{ key: s.key, label: s.title }]}
            unit={s.unit}
            title={s.title}
            height={180}
            syncId="ceo-frontend-daily"
            ariaLabel={`${s.noun} per day ${span}.`}
            emptyText="No days to plot yet."
          />
        ))}
      </div>
      <div className="border-t pt-6">
        <TimeSeriesChart
          initialRange="90d"
          data={cashDaily}
          series={[{ key: "value", label: "Cash" }]}
          kind="area"
          unit="money"
          title={cashLabel}
          summary="through yesterday"
          height={220}
          ariaLabel={`Cash collected per day over the last ${count(cashDaily.length)} complete days.`}
          emptyText={
            m
              ? "No cash days to plot yet."
              : "The money section has not been computed yet."
          }
        />
      </div>
    </div>
  );
}

// --- Card 5: targets ---

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
  // The shared meter, so a target reads the same here, on Sales and on Money.
  const pace = p.targets.month === null || p.targets.month === p.month;
  return (
    <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(item =>
        item.metric === "cac" ? (
          // Decision 5: the cost per close meter is ad spend only too.
          <div key={item.metric} className="min-w-0">
            <TargetMeter
              item={item}
              dayOfMonth={p.dayOfMonth}
              daysInMonth={p.daysInMonth}
              pace={pace}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              {CAC_AD_SPEND_ONLY} Lead-gen spend only, as the B2B dashboard
              counts it.
            </p>
          </div>
        ) : (
          <TargetMeter
            key={item.metric}
            item={item}
            dayOfMonth={p.dayOfMonth}
            daysInMonth={p.daysInMonth}
            pace={pace}
          />
        ),
      )}
    </div>
  );
}

// --- What this tab cannot show, and why ---

const NO_SOURCE_TILES: { label: string; why: string }[] = [
  {
    label: "Lead to booked call time",
    why: "No source records when a lead's first call was booked. The funnel carries counts by day, never a timestamp per lead.",
  },
  {
    label: "Open pipeline value",
    why: "Nothing in the B2B project holds unclosed opportunities with a value on them. The closer form is signed deals only.",
  },
  {
    label: "Customer lifetime value",
    why: "Needs a revenue history per customer keyed to the deal. Whop payments are not joined to the closer form.",
  },
  {
    label: "Payback period",
    why: "Needs the same customer revenue history as lifetime value, which no source gives.",
  },
  {
    label: "Cash collected against cash contracted",
    why: "Nothing links a payment to the deal that produced it, so what share of the contracted money has actually landed cannot be worked out.",
  },
];

const NO_SOURCE_NOTES: Note[] = [
  {
    level: "info",
    text: "These five are on the tab so nobody assumes they are being watched. They are n/a because no source gives them, not because they are zero.",
  },
  {
    level: "info",
    text: "Each would need a backend change first: a booking timestamp per lead, a table of open opportunities, and a link from a payment back to the deal that produced it.",
  },
];

function NotMeasurableCard() {
  return (
    <SectionCard
      kicker="Frontend"
      title="Not measurable yet"
      notes={NO_SOURCE_NOTES}
      order={5}
      hideAsOf
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
        {NO_SOURCE_TILES.map(t => (
          <StatTile
            key={t.label}
            variant="plain"
            label={t.label}
            value={null}
            naHint={t.why}
          />
        ))}
      </div>
    </SectionCard>
  );
}
