import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  type LucideIcon,
  MessageSquare,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { type Column, DataTable } from "@/components/ceo/DataTable";
import { Delta } from "@/components/ceo/Delta";
import { EmptyState } from "@/components/ceo/EmptyState";
import { FeedList } from "@/components/ceo/FeedList";
import { type FunnelStep, FunnelStrip } from "@/components/ceo/FunnelStrip";
import * as f from "@/components/ceo/format";
import { HeroFigure } from "@/components/ceo/HeroFigure";
import { Meter } from "@/components/ceo/Meter";
import {
  CLOSE_RATE,
  cashHeadline,
  contractedHeadline,
  INTRO_TO_DEMO,
  SHOW_RATE,
} from "@/components/ceo/metrics";
import { Value } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { Sparkline } from "@/components/ceo/Sparkline";
import { StatTile } from "@/components/ceo/StatTile";
import {
  gateLabel,
  gateTone,
  STATUS_COLOR,
  StatusChip,
  type StatusTone,
} from "@/components/ceo/StatusChip";
import { TabLink } from "@/components/ceo/TabLink";
import type { CeoSections } from "@/components/ceo/useCeo";
import { cn } from "@/lib/utils";
import type {
  ClientRow,
  DeliveryPayload,
  MoneyPayload,
  Note,
  Point,
  TeamPerson,
} from "../../../convex/ceo/payloads";
import {
  feedState,
  jobName,
  sourceLabel,
  syncEvery,
  syncState,
} from "./machineState";
import { buildRoster, useLiveStatuses } from "./teamRoster";
import type { CeoTabProps } from "./types";

type GoTab = CeoTabProps["goTab"];

/** The one screen: are we OK, where is it leaking, what needs me. */
export function TodayTab({ sections, now, day, goTab }: CeoTabProps) {
  const today = day ?? f.kuwaitDay(now);
  return (
    <div className="@container grid gap-4 lg:gap-6">
      <CashHero section={sections.money} today={today} goTab={goTab} />

      <KpiRow
        delivery={sections.delivery}
        calls={sections.calls}
        day={day}
        goTab={goTab}
      />

      <div className="grid items-start gap-4 lg:gap-6 @4xl:grid-cols-2">
        <DeliveryFunnelCard
          delivery={sections.delivery}
          calls={sections.calls}
          goTab={goTab}
        />
        <GrowthFunnelCard section={sections.growth} goTab={goTab} />
      </div>

      <div className="grid items-start gap-4 lg:gap-6 @4xl:grid-cols-2">
        <div className="grid min-w-0 gap-4 lg:gap-6">
          <ClientsCard section={sections.clients} goTab={goTab} />
          <DeliveryByClientCard section={sections.delivery} goTab={goTab} />
        </div>
        <div className="grid min-w-0 gap-4 lg:gap-6">
          <LiveFeedCard section={sections.team} now={now} goTab={goTab} />
          <TeamTodayCard section={sections.team} now={now} today={today} />
        </div>
      </div>

      <MachineLine section={sections.machine} goTab={goTab} />
    </div>
  );
}

// --- Shared bits ---

// Today repeats only the warnings; every section's full notes live on its own tab.
function warnings(notes: Note[] | null | undefined): Note[] {
  return (notes ?? []).filter(n => n.level === "warn");
}

// The cash card carries only warnings about what it shows: cash, the deals and
// contracted rows, and the cash target meter. Expenses, the bank import, card
// unloads, failed checkouts and the other targets are Money tab matters. The
// bank import coverage warning names bank transfers, so it is skipped before
// the cash rule can take it, and a warning neither list names stays on Money.
const CASH_CARD_SKIP =
  /expense|bank statement|card unload|failed charge|recent deals|revenue target|actuals for targets|no targets exist/i;
const CASH_CARD_KEEP =
  /cash|whop|\btap\b|rails?\b|refund|manual|by hand|hand entered|payment|deal|contracted|closer form|targets could not be read/i;

function cashCardWarnings(notes: Note[] | null | undefined): Note[] {
  return warnings(notes).filter(
    n => !CASH_CARD_SKIP.test(n.text) && CASH_CARD_KEEP.test(n.text),
  );
}

// The growth funnel card shows no rep table, ad table, lead sources or daily
// chart, so a warning about one of those stays on the Sales and Marketing tabs.
// The show rule and the count of past demos still marked confirmed are Sales
// matters too: they are info notes today, and this keeps them off Today even
// if one is ever raised to a warning.
const GROWTH_CARD_SKIP =
  /rep scorecard|top ads|lead sources|daily series|show rate|still marked confirmed/i;

