import {
  CalendarClock,
  CalendarSync,
  Clock3,
  MessageSquare,
  MonitorSmartphone,
  Rocket,
  ShieldCheck,
  UserMinus,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { BarList } from "@/components/ceo/BarList";
import { type Column, DataTable } from "@/components/ceo/DataTable";
import { EmptyState } from "@/components/ceo/EmptyState";
import { FilterChips, type FilterOption } from "@/components/ceo/FilterChips";
import {
  capitalize,
  count,
  date,
  dateTime,
  isNum,
  kuwaitDay,
  money,
  pct,
  plural,
  relative,
} from "@/components/ceo/format";
import { Hint } from "@/components/ceo/Hint";
import {
  CHURN_RULE,
  churnHeadline,
  isLiveClient,
} from "@/components/ceo/metrics";
import { Na, Value } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { ShowMore } from "@/components/ceo/ShowMore";
import { StatTile } from "@/components/ceo/StatTile";
import {
  gateLabel,
  gateTone,
  StatusChip,
  StatusDot,
  type StatusTone,
} from "@/components/ceo/StatusChip";
import { CPL_GATE } from "@/lib/kpi";
import { cn } from "@/lib/utils";
import type {
  ChurnClient,
  ClientRow,
  ClientsPayload,
  Note,
  PortalPayload,
  RenewalEvidence,
  TermClient,
} from "../../../convex/ceo/payloads";
import type { CeoTabProps } from "./types";

// --- Clients ---

type RiskLevel = ClientRow["risk"]["level"];

// Serious, not critical: the same tone as the Today card and the tab badge.
const RISK: Record<RiskLevel, { tone: StatusTone; label: string }> = {
  high: { tone: "serious", label: "High risk" },
  medium: { tone: "warning", label: "Medium risk" },
  low: { tone: "neutral", label: "Low risk" },
};

// Same tie-breaks as the backend's at-risk list: points, then longest silence.
const byRisk = (a: ClientRow, b: ClientRow) =>
  b.risk.score - a.risk.score ||
  (b.silentDays ?? -1) - (a.silentDays ?? -1) ||
  a.name.localeCompare(b.name);

const clickupUrl = (taskId: string) =>
  `https://app.clickup.com/t/${encodeURIComponent(taskId)}`;

const HINT = {
  silent: "The ClickUp card has no Last POC date, so silence cannot be judged",
  noCampaign: "No campaign on the ads board is matched to this client",
  noLeads: "No leads in the last 7 days, so there is no cost per lead",
  pulse: "Pulse health could not be read, or this client is not in Pulse",
  pulseNoData:
    "Pulse has no leads, bookings or spend for this client in the last 90 days",
  portal:
    "No unexpired portal session. Sessions expire after 30 to 90 days, so this means no visit in that time",
  csm: "No CSM on the ClickUp card",
  stage: "No stage on the ClickUp card",
  contact:
    "The ClickUp card has neither a Last POC nor a Last Call date, so there is no contact to date",
  payDate: "No Next Payment Date on the ClickUp card",
  paid: "The cockpit ties only some payments to a client, and only as renewal evidence for the churn card, so it cannot say whether this one was collected",
};

// Happiness is free text from the ClickUp card; the unhappy words match the risk rules.
function happinessTone(h: string | null): StatusTone | null {
  if (!h) return null;
  if (/unhappy|at risk|angry|upset|danger|churn|\bred\b/i.test(h))
    return "serious";
  if (/happy/i.test(h)) return "good";
  return null;
}

// 8 to 14 silent days is one risk point, over 14 is two.
function silentTone(days: number | null): StatusTone | null {
  if (!isNum(days)) return null;
  if (days > 14) return "serious";
  if (days >= 8) return "warning";
  return null;
}

function pulseTone(status: string | null): StatusTone | null {
  if (status === "bad") return "serious";
  if (status === "watch") return "warning";
  if (status === "good") return "good";
  return null;
}

const cplHint = (r: ClientRow) =>
  r.leads7d === 0 ? HINT.noLeads : HINT.noCampaign;

// --- Days, payments and signals ---

const DAY_MS = 86_400_000;

/** Epoch ms of a Kuwait day "YYYY-MM-DD", or null when it is not a day. */
function dayMs(day: string | null | undefined): number | null {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** Whole days from today to a day: negative is in the past, 0 is today. */
function daysFromToday(
  day: string | null | undefined,
  today: string,
): number | null {
  const a = dayMs(day);
  const b = dayMs(today);
  return a === null || b === null ? null : Math.round((a - b) / DAY_MS);
}

/** "today", "in 5 days", "5 days ago". */
function awayWords(days: number): string {
  if (days === 0) return "today";
  return days > 0 ? `in ${plural(days, "day")}` : `${plural(-days, "day")} ago`;
}

/**
 * Where a client's next payment date sits. `overdue` is a date the cockpit is
 * actually chasing (the risk score says so); `past` is a date that has gone by
 * on a client the sync does not chase, which is an extension on the card or a
 * paused, stopped or cancelled stage.
 */
type PayState = "overdue" | "past" | "soon" | "later" | "none";

const OVERDUE_REASON = /payment .*overdue/i;

const PAY: Record<PayState, { label: string; tone: StatusTone; hint: string }> =
  {
    overdue: {
      label: "Past due",
      tone: "serious",
      hint: "The date on the card has passed and the cockpit is counting it as overdue.",
    },
    past: {
      label: "Date passed",
      tone: "warning",
      hint: "The date on the card has passed but the cockpit is not chasing it: either an extension on the card moved it, or the stage is one the sync leaves alone (paused, stopped, cancelled).",
    },
    soon: {
      label: "Due soon",
      tone: "neutral",
      hint: "The next payment date on the card falls in the next 7 days.",
    },
    later: {
      label: "Later",
      tone: "neutral",
      hint: "The next payment date on the card is more than 7 days away.",
    },
    none: { label: "No date", tone: "neutral", hint: HINT.payDate },
  };

/** Sort order for the payment state column: the ones to act on first. */
const PAY_RANK: Record<PayState, number> = {
  overdue: 0,
  past: 1,
  soon: 2,
  later: 3,
  none: 4,
};

function paymentOf(
  r: ClientRow,
  today: string,
): { state: PayState; days: number | null } {
  const days = daysFromToday(r.paymentDue, today);
  if (days === null) return { state: "none", days: null };
  if (days < 0)
    return {
      state: r.risk.reasons.some(x => OVERDUE_REASON.test(x))
        ? "overdue"
        : "past",
      days,
    };
  return { state: days <= 7 ? "soon" : "later", days };
}

/** How long a client has been silent, in bands. */
type SilenceBand = "fresh" | "week" | "long" | "unknown";

function silenceBand(r: ClientRow): SilenceBand {
  if (!isNum(r.silentDays)) return "unknown";
  if (r.silentDays > 14) return "long";
  return r.silentDays >= 8 ? "week" : "fresh";
}

/** The risk reasons that say a client is talking about leaving. */
const SIGNAL_REASON = /^(happiness|defcon) /i;

const signalsOf = (r: ClientRow) =>
  r.risk.reasons.filter(x => SIGNAL_REASON.test(x));

const PORTAL_SEEN_DAYS = 30;

// --- Notes: each caveat beside the card it qualifies ---

type CardKey =
  | "book"
  | "risk"
  | "silence"
  | "payments"
  | "onboarding"
  | "terms"
  | "churn"
  | "roster"
  | "portal";

/**
 * Where each note from the clients payload belongs. A note can qualify more
 * than one card, and anything unmatched falls to the roster, so no caveat is
 * dropped.
 */
const NOTE_ROUTES: readonly (readonly [RegExp, CardKey[]])[] = [
  [
    /roster was last stored/i,
    ["book", "silence", "payments", "onboarding", "churn"],
  ],
  [/last poc date/i, ["silence"]],
  [/churn and renewals/i, ["terms"]],
  [/risk points/i, ["risk"]],
  [/portal/i, ["portal", "roster"]],
];

function routeNotes(notes: Note[] | null | undefined) {
  const out: Partial<Record<CardKey, Note[]>> = {};
  for (const note of notes ?? []) {
    const keys = NOTE_ROUTES.find(([re]) => re.test(note.text))?.[1] ?? [
      "roster",
    ];
    for (const key of keys) out[key] = [...(out[key] ?? []), note];
  }
  return out;
}

/** Caveats the screen owns: how this tab reads the rows, not what the source says. */
const OWN_NOTES: Record<CardKey, Note[]> = {
  book: [],
  risk: [
    {
      level: "info",
      text: "Every active and onboarding client on 3 or more risk points is here, not only the eight the backend picks. A churned client scores 0 by rule, so it never appears.",
    },
  ],
  silence: [
    {
      level: "info",
      text: "Silent days count from the Last POC date on the client card. Last contact is the later of Last POC and Last Call, so a client can have a newer call than the silence figure shows.",
    },
    {
      level: "info",
      text: "Both dates are typed on the card by hand, so this measures what was written down, not every message that was sent. Active and onboarding clients only.",
    },
  ],
  payments: [
    {
      level: "info",
      text: "This is the Next Payment Date field on the client card. It is not an invoice and not a payment: the cockpit ties only some payments to a client, as renewal evidence on the churn card, so it cannot say whether this money arrived. The date moves only when someone updates the card, and the card carries no amount, so there is no money figure here.",
    },
    {
      level: "info",
      text: "Past due counts the dates the cockpit is chasing. A date that has passed on a client with an extension on the card, or on a paused, stopped or cancelled stage, reads as date passed instead. Active and onboarding clients only.",
    },
  ],
  onboarding: [
    {
      level: "info",
      text: "Onboarding is the bucket the sync gives the card, with the stage name as the fallback, and the stages are the client card's own status field.",
    },
    {
      level: "info",
      text: "No stage carries a date in the client rows, so how long a client has been onboarding and how far it is from launch cannot be shown.",
    },
  ],
  terms: [],
  churn: [
    {
      level: "info",
      text: "Churned and paused here are the roster as it stands today, not a rate. The churn and renewals card above applies the churn rule, with dated losses.",
    },
    {
      level: "info",
      text: "A cancellation signal is an unhappy happiness value on the card or a DEFCON flag from the latest call notes. Both are set by the team by hand, so a quiet client with neither can still be about to leave.",
    },
  ],
  roster: [],
  portal: [
    {
      level: "info",
      text: "Portal use across the roster counts client cards, so it can differ from the portal's own figures above: the roster is the ClickUp client list and the portal keeps its own directory.",
    },
    {
      level: "info",
      text: "A client row carries the newest unexpired session only, and not whether that client has portal access at all, so never given access and session expired look the same here.",
    },
  ],
};

function cardNotes(
  routed: Partial<Record<CardKey, Note[]>>,
  key: CardKey,
): Note[] {
  return [...OWN_NOTES[key], ...(routed[key] ?? [])];
}

/**
 * The client success department: the book, who needs attention, silence and
 * last contact, payments on the card, the onboarding pipeline, churn signals,
 * the full roster, the client portal, and what has no source at all.
 */
export function ClientSuccessTab({ sections, now, day }: CeoTabProps) {
  const clients = sections.clients;
  const payload = clients?.payload ?? null;
  const portal = sections.portal;
  const today = day ?? kuwaitDay(now);
  const routed = useMemo(() => routeNotes(payload?.notes), [payload]);

  const portalCard = (
    <SectionCard
      kicker="Mahara OS, right now"
      title="Client portal"
      section={portal}
      alsoReads={payload ? [clients] : undefined}
      notes={[
        ...(portal?.payload?.notes ?? []),
        ...(payload ? cardNotes(routed, "portal") : []),
      ]}
      order={7}
    >
      {p => <Portal payload={p} rows={payload?.rows ?? null} now={now} />}
    </SectionCard>
  );

  // One empty state for the whole roster, not six stacked ones.
  if (!payload)
    return (
      <div className="grid gap-4 lg:gap-6">
        <SectionCard title="Clients" section={clients}>
          {() => null}
        </SectionCard>
        {portalCard}
        <NotMeasured order={8} />
      </div>
    );

  const live = payload.rows.filter(isLiveClient);
  const high = live.filter(r => r.risk.level === "high").length;
  const medium = live.filter(r => r.risk.level === "medium").length;
  const churnHead = churnHeadline(payload);

  return (
    <div className="grid gap-4 lg:gap-6">
      <SectionCard
        kicker="The roster right now"
        title={
          <>
            Client book
            <TitleNote>
              {plural(payload.counts.total, "client")} on the roster
            </TitleNote>
          </>
        }
        section={clients}
        notes={cardNotes(routed, "book")}
        order={0}
      >
        {p => <Book payload={p} high={high} medium={medium} />}
      </SectionCard>

      <SectionCard
        kicker="The roster right now"
        title={
          <>
            Clients that need you
            {high + medium > 0 ? (
              <TitleNote>
                {count(high)} high, {count(medium)} medium
              </TitleNote>
            ) : null}
          </>
        }
        section={clients}
        notes={cardNotes(routed, "risk")}
        order={1}
      >
        {p => <AtRisk rows={p.rows} />}
      </SectionCard>

      <SectionCard
        kicker="Days of silence counted to today"
        title={
          <>
            Silence and last contact
            <TitleNote>active and onboarding clients</TitleNote>
          </>
        }
        section={clients}
        notes={cardNotes(routed, "silence")}
        order={2}
      >
        {p => <Silence payload={p} />}
      </SectionCard>

      <SectionCard
        kicker="Next payment dates from today"
        title={
          <>
            Payments on the card
            <TitleNote>next payment date, not a payment record</TitleNote>
          </>
        }
        section={clients}
        notes={cardNotes(routed, "payments")}
        order={3}
      >
        {p => <Payments payload={p} today={today} />}
      </SectionCard>

      <SectionCard
        kicker="The roster right now"
        title={
          <>
            Onboarding pipeline
            <TitleNote>
              {plural(payload.counts.onboarding, "client")} onboarding
            </TitleNote>
          </>
        }
        section={clients}
        notes={cardNotes(routed, "onboarding")}
        order={4}
      >
        {p => <Onboarding payload={p} />}
      </SectionCard>

      <SectionCard
        kicker="Launched clients, this month and the 90 day term"
        title={
          <>
            Churn and renewals
            {churnHead.month ? (
              <TitleNote>{churnHead.month} so far</TitleNote>
            ) : null}
          </>
        }
        section={clients}
        notes={[...(payload.churn?.notes ?? []), ...cardNotes(routed, "terms")]}
        actions={
          churnHead.churn && churnHead.partial ? (
            <StatusChip
              tone="warning"
              label="Partial month"
              hint="The cockpit's own daily history does not cover the whole month yet, so a client that stopped earlier in the month can be missing. The notes under this card say which days."
            />
          ) : undefined
        }
        order={5}
      >
        {p => <ChurnRenewals payload={p} today={today} />}
      </SectionCard>

      <SectionCard
        kicker="The roster right now"
        title="Stopped, paused and cancellation signals"
        section={clients}
        notes={cardNotes(routed, "churn")}
        order={5}
      >
        {p => <Churn payload={p} />}
      </SectionCard>

      <SectionCard
        kicker="The roster right now"
        title="All clients"
        section={clients}
        notes={cardNotes(routed, "roster")}
        order={6}
      >
        {p => <Roster payload={p} now={now} today={today} />}
      </SectionCard>

      {portalCard}

      <NotMeasured order={8} />
    </div>
  );
}

function TitleNote({ children }: { children: ReactNode }) {
  return (
    <span className="ml-2 font-normal text-muted-foreground">{children}</span>
  );
}

function ClientName({
  row,
  className,
}: {
  row: Pick<ClientRow, "name" | "clickupTaskId">;
  className?: string;
}) {
  if (!row.clickupTaskId)
    return <span className={cn("text-foreground", className)}>{row.name}</span>;
  return (
    <a
      href={clickupUrl(row.clickupTaskId)}
      target="_blank"
      rel="noreferrer"
      title="Open the ClickUp card"
      className={cn(
        "rounded-sm text-foreground decoration-muted-foreground/40 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {row.name}
    </a>
  );
}

// --- Client book ---

function Book({
  payload,
  high,
  medium,
}: {
  payload: ClientsPayload;
  high: number;
  medium: number;
}) {
  const { counts } = payload;
  const share = (n: number) =>
    counts.total > 0 ? `${pct(n / counts.total)} of the roster` : undefined;
  const live = counts.active + counts.onboarding;
  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 @xl:grid-cols-3 @4xl:grid-cols-6">
        <StatTile
          variant="plain"
          label="Active"
          value={count(counts.active)}
          sub={share(counts.active)}
        />
        <StatTile
          variant="plain"
          label="Onboarding"
          value={count(counts.onboarding)}
          sub={share(counts.onboarding)}
        />
        <StatTile
          variant="plain"
          label="Paused"
          value={count(counts.paused)}
          sub={share(counts.paused)}
        />
        <StatTile
          variant="plain"
          label="Churned"
          value={count(counts.churned)}
          sub={share(counts.churned)}
        />
        <StatTile
          variant="plain"
          label="High risk"
          value={count(high)}
          sub={`of ${count(live)} active and onboarding`}
          hint="5 or more risk points. The point rules are listed under the roster."
        />
        <StatTile
          variant="plain"
          label="Medium risk"
          value={count(medium)}
          sub="3 to 4 risk points"
        />
      </div>
    </div>
  );
}

// --- Clients that need you ---

const AT_RISK_START = 6;

function AtRisk({ rows }: { rows: ClientRow[] }) {
  const [expanded, setExpanded] = useState(false);
  // All high and medium, not just the backend's top 8.
  const list = useMemo(
    () =>
      rows.filter(r => isLiveClient(r) && r.risk.level !== "low").sort(byRisk),
    [rows],
  );

  if (list.length === 0)
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No client is at high or medium risk"
        text="Every active and onboarding client scores under 3 risk points."
        compact
      />
    );

  const shown = expanded ? list : list.slice(0, AT_RISK_START);
  return (
    <div className="@container">
      <ul className="grid gap-3 @2xl:grid-cols-2 @6xl:grid-cols-3">
        {shown.map(r => (
          <RiskCard key={r.clickupTaskId || r.name} row={r} />
        ))}
      </ul>
      {list.length > AT_RISK_START ? (
        <ShowMore
          total={list.length}
          expanded={expanded}
          onToggle={() => setExpanded(e => !e)}
        />
      ) : null}
    </div>
  );
}

function RiskCard({ row }: { row: ClientRow }) {
  const { level, score, reasons } = row.risk;
  const meta = [row.stage, row.service, row.csm ? `CSM ${row.csm}` : null]
    .filter(Boolean)
    .join(" · ");
  const pulseScore = row.pulse?.score ?? null;
  return (
    <li className="flex min-w-0 flex-col rounded-lg border p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <ClientName
            row={row}
            className="block truncate text-sm font-semibold"
          />
          {meta ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {meta}
            </p>
          ) : null}
        </div>
        <StatusChip
          tone={RISK[level].tone}
          label={RISK[level].label}
          hint={plural(score, "risk point")}
        />
      </div>

      {reasons.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Reasons">
          {reasons.map(reason => (
            <li
              key={reason}
              className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] leading-4 text-foreground/85"
            >
              {capitalize(reason)}
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="mt-3 grid grid-cols-4 gap-2 border-t border-[color:var(--ceo-grid)] pt-3">
        <Mini
          label="Silent"
          value={isNum(row.silentDays) ? plural(row.silentDays, "day") : null}
          naHint={HINT.silent}
        />
        <Mini
          label="Leads 7d"
          value={isNum(row.leads7d) ? count(row.leads7d) : null}
          naHint={HINT.noCampaign}
        />
        <Mini
          label="CPL 7d"
          value={isNum(row.cpl7d) ? money(row.cpl7d) : null}
          naHint={cplHint(row)}
        />
        <Mini
          label="Pulse"
          value={isNum(pulseScore) ? count(pulseScore) : null}
          naHint={row.pulse ? HINT.pulseNoData : HINT.pulse}
        />
      </dl>

      {row.latestUpdate ? (
        <p className="mt-3 flex min-w-0 gap-2 text-xs leading-relaxed text-muted-foreground">
          <MessageSquare className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="line-clamp-3 min-w-0">
            <span className="sr-only">Latest update: </span>
            {row.latestUpdate}
          </span>
        </p>
      ) : null}
    </li>
  );
}

function Mini({
  label,
  value,
  naHint,
}: {
  label: string;
  value: string | null;
  naHint?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-medium text-foreground">
        <Value value={value} hint={naHint} />
      </dd>
    </div>
  );
}

// --- Roster ---

type RosterFilter =
  | "all"
  | "risk"
  | "active"
  | "onboarding"
  | "paused"
  | "churned";

function Roster({
  payload,
  now,
  today,
}: {
  payload: ClientsPayload;
  now: number;
  today: string;
}) {
  const [filter, setFilter] = useState<RosterFilter>("all");
  const { counts } = payload;

  const atRisk = useMemo(
    () => payload.rows.filter(r => isLiveClient(r) && r.risk.level !== "low"),
    [payload.rows],
  );
  const rows = useMemo(() => {
    if (filter === "all") return payload.rows;
    if (filter === "risk") return atRisk;
    return payload.rows.filter(r => r.bucket === filter);
  }, [payload.rows, atRisk, filter]);
  const columns = useMemo(() => rosterColumns(now, today), [now, today]);

  const options: FilterOption<RosterFilter>[] = [
    { key: "all", label: "All", count: payload.rows.length },
    { key: "risk", label: "At risk", count: atRisk.length },
    { key: "active", label: "Active", count: counts.active },
    { key: "onboarding", label: "Onboarding", count: counts.onboarding },
    { key: "paused", label: "Paused", count: counts.paused },
    { key: "churned", label: "Churned", count: counts.churned },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r, i) => r.clickupTaskId || `${r.name}-${i}`}
      search={{
        placeholder: "Search client, CSM or stage",
        text: r =>
          [r.name, r.csm, r.stage, r.service, r.happiness]
            .filter(Boolean)
            .join(" "),
      }}
      filters={
        <FilterChips
          options={options}
          value={filter}
          onChange={setFilter}
          ariaLabel="Show clients"
        />
      }
      stickyFirst
      caption="All clients with stage, CSM, health signals and risk"
      emptyText="No clients match"
    />
  );
}

function NumberWithDot({
  text,
  tone,
  label,
}: {
  text: string;
  tone: StatusTone | null;
  label: string;
}) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      {tone ? <StatusDot tone={tone} label={label} /> : null}
      {text}
    </span>
  );
}

