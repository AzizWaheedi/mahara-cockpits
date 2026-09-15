import { MessageSquare, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { type Column, DataTable } from "@/components/ceo/DataTable";
import { EmptyState } from "@/components/ceo/EmptyState";
import { FilterChips, type FilterOption } from "@/components/ceo/FilterChips";
import {
  capitalize,
  count,
  dateTime,
  isNum,
  money,
  pct,
  plural,
  relative,
} from "@/components/ceo/format";
import { Hint } from "@/components/ceo/Hint";
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
  ClientRow,
  ClientsPayload,
  PortalPayload,
} from "../../../convex/ceo/payloads";
import type { CeoTabProps } from "./types";

// --- Clients ---

const isLive = (r: ClientRow) =>
  r.bucket === "active" || r.bucket === "onboarding";

type RiskLevel = ClientRow["risk"]["level"];

// Serious, not critical: the same tone as the Today card and the Clients tab badge.
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

/** Counts, clients that need attention, the full roster and the client portal. */
export function ClientsTab({ sections, now }: CeoTabProps) {
  const clients = sections.clients;
  const payload = clients?.payload ?? null;
  const portal = sections.portal;

  const portalCard = (
    <SectionCard
      kicker="Mahara OS"
      title="Client portal"
      section={portal}
      notes={portal?.payload?.notes}
      order={3}
    >
      {p => <Portal payload={p} now={now} />}
    </SectionCard>
  );

  // One empty state for the whole roster, not three stacked ones.
  if (!payload)
    return (
      <div className="grid gap-4 lg:gap-6">
        <SectionCard title="Clients" section={clients}>
          {() => null}
        </SectionCard>
        {portalCard}
      </div>
    );

  // Warnings sit on the first card so they are read first; the long rule notes go under the roster.
  const warn = payload.notes.filter(n => n.level === "warn");
  const info = payload.notes.filter(n => n.level !== "warn");
  const live = payload.rows.filter(isLive);
  const high = live.filter(r => r.risk.level === "high").length;
  const medium = live.filter(r => r.risk.level === "medium").length;

  return (
    <div className="grid gap-4 lg:gap-6">
      <SectionCard
        title={
          <>
            Client book
            <TitleNote>
              {plural(payload.counts.total, "client")} on the roster
            </TitleNote>
          </>
        }
        section={clients}
        notes={warn}
        order={0}
      >
        {p => <Book payload={p} high={high} medium={medium} />}
      </SectionCard>

      <SectionCard
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
        order={1}
      >
        {p => <AtRisk rows={p.rows} />}
      </SectionCard>

      <SectionCard title="All clients" section={clients} notes={info} order={2}>
        {p => <Roster payload={p} now={now} />}
      </SectionCard>

      {portalCard}
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
  row: ClientRow;
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
    () => rows.filter(r => isLive(r) && r.risk.level !== "low").sort(byRisk),
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

function Roster({ payload, now }: { payload: ClientsPayload; now: number }) {
  const [filter, setFilter] = useState<RosterFilter>("all");
  const { counts } = payload;

  const atRisk = useMemo(
    () => payload.rows.filter(r => isLive(r) && r.risk.level !== "low"),
    [payload.rows],
  );
  const rows = useMemo(() => {
    if (filter === "all") return payload.rows;
    if (filter === "risk") return atRisk;
    return payload.rows.filter(r => r.bucket === filter);
  }, [payload.rows, atRisk, filter]);
  const columns = useMemo(() => rosterColumns(now), [now]);

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

function rosterColumns(now: number): Column<ClientRow>[] {
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
      cell: r =>
        isNum(r.silentDays) ? (
          <NumberWithDot
            text={plural(r.silentDays, "day")}
            tone={silentTone(r.silentDays)}
            label="Long silence"
          />
        ) : (
          <Na hint={HINT.silent} />
        ),
      sortValue: r => r.silentDays,
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

function Portal({ payload, now }: { payload: PortalPayload; now: number }) {
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