function growthCardWarnings(notes: Note[] | null | undefined): Note[] {
  return warnings(notes).filter(n => !GROWTH_CARD_SKIP.test(n.text));
}

const TONE_ICON: Record<StatusTone, LucideIcon> = {
  good: CircleCheck,
  warning: TriangleAlert,
  serious: CircleAlert,
  critical: OctagonAlert,
  neutral: CircleDashed,
};

/** The status icon for a cost against its gate, with the state spelled out for screen readers. */
function GateIcon({
  value,
  gate,
  className,
}: {
  value: number | null | undefined;
  gate: number;
  className?: string;
}) {
  const tone = gateTone(value, gate);
  if (tone === "neutral") return null;
  const Icon = TONE_ICON[tone];
  return (
    <>
      <Icon
        className={cn("size-3 shrink-0 self-center", className)}
        style={{ color: STATUS_COLOR[tone] }}
        aria-hidden
      />
      <span className="sr-only">
        {tone === "good" ? "within gate, " : "over gate, "}
      </span>
    </>
  );
}

/** A cost with its gate: the value, then a status icon and the gate in muted text. */
function GateValue({
  value,
  gate,
}: {
  value: number | null | undefined;
  gate: number;
}) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <Value value={f.money(value)} />
      <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
        <GateIcon value={value} gate={gate} />
        gate {f.money(gate)}
      </span>
    </span>
  );
}

function gateChip(
  value: number | null | undefined,
  gate: number,
  noun: string,
) {
  const tone = gateTone(value, gate);
  if (tone === "neutral") return undefined;
  return (
    <StatusChip
      tone={tone}
      label={gateLabel(tone, gate)}
      hint={`${noun} ${f.money(value)} against the ${f.money(gate)} gate${tone === "warning" ? ", within 25% of it" : ""}`}
    />
  );
}

function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

// --- 1. Hero band ---

function CashHero({
  section,
  today,
  goTab,
}: {
  section: CeoSections["money"];
  today: string;
  goTab: GoTab;
}) {
  const p = section?.payload ?? null;
  const scopeNote = p ? cashHeadline(p).note : null;
  // "Cash" once: the title names it, the figure's label says only the month
  // and the rails ("This month, Whop and Tap").
  return (
    <SectionCard
      title="Cash collected"
      section={section}
      notes={[
        ...(scopeNote ? [scopeNote] : []),
        ...cashCardWarnings(section?.payload?.notes),
      ]}
      actions={<TabLink tab="money" label="Money" goTab={goTab} />}
      order={0}
    >
      {m => <CashHeroBody m={m} today={today} />}
    </SectionCard>
  );
}