function rosterColumns(now: number, today: string): Column<ClientRow>[] {
  return [
    {
      key: "name",
      header: "Client",
      cell: r => (
        <div className="min-w-0">
          <ClientName row={r} className="font-medium" />
          {r.service ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {r.service}
            </p>
          ) : null}
        </div>
      ),
      sortValue: r => r.name,
      className: "min-w-44 max-w-64",
    },
    {
      key: "risk",
      header: "Risk",
      cell: r => <RiskCell row={r} />,
      sortValue: r => r.risk.score,
    },
    {
      key: "stage",
      header: "Stage",
      cell: r =>
        r.stage ? (
          <span className="block min-w-28">{r.stage}</span>
        ) : (
          <Na hint={HINT.stage} />
        ),
      sortValue: r => r.stage,
    },
    {
      key: "term",
      header: "90 day term",
      hideBelow: "md",
      cell: r => <TermCell row={r} today={today} />,
      sortValue: r => (r.termState ? TERM_RANK[r.termState] : null),
    },
    {
      key: "csm",
      header: "CSM",
      cell: r => (r.csm ? r.csm : <Na hint={HINT.csm} />),
      sortValue: r => r.csm,
    },
    {
      key: "happiness",
      header: "Happiness",
      cell: r => {
        if (!r.happiness)
          return <span className="text-muted-foreground">Not set</span>;
        const tone = happinessTone(r.happiness);
        return (
          <span className="inline-flex min-w-28 items-center gap-1.5">
            {tone ? (
              <StatusDot
                tone={tone}
                label={tone === "good" ? "Happy" : "Unhappy"}
              />
            ) : null}
            {r.happiness}
          </span>
        );
      },
      sortValue: r => r.happiness,
    },
    {
      key: "silent",
      header: "Silent",
      numeric: true,
      cell: r => <SilentCell row={r} />,
      sortValue: r => r.silentDays,
    },
    {
      key: "contact",
      header: "Last contact",
      hideBelow: "lg",
      cell: r => <ContactCell row={r} />,
      sortValue: r => r.lastContactAt,
    },
    {
      key: "leads",
      header: "Leads 7d",
      numeric: true,
      cell: r =>
        isNum(r.leads7d) ? count(r.leads7d) : <Na hint={HINT.noCampaign} />,
      sortValue: r => r.leads7d,
    },
    {
      key: "cpl",
      header: "CPL 7d",
      numeric: true,
      cell: r => {
        if (!isNum(r.cpl7d)) return <Na hint={cplHint(r)} />;
        const tone = gateTone(r.cpl7d, CPL_GATE);
        return (
          <NumberWithDot
            text={money(r.cpl7d)}
            tone={tone === "good" || tone === "neutral" ? null : tone}
            label={gateLabel(tone, CPL_GATE)}
          />
        );
      },
      sortValue: r => r.cpl7d,
    },
    {
      key: "bookings",
      header: "Bookings 7d",
      numeric: true,
      cell: r =>
        isNum(r.bookings7d) ? (
          count(r.bookings7d)
        ) : (
          <Na hint={HINT.noCampaign} />
        ),
      sortValue: r => r.bookings7d,
    },
    {
      key: "pulse",
      header: "Pulse",
      numeric: true,
      cell: r => {
        const score = r.pulse?.score ?? null;
        if (!isNum(score))
          return <Na hint={r.pulse ? HINT.pulseNoData : HINT.pulse} />;
        const tone = pulseTone(r.pulse?.status ?? null);
        return (
          <NumberWithDot
            text={count(score)}
            tone={tone}
            label={`Pulse ${r.pulse?.status ?? ""}`}
          />
        );
      },
      sortValue: r => r.pulse?.score ?? null,
    },
    {
      key: "portal",
      header: "Portal seen",
      cell: r =>
        isNum(r.portalLastSeenAt) ? (
          <Hint content={dateTime(r.portalLastSeenAt, now)} side="left">
            <time
              dateTime={new Date(r.portalLastSeenAt).toISOString()}
              className="whitespace-nowrap tabular-nums"
            >
              {relative(r.portalLastSeenAt, now)}
            </time>
          </Hint>
        ) : (
          <Na hint={HINT.portal} />
        ),
      sortValue: r => r.portalLastSeenAt,
    },
    {
      key: "payment",
      header: "Next payment",
      hideBelow: "lg",
      cell: r => <PaymentCell row={r} today={today} />,
      sortValue: r => dayMs(r.paymentDue),
    },
  ];
}

