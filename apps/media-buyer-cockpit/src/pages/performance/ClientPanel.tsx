/**
 * One client, opened from the board: where its funnel breaks first, its
 * numbers against its targets, the appointments still waiting for an
 * outcome, every campaign's daily budget against what it spent, every
 * campaign, ad set and ad, and its levers.
 */
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { date, isNum, money, shortDate } from "@/components/ceo/format";
import { KICKER, Kicker } from "@/components/ceo/Kicker";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  type BudgetCampaign,
  type Budgets,
  type Cell,
  type ClientPage,
  type ClientRow,
  type Metrics,
  type NoOutcomeAppointment,
  rangeLabel,
  type Targets,
  type TreeAd,
  type TreeAdSet,
  type TreeCampaign,
  useClientPage,
} from "@/lib/boardClient";
import {
  type BoardColumn,
  BUDGET_COLUMNS,
  budgetYesterdayWords,
  COLUMNS,
  columnOf,
  firstBreak,
  formatValue,
  GROUPS,
  noOutcomeWords,
  statusOf,
  targetText,
  targetUnit,
} from "@/lib/boardColumns";
import { cn } from "@/lib/utils";
import { clientTarget, FirstBreakLine } from "./BoardGrid";
import {
  BoardDot,
  CellContent,
  CellHelp,
  callerLine,
  HelpCell,
  RetentionBars,
  retentionWords,
} from "./cells";
import { LeverForm, LeverList } from "./Levers";

const SHOW_FIRST = 5;