function CashHeroBody({ m, today }: { m: MoneyPayload; today: string }) {
  // The same rule the Frontend and Money tabs use, so the three headline cash
  // figures are one number under one name.
  const headline = cashHeadline(m);
  const cash = headline.rail;
  const tapConnected = headline.tap?.connected === true;
  // Closer form plus deal values logged by hand, as on Money, Frontend and Sales.
  const contracted = contractedHeadline(m);
  const prev = f.shiftMonth(m.month, -1);
  const prevLength = prev ? f.daysInMonth(prev) : null;
  const sameDay = prevLength ? Math.min(m.dayOfMonth, prevLength) : null;
  const pace = f.change(cash.mtd, cash.lastMonthToDate);
  const monthName = f.month(m.month, { long: true });
  const prevName = prev ? f.month(prev, { long: true }) : "last month";
  const vs =
    prev && sameDay
      ? `vs ${f.money(cash.lastMonthToDate)} by ${sameDay} ${f.month(prev)}`
      : "vs last month to date";

  const target =
    m.targets.month === m.month
      ? m.targets.items.find(i => i.metric === "cash_collected" && i.target > 0)
      : undefined;
  const projected = cash.projectedMonth;
  const share = target && f.isNum(projected) ? projected / target.target : null;
  const meterTone =
    share === null || share >= 1
      ? "emphasis"
      : share >= 0.85
        ? "warning"
        : "serious";

  // Today is still running; its partial day would end the line on a false drop (as on the Money tab).
  const daily = cash.daily.filter(p => p.date < today).slice(-90);
  const best = daily.reduce<Point | null>(
    (top, p) => (p.value > (top?.value ?? 0) ? p : top),
    null,
  );
  const total90 = daily.reduce((sum, p) => sum + p.value, 0);

  return (
    <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] @4xl:gap-10">
      <div className="min-w-0">
        <HeroFigure
          label={`This month, ${headline.scope}`}
          value={cash.mtd}
          format={f.money}
          countKey="today-cash-mtd"
          delta={<Delta value={pace} size="md" vs={vs} />}
          sub={
            <>
              Projected{" "}
              <span className="font-medium text-foreground">
                {f.money(projected)}
              </span>{" "}
              for {monthName}
            </>
          }
          naHint="No connected cash rail gives a figure for this month."
        />
        <div className="mt-6">
          {daily.length > 1 ? (
            <Sparkline
              values={daily.map(p => p.value)}
              labels={daily.map(p => f.date(p.date))}
              format={f.money}
              height={72}
              ariaLabel={`Cash per day over the last 90 days, through yesterday: ${f.money(total90)} in total${best ? `, best day ${f.money(best.value)} on ${f.date(best.date)}` : ""}.`}
            />
          ) : null}
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {daily.length > 1
                ? "Per day, last 90 days through yesterday"
                : "No daily cash to chart yet"}
            </span>
            {best ? (
              <span>
                Best day{" "}
                <span className="font-medium text-foreground">
                  {f.money(best.value)}
                </span>{" "}
                on {f.date(best.date)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-w-0 @4xl:border-l @4xl:pl-10">
        {target ? (
          <Meter
            label={`Projected cash vs ${monthName} target`}
            value={projected}
            target={target.target}
            format={f.money}
            tone={meterTone}
            sub={
              m.dayOfMonth < 5
                ? "Early in the month, so the projection still moves a lot."
                : `${f.money(cash.mtd)} collected so far.`
            }
            className="mb-5 border-b pb-5"
          />
        ) : null}
        <dl>
          {/* The same names and figures as the Frontend and Sales tabs. */}
          <LedgerRow
            label="Deals signed this month"
            value={f.count(m.deals.mtd)}
            sub={`${f.count(m.deals.lastMonth)} in all of ${prevName}`}
          />
          <LedgerRow
            label={contracted.label}
            value={f.money(contracted.value)}
            sub={`${contracted.split ? `${contracted.split}. ` : ""}${f.money(contracted.lastMonth)} in all of ${prevName}`}
          />
          {/* Whop is the only rail that reports refunds, so this stays Whop
              refunds even when the cash above covers more rails. */}
          <LedgerRow
            label="Refunds this month"
            value={f.money(m.refunds.mtd)}
            sub={
              tapConnected
                ? `Whop only, Tap refunds are not read yet. ${f.money(m.refunds.last90)} in the last 90 days.`
                : `${f.money(m.refunds.last90)} in the last 90 days`
            }
          />
        </dl>
      </div>
    </div>
  );
}

function LedgerRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    // A grid rather than nested wrappers: a dl group may only hold dt and dd directly.
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-[color:var(--ceo-grid)] py-3 first:pt-0 last:border-0 last:pb-0">
      <dt className="col-start-1 row-start-1 text-xs text-muted-foreground">
        {label}
      </dt>
      <dd className="col-start-2 row-span-2 row-start-1 text-xl font-semibold tracking-tight text-foreground">
        <Value value={value} />
      </dd>
      {sub ? (
        <dd className="col-start-1 row-start-2 mt-0.5 text-xs text-muted-foreground">
          {sub}
        </dd>
      ) : null}
    </div>
  );
}

// --- 2. KPI row ---

/**
 * Six numbers in one card, from two sections. The card tracks both for "as of"
 * and stale banners; a missing section shows n/a in its own tiles only.
 */