function RiskCell({ row }: { row: ClientRow }) {
  const { level, score, reasons } = row.risk;
  const why = reasons.length
    ? `${plural(score, "point")}: ${reasons.join(", ")}`
    : undefined;
  if (level !== "low")
    return (
      <StatusChip
        tone={RISK[level].tone}
        label={level === "high" ? "High" : "Medium"}
        hint={why}
      />
    );
  if (!why) return <span className="text-xs text-muted-foreground">None</span>;
  return (
    <Hint content={why}>
      <button
        type="button"
        className="cursor-help rounded-sm text-xs text-muted-foreground underline decoration-muted-foreground/35 decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Low
      </button>
    </Hint>
  );
}

// --- Client portal ---

const BACKUP_STALE_MS = 36 * 3600_000;

function Portal({
  payload,
  rows,
  now,
}: {
  payload: PortalPayload;
  /** The client roster, so portal use can be counted per client card. Null when the clients section has no numbers. */
  rows: ClientRow[] | null;
  now: number;
}) {
  const { crm } = payload;
  return (
    <div className="@container">
      <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] @4xl:gap-10">
        <div className="min-w-0">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 @xl:grid-cols-3">
            <StatTile
              variant="plain"
              label="Clients with access"
              value={count(payload.withAccess)}
              sub={
                <ShareBar
                  value={payload.withAccess}
                  total={payload.clientsInDirectory}
                  text={`of ${count(payload.clientsInDirectory)} current clients`}
                />
              }
            />
            <StatTile
              variant="plain"
              label="CRM connected"
              value={count(crm.connected)}
              sub={
                <ShareBar
                  value={crm.connected}
                  total={crm.total}
                  text={`of ${count(crm.total)} with a CRM set up`}
                />
              }
            />
            <StatTile
              variant="plain"
              label="Live sessions"
              value={count(payload.liveSessions)}
              sub="Client sessions not yet expired"
            />
            <StatTile
              variant="plain"
              label="Seen in 7 days"
              value={count(payload.seen7d.length)}
              sub="Clients with a recent visit"
            />
            <StatTile
              variant="plain"
              label="Outcomes submitted"
              value={count(payload.outcomesSubmitted)}
              sub="By clients, in the portal"
            />
            <StatTile
              variant="plain"
              label="Appointment rows"
              value={count(payload.appointmentRows)}
              sub="In the appointments sheet mirror"
            />
          </div>
          <PortalTrust payload={payload} now={now} />
        </div>
        <SeenList seen={payload.seen7d} now={now} />
      </div>
      {rows ? <PortalRoster rows={rows} now={now} /> : null}
    </div>
  );
}