/** A part of the panel: a heading with its count and one grey line. */
function Part({
  id,
  title,
  count,
  lede,
  children,
}: {
  id: string;
  title: string;
  count?: number | null;
  lede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="border-t px-5 py-6 sm:px-6">
      <h3
        id={id}
        className="flex items-baseline gap-2 text-[15px] font-semibold"
      >
        {title}
        {isNum(count) ? (
          <span className="text-sm font-normal tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
      </h3>
      {lede ? (
        <p className="mt-1 text-[13px] text-muted-foreground">{lede}</p>
      ) : null}
      <div className="@container mt-4">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Numbers against targets.

function NumberRow({
  row,
  column,
  targets,
}: {
  row: ClientRow;
  column: BoardColumn;
  targets: Targets;
}) {
  const target = column.metric
    ? clientTarget(row, column.metric, targets)
    : null;
  if (column.special === "caller") return null;
  if (column.special === "retention") {
    const words = retentionWords(row.values);
    return (
      <li className="flex items-center justify-between gap-3 py-2">
        <span className="min-w-0 text-[13px] text-muted-foreground">
          {column.name}
        </span>
        <HelpCell
          label={`${column.name}: ${words ?? "n/a"}`}
          help={
            <CellHelp
              column={column}
              cell={row.values.retention50}
              extra={words}
            />
          }
        >
          <RetentionBars values={row.values} />
        </HelpCell>
      </li>
    );
  }
  const cell: Cell | undefined =
    column.key === "noOutcome"
      ? (row.values.noOutcome ?? { v: row.noOutcome ?? null, status: null })
      : row.values[column.key];
  const dot = column.dotFrom ? statusOf(row.values[column.dotFrom]) : undefined;
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block text-[13px] text-foreground">{column.name}</span>
        {target && isNum(target.good) ? (
          <span className="block text-[11px] leading-4 text-muted-foreground">
            {column.dotFrom ? "As a share of meetings due: " : ""}
            {column.dotFrom
              ? targetText(target, targetUnit(target)).replace(/^G/, "g")
              : targetText(target, targetUnit(target))}
            {target.source === "client" ? " This client's own." : ""}
          </span>
        ) : null}
      </span>
      <HelpCell
        label={`${column.name}`}
        className="shrink-0 text-[13px]"
        help={
          <CellHelp
            column={column}
            cell={cell}
            target={target}
            status={dot}
            extra={
              column.key === "noOutcome"
                ? noOutcomeWords(row)
                : column.key === "budgetUsed"
                  ? budgetYesterdayWords(cell)
                  : null
            }
          />
        }
      >
        <CellContent cell={cell} unit={column.unit} dot={dot} />
      </HelpCell>
    </li>
  );
}

function Numbers({ row, targets }: { row: ClientRow; targets: Targets }) {
  return (
    <div className="grid gap-x-8 gap-y-5 @xl:grid-cols-2">
      {GROUPS.filter(g => g.key !== "client").map(g => (
        <div key={g.key} className="min-w-0">
          <h4 className={KICKER}>{g.label}</h4>
          <ul className="mt-1 divide-y divide-[color:var(--ceo-grid)]">
            {COLUMNS.filter(c => c.group === g.key).map(c => (
              <NumberRow key={c.key} row={row} column={c} targets={targets} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appointments with no outcome.

const CALENDAR: Record<string, string> = {
  main: "Main calendar",
  online: "Online calendar",
  provisional: "Not confirmed",
};

function NoOutcomeList({ page, today }: { page: ClientPage; today: string }) {
  const [all, setAll] = useState(false);
  const list = page.noOutcomeAppointments;
  const note = page.noOutcomeCheck?.note;
  if (!list.length)
    return (
      <div className="space-y-2">
        <p className="text-[13px]">
          Every appointment due in this time frame has an outcome.
        </p>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
    );
  const shown = all ? list : list.slice(0, SHOW_FIRST);
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-[color:var(--ceo-grid)] rounded-xl bg-muted/40">
        {shown.map(a => (
          <NoOutcomeItem key={a.appointmentId} a={a} today={today} />
        ))}
      </ul>
      {list.length > SHOW_FIRST ? (
        <button
          type="button"
          onClick={() => setAll(v => !v)}
          aria-expanded={all}
          className="rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {all ? "Show fewer" : `Show the other ${list.length - SHOW_FIRST}`}
        </button>
      ) : null}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/**
 * "Booked by Dana Yousef", "Booked by the lead": a person's name as it is,
 * the database's "The lead", "The AI assistant" and "Someone in GoHighLevel"
 * in lower case mid-sentence.
 */
function bookedByWords(b: { name: string; how?: string | null }): string {
  const person = b.how === "The call centre";
  const name = person
    ? b.name
    : b.name.charAt(0).toLowerCase() + b.name.slice(1);
  return `Booked by ${name}`;
}

/** "1 lead", "3 leads"; words, never a number, when it was not measured. */
function countWords(
  v: number | null | undefined,
  one: string,
  many: string,
): string {
  if (!isNum(v)) return `${many} not measured`;
  return `${formatValue(v, "count")} ${v === 1 ? one : many}`;
}

function NoOutcomeItem({
  a,
  today,
}: {
  a: NoOutcomeAppointment;
  today: string;
}) {
  const days = isNum(a.daysSince)
    ? a.daysSince === 0
      ? "today"
      : a.daysSince === 1
        ? "1 day ago"
        : `${a.daysSince} days ago`
    : null;
  const ad = a.adName ?? (a.adId ? `Ad ${a.adId}` : "No ad on the lead");
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-[13px] font-medium tabular-nums">
          {a.meetingDay ? date(a.meetingDay) : "No date"}
          {a.meetingTime ? `, ${a.meetingTime}` : ""}
          <span className="font-normal text-muted-foreground">
            {" "}
            · {a.firstName || "No name"}
          </span>
        </p>
        <p className="truncate text-xs text-muted-foreground" dir="auto">
          {ad}
        </p>
        <p className="text-xs text-muted-foreground">
          {[
            a.calendar
              ? (CALENDAR[a.calendar] ?? a.calendarName)
              : a.calendarName,
            a.bookedBy ? bookedByWords(a.bookedBy) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {days ? (
          <span
            className="text-xs tabular-nums text-muted-foreground"
            title={`Today is ${today}`}
          >
            {days}
          </span>
        ) : null}
        {a.contactUrl ? (
          <a
            href={a.contactUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open in GoHighLevel
            <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Budget and spend (2026-10-17): every campaign switched on now, its daily
// budget against what it spent (one that spent nothing too: the tree lists
// only campaigns with ad numbers), and each account's billing and spending
// limit. The figures and the words are the database's.

/** An amount in the account's own currency: "$140", "140 SAR". */
function amount(
  v: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (!isNum(v)) return "not known";
  if (!currency || currency === "USD") return money(v);
  return `${Math.round(v).toLocaleString("en")} ${currency}`;
}

/** Each account in a sentence: its Meta status, and its spending limit when one is set. */
function accountWords(b: Budgets): string | null {
  const said = b.account.map(a => {
    const name = a.name ?? `Ad account ${a.accountId}`;
    const limit = a.spendingLimit;
    const status = (a.status ?? "Status not known").toLowerCase();
    if (!limit || !isNum(limit.left)) return `${name}: ${status}.`;
    const days = isNum(limit.daysLeft)
      ? limit.daysLeft < 1
        ? ", under one day of budget"
        : `, about ${limit.daysLeft === 1 ? "1 day" : `${limit.daysLeft} days`} of budget`
      : "";
    return `${name}: ${status}; ${amount(limit.left, a.currency)} left of its spending limit${days}.`;
  });
  return said.length ? said.join(" ") : null;
}

/** "Campaign budget", "Ad set budgets, 2 on". */
function budgetLevelWords(c: BudgetCampaign): string {
  if (c.budgetLevel === "campaign") return "Campaign budget";
  if (c.budgetLevel === "adset")
    return isNum(c.adsets) && c.adsets > 0
      ? `Ad set budgets, ${c.adsets} on`
      : "Ad set budgets";
  return c.whyNot ?? "Budget not read yet";
}

function BudgetRow({
  campaign,
  targets,
}: {
  campaign: BudgetCampaign;
  targets: Targets;
}) {
  const flag = campaign.flag;
  const flagStatus =
    flag?.status === "off" || flag?.status === "watch" ? flag.status : null;
  return (
    <tr data-budget-row={campaign.id}>
      <th
        scope="row"
        className="sticky left-0 z-[1] border-b border-[color:var(--ceo-grid)] bg-background py-2 pr-3 pl-5 text-left align-top font-normal sm:pl-6"
      >
        <span className="block w-[184px] sm:w-[244px]">
          <span className="block truncate font-medium" dir="auto">
            {campaign.name ?? `Campaign ${campaign.id}`}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {budgetLevelWords(campaign)}
          </span>
          {flag?.words ? (
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-4">
              <BoardDot status={flagStatus} />
              <span className="min-w-0">{flag.words}</span>
            </span>
          ) : null}
        </span>
      </th>
      {BUDGET_COLUMNS.map(c => {
        const cell = campaign.metrics[c.key];
        const target = c.metric ? targets[c.metric] : null;
        return (
          <td
            key={c.key}
            className="border-b border-[color:var(--ceo-grid)] px-3 py-2 text-right align-top"
          >
            <HelpCell
              label={c.name}
              help={<CellHelp column={c} cell={cell} target={target} />}
            >
              <CellContent cell={cell} unit={c.unit} />
            </HelpCell>
          </td>
        );
      })}
    </tr>
  );
}

function BudgetPart({
  budgets,
  row,
  targets,
  canLever,
  onLever,
}: {
  budgets: Budgets;
  row: ClientRow | null;
  targets: Targets;
  canLever: boolean;
  onLever: () => void;
}) {
  const daily = budgets.campaigns.filter(c => c.budgetType !== "lifetime");
  const lifetime = budgets.campaigns.filter(c => c.budgetType === "lifetime");
  const paused = budgets.paused;
  const off = statusOf(row?.values.budgetUsed) === "off";
  return (
    <div className="space-y-4">
      {off && canLever ? (
        <div className="flex justify-end">
          <Button size="sm" variant="teal" onClick={onLever}>
            Add a lever for budget used
          </Button>
        </div>
      ) : null}
      {!budgets.campaigns.length ? (
        <EmptyState
          compact
          icon={CircleDashed}
          title={
            budgets.asOf
              ? "No campaign is switched on now"
              : "The budgets have not been read yet"
          }
          text={
            budgets.asOf
              ? "Nothing is set to spend on the linked ad accounts. Switch a campaign on in Ads Manager to see its budget here."
              : (budgets.note ??
                "Meta budgets are read every hour. Check again after the next read.")
          }
        />
      ) : null}
      {daily.length ? (
        <div className="-mx-5 overflow-x-auto sm:-mx-6">
          <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
            <caption className="sr-only">
              Every campaign switched on now: its daily budget and what it spent
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-[2] h-9 border-b bg-background pl-5 pr-3 text-left text-xs font-medium text-muted-foreground sm:pl-6"
                >
                  Campaign
                </th>
                {BUDGET_COLUMNS.map(c => (
                  <th
                    key={c.key}
                    scope="col"
                    title={c.name}
                    className="h-9 min-w-[84px] whitespace-nowrap border-b px-3 text-right text-xs font-medium text-muted-foreground last:pr-5 sm:last:pr-6"
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {daily.map(c => (
                <BudgetRow key={c.id} campaign={c} targets={targets} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {lifetime.length ? (
        <div className="rounded-xl bg-muted/40 p-4 text-[13px]">
          <p className="font-medium">On a lifetime budget</p>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {lifetime.map(c => (
              <li
                key={c.id}
                className="tabular-nums"
                data-budget-lifetime={c.id}
              >
                <span className="text-foreground" dir="auto">
                  {c.name ?? `Campaign ${c.id}`}
                </span>
                {c.lifetime
                  ? `: ${money(c.lifetime.remaining)} left of ${money(c.lifetime.budget)}${c.lifetime.endsOn ? `, ends ${shortDate(c.lifetime.endsOn)}` : ""}`
                  : ""}
                {c.delivering === false && c.whyNot ? `. ${c.whyNot}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            A lifetime budget has no daily figure, so it is left out of
            Budget/day and Budget used.
          </p>
        </div>
      ) : null}
      {paused && isNum(paused.campaigns) && paused.campaigns > 0 ? (
        <p className="text-[13px] text-muted-foreground tabular-nums">
          {paused.campaigns === 1
            ? "1 campaign switched off now"
            : `${paused.campaigns} campaigns switched off now`}{" "}
          spent {money(paused.spend)} in these days.
        </p>
      ) : null}
      {budgets.note && budgets.campaigns.length ? (
        <p className="text-xs text-muted-foreground">{budgets.note}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Campaigns, ad sets and ads.

const TREE_COLUMNS = [
  "spend",
  "impressions",
  "linkCtr",
  "cpm",
  "frequency",
  "metaLeads",
  "cpl",
  "crmLeads",
  "confirmedBookings",
  "costPerBooking",
  "shows",
  "hookRate",
  "holdRate",
  "retention50",
]
  .map(k => columnOf(k))
  .filter((c): c is BoardColumn => Boolean(c));

const TREE_LABEL: Record<string, string> = {
  confirmedBookings: "Bookings",
  metaLeads: "Form leads",
  costPerBooking: "Cost per booking",
};

function TreeCells({
  metrics,
  targets,
}: {
  metrics: Metrics;
  targets: Targets;
}) {
  return (
    <>
      {TREE_COLUMNS.map(c => {
        const target = c.metric ? targets[c.metric] : null;
        if (c.special === "retention") {
          const words = retentionWords(metrics);
          return (
            <td
              key={c.key}
              className="border-b border-[color:var(--ceo-grid)] px-3 py-2 text-right"
            >
              <HelpCell
                label={`Video retention: ${words ?? "n/a"}`}
                help={
                  <CellHelp
                    column={c}
                    cell={metrics.retention50}
                    extra={words}
                  />
                }
              >
                <RetentionBars values={metrics} />
              </HelpCell>
            </td>
          );
        }
        const cell = metrics[c.key];
        return (
          <td
            key={c.key}
            className="border-b border-[color:var(--ceo-grid)] px-3 py-2 text-right"
          >
            <HelpCell
              label={c.name}
              help={<CellHelp column={c} cell={cell} target={target} />}
            >
              <CellContent cell={cell} unit={c.unit} />
            </HelpCell>
          </td>
        );
      })}
    </>
  );
}

function TreeName({
  depth,
  name,
  sub,
  open,
  onToggle,
  count,
}: {
  depth: 0 | 1 | 2;
  name: string;
  sub?: string | null;
  open?: boolean;
  onToggle?: () => void;
  count?: number;
}) {
  const indent = depth === 0 ? "pl-4" : depth === 1 ? "pl-8" : "pl-12";
  const inner = (
    <>
      {onToggle ? (
        open ? (
          <ChevronDown
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        ) : (
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        )
      ) : (
        <span aria-hidden className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0">
        <span
          className={cn(
            "block truncate",
            depth === 0
              ? "font-medium"
              : depth === 1
                ? ""
                : "text-muted-foreground",
          )}
          dir="auto"
        >
          {name}
        </span>
        {sub ? (
          <span className="block truncate text-[11px] text-muted-foreground">
            {sub}
          </span>
        ) : null}
      </span>
    </>
  );
  return (
    <th
      scope="row"
      className={cn(
        "sticky left-0 z-[1] border-b border-[color:var(--ceo-grid)] bg-background py-2 pr-3 text-left font-normal",
        indent,
      )}
    >
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} the ${count ?? ""} ${depth === 0 ? "ad sets" : "ads"} in ${name}`}
          className="flex w-[200px] items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-[260px]"
        >
          {inner}
        </button>
      ) : (
        <span className="flex w-[200px] items-center gap-1.5 sm:w-[260px]">
          {inner}
        </span>
      )}
    </th>
  );
}

function CampaignRows({
  campaign,
  targets,
  openAll,
}: {
  campaign: TreeCampaign;
  targets: Targets;
  openAll: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [sets, setSets] = useState<Record<string, boolean>>({});
  const shown = open || openAll;
  return (
    <>
      <tr data-level="campaign">
        <TreeName
          depth={0}
          name={campaign.name ?? `Campaign ${campaign.id ?? ""}`}
          sub={objectiveWords(campaign.objective)}
          open={shown}
          onToggle={() => setOpen(v => !v)}
          count={campaign.adsets.length}
        />
        <TreeCells metrics={campaign.metrics} targets={targets} />
      </tr>
      {shown
        ? campaign.adsets.map((s: TreeAdSet, si) => {
            const key = s.id ?? `set-${si}`;
            const setOpen = sets[key] ?? openAll;
            return (
              <AdSetRows
                key={key}
                set={s}
                targets={targets}
                open={setOpen}
                onToggle={() => setSets(m => ({ ...m, [key]: !setOpen }))}
              />
            );
          })
        : null}
    </>
  );
}

function AdSetRows({
  set,
  targets,
  open,
  onToggle,
}: {
  set: TreeAdSet;
  targets: Targets;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr data-level="adset">
        <TreeName
          depth={1}
          name={set.name ?? `Ad set ${set.id ?? ""}`}
          sub={destinationWords(set.destination)}
          open={open}
          onToggle={onToggle}
          count={set.ads.length}
        />
        <TreeCells metrics={set.metrics} targets={targets} />
      </tr>
      {open
        ? set.ads.map((a: TreeAd) => (
            <tr key={a.id} data-level="ad">
              <TreeName depth={2} name={a.name ?? `Ad ${a.id}`} />
              <TreeCells metrics={a.metrics} targets={targets} />
            </tr>
          ))
        : null}
    </>
  );
}

function objectiveWords(o: string | null | undefined): string | null {
  if (!o) return null;
  const words: Record<string, string> = {
    OUTCOME_LEADS: "Leads",
    OUTCOME_ENGAGEMENT: "Engagement",
    OUTCOME_SALES: "Sales",
    OUTCOME_TRAFFIC: "Traffic",
    OUTCOME_AWARENESS: "Awareness",
  };
  return words[o] ?? o.replace(/^OUTCOME_/, "").toLowerCase();
}

function destinationWords(d: string | null | undefined): string | null {
  if (!d) return null;
  const words: Record<string, string> = {
    ON_AD: "Lead form",
    WHATSAPP: "WhatsApp",
    WEBSITE: "Website",
    MESSENGER: "Messenger",
    INSTAGRAM_DIRECT: "Instagram chat",
  };
  return words[d] ?? null;
}

function Tree({ page }: { page: ClientPage }) {
  const [openAll, setOpenAll] = useState(false);
  const cover = page.adCover?.state;
  const notInStore = page.notInStore ?? [];
  const noAd = page.noAd;
  const hasNoAd =
    noAd && ((noAd.crmLeads ?? 0) > 0 || (noAd.confirmedBookings ?? 0) > 0);
  const none = (
    <EmptyState
      compact
      icon={CircleDashed}
      title={
        cover === "no_account"
          ? "No Meta ad account is linked to this client"
          : "No ad delivered in these days"
      }
      text={
        cover === "no_account"
          ? "Ask the media buyer to link the client's Meta ad account; until then the ad numbers stay empty."
          : (page.adCover?.note ??
            "Choose a longer time frame to see earlier ads.")
      }
    />
  );
  if (!page.campaigns.length && !notInStore.length && !hasNoAd) return none;
  return (
    <div className="space-y-3">
      {!page.campaigns.length ? none : null}
      {page.campaigns.length ? (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setOpenAll(v => !v)}
              className="rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {openAll ? "Show ad sets only" : "Show every ad"}
            </button>
          </div>
          <div className="-mx-5 overflow-x-auto sm:-mx-6">
            <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
              <caption className="sr-only">Campaigns, ad sets and ads</caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-[2] h-9 border-b bg-background pl-5 pr-3 text-left text-xs font-medium text-muted-foreground sm:pl-6"
                  >
                    Campaign, ad set, ad
                  </th>
                  {TREE_COLUMNS.map(c => (
                    <th
                      key={c.key}
                      scope="col"
                      title={c.name}
                      className="h-9 min-w-[84px] whitespace-nowrap border-b px-3 text-right text-xs font-medium text-muted-foreground last:pr-5 sm:last:pr-6"
                    >
                      {TREE_LABEL[c.key] ?? c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.campaigns.map((c, ci) => (
                  <CampaignRows
                    key={c.id ?? `c-${ci}`}
                    campaign={c}
                    targets={page.targets}
                    openAll={openAll}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {notInStore.length || hasNoAd ? (
        <div className="rounded-xl bg-muted/40 p-4 text-[13px]">
          <p className="font-medium">CRM leads the tree cannot place</p>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {notInStore.map(x => (
              <li key={x.adId} className="tabular-nums">
                Ad {x.adId}, not in the Meta store:{" "}
                {countWords(x.crmLeads, "lead", "leads")},{" "}
                {countWords(x.confirmedBookings, "booking", "bookings")},{" "}
                {showsWords(x.shows)}
              </li>
            ))}
            {hasNoAd && noAd ? (
              <li className="tabular-nums">
                No ad on the lead: {countWords(noAd.crmLeads, "lead", "leads")},{" "}
                {countWords(noAd.confirmedBookings, "booking", "bookings")},{" "}
                {showsWords(noAd.shows)}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function showsWords(cell: Cell | null | undefined): string {
  if (!cell) return "shows not measured";
  if (statusOf(cell) === "not_filled_in") return "shows not filled in";
  if (!isNum(cell.v)) return "shows not measured";
  return `${formatValue(cell.v, "count")} ${cell.v === 1 ? "show" : "shows"}`;
}

// ---------------------------------------------------------------------------

export function ClientPanel({
  location,
  row,
  from,
  to,
  today,
  onOpenChange,
  onChanged,
  boardTargets,
}: {
  location: string | null;
  /** The board's row, shown at once while the client's page is read. */
  row: ClientRow | null;
  from: string;
  to: string;
  today: string;
  onOpenChange: (open: boolean) => void;
  /** A lever was filed: the board reads its counts again. */
  onChanged: () => void;
  /** The board's targets, shown until the client's own arrive. */
  boardTargets?: Targets | null;
}) {
  const page = useClientPage(location, from, to);
  const data =
    page.status === "ready"
      ? page.data
      : page.status === "error"
        ? page.data
        : undefined;
  const live = data?.client ?? row;
  const name = data?.clientName ?? row?.clientName ?? "Client";
  const targets = data?.targets ?? boardTargets ?? null;
  const [leverMetric, setLeverMetric] = useState<string | null>(null);
  const brk = live ? firstBreak(live) : null;
  const caller = live ? callerLine(live) : null;
  const clickup = data?.clickupId ?? row?.clickupId ?? null;
  // Another client: its own lever form, closed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the client is the trigger
  useEffect(() => {
    setLeverMetric(null);
  }, [location]);
  // "Add a lever for ..." at the top opens the form at the foot: bring it into view.
  useEffect(() => {
    if (leverMetric)
      document
        .getElementById("board-panel-levers")
        ?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [leverMetric]);

  return (
    <Sheet open={Boolean(location)} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="ceo-root w-full gap-0 overflow-y-auto p-0 sm:max-w-[960px]"
      >
        <header className="sticky top-0 z-10 border-b bg-background/95 px-5 py-4 pr-12 backdrop-blur sm:px-6">
          <Kicker>Client</Kicker>
          <SheetTitle
            className="mt-1 truncate text-left text-lg font-semibold tracking-tight"
            dir="auto"
          >
            {name}
          </SheetTitle>
          <SheetDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{rangeLabel(from, to, today)}</span>
            {live?.serviceMode ? (
              <span>
                ·{" "}
                {live.serviceMode === "DWY" ? "Done with you" : "Done for you"}
              </span>
            ) : null}
            {caller ? <span>· Caller: {caller.text}</span> : null}
            {clickup ? (
              <a
                href={`https://app.clickup.com/t/${clickup}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-4 hover:underline"
              >
                · Client card
                <ArrowUpRight aria-hidden className="size-3" />
              </a>
            ) : null}
          </SheetDescription>
        </header>

        {live ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
            <p className="flex min-w-0 items-center gap-2 text-sm">
              <span className="text-muted-foreground">Funnel:</span>
              <FirstBreakLine
                row={live}
                className="text-sm [&>span:last-child]:text-foreground"
              />
            </p>
            {brk && (brk.kind === "off" || brk.kind === "watch") && clickup ? (
              <Button
                size="sm"
                variant="teal"
                onClick={() => setLeverMetric(brk.metric)}
              >
                Add a lever for {brk.label}
              </Button>
            ) : null}
          </div>
        ) : null}

        {page.status === "error" ? (
          <div
            className="mx-5 mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ceo-stale sm:mx-6"
            role="alert"
          >
            <TriangleAlert
              aria-hidden
              className="mt-0.5 size-3.5 shrink-0"
              style={{ color: "var(--ceo-warning)" }}
            />
            <span className="min-w-0 flex-1">{page.message}</span>
            <button
              type="button"
              onClick={page.reload}
              className="font-medium underline-offset-4 hover:underline"
            >
              Try again
            </button>
          </div>
        ) : null}

        {live && (targets || row) ? (
          <Part
            id="board-panel-numbers"
            title="Numbers against targets"
            lede={
              live.notes?.length
                ? live.notes.join(" ")
                : "Hover or tap a number for how it is worked out."
            }
          >
            <Numbers row={live} targets={targets ?? {}} />
          </Part>
        ) : null}

        {!data ? (
          // A failed read with nothing kept says so above, with Try again.
          page.status === "loading" || page.status === "idle" ? (
            <p className="flex items-center gap-2 border-t px-5 py-6 text-sm text-muted-foreground sm:px-6">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Reading the appointments, the ads and the levers
            </p>
          ) : null
        ) : (
          <>
            <Part
              id="board-panel-no-outcome"
              title="No outcome"
              count={data.noOutcomeAppointments.length}
              lede="Appointments due in this time frame with no showed or no-show mark yet, oldest first. Mark each one in GoHighLevel or ask the client."
            >
              <NoOutcomeList page={data} today={today} />
            </Part>
            {/* No ad account: the tree below says so once. */}
            {data.budgets?.account.length ? (
              <Part
                id="board-panel-budgets"
                title="Budget and spend"
                count={data.budgets.campaigns.length}
                lede={
                  accountWords(data.budgets) ??
                  "Every campaign switched on now, its daily budget against what it spent."
                }
              >
                <BudgetPart
                  budgets={data.budgets}
                  row={live}
                  targets={data.targets}
                  canLever={Boolean(clickup)}
                  onLever={() => setLeverMetric("budget_used")}
                />
              </Part>
            ) : null}
            <Part
              id="board-panel-tree"
              title="Campaigns, ad sets and ads"
              count={data.campaigns.length}
              lede={data.adWindow.note}
            >
              <Tree page={data} />
            </Part>
            <Part
              id="board-panel-levers"
              title="Levers"
              count={data.levers.length}
              lede="Each lever is a ClickUp task in the team that owns it, with a comment on the client's card."
            >
              <div className="space-y-5">
                <LeverList levers={data.levers} targets={data.targets} />
                {clickup ? (
                  <LeverForm
                    key={leverMetric ?? "lever"}
                    locationId={data.locationId}
                    clientName={data.clientName}
                    targets={data.targets}
                    initialMetric={leverMetric}
                    open={leverMetric !== null}
                    onOpenChange={o =>
                      setLeverMetric(
                        o
                          ? (leverMetric ??
                              (brk && "metric" in brk ? brk.metric : "cpl"))
                          : null,
                      )
                    }
                    from={from}
                    to={to}
                    onFiled={() => {
                      page.reload();
                      onChanged();
                    }}
                  />
                ) : (
                  <p className="text-[13px] text-muted-foreground">
                    This client has no ClickUp card, so a lever cannot be filed.
                    Link the client's ClickUp card first.
                  </p>
                )}
              </div>
            </Part>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