function KpiRow({
  delivery,
  calls,
  day,
  goTab,
}: {
  delivery: CeoSections["delivery"];
  calls: CeoSections["calls"];
  day: string | null;
  goTab: GoTab;
}) {
  const title = "Client delivery and calls";
  const kicker = "Yesterday and today";
  // One link: most of the card is delivery. Calls is a tap away in the rail.
  const actions = <TabLink tab="delivery" label="Delivery" goTab={goTab} />;
  if (!delivery && !calls)
    return (
      <SectionCard
        kicker={kicker}
        title={title}
        section={null}
        actions={actions}
        order={1}
      />
    );

  const d = delivery?.payload ?? null;
  const c = calls?.payload ?? null;
  const pendingD = d ? undefined : "Delivery numbers are not computed yet";
  const pendingC = c ? undefined : "Call numbers are not computed yet";
  const s = c?.speedToLead ?? null;
  const sinceDays = s?.since && day ? daysBetween(s.since, day) : null;

  return (
    <SectionCard
      kicker={kicker}
      title={title}
      alsoReads={[delivery, calls]}
      notes={[...warnings(d?.notes), ...warnings(c?.notes)]}
      actions={actions}
      order={1}
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 @2xl:grid-cols-3 @5xl:grid-cols-6">
        <StatTile
          variant="plain"
          label="Client ad spend yesterday"
          value={d ? f.money(d.yesterday.spend) : null}
          naHint={pendingD}
          delta={
            d ? (
              <Delta
                value={f.change(d.yesterday.spend, d.last7.spend / 7)}
                goodWhen="neither"
                vs="vs 7-day average"
              />
            ) : undefined
          }
          sub={d ? `${f.money(d.last7.spend)} in 7 days` : undefined}
        />
        <StatTile
          variant="plain"
          label="Client leads yesterday"
          value={d ? f.count(d.yesterday.leads) : null}
          naHint={pendingD}
          delta={
            d ? (
              <Delta
                value={f.change(d.yesterday.leads, d.last7.leads / 7)}
                vs="vs 7-day average"
              />
            ) : undefined
          }
          sub={d ? `${f.count(d.last7.leads)} in 7 days` : undefined}
        />
        <StatTile
          variant="plain"
          label="Client cost per lead, 7 days"
          value={d ? f.money(d.last7.cpl) : null}
          naHint={
            pendingD ??
            (d?.last7.leads === 0 ? "No leads in the last 7 days" : undefined)
          }
          status={
            d ? gateChip(d.last7.cpl, d.gates.cpl, "Cost per lead") : undefined
          }
          delta={
            d ? (
              <Delta
                value={f.change(d.last7.cpl, d.prevLast7.cpl)}
                goodWhen="down"
                vs="vs previous 7 days"
              />
            ) : undefined
          }
        />
        <StatTile
          variant="plain"
          label="Client appointments yesterday"
          value={d ? f.count(d.yesterday.bookings) : null}
          naHint={pendingD}
          delta={
            d ? (
              <Delta
                value={f.change(d.yesterday.bookings, d.last7.bookings / 7)}
                vs="vs 7-day average"
              />
            ) : undefined
          }
          sub={
            d ? (
              <span className="flex items-start gap-1">
                <GateIcon
                  value={d.last7.cpb}
                  gate={d.gates.cpb}
                  className="mt-1 self-start"
                />
                <span>
                  {f.isNum(d.last7.cpb)
                    ? `${f.money(d.last7.cpb)} per booking vs ${f.money(d.gates.cpb)} gate`
                    : `No cost per booking yet, gate ${f.money(d.gates.cpb)}`}
                </span>
              </span>
            ) : undefined
          }
        />
        <StatTile
          variant="plain"
          label="Dials today"
          value={c ? f.count(c.today.dials) : null}
          naHint={pendingC}
          sub={
            !c
              ? undefined
              : c.today.dials > 0
                ? `${f.count(c.today.connected)} connected${f.isNum(c.today.connectRate) ? ` (${f.pct(c.today.connectRate)})` : ""}`
                : `None yet, ${f.count(c.yesterday.dials)} yesterday`
          }
        />
        <StatTile
          variant="plain"
          label="Speed to lead, 7 days"
          hint={
            s && s.sample > 0
              ? `Median working time from a new lead to its first actual call, over ${f.plural(s.sample, "lead")}${s.since && sinceDays !== null && sinceDays < 7 ? ` since ${f.date(s.since)}` : ""}.`
              : "Median working time from a new lead to its first actual call."
          }
          value={s ? f.minutes(s.workingMedianMinutes7d) : null}
          naHint={
            pendingC ??
            (s?.sample === 0
              ? "No calls linked to new leads in the last 7 days"
              : undefined)
          }
          sub={
            s && f.isNum(s.withinTwoMinutesRate7d)
              ? `${f.pct(s.withinTwoMinutesRate7d)} of new leads within 2 working min`
              : undefined
          }
        />
      </div>
    </SectionCard>
  );
}

// --- 3. Funnels ---