/** "of 42 current clients" with a thin share bar under it. */
function ShareBar({
  value,
  total,
  text,
}: {
  value: number;
  total: number;
  text: string;
}) {
  const frac = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;
  return (
    <span className="block">
      <span className="block">{text}</span>
      {total > 0 ? (
        <span
          role="meter"
          aria-label={text}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={value}
          aria-valuetext={`${count(value)} ${text}, ${pct(value / total)}`}
          className="mt-2 block h-1.5 w-full max-w-44 rounded-full"
          style={{ backgroundColor: "var(--ceo-emphasis-track)" }}
        >
          <span
            className="block h-full rounded-full"
            style={{
              width: `${(frac * 100).toFixed(2)}%`,
              minWidth: frac > 0 ? 4 : 0,
              backgroundColor: "var(--ceo-emphasis)",
            }}
          />
        </span>
      ) : null}
    </span>
  );
}

function PortalTrust({
  payload,
  now,
}: {
  payload: PortalPayload;
  now: number;
}) {
  const { status, issues } = payload.health;
  const healthy = status !== null && /^(ok|healthy)$/i.test(status.trim());
  const healthTone: StatusTone =
    status === null ? "neutral" : healthy ? "good" : "warning";
  const healthLabel =
    status === null ? "No report" : healthy ? "Healthy" : capitalize(status);

  const backupAt = payload.backupVerifiedAt;
  const backupOld = isNum(backupAt) && now - backupAt > BACKUP_STALE_MS;

  return (
    <dl className="mt-6 grid gap-x-6 gap-y-3 border-t border-[color:var(--ceo-grid)] pt-4 @xl:grid-cols-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <dt className="text-[13px] text-muted-foreground">Self-check</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusChip tone={healthTone} label={healthLabel} size="md" />
          {status !== null ? (
            <span className="text-xs text-muted-foreground">
              {issues > 0 ? plural(issues, "open issue") : "No open issues"}
            </span>
          ) : null}
        </dd>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <dt className="text-[13px] text-muted-foreground">Backup</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusChip
            tone={!isNum(backupAt) ? "serious" : backupOld ? "warning" : "good"}
            label={
              !isNum(backupAt)
                ? "Not verified"
                : backupOld
                  ? "Verified, over a day old"
                  : "Restore verified"
            }
            size="md"
          />
          {isNum(backupAt) ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              {dateTime(backupAt, now)}
            </span>
          ) : null}
        </dd>
      </div>
    </dl>
  );
}

const SEEN_START = 8;

function SeenList({
  seen,
  now,
}: {
  seen: PortalPayload["seen7d"];
  now: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? seen : seen.slice(0, SEEN_START);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium text-foreground">
          Seen in the last 7 days
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {plural(seen.length, "client")}
        </p>
      </div>
      {seen.length === 0 ? (
        <EmptyState
          icon={MonitorSmartphone}
          title="No client opened the portal in 7 days"
          compact
        />
      ) : (
        <ol className="min-w-0">
          {rows.map((s, i) => (
            <li
              key={`${s.client}-${i}`}
              className="flex min-w-0 items-center justify-between gap-3 border-b border-[color:var(--ceo-grid)] py-2 last:border-0"
            >
              <span
                className="min-w-0 truncate text-[13px] text-foreground"
                title={s.client}
              >
                {s.client}
              </span>
              <Hint content={dateTime(s.lastSeenAt, now)} side="left">
                <time
                  dateTime={new Date(s.lastSeenAt).toISOString()}
                  className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground"
                >
                  {relative(s.lastSeenAt, now)}
                </time>
              </Hint>
            </li>
          ))}
        </ol>
      )}
      {seen.length > SEEN_START ? (
        <ShowMore
          total={seen.length}
          expanded={expanded}
          onToggle={() => setExpanded(e => !e)}
        />
      ) : null}
    </div>
  );
}

// --- Cells and columns the small tables share with the roster ---

const CONTACT_HINT =
  "The day of the later of Last POC and Last Call on the client card. The card carries a day, not a time.";

function SilentCell({ row }: { row: ClientRow }) {
  if (!isNum(row.silentDays)) return <Na hint={HINT.silent} />;
  return (
    <NumberWithDot
      text={plural(row.silentDays, "day")}
      tone={silentTone(row.silentDays)}
      label="Long silence"
    />
  );
}

function ContactCell({ row }: { row: ClientRow }) {
  if (!isNum(row.lastContactAt)) return <Na hint={HINT.contact} />;
  return (
    <Hint content={CONTACT_HINT} side="left">
      <time
        dateTime={new Date(row.lastContactAt).toISOString()}
        className="cursor-help whitespace-nowrap tabular-nums"
      >
        {date(row.lastContactAt)}
      </time>
    </Hint>
  );
}