function DeliveryFunnelCard({
  delivery,
  calls,
  goTab,
}: {
  delivery: CeoSections["delivery"];
  calls: CeoSections["calls"];
  goTab: GoTab;
}) {
  return (
    <SectionCard
      kicker="Last 7 days"
      title="Client delivery funnel"
      section={delivery}
      alsoReads={[calls]}
      actions={<TabLink tab="delivery" label="Delivery" goTab={goTab} />}
      order={3}
    >
      {d => {
        const c = calls?.payload?.last7 ?? null;
        const steps: FunnelStep[] = [
          { label: "Leads", value: d.last7.leads },
          // Several dials per lead is normal, so leads to dials is not a conversion.
          {
            label: "Actual calls",
            value: c?.providerDials ?? null,
            skipRate: true,
          },
          { label: "Connected", value: c?.connected ?? null },
          {
            label: "Bookings",
            value: d.last7.bookings,
            // Delivery uses appointment date, so this is not a call conversion.
            skipRate: true,
          },
        ];
        return (
          <>
            <FunnelStrip
              steps={steps}
              ariaLabel="Client delivery funnel, last 7 days"
              context={[
                {
                  label: "Client ad spend",
                  value: <Value value={f.money(d.last7.spend)} />,
                },
                {
                  label: "Cost per lead",
                  value: <GateValue value={d.last7.cpl} gate={d.gates.cpl} />,
                },
                {
                  label: "Cost per booking",
                  value: <GateValue value={d.last7.cpb} gate={d.gates.cpb} />,
                },
              ]}
            />
            {c ? (
              <details className="mt-4 text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none hover:text-foreground">
                  How this is counted
                </summary>
                <p className="mt-2 leading-relaxed">
                  Actual calls and connections use the shared call center
                  report. Delivery bookings use appointment date, so these steps
                  are separate activity counts rather than a lead conversion
                  funnel.
                </p>
              </details>
            ) : null}
          </>
        );
      }}
    </SectionCard>
  );
}

function GrowthFunnelCard({
  section,
  goTab,
}: {
  section: CeoSections["growth"];
  goTab: GoTab;
}) {
  return (
    <SectionCard
      kicker="Month to date"
      title="Mahara growth funnel"
      section={section}
      notes={growthCardWarnings(section?.payload?.notes)}
      actions={<TabLink tab="frontend" label="Frontend" goTab={goTab} />}
      order={4}
    >
      {g => {
        const w = g.windows.mtd;
        const steps: FunnelStep[] = [
          { label: "Leads", value: w.leads },
          { label: "Intros booked", value: w.introsBooked },
          // The dashboard's own rates: intro to demo on intros shown, show rate
          // on demos that were due rather than every booking.
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
        ];
        return (
          <FunnelStrip
            steps={steps}
            ariaLabel="Mahara growth funnel, month to date"
            context={[
              {
                label: "Lead-gen ad spend",
                value: <Value value={f.money(w.spend)} />,
              },
              {
                label: "Cost per lead",
                value: <Value value={f.money(w.cpl)} />,
              },
              // Closer form only; the cash card's contracted figure also adds
              // deal values logged by hand, so the two can differ.
              {
                label: "Contracted, closer form",
                value: <Value value={f.money(w.contracted)} />,
              },
              // What the closer typed at signing, not the cash collected above.
              {
                label: "Cash typed on the form",
                value: <Value value={f.money(w.cash)} />,
              },
            ]}
          />
        );
      }}
    </SectionCard>
  );
}

// --- 4. Left column: clients ---

const RISK: Record<
  ClientRow["risk"]["level"],
  { tone: StatusTone; label: string }
> = {
  high: { tone: "serious", label: "High risk" },
  medium: { tone: "warning", label: "Medium risk" },
  low: { tone: "neutral", label: "Low risk" },
};

function ClientsCard({
  section,
  goTab,
}: {
  section: CeoSections["clients"];
  goTab: GoTab;
}) {
  return (
    <SectionCard
      kicker="Right now"
      title="Clients that need you"
      section={section}
      notes={warnings(section?.payload?.notes)}
      actions={
        <TabLink tab="client-success" label="Client success" goTab={goTab} />
      }
      order={5}
    >
      {p => {
        const live = p.rows.filter(
          r => r.bucket === "active" || r.bucket === "onboarding",
        );
        const high = live.filter(r => r.risk.level === "high").length;
        const medium = live.filter(r => r.risk.level === "medium").length;
        const top = p.atRisk.filter(r => r.risk.level !== "low").slice(0, 5);
        const more = high + medium - top.length;

        if (top.length === 0)
          return (
            <EmptyState
              icon={CircleCheck}
              title="No client is at high or medium risk"
              text={`Across ${f.plural(live.length, "active or onboarding client", "active and onboarding clients")}.`}
              compact
            />
          );

        return (
          <>
            <p className="text-xs text-muted-foreground">
              {[
                high ? `${f.count(high)} at high risk` : null,
                medium ? `${f.count(medium)} at medium risk` : null,
              ]
                .filter(Boolean)
                .join(" and ")}{" "}
              across{" "}
              {f.plural(
                live.length,
                "active or onboarding client",
                "active and onboarding clients",
              )}
            </p>
            <ul className="mt-3">
              {top.map(r => (
                <ClientRiskRow key={r.clickupTaskId || r.name} row={r} />
              ))}
            </ul>
            {/* The header link already opens Client success, so the rest is a
                count, not a second link to the same place. */}
            {more > 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {f.plural(more, "more client")} at risk on Client success
              </p>
            ) : null}
          </>
        );
      }}
    </SectionCard>
  );
}

function ClientRiskRow({ row }: { row: ClientRow }) {
  const risk = RISK[row.risk.level];
  const meta = [row.stage, row.csm ? `${row.csm} (CSM)` : "No CSM"]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="border-b border-[color:var(--ceo-grid)] py-3 first:pt-0 last:border-0 last:pb-0">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          {row.clickupTaskId ? (
            <a
              href={`https://app.clickup.com/t/${encodeURIComponent(row.clickupTaskId)}`}
              target="_blank"
              rel="noreferrer"
              title={`Open ${row.name} in ClickUp`}
              className="group/link flex min-w-0 items-center gap-1 rounded-sm text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate" dir="auto">
                {row.name}
              </span>
              <ArrowUpRight
                className="size-3.5 shrink-0 text-muted-foreground group-hover/link:text-foreground"
                aria-hidden
              />
            </a>
          ) : (
            <p
              className="truncate text-sm font-medium text-foreground"
              dir="auto"
            >
              {row.name}
            </p>
          )}
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {meta}
          </p>
        </div>
        <StatusChip
          tone={risk.tone}
          label={risk.label}
          hint={`${f.plural(row.risk.score, "risk point")}`}
        />
      </div>
      {row.risk.reasons.length ? (
        <ul
          className="mt-2 flex flex-wrap gap-1.5"
          aria-label={`Why ${row.name} is at risk`}
        >
          {row.risk.reasons.map(reason => (
            <li
              key={reason}
              className="rounded-md bg-muted px-1.5 py-0.5 text-xs leading-4 text-foreground/80"
            >
              {f.capitalize(reason)}
            </li>
          ))}
        </ul>
      ) : null}
      {row.latestUpdate ? (
        <p className="mt-2 flex min-w-0 gap-1.5 text-xs leading-5 text-muted-foreground">
          <MessageSquare className="mt-[3px] size-3.5 shrink-0" aria-hidden />
          <span className="line-clamp-2 min-w-0">{row.latestUpdate}</span>
        </p>
      ) : null}
    </li>
  );
}

type DeliveryClient = DeliveryPayload["clients"][number];

const DELIVERY_STATUS: Record<
  DeliveryClient["status"],
  { tone: StatusTone; label: string }
> = {
  bad: { tone: "serious", label: "Off track" },
  watch: { tone: "warning", label: "Watch" },
  good: { tone: "good", label: "On track" },
  "no-data": { tone: "neutral", label: "No data" },
};

const statusOf = (r: DeliveryClient) =>
  DELIVERY_STATUS[r.status] ?? DELIVERY_STATUS["no-data"];

// The status rides as an icon before the name so the compact table fits a half-width card; the legend under it names each icon.
const DELIVERY_COLUMNS: Column<DeliveryClient>[] = [
  {
    key: "client",
    header: "Client",
    cell: r => {
      const s = statusOf(r);
      const Icon = TONE_ICON[s.tone];
      return (
        <span className="flex min-w-0 items-center gap-2" title={s.label}>
          <Icon
            className="size-3.5 shrink-0"
            style={{ color: STATUS_COLOR[s.tone] }}
            aria-hidden
          />
          <span className="sr-only">{s.label}:</span>
          <span
            className="min-w-0 truncate font-medium text-foreground"
            title={r.client}
          >
            {r.client}
          </span>
        </span>
      );
    },
    sortValue: r => r.client,
    // Width 100% with max-width 0 lets the name take whatever the numbers leave and truncate there.
    className: "w-full max-w-0",
  },
  {
    key: "spend",
    header: "Spend",
    numeric: true,
    cell: r => f.money(r.spend7d),
    sortValue: r => r.spend7d,
  },
  {
    key: "leads",
    header: "Leads",
    numeric: true,
    hideBelow: "sm",
    cell: r => f.count(r.leads7d),
    sortValue: r => r.leads7d,
  },
  {
    key: "cpl",
    header: "CPL",
    numeric: true,
    cell: r => <Value value={f.money(r.cpl7d)} />,
    sortValue: r => r.cpl7d,
  },
  {
    key: "bookings",
    header: "Bookings",
    numeric: true,
    hideBelow: "sm",
    cell: r => f.count(r.bookings7d),
    sortValue: r => r.bookings7d,
  },
];