function PaymentCell({ row, today }: { row: ClientRow; today: string }) {
  const { state, days } = paymentOf(row, today);
  if (state === "none" || days === null) return <Na hint={HINT.payDate} />;
  const pay = PAY[state];
  const late = state === "overdue" || state === "past";
  return (
    <span className="inline-flex min-w-32 items-center gap-1.5 whitespace-nowrap">
      {late ? <StatusDot tone={pay.tone} label={pay.label} /> : null}
      <span className="tabular-nums">{date(row.paymentDue)}</span>
      <span className="text-xs text-muted-foreground">{awayWords(days)}</span>
    </span>
  );
}

const NAME_COL: Column<ClientRow> = {
  key: "name",
  header: "Client",
  cell: r => <ClientName row={r} className="font-medium" />,
  sortValue: r => r.name,
  className: "min-w-40 max-w-64",
};

const STAGE_COL: Column<ClientRow> = {
  key: "stage",
  header: "Stage",
  cell: r =>
    r.stage ? (
      <span className="block min-w-28">{r.stage}</span>
    ) : (
      <Na hint={HINT.stage} />
    ),
  sortValue: r => r.stage,
};

const CSM_COL: Column<ClientRow> = {
  key: "csm",
  header: "CSM",
  cell: r => (r.csm ? r.csm : <Na hint={HINT.csm} />),
  sortValue: r => r.csm,
};

const SILENT_COL: Column<ClientRow> = {
  key: "silent",
  header: "Silent",
  numeric: true,
  cell: r => <SilentCell row={r} />,
  sortValue: r => r.silentDays,
};

const CONTACT_COL: Column<ClientRow> = {
  key: "contact",
  header: "Last contact",
  cell: r => <ContactCell row={r} />,
  sortValue: r => r.lastContactAt,
};

const RISK_COL: Column<ClientRow> = {
  key: "risk",
  header: "Risk",
  cell: r => <RiskCell row={r} />,
  sortValue: r => r.risk.score,
};

// --- Silence and last contact ---

const SILENCE_TILES: {
  key: SilenceBand;
  label: string;
  sub: string;
  hint?: string;
}[] = [
  {
    key: "fresh",
    label: "Contacted in 7 days",
    sub: "no risk point for silence",
  },
  { key: "week", label: "Silent 8 to 14 days", sub: "one risk point each" },
  { key: "long", label: "Silent over 14 days", sub: "two risk points each" },
  {
    key: "unknown",
    label: "No contact date",
    sub: "silence cannot be judged",
    hint: "The client card has no Last POC date, so the cockpit does not know when this client was last spoken to.",
  },
];

/** How long each live client has gone without contact, and who has waited longest. */
function Silence({ payload }: { payload: ClientsPayload }) {
  const live = useMemo(() => payload.rows.filter(isLiveClient), [payload.rows]);

  const quiet = useMemo(
    () =>
      live
        .filter(r => {
          const band = silenceBand(r);
          return band === "week" || band === "long";
        })
        .sort(
          (a, b) =>
            (b.silentDays ?? 0) - (a.silentDays ?? 0) ||
            a.name.localeCompare(b.name),
        ),
    [live],
  );

  const counts = useMemo(() => {
    const out: Record<SilenceBand, number> = {
      fresh: 0,
      week: 0,
      long: 0,
      unknown: 0,
    };
    for (const r of live) out[silenceBand(r)] += 1;
    return out;
  }, [live]);

  // Rows with a call date but no Last POC: the reason the silence column is blank.
  const callOnly = live.filter(
    r => !isNum(r.silentDays) && isNum(r.lastContactAt),
  ).length;
  const longest = quiet[0] ?? null;

  const columns = useMemo(
    () => [NAME_COL, SILENT_COL, CONTACT_COL, CSM_COL, RISK_COL],
    [],
  );

  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 @xl:grid-cols-3 @4xl:grid-cols-5">
        {SILENCE_TILES.map(t => (
          <StatTile
            key={t.key}
            variant="plain"
            label={t.label}
            value={count(counts[t.key])}
            sub={
              t.key === "unknown" && callOnly > 0
                ? `${count(callOnly)} of them have a call date but no Last POC`
                : t.key === "fresh"
                  ? `of ${count(live.length)} live clients`
                  : t.sub
            }
            hint={t.hint}
          />
        ))}
        <StatTile
          variant="plain"
          label="Longest silence"
          value={
            isNum(longest?.silentDays)
              ? plural(longest.silentDays, "day")
              : null
          }
          sub={longest ? longest.name : undefined}
          naHint="No active or onboarding client is silent for 8 days or more."
        />
      </div>

      <div className="mt-6 border-t border-[color:var(--ceo-grid)] pt-4">
        {quiet.length === 0 ? (
          <EmptyState
            icon={Clock3}
            title="Every live client was spoken to in the last 7 days"
            text="Or has no Last POC date on the card, which the tile above counts separately."
            compact
          />
        ) : (
          <DataTable
            rows={quiet}
            columns={columns}
            rowKey={(r, i) => r.clickupTaskId || `${r.name}-${i}`}
            initialSort={{ key: "silent", dir: "desc" }}
            limit={8}
            caption="Live clients silent for 8 days or more, longest first"
            emptyText="No client matches"
          />
        )}
      </div>
    </div>
  );
}

// --- Payments on the client card ---

const PAY_TILES: { key: PayState; label: string; sub: string }[] = [
  { key: "overdue", label: "Past due", sub: "the cockpit is chasing these" },
  {
    key: "past",
    label: "Date passed",
    sub: "extended on the card, or a stage the sync leaves alone",
  },
  { key: "soon", label: "Due in 7 days", sub: "by the date on the card" },
  { key: "later", label: "Later", sub: "more than 7 days away" },
  { key: "none", label: "No date", sub: "nothing set on the card" },
];

/** Where the next payment date sits for every live client, and what it cannot say. */
function Payments({
  payload,
  today,
}: {
  payload: ClientsPayload;
  today: string;
}) {
  const live = useMemo(() => payload.rows.filter(isLiveClient), [payload.rows]);

  const counts = useMemo(() => {
    const out: Record<PayState, number> = {
      overdue: 0,
      past: 0,
      soon: 0,
      later: 0,
      none: 0,
    };
    for (const r of live) out[paymentOf(r, today).state] += 1;
    return out;
  }, [live, today]);

  const dated = useMemo(
    () =>
      live
        .filter(r => dayMs(r.paymentDue) !== null)
        .sort(
          (a, b) =>
            (dayMs(a.paymentDue) ?? 0) - (dayMs(b.paymentDue) ?? 0) ||
            a.name.localeCompare(b.name),
        ),
    [live],
  );

  const columns = useMemo<Column<ClientRow>[]>(
    () => [
      NAME_COL,
      {
        key: "date",
        header: "Next payment",
        cell: r => (
          <span className="whitespace-nowrap tabular-nums">
            {date(r.paymentDue)}
          </span>
        ),
        sortValue: r => dayMs(r.paymentDue),
      },
      {
        key: "away",
        header: "When",
        cell: r => {
          const days = daysFromToday(r.paymentDue, today);
          return days === null ? (
            <Na hint={HINT.payDate} />
          ) : (
            <span className="whitespace-nowrap text-muted-foreground">
              {awayWords(days)}
            </span>
          );
        },
        sortValue: r => daysFromToday(r.paymentDue, today),
      },
      {
        key: "state",
        header: "On the card",
        cell: r => {
          const pay = PAY[paymentOf(r, today).state];
          return (
            <StatusChip tone={pay.tone} label={pay.label} hint={pay.hint} />
          );
        },
        sortValue: r => PAY_RANK[paymentOf(r, today).state],
      },
      {
        key: "collected",
        header: "Collected",
        hideBelow: "md",
        cell: () => <Na hint={HINT.paid} />,
      },
      CSM_COL,
    ],
    [today],
  );

  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 @xl:grid-cols-3 @4xl:grid-cols-6">
        {PAY_TILES.map(t => (
          <StatTile
            key={t.key}
            variant="plain"
            label={t.label}
            value={count(counts[t.key])}
            sub={t.sub}
            hint={PAY[t.key].hint}
            status={
              t.key === "overdue" && counts.overdue > 0 ? (
                <StatusChip tone="serious" label="Chasing" />
              ) : undefined
            }
          />
        ))}
        <StatTile
          variant="plain"
          label="Money past due"
          value={null}
          naHint="The client card carries a date but no amount, and no Whop or Tap payment is joined to a client, so what is at stake in money cannot be shown."
          sub="no amount on the card"
        />
      </div>

      <div className="mt-6 border-t border-[color:var(--ceo-grid)] pt-4">
        {dated.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No live client has a next payment date on its card"
            compact
          />
        ) : (
          <DataTable
            rows={dated}
            columns={columns}
            rowKey={(r, i) => r.clickupTaskId || `${r.name}-${i}`}
            limit={8}
            caption="Live clients by next payment date, soonest first"
            emptyText="No client matches"
          />
        )}
      </div>
    </div>
  );
}

// --- Onboarding pipeline ---

/** Onboarding clients by stage, how quiet they are and how far into the portal they got. */
function Onboarding({ payload }: { payload: ClientsPayload }) {
  const rows = useMemo(
    () => payload.rows.filter(r => r.bucket === "onboarding"),
    [payload.rows],
  );

  const stages = useMemo(() => {
    const by = new Map<string, number>();
    for (const r of rows) {
      const key = r.stage || "No stage on the card";
      by.set(key, (by.get(key) ?? 0) + 1);
    }
    return [...by.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }, [rows]);

  const quiet = rows.filter(
    r => isNum(r.silentDays) && r.silentDays > 7,
  ).length;
  const risky = rows.filter(r => r.risk.level !== "low").length;
  const inPortal = rows.filter(r => isNum(r.portalLastSeenAt)).length;
  const share =
    payload.counts.total > 0
      ? `${pct(rows.length / payload.counts.total)} of the roster`
      : undefined;

  const ordered = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          b.risk.score - a.risk.score ||
          (b.silentDays ?? -1) - (a.silentDays ?? -1) ||
          a.name.localeCompare(b.name),
      ),
    [rows],
  );

  const columns = useMemo(
    () => [NAME_COL, STAGE_COL, CSM_COL, SILENT_COL, CONTACT_COL, RISK_COL],
    [],
  );

  if (rows.length === 0)
    return (
      <EmptyState
        icon={Rocket}
        title="No client is onboarding"
        text="Every client on the roster is active, paused or churned."
        compact
      />
    );

  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 @xl:grid-cols-4">
        <StatTile
          variant="plain"
          label="In onboarding"
          value={count(rows.length)}
          sub={share}
        />
        <StatTile
          variant="plain"
          label="Silent over 7 days"
          value={count(quiet)}
          sub="since the Last POC date"
        />
        <StatTile
          variant="plain"
          label="At high or medium risk"
          value={count(risky)}
          sub="3 or more risk points"
        />
        <StatTile
          variant="plain"
          label="Seen in the portal"
          value={count(inPortal)}
          sub="with an unexpired session"
          hint="Sessions expire after 30 to 90 days, so a client that visited once long ago does not count here."
        />
      </div>

      <div className="mt-6 grid gap-6 border-t border-[color:var(--ceo-grid)] pt-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] @4xl:gap-10">
        <div className="min-w-0">
          <p className="mb-3 text-[13px] font-medium text-foreground">
            Where they are
          </p>
          <BarList
            items={stages}
            limit={8}
            ariaLabel="Onboarding clients by stage"
            emptyText="No stage on any onboarding card"
          />
        </div>
        <div className="min-w-0">
          <p className="mb-3 text-[13px] font-medium text-foreground">
            Who is waiting
          </p>
          <DataTable
            rows={ordered}
            columns={columns}
            rowKey={(r, i) => r.clickupTaskId || `${r.name}-${i}`}
            limit={6}
            bleed={false}
            caption="Onboarding clients, highest risk first"
            emptyText="No onboarding client"
          />
        </div>
      </div>
    </div>
  );
}

// --- Churn and renewals (the rule decided on 2026-09-16) ---

type TermState = NonNullable<ClientRow["termState"]>;

const TERM: Record<TermState, { label: string; tone: StatusTone }> = {
  "in-term": { label: "In term", tone: "neutral" },
  renewed: { label: "Renewed", tone: "good" },
  "no-renewal": { label: "No renewal", tone: "serious" },
  "not-launched": { label: "Not launched", tone: "neutral" },
};

/** Sort order for the roster's term column: the ones to act on first. */
const TERM_RANK: Record<TermState, number> = {
  "no-renewal": 0,
  "in-term": 1,
  renewed: 2,
  "not-launched": 3,
};

const REASON: Record<
  ChurnClient["reason"],
  { label: string; tone: StatusTone; hint: string }
> = {
  stopped: {
    label: "Stopped",
    tone: "serious",
    hint: "The card moved to a stopped stage on this day, as the cockpit's own daily history of the card saw it.",
  },
  "term-ended-no-renewal": {
    label: "Term ended, no renewal",
    tone: "warning",
    hint: "The 90 day term ended on this day and no payment on any rail is dated after it.",
  },
};

const RAIL_WORD: Record<RenewalEvidence["rail"], string> = {
  whop: "Whop",
  tap: "Tap",
  manual: "logged by hand",
};

const BUCKET_WORD: Record<string, string> = {
  active: "Active",
  onboarding: "Onboarding",
  paused: "Paused",
  churned: "Churned",
};

const TERM_NA =
  "Not judged on this reading: the clients section was stored before the churn rule shipped, or Whop payments could not be read on the last refresh.";

function TermCell({ row, today }: { row: ClientRow; today: string }) {
  if (!row.termState) return <Na hint={TERM_NA} />;
  const t = TERM[row.termState];
  const away = daysFromToday(row.termEnd, today);
  // A stopped client is already gone: its term state is history, not an
  // alarm, and it may have stopped long before the term end.
  const gone = row.bucket === "churned";
  const hint =
    row.termState === "not-launched"
      ? row.launchDate
        ? `The Launch Date on the card, ${date(row.launchDate)}, is in the future.`
        : "No Launch Date on the card, so the client has not launched and has no term."
      : `Launched ${date(row.launchDate)}. The term ${away !== null && away < 0 ? "ended" : "ends"} ${date(row.termEnd)}${away === null ? "" : `, ${awayWords(away)}`}.${gone ? " The card is in a stopped stage, so the loss is dated on the stop when that came first." : ""}`;
  return (
    <StatusChip tone={gone ? "neutral" : t.tone} label={t.label} hint={hint} />
  );
}

/** The stage on the card today, with its bucket when the two differ. */
function CardNow({
  item,
}: {
  item: { stage: string | null; cardBucket: string | null };
}) {
  if (item.cardBucket === null)
    return (
      <span className="whitespace-nowrap text-muted-foreground">
        Off the client list
      </span>
    );
  const word = BUCKET_WORD[item.cardBucket] ?? capitalize(item.cardBucket);
  const stage = item.stage ?? word;
  return (
    <span className="block min-w-24">
      {stage}
      {stage.toLowerCase() !== word.toLowerCase() ? (
        <span className="text-xs text-muted-foreground">
          {" "}
          ({word.toLowerCase()})
        </span>
      ) : null}
    </span>
  );
}

/** A Kuwait day with how far it is from today. */
function DayCell({ day, today }: { day: string | null; today: string }) {
  const away = daysFromToday(day, today);
  if (!day || away === null) return <Na />;
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="tabular-nums">{date(day)}</span>
      <span className="text-xs text-muted-foreground">{awayWords(away)}</span>
    </span>
  );
}

const LAUNCH_NA = "No Launch Date on the card";

function churnColumns(today: string, launched: boolean): Column<ChurnClient>[] {
  const cols: Column<ChurnClient>[] = [
    {
      key: "name",
      header: "Client",
      cell: c => <ClientName row={c} className="font-medium" />,
      sortValue: c => c.name,
      className: "min-w-36 max-w-56",
    },
    {
      key: "day",
      header: "Lost on",
      cell: c => <DayCell day={c.day} today={today} />,
      sortValue: c => c.day,
    },
  ];
  if (launched)
    cols.push({
      key: "reason",
      header: "Why",
      cell: c => {
        const r = REASON[c.reason];
        return <StatusChip tone={r.tone} label={r.label} hint={r.hint} />;
      },
      sortValue: c => c.reason,
    });
  cols.push({
    key: "card",
    header: "Card now",
    cell: c => <CardNow item={c} />,
    sortValue: c => c.stage,
  });
  if (launched)
    cols.push({
      key: "launch",
      header: "Launched",
      hideBelow: "md",
      cell: c =>
        c.launchDate ? (
          <span className="whitespace-nowrap tabular-nums">
            {date(c.launchDate)}
          </span>
        ) : (
          <Na hint={LAUNCH_NA} />
        ),
      sortValue: c => c.launchDate,
    });
  return cols;
}

const STILL_LIVE_HINT =
  "The card still reads as a live client, but under the rule this client churned on its term end. A payment dated after the term end, on Whop or logged by hand, turns it into a renewal.";