function DeliveryByClientCard({
  section,
  goTab,
}: {
  section: CeoSections["delivery"];
  goTab: GoTab;
}) {
  return (
    <SectionCard
      kicker="Last 7 days"
      title="Delivery by client"
      section={section}
      actions={<TabLink tab="delivery" label="Delivery" goTab={goTab} />}
      order={6}
    >
      {d => {
        const rows = [...d.clients]
          .sort((a, b) => b.spend7d - a.spend7d)
          .slice(0, 8);
        const shown = (
          Object.keys(DELIVERY_STATUS) as DeliveryClient["status"][]
        ).filter(k => rows.some(r => r.status === k));
        return (
          <>
            <DataTable
              rows={rows}
              columns={DELIVERY_COLUMNS}
              rowKey={r => r.clickupTaskId ?? r.client}
              caption="Top clients by ad spend, last 7 days"
              emptyText="No client spent on ads in the last 7 days."
            />
            {rows.length ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <ul
                  className="flex flex-wrap items-center gap-x-3 gap-y-1"
                  aria-label="Status key"
                >
                  {shown.map(k => {
                    const s = DELIVERY_STATUS[k];
                    const Icon = TONE_ICON[s.tone];
                    return (
                      <li key={k} className="inline-flex items-center gap-1">
                        <Icon
                          className="size-3 shrink-0"
                          style={{ color: STATUS_COLOR[s.tone] }}
                          aria-hidden
                        />
                        {s.label}
                      </li>
                    );
                  })}
                </ul>
                {d.clients.length > rows.length ? (
                  <span>
                    Top {f.count(rows.length)} of{" "}
                    {f.plural(d.clients.length, "client")} by spend
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        );
      }}
    </SectionCard>
  );
}

// --- 4. Right column: team ---

function LiveFeedCard({
  section,
  now,
  goTab,
}: {
  section: CeoSections["team"];
  now: number;
  goTab: GoTab;
}) {
  return (
    <SectionCard
      kicker="Newest first"
      title="Live feed"
      section={section}
      notes={warnings(section?.payload?.notes)}
      actions={<TabLink tab="management" label="Management" goTab={goTab} />}
      order={5}
    >
      {t => (
        <FeedList
          items={t.feed}
          now={now}
          limit={15}
          emptyText="No team activity yet."
        />
      )}
    </SectionCard>
  );
}

const EOD: Record<
  TeamPerson["eodYesterday"],
  { tone: StatusTone; label: string; rank: number }
> = {
  missed: { tone: "serious", label: "EOD missed", rank: 0 },
  late: { tone: "warning", label: "EOD late", rank: 1 },
  "on time": { tone: "good", label: "EOD on time", rank: 2 },
  "not due": { tone: "neutral", label: "No EOD due", rank: 3 },
};

function TeamTodayCard({
  section,
  now,
  today,
}: {
  section: CeoSections["team"];
  now: number;
  today: string;
}) {
  // The Management switch's live statuses, laid over the stored people so a
  // person set to Paused or Left leaves this card the moment it is saved,
  // the same as on the Management tab.
  const live = useLiveStatuses();
  return (
    // The Live feed above links to Management; one link to it is enough.
    <SectionCard title="Team today" section={section} order={6}>
      {t => {
        const roster = buildRoster(
          t.people,
          t.inactive ?? [],
          live.rows,
          today,
        );
        const active = roster.active;
        if (active.length === 0)
          return (
            <EmptyState
              title={
                roster.inactive.length
                  ? "Nobody active on the team list. Everyone listed is paused or left."
                  : "No team members on record yet."
              }
              compact
            />
          );
        const eodOf = (p: TeamPerson) => EOD[p.eodYesterday] ?? EOD["not due"];
        // Whoever missed or was late comes first, so the list reads as a to-do.
        const people = [...active].sort(
          (a, b) =>
            eodOf(a).rank - eodOf(b).rank || a.name.localeCompare(b.name),
        );
        const tally = (k: TeamPerson["eodYesterday"]) =>
          active.filter(p => p.eodYesterday === k).length;
        const summary = [
          tally("on time") ? `${f.count(tally("on time"))} on time` : null,
          tally("late") ? `${f.count(tally("late"))} late` : null,
          tally("missed") ? `${f.count(tally("missed"))} missed` : null,
        ].filter(Boolean);
        return (
          <>
            <p className="text-xs text-muted-foreground">
              {summary.length
                ? `EOD reports yesterday: ${summary.join(", ")}`
                : "No EOD reports were due yesterday"}
            </p>
            <ul className="mt-3">
              {people.map(p => {
                const eod = eodOf(p);
                return (
                  <li
                    key={p.key}
                    className="flex min-w-0 items-start justify-between gap-3 border-b border-[color:var(--ceo-grid)] py-2.5 first:pt-0 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {p.name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[
                          p.role,
                          f.isNum(p.lastActiveAt)
                            ? `active ${f.relative(p.lastActiveAt, now)}`
                            : "no recent activity",
                          p.actionsToday > 0
                            ? `${f.plural(p.actionsToday, "action")} today`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <StatusChip
                      tone={eod.tone}
                      label={eod.label}
                      hint={`${f.count(p.eod14.filed)} of ${f.count(p.eod14.due)} filed in 14 days, ${f.count(p.eod14.late)} late`}
                    />
                  </li>
                );
              })}
            </ul>
          </>
        );
      }}
    </SectionCard>
  );
}

// --- 5. Machine line ---

/**
 * The machine in one line, and only when something is wrong. The page header
 * already says when the numbers were computed, how many sources are stale
 * and whether Hermes is failing; this line names what the header cannot:
 * which jobs, data sources and outside feeds are failing, and a slow sync.
 * The whole picture is on the Machine tab, one tap away.
 */
function MachineLine({
  section,
  goTab,
}: {
  section: CeoSections["machine"];
  goTab: GoTab;
}) {
  const m = section?.payload ?? null;
  if (!m) return null;
  // The Machine tab's rules, so this line never disagrees with the tab it opens.
  const sync = syncState(m.syncAgeMin, syncEvery(m));
  const badFeeds = m.feeds.filter(feed => !feed.ok);
  const counts: string[] = [];
  if (m.failingJobs > 0)
    counts.push(`${f.plural(m.failingJobs, "job")} failing`);
  if (m.staleJobs > 0) counts.push(`${f.plural(m.staleJobs, "job")} overdue`);
  if (m.failingSources > 0)
    counts.push(`${f.plural(m.failingSources, "data source")} failing`);
  if (badFeeds.length)
    counts.push(`${f.plural(badFeeds.length, "outside feed")} behind`);
  if (
    (sync.tone === "warning" || sync.tone === "serious") &&
    f.isNum(m.syncAgeMin)
  )
    counts.push(`last sync ${f.minutes(m.syncAgeMin)} ago`);
  if (counts.length === 0) return null;

  const names = [
    ...m.jobs.filter(j => !j.ok).map(j => jobName(j.job)),
    ...m.sources
      .filter(src => src.ok === false)
      .map(src => sourceLabel(src.source)),
    ...badFeeds.map(feed => feed.name),
  ];
  const tone: StatusTone =
    m.failingJobs > 0
      ? "critical"
      : m.failingSources > 0 ||
          sync.tone === "serious" ||
          badFeeds.some(feed => feedState(feed).tone === "serious")
        ? "serious"
        : "warning";
  const Icon = TONE_ICON[tone];
  const shown = names.slice(0, 4);

  return (
    <section
      aria-label="Machine"
      className="ceo-card flex min-w-0 items-start gap-3 rounded-2xl border bg-card px-4 py-3 sm:px-6"
    >
      <Icon
        className="mt-0.5 size-4 shrink-0"
        style={{ color: STATUS_COLOR[tone] }}
        aria-hidden
      />
      <p className="min-w-0 flex-1 text-sm leading-5 text-foreground">
        {f.capitalize(counts.join(", "))}
        {shown.length ? (
          <span className="text-muted-foreground">
            {`: ${shown.join(", ")}${names.length > shown.length ? ` and ${f.count(names.length - shown.length)} more` : ""}`}
          </span>
        ) : null}
      </p>
      <TabLink tab="machine" label="Machine" goTab={goTab} />
    </section>
  );
}