function termColumns(
  today: string,
  kind: "due" | "ended" | "renewed",
): Column<TermClient>[] {
  const cols: Column<TermClient>[] = [
    {
      key: "name",
      header: "Client",
      cell: t => <ClientName row={t} className="font-medium" />,
      sortValue: t => t.name,
      className: "min-w-36 max-w-56",
    },
    {
      key: "end",
      header: kind === "due" ? "Term ends" : "Term ended",
      cell: t => <DayCell day={t.termEnd} today={today} />,
      sortValue: t => t.termEnd,
    },
  ];
  if (kind === "renewed")
    cols.push(
      {
        key: "renewal",
        header: "Renewal payment",
        cell: t =>
          t.renewal ? (
            <span className="block min-w-36">
              <span className="font-medium tabular-nums">
                {money(t.renewal.amountUsd)}
              </span>{" "}
              <span className="text-muted-foreground">
                on {date(t.renewal.day)}, {RAIL_WORD[t.renewal.rail]}
              </span>
            </span>
          ) : (
            <Na />
          ),
        sortValue: t => t.renewal?.day ?? null,
      },
      {
        key: "matched",
        header: "Tied to the client by",
        hideBelow: "lg",
        cell: t => (
          <span className="block min-w-48 text-xs text-muted-foreground">
            {t.renewal?.matchedBy ?? ""}
          </span>
        ),
      },
    );
  cols.push({
    key: "card",
    header: "Card now",
    cell: t => (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <CardNow item={t} />
        {kind === "ended" &&
        t.cardBucket !== null &&
        t.cardBucket !== "churned" ? (
          <StatusChip
            tone="warning"
            label="Card still live"
            hint={STILL_LIVE_HINT}
          />
        ) : null}
      </span>
    ),
    sortValue: t => t.stage,
  });
  if (kind !== "renewed")
    cols.push({
      key: "launch",
      header: "Launched",
      hideBelow: "md",
      cell: t => (
        <span className="whitespace-nowrap tabular-nums">
          {date(t.launchDate)}
        </span>
      ),
      sortValue: t => t.launchDate,
    });
  return cols;
}

function ChurnRule() {
  return (
    <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">
        The rule, decided on 16 September 2026.{" "}
      </span>
      {CHURN_RULE}
    </p>
  );
}

function ListBlock({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

const churnKey = (c: { clickupTaskId: string; name: string }, i: number) =>
  c.clickupTaskId || `${c.name}-${i}`;

/**
 * Churn under decisions 1 and 4 of 2026-09-16: launched clients lost this
 * month, losses before launch apart, and every launched client seen through
 * its 90 day term, each one named, with the rule and its weaknesses on the card.
 */
function ChurnRenewals({
  payload,
  today,
}: {
  payload: ClientsPayload;
  today: string;
}) {
  const head = churnHeadline(payload);
  const churn = head.churn;
  const churnCols = useMemo(() => churnColumns(today, true), [today]);
  const lostCols = useMemo(() => churnColumns(today, false), [today]);
  const dueCols = useMemo(() => termColumns(today, "due"), [today]);
  const endedCols = useMemo(() => termColumns(today, "ended"), [today]);
  const renewedCols = useMemo(() => termColumns(today, "renewed"), [today]);

  if (!churn)
    return (
      <div className="space-y-4">
        <ChurnRule />
        <EmptyState
          icon={UserMinus}
          title="No churn reading yet"
          text={head.naHint}
          compact
        />
      </div>
    );

  const stillLive = churn.termEndedNoRenewal.filter(
    t => t.cardBucket !== null && t.cardBucket !== "churned",
  ).length;
  const soonest = churn.renewalDueSoon[0] ?? null;
  // While the month is partial an empty list proves nothing: a stop the
  // cockpit's history could not date is left out, so the titles say so.
  const partialText = head.partial
    ? "The cockpit's own history does not cover the whole month, so a client that stopped before it began is not here. See the partial month note."
    : undefined;

  return (
    <div className="@container">
      <ChurnRule />

      <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 @xl:grid-cols-3 @4xl:grid-cols-5">
        <StatTile
          variant="plain"
          label={head.label}
          value={count(head.value)}
          sub={head.sub}
          hint={head.hint}
          naHint={head.naHint}
        />
        <StatTile
          variant="plain"
          label="Lost before launch"
          value={count(head.lostBeforeLaunch)}
          sub={head.lostSub}
          hint="Clients with no Launch Date that stopped this month. A sales and onboarding loss, not a retention one."
        />
        <StatTile
          variant="plain"
          label="Renewal due in 15 days"
          value={count(churn.renewalDueSoon.length)}
          sub={
            soonest
              ? `first: ${soonest.name}, ${awayWords(soonest.daysToTermEnd)}`
              : "no term ends in the next 15 days"
          }
          hint="Launched clients still on the books whose term end (Launch Date plus 90 days) falls from today to 15 days from now."
        />
        <StatTile
          variant="plain"
          label="Term ended, no renewal"
          value={count(churn.termEndedNoRenewal.length)}
          sub={
            stillLive > 0
              ? `${plural(stillLive, "card")} still live on ClickUp`
              : "counted as churned on the term end"
          }
          hint="Past the term end with no payment dated after it, on any rail the cockpit can tie to the client. Each counts as churned on its term end."
        />
        <StatTile
          variant="plain"
          label="Term ended, renewed"
          value={count(churn.termEndedRenewed.length)}
          sub="a payment dated after the term end"
          hint="The payment is the only renewal evidence that exists: no form, field or table records a renewal."
        />
      </div>

      <div className="mt-6 grid gap-6 border-t border-[color:var(--ceo-grid)] pt-4 @4xl:grid-cols-2 @4xl:gap-10">
        <ListBlock
          title={`Churned in ${head.month ?? "this month"}`}
          sub="Launched clients, newest loss first"
        >
          {churn.churnedThisMonth.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title={
                head.partial
                  ? "No dated churn this month so far"
                  : "No launched client churned this month"
              }
              text={partialText}
              compact
            />
          ) : (
            <DataTable
              rows={churn.churnedThisMonth}
              columns={churnCols}
              rowKey={churnKey}
              limit={6}
              bleed={false}
              caption="Launched clients churned this month, with the day and the reason"
              emptyText="No client matches"
            />
          )}
        </ListBlock>
        <ListBlock
          title="Lost before launch"
          sub="No Launch Date on the card, so never churn"
        >
          {churn.lostBeforeLaunchThisMonth.length === 0 ? (
            <EmptyState
              icon={Rocket}
              title={
                head.partial
                  ? "No dated loss before launch this month so far"
                  : "No client was lost before launch this month"
              }
              text={partialText}
              compact
            />
          ) : (
            <DataTable
              rows={churn.lostBeforeLaunchThisMonth}
              columns={lostCols}
              rowKey={churnKey}
              limit={6}
              bleed={false}
              caption="Clients lost before launch this month"
              emptyText="No client matches"
            />
          )}
        </ListBlock>
      </div>

      <div className="mt-6 grid gap-6 border-t border-[color:var(--ceo-grid)] pt-4 @4xl:grid-cols-2 @4xl:gap-10">
        <ListBlock
          title="Renewal due in the next 15 days"
          sub="Soonest term end first"
        >
          {churn.renewalDueSoon.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No term ends in the next 15 days"
              compact
            />
          ) : (
            <DataTable
              rows={churn.renewalDueSoon}
              columns={dueCols}
              rowKey={churnKey}
              limit={6}
              bleed={false}
              caption="Launched clients whose 90 day term ends in the next 15 days"
              emptyText="No client matches"
            />
          )}
        </ListBlock>
        <ListBlock
          title="Term ended with no renewal payment"
          sub="Counted as churned on the term end, newest first"
        >
          {churn.termEndedNoRenewal.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No launched client is past its term end without a renewal payment"
              compact
            />
          ) : (
            <DataTable
              rows={churn.termEndedNoRenewal}
              columns={endedCols}
              rowKey={churnKey}
              limit={6}
              bleed={false}
              caption="Launched clients past the term end with no payment dated after it"
              emptyText="No client matches"
            />
          )}
        </ListBlock>
      </div>

      <div className="mt-6 border-t border-[color:var(--ceo-grid)] pt-4">
        <ListBlock
          title="Term ended and renewed"
          sub="The first payment dated after the term end, and how it was tied to the client"
        >
          {churn.termEndedRenewed.length === 0 ? (
            <EmptyState
              icon={CalendarSync}
              title="No client has a payment after its term end yet"
              text="A renewal only shows once a payment dated after the term end is on Whop under a portal login, or logged by hand with the client."
              compact
            />
          ) : (
            <DataTable
              rows={churn.termEndedRenewed}
              columns={renewedCols}
              rowKey={churnKey}
              limit={8}
              caption="Launched clients renewed after the term end, with the renewal payment"
              emptyText="No client matches"
            />
          )}
        </ListBlock>
      </div>
    </div>
  );
}

// --- Churn and cancellation signals ---

const GONE_ORDER = ["paused", "churned"];

/** Who has left or stopped, and which live clients are showing the same signs. */
function Churn({ payload }: { payload: ClientsPayload }) {
  const live = useMemo(() => payload.rows.filter(isLiveClient), [payload.rows]);

  const signalled = useMemo(
    () => live.filter(r => signalsOf(r).length > 0).sort(byRisk),
    [live],
  );

  const gone = useMemo(
    () =>
      payload.rows
        .filter(r => r.bucket === "paused" || r.bucket === "churned")
        .sort(
          (a, b) =>
            GONE_ORDER.indexOf(a.bucket ?? "") -
              GONE_ORDER.indexOf(b.bucket ?? "") ||
            a.name.localeCompare(b.name),
        ),
    [payload.rows],
  );

  const signalColumns = useMemo<Column<ClientRow>[]>(
    () => [
      NAME_COL,
      {
        key: "signal",
        header: "Signal",
        cell: r => (
          <span className="block min-w-40">
            {signalsOf(r).map(capitalize).join(", ")}
          </span>
        ),
        sortValue: r => signalsOf(r).join(" "),
      },
      SILENT_COL,
      CSM_COL,
      RISK_COL,
    ],
    [],
  );

  const goneColumns = useMemo<Column<ClientRow>[]>(
    () => [
      NAME_COL,
      {
        key: "bucket",
        header: "State",
        cell: r =>
          r.bucket ? (
            capitalize(r.bucket)
          ) : (
            <Na hint="No bucket and no stage on the client card" />
          ),
        sortValue: r => r.bucket,
      },
      STAGE_COL,
      CSM_COL,
      CONTACT_COL,
    ],
    [],
  );

  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 @xl:grid-cols-4">
        <StatTile
          variant="plain"
          label="Churned"
          value={count(payload.counts.churned)}
          sub="on the roster today"
          hint="A count of cards sitting in a churned stage right now, not a churn rate. The churn and renewals card applies the churn rule and dates each loss."
        />
        <StatTile
          variant="plain"
          label="Paused"
          value={count(payload.counts.paused)}
          sub="stopped, not gone"
        />
        <StatTile
          variant="plain"
          label="Live clients showing a signal"
          value={count(signalled.length)}
          sub="unhappy on the card, or a DEFCON flag"
        />
        <StatTile
          variant="plain"
          label="Reason they left"
          value={null}
          naHint="No field on the client card records why a client left, so no churn reason can be counted."
          sub="nothing records it"
        />
      </div>

      <div className="mt-6 border-t border-[color:var(--ceo-grid)] pt-4">
        <p className="mb-3 text-[13px] font-medium text-foreground">
          Live clients showing a cancellation signal
        </p>
        {signalled.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No live client is marked unhappy or flagged on a call"
            compact
          />
        ) : (
          <DataTable
            rows={signalled}
            columns={signalColumns}
            rowKey={(r, i) => r.clickupTaskId || `${r.name}-${i}`}
            limit={6}
            caption="Active and onboarding clients with an unhappy or DEFCON signal"
            emptyText="No client matches"
          />
        )}
      </div>

      <div className="mt-6 border-t border-[color:var(--ceo-grid)] pt-4">
        <p className="mb-3 text-[13px] font-medium text-foreground">
          Paused and churned clients
        </p>
        {gone.length === 0 ? (
          <EmptyState
            icon={UserMinus}
            title="No client is paused or churned"
            compact
          />
        ) : (
          <DataTable
            rows={gone}
            columns={goneColumns}
            rowKey={(r, i) => r.clickupTaskId || `${r.name}-${i}`}
            limit={8}
            caption="Paused and churned clients with their stage and last contact"
            emptyText="No client matches"
          />
        )}
      </div>
    </div>
  );
}

// --- Portal use across the roster ---

/** The same portal, counted per client card, so the CEO sees who is not using it. */
function PortalRoster({ rows, now }: { rows: ClientRow[]; now: number }) {
  const live = rows.filter(isLiveClient);
  const age = (r: ClientRow) =>
    isNum(r.portalLastSeenAt) ? now - r.portalLastSeenAt : null;
  const seen7 = live.filter(r => {
    const a = age(r);
    return a !== null && a < 7 * DAY_MS;
  }).length;
  const seen30 = live.filter(r => {
    const a = age(r);
    return a !== null && a >= 7 * DAY_MS && a < PORTAL_SEEN_DAYS * DAY_MS;
  }).length;
  const older = live.filter(r => {
    const a = age(r);
    return a !== null && a >= PORTAL_SEEN_DAYS * DAY_MS;
  }).length;
  const never = live.filter(r => age(r) === null).length;

  return (
    <div className="mt-6 border-t border-[color:var(--ceo-grid)] pt-4">
      <p className="mb-3 text-[13px] font-medium text-foreground">
        Portal use across the client roster
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 @xl:grid-cols-4">
        <StatTile
          variant="plain"
          label="Seen in 7 days"
          value={count(seen7)}
          sub={`of ${count(live.length)} live clients`}
        />
        <StatTile
          variant="plain"
          label={`Seen 8 to ${PORTAL_SEEN_DAYS} days ago`}
          value={count(seen30)}
          sub="still inside the session window"
        />
        <StatTile
          variant="plain"
          label={`Seen over ${PORTAL_SEEN_DAYS} days ago`}
          value={count(older)}
          sub="session not expired yet"
        />
        <StatTile
          variant="plain"
          label="No unexpired session"
          value={count(never)}
          sub="never visited, or the session expired"
          hint="The client row carries the newest unexpired session only. A client that has never been given access looks the same as one whose session expired, so this is not a count of clients without access."
        />
      </div>
    </div>
  );
}

// --- What client success has no source for at all ---

const NO_CLIENT_MONEY =
  "The client card carries MRR, LTV and Next Payment Amount, but the cockpit's client adapter does not read them. Payments are tied to a client only as renewal evidence, through portal logins and hand entries, which the churn card's notes show is not complete enough to call revenue.";

const NOT_MEASURED: { label: string; why: string }[] = [
  { label: "Revenue per client", why: NO_CLIENT_MONEY },
  { label: "Monthly recurring revenue", why: NO_CLIENT_MONEY },
  {
    label: "Money at risk on the clients above",
    why: "It needs revenue per client, which the cockpit does not have, so a risk list can name clients but never a sum.",
  },
  {
    label: "Whether a payment was collected",
    why: "The next payment date is a field on the client card. No invoice is joined to a client, and payments are tied to a client only partly, as renewal evidence on the churn card, so paid and not paid look the same here.",
  },
  {
    label: "Churn and retention over time",
    why: "The churn card gives this month's rate from the cockpit's own daily history of each client's stage, which started in September 2026. A trend needs several complete months of it.",
  },
  {
    label: "Why a client left",
    why: "No field on the client card records a churn reason.",
  },
  {
    label: "Time in onboarding and days to launch",
    why: "The client rows carry the Launch Date, but not the day the client signed or the day each stage began, so onboarding cycle time cannot be measured.",
  },
  {
    label: "A renewal as its own record",
    why: "No form, field or table records a renewal. The churn card counts a payment dated after the term end as the renewal, which is the only evidence that exists.",
  },
  {
    label: "Client requests and response time",
    why: "No ticket or request table exists in any source the cockpit reads.",
  },
  {
    label: "A survey score from the client",
    why: "Happiness and DEFCON are set by the team on the card and in the call notes, not answered by the client, so there is no NPS or CSAT.",
  },
];

/** Metrics with no source at all: named, shown as n/a, each with what is missing. */
function NotMeasured({ order }: { order: number }) {
  return (
    <SectionCard
      kicker="Client success"
      title="Not measured yet"
      order={order}
      bodyClassName="mt-4"
    >
      <p className="mb-4 max-w-2xl text-xs leading-relaxed text-muted-foreground">
        These are the client success numbers a CEO would normally ask for that
        no source the cockpit reads can give. They are named here rather than
        left off, so nobody hunts for a number that does not exist.
      </p>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
        {NOT_MEASURED.map(m => (
          <div key={m.label} className="min-w-0">
            <dt className="text-[13px] leading-5 text-muted-foreground">
              {m.label}
            </dt>
            <dd className="mt-0.5 min-w-0">
              <span className="text-base font-semibold tracking-tight">
                <Na hint={m.why} />
              </span>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {m.why}
              </p>
            </dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  );
}
