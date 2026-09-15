import { CircleCheck, OctagonAlert, Rocket, ShieldCheck } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { type Column, DataTable } from "@/components/ceo/DataTable";
import { Delta } from "@/components/ceo/Delta";
import { EmptyState } from "@/components/ceo/EmptyState";
import { FilterChips, type FilterOption } from "@/components/ceo/FilterChips";
import {
  capitalize,
  change,
  count,
  date,
  isNum,
  kuwaitDay,
  money,
  moneyCompact,
  pct,
  plural,
} from "@/components/ceo/format";
import { Hint } from "@/components/ceo/Hint";
import { Na, Value } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import {
  gateLabel,
  gateTone,
  STATUS_COLOR,
  StatusChip,
  type StatusTone,
} from "@/components/ceo/StatusChip";
import { TimeSeriesChart } from "@/components/ceo/TimeSeriesChart";
import { cn } from "@/lib/utils";
import type { DeliveryPayload, Note } from "../../../convex/ceo/payloads";
import type { CeoTabProps } from "./types";

type ClientRow = DeliveryPayload["clients"][number];
type ClientStatus = ClientRow["status"];

// Off track is serious, as on the Today tab: critical is kept for things that are broken.
const STATUS: Record<
  ClientStatus,
  { tone: StatusTone; label: string; order: number }
> = {
  bad: { tone: "serious", label: "Off track", order: 0 },
  watch: { tone: "warning", label: "Watch", order: 1 },
  good: { tone: "good", label: "On track", order: 2 },
  "no-data": { tone: "neutral", label: "No data", order: 3 },
};

function statusHint(status: ClientStatus, gates: DeliveryPayload["gates"]) {
  const cpl = money(gates.cpl);
  const cpb = money(gates.cpb);
  switch (status) {
    case "bad":
      return `No leads, or cost per lead more than 50% over the ${cpl} gate.`;
    case "watch":
      return `Leads are coming, but cost per lead is a little over ${cpl}, cost per booking is over ${cpb}, or no bookings are read yet.`;
    case "good":
      return `Cost per lead within ${cpl} and, where bookings are read, cost per booking within ${cpb}.`;
    default:
      return "No spend in the last 7 days.";
  }
}

// Verdicts come from the media buyer sync (convex/sync.ts); unknown ones still show, in neutral.
const VERDICTS: {
  key: string;
  label: string;
  tone: StatusTone;
  hint: string;
  always?: boolean;
}[] = [
  {
    key: "scale",
    label: "Scale",
    tone: "good",
    hint: "Cost per lead under the gate over the last 7 days.",
    always: true,
  },
  {
    key: "hold",
    label: "Hold",
    tone: "warning",
    hint: "Cost per lead over the gate but within 50%. Watch, do not scale.",
    always: true,
  },
  {
    key: "fatiguing",
    label: "Fatiguing",
    tone: "serious",
    hint: "The same people keep seeing it, or the link click rate has dropped.",
  },
  {
    key: "below KPI",
    label: "Below KPI",
    tone: "serious",
    hint: "People click but few opt in: the landing page needs work.",
  },
  {
    key: "kill",
    label: "Kill",
    tone: "critical",
    hint: "Spend with no leads, or cost per lead more than 50% over the gate.",
    always: true,
  },
  {
    key: "no delivery",
    label: "No delivery",
    tone: "neutral",
    hint: "No spend in the last 7 days.",
  },
];

/** Shifts a "YYYY-MM-DD" day by whole days. */
function shiftDay(day: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
  return d.toISOString().slice(0, 10);
}

/** Clients' ads: spend, leads, bookings, campaign health, launches and account issues. */
export function DeliveryTab({ sections, now, day }: CeoTabProps) {
  const section = sections.delivery;
  const payload = section?.payload ?? null;
  const today = day ?? kuwaitDay(now);

  // Notes sit once each beside the numbers they qualify: launch caveats on
  // Launches, other warnings on the headline numbers, definitions on the table.
  const notes = useMemo(() => {
    const all = payload?.notes ?? [];
    const launch = all.filter(n => /launch/i.test(n.text));
    const rest = all.filter(n => !/launch/i.test(n.text));
    return {
      launch,
      top: rest.filter(n => n.level === "warn"),
      clients: rest.filter(n => n.level !== "warn"),
    };
  }, [payload]);

  // When a refresh has not run since midnight, "yesterday" is an older day.
  const computedDay = section?.computedAt
    ? kuwaitDay(section.computedAt)
    : today;
  const behind = computedDay !== today;
  const yesterdayLabel = behind ? date(shiftDay(computedDay, -1)) : "Yesterday";
  const topNotes: Note[] = behind
    ? [
        {
          level: "warn",
          text: `These numbers were computed on ${date(computedDay)} and have not refreshed since, so yesterday means ${date(shiftDay(computedDay, -1))}.`,
        },
        ...notes.top,
      ]
    : notes.top;

  // With nothing to show, one card says so instead of six identical empty states.
  if (!payload)
    return (
      <div className="grid min-w-0">
        <SectionCard title="Client delivery" section={section}>
          {() => null}
        </SectionCard>
      </div>
    );

  return (
    <div className="@container grid min-w-0 gap-4 lg:gap-6">
      <SectionCard
        kicker="Last 7 full days"
        title="Client ads"
        section={section}
        notes={topNotes}
        order={0}
      >
        {d => <Headline d={d} yesterdayLabel={yesterdayLabel} />}
      </SectionCard>

      <SectionCard
        kicker="Last 30 days"
        title="Spend, leads and bookings per day"
        section={section}
        order={1}
      >
        {d => <DailyCharts d={d} />}
      </SectionCard>

      <SectionCard title="Campaign health" section={section} order={2}>
        {d => <CampaignHealth d={d} />}
      </SectionCard>

      <SectionCard
        kicker="Last 7 days"
        title="Clients with spend"
        section={section}
        notes={notes.clients}
        order={3}
      >
        {d => <ClientsTable d={d} />}
      </SectionCard>

      <div className="grid min-w-0 items-start gap-4 lg:gap-6 @4xl:grid-cols-2">
        <SectionCard
          title="Launches"
          section={section}
          notes={notes.launch}
          order={4}
        >
          {d => <Launches d={d} />}
        </SectionCard>
        <SectionCard
          title="Ad account issues"
          section={section}
          order={5}
          actions={
            payload.accountIssues.length > 0 ? (
              <StatusChip
                tone="critical"
                label={plural(payload.accountIssues.length, "account")}
              />
            ) : null
          }
        >
          {d => <AccountIssues d={d} />}
        </SectionCard>
      </div>
    </div>
  );
}

// --- Headline -----------------------------------------------------------------

/**
 * Five tiles in one hairline-divided block. Phones get two columns with the
 * first tile across the top, mid widths a 2 over 3 split, wide cards one row,
 * so five tiles never leave an empty cell.
 */
const TILE_SPANS = [
  "col-span-2 @xl:col-span-3 @4xl:col-span-1",
  "@xl:col-span-3 @4xl:col-span-1",
  "@xl:col-span-2 @4xl:col-span-1",
  "@xl:col-span-2 @4xl:col-span-1",
  "@xl:col-span-2 @4xl:col-span-1",
];

function TileBlock({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border bg-[var(--ceo-grid)] @xl:grid-cols-6 @4xl:grid-cols-5">
      {children}
    </div>
  );
}

/** The other windows under a tile's headline value, label left and value right. */
function WindowLines({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="space-y-0.5 border-t border-[color:var(--ceo-grid)] pt-2 text-xs leading-5 text-muted-foreground">
      {rows.map(r => (
        <div
          key={r.label}
          className="flex min-w-0 items-baseline justify-between gap-2"
        >
          <dt className="min-w-0 truncate">{r.label}</dt>
          <dd className="shrink-0 font-medium tabular-nums text-foreground">
            <Value value={r.value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A tile cell whose window lines sit on the cell floor, so they line up across a row even when a status chip wraps. */
function TileCell({
  tile,
  lines,
  className,
}: {
  tile: ReactNode;
  lines: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col bg-card p-4", className)}>
      {tile}
      <div className="mt-auto pt-3">{lines}</div>
    </div>
  );
}

function gateChip(value: number | null, gate: number, noun: string) {
  if (!isNum(value)) return null;
  const tone = gateTone(value, gate);
  return (
    <StatusChip
      tone={tone}
      label={gateLabel(tone, gate)}
      hint={`The gate is ${money(gate)} per ${noun}. Up to 25% over is a warning.`}
    />
  );
}

function Headline({
  d,
  yesterdayLabel,
}: {
  d: DeliveryPayload;
  yesterdayLabel: string;
}) {
  const { last7: w, prevLast7: p, yesterday: y, mtd: m, gates } = d;
  const vs = "vs prior 7 days";
  const lines = (fmt: (v: number | null) => string, k: keyof typeof w) => (
    <WindowLines
      rows={[
        { label: yesterdayLabel, value: fmt(y[k]) },
        { label: "This month", value: fmt(m[k]) },
      ]}
    />
  );

  const tiles = [
    {
      key: "spend",
      lines: lines(money, "spend"),
      tile: (
        <StatTile
          variant="plain"
          label="Ad spend"
          value={money(w.spend)}
          delta={
            <Delta
              value={change(w.spend, p.spend)}
              goodWhen="neither"
              vs={vs}
            />
          }
          hint="Meta spend on campaigns on the Ads Management board, in USD."
        />
      ),
    },
    {
      key: "leads",
      lines: lines(count, "leads"),
      tile: (
        <StatTile
          variant="plain"
          label="Leads"
          value={count(w.leads)}
          delta={<Delta value={change(w.leads, p.leads)} vs={vs} />}
        />
      ),
    },
    {
      key: "cpl",
      lines: lines(money, "cpl"),
      tile: (
        <StatTile
          variant="plain"
          label="Cost per lead"
          value={money(w.cpl)}
          naHint="No leads in the last 7 days, so there is no cost per lead."
          status={gateChip(w.cpl, gates.cpl, "lead")}
          delta={<Delta value={change(w.cpl, p.cpl)} goodWhen="down" vs={vs} />}
          hint={`Spend divided by leads. The gate is ${money(gates.cpl)}.`}
        />
      ),
    },
    {
      key: "bookings",
      lines: lines(count, "bookings"),
      tile: (
        <StatTile
          variant="plain"
          label="Bookings"
          value={count(w.bookings)}
          delta={<Delta value={change(w.bookings, p.bookings)} vs={vs} />}
          hint="GHL appointments for Done For You clients whose GHL is connected. The latest days read low."
        />
      ),
    },
    {
      key: "cpb",
      lines: lines(money, "cpb"),
      tile: (
        <StatTile
          variant="plain"
          label="Cost per booking"
          value={money(w.cpb)}
          naHint="No bookings read in the last 7 days, so there is no cost per booking."
          status={gateChip(w.cpb, gates.cpb, "booking")}
          delta={<Delta value={change(w.cpb, p.cpb)} goodWhen="down" vs={vs} />}
          hint={`Spend on campaigns whose bookings are read, divided by their bookings. The gate is ${money(gates.cpb)}.`}
        />
      ),
    },
  ];

  return (
    <TileBlock>
      {tiles.map((t, i) => (
        <TileCell
          key={t.key}
          tile={t.tile}
          lines={t.lines}
          className={TILE_SPANS[i]}
        />
      ))}
    </TileBlock>
  );
}

// --- Daily charts ---------------------------------------------------------------

function DailyCharts({ d }: { d: DeliveryPayload }) {
  const rows = d.daily;
  const total = (k: "spend" | "leads" | "bookings") =>
    rows.reduce((s, r) => s + (isNum(r[k]) ? r[k] : 0), 0);
  const last = rows.at(-1);
  const span = rows.length
    ? `${date(rows[0].date)} to ${date(last?.date)}`
    : "no days";
  const spend = total("spend");
  const leads = total("leads");
  const bookings = total("bookings");

  return (
    <div className="grid min-w-0 gap-x-6 gap-y-8 @4xl:grid-cols-3">
      <TimeSeriesChart
        data={rows}
        series={[{ key: "spend", label: "Ad spend" }]}
        kind="area"
        unit="money"
        title="Ad spend"
        summary={`${moneyCompact(spend)} total`}
        height={180}
        syncId="ceo-delivery-daily"
        ariaLabel={`Client ad spend per day, ${span}. ${money(spend)} in total, ${money(last?.spend)} on the last day.`}
      />
      <TimeSeriesChart
        data={rows}
        series={[{ key: "leads", label: "Leads" }]}
        kind="area"
        unit="count"
        title="Leads"
        summary={`${count(leads)} total`}
        height={180}
        syncId="ceo-delivery-daily"
        ariaLabel={`Client leads per day, ${span}. ${count(leads)} in total, ${count(last?.leads)} on the last day.`}
      />
      <TimeSeriesChart
        data={rows}
        series={[{ key: "bookings", label: "Bookings" }]}
        kind="area"
        unit="count"
        title="Bookings"
        summary={`${count(bookings)} total`}
        height={180}
        syncId="ceo-delivery-daily"
        ariaLabel={`Client bookings per day, ${span}. ${count(bookings)} in total, ${count(last?.bookings)} on the last day.`}
      />
    </div>
  );
}

// --- Campaign health ----------------------------------------------------------

function CampaignHealth({ d }: { d: DeliveryPayload }) {
  const c = d.campaigns;
  const verdicts = useMemo(() => {
    const known = VERDICTS.filter(
      v => v.always || (c.verdicts[v.key] ?? 0) > 0,
    ).map(v => ({ ...v, count: c.verdicts[v.key] ?? 0 }));
    const extra = Object.entries(c.verdicts)
      .filter(([k, n]) => n > 0 && !VERDICTS.some(v => v.key === k))
      .map(([k, n]) => ({
        key: k,
        label: capitalize(k),
        tone: "neutral" as StatusTone,
        hint: "A verdict this screen does not describe yet.",
        count: n,
      }));
    return [...known, ...extra];
  }, [c.verdicts]);
  const judged = verdicts.reduce((s, v) => s + v.count, 0);

  const flag = (n: number) =>
    n > 0 ? <StatusChip tone="warning" label="Needs a look" /> : null;

  return (
    <div className="min-w-0 space-y-6">
      <div className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border bg-[var(--ceo-grid)] @xl:grid-cols-3">
        <div className="col-span-2 min-w-0 bg-card p-4 @xl:col-span-1">
          <StatTile
            variant="plain"
            label="Running on Meta"
            value={count(c.running)}
            sub="Campaigns live now, on the board"
          />
        </div>
        <div className="min-w-0 bg-card p-4">
          <StatTile
            variant="plain"
            label="Off on the board, still running"
            value={count(c.boardOffButRunning)}
            status={flag(c.boardOffButRunning)}
            sub="Marked off in ClickUp but live on Meta"
          />
        </div>
        <div className="min-w-0 bg-card p-4">
          <StatTile
            variant="plain"
            label="Spending, not on the board"
            value={count(c.spendingNotOnBoard)}
            status={flag(c.spendingNotOnBoard)}
            sub="Spend in 7 days with no board card, left out of these numbers"
          />
        </div>
      </div>

      <div className="min-w-0">
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-[13px] font-medium text-foreground">
            Verdicts on running campaigns
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {plural(judged, "campaign")} judged on the last 7 days
          </p>
        </div>
        {judged > 0 ? (
          <div
            className="flex h-2.5 w-full min-w-0 gap-[2px] overflow-hidden rounded-full"
            aria-hidden
          >
            {verdicts
              .filter(v => v.count > 0)
              .map(v => (
                <div
                  key={v.key}
                  className="h-full min-w-1 first:rounded-l-full last:rounded-r-full"
                  style={{
                    flexGrow: v.count,
                    flexBasis: 0,
                    backgroundColor:
                      v.tone === "neutral"
                        ? "var(--ceo-deemphasis)"
                        : STATUS_COLOR[v.tone],
                  }}
                />
              ))}
          </div>
        ) : (
          <div
            className="h-2.5 w-full rounded-full bg-[var(--ceo-grid)]"
            aria-hidden
          />
        )}
        <ul className="mt-4 grid min-w-0 grid-cols-2 gap-x-6 gap-y-3 @xl:grid-cols-3 @4xl:grid-cols-6">
          {verdicts.map(v => (
            <li key={v.key} className="min-w-0">
              <Hint content={v.hint}>
                <button
                  type="button"
                  className="flex min-w-0 cursor-help items-center gap-1.5 rounded-sm text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        v.tone === "neutral"
                          ? "var(--ceo-deemphasis)"
                          : STATUS_COLOR[v.tone],
                    }}
                  />
                  <span className="truncate">{v.label}</span>
                </button>
              </Hint>
              <p className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-lg font-semibold tracking-tight text-foreground">
                  {count(v.count)}
                </span>
                {judged > 0 ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {pct(v.count / judged)}
                  </span>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// --- Clients table --------------------------------------------------------------

/** Cost against its gate: a status dot only when it is over, so exceptions stand out. */
function GateCell({
  value,
  gate,
  noun,
}: {
  value: number | null;
  gate: number;
  noun: string;
}) {
  if (!isNum(value))
    return (
      <Na
        hint={
          noun === "lead"
            ? "No leads in these 7 days"
            : "No bookings read for this client in these 7 days"
        }
      />
    );
  const tone = gateTone(value, gate);
  // relative keeps the sr-only text inside the table's scroller; without it the
  // absolutely placed span widens the whole page on phones.
  return (
    <span className="relative inline-flex items-center justify-end gap-1.5">
      {tone !== "good" ? (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: STATUS_COLOR[tone] }}
        />
      ) : null}
      {money(value)}
      {tone !== "good" ? (
        <span className="sr-only">
          , over the {money(gate)} per {noun} gate
        </span>
      ) : null}
    </span>
  );
}

type Filter = "all" | ClientStatus;

function ClientsTable({ d }: { d: DeliveryPayload }) {
  const [filter, setFilter] = useState<Filter>("all");
  const counts = useMemo(() => {
    const out: Record<ClientStatus, number> = {
      bad: 0,
      watch: 0,
      good: 0,
      "no-data": 0,
    };
    for (const r of d.clients) out[r.status] += 1;
    return out;
  }, [d.clients]);
  const rows = useMemo(
    () =>
      filter === "all" ? d.clients : d.clients.filter(r => r.status === filter),
    [d.clients, filter],
  );

  const columns: Column<ClientRow>[] = [
    {
      key: "client",
      header: "Client",
      cell: r => (
        // On phones the status column is hidden, so a dot before the name carries it.
        <span className="relative flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full sm:hidden"
            style={{
              backgroundColor:
                STATUS[r.status].tone === "neutral"
                  ? "var(--ceo-deemphasis)"
                  : STATUS_COLOR[STATUS[r.status].tone],
            }}
          />
          <span
            title={r.client}
            className="block max-w-36 truncate font-medium text-foreground sm:max-w-64"
          >
            {r.client}
          </span>
          <span className="sr-only sm:hidden">, {STATUS[r.status].label}</span>
        </span>
      ),
      sortValue: r => r.client,
    },
    {
      key: "status",
      header: "Status",
      hideBelow: "sm",
      cell: r => (
        <StatusChip
          tone={STATUS[r.status].tone}
          label={STATUS[r.status].label}
        />
      ),
      sortValue: r => STATUS[r.status].order,
    },
    {
      key: "campaigns",
      header: "Campaigns",
      numeric: true,
      cell: r => count(r.campaigns),
      sortValue: r => r.campaigns,
      hideBelow: "lg",
    },
    {
      key: "spend",
      header: "Spend",
      numeric: true,
      cell: r => money(r.spend7d),
      sortValue: r => r.spend7d,
    },
    {
      key: "leads",
      header: "Leads",
      numeric: true,
      cell: r => count(r.leads7d),
      sortValue: r => r.leads7d,
    },
    {
      key: "cpl",
      header: "Cost per lead",
      numeric: true,
      cell: r => <GateCell value={r.cpl7d} gate={d.gates.cpl} noun="lead" />,
      sortValue: r => r.cpl7d,
    },
    {
      key: "bookings",
      header: "Bookings",
      numeric: true,
      cell: r => count(r.bookings7d),
      sortValue: r => r.bookings7d,
    },
    {
      key: "cpb",
      header: "Cost per booking",
      numeric: true,
      cell: r => <GateCell value={r.cpb7d} gate={d.gates.cpb} noun="booking" />,
      sortValue: r => r.cpb7d,
    },
  ];

  const chip = (key: ClientStatus): FilterOption<Filter> => ({
    key,
    label: STATUS[key].label,
    count: counts[key],
    tone: STATUS[key].tone,
    hint: statusHint(key, d.gates),
  });
  const options: FilterOption<Filter>[] = [
    { key: "all", label: "All", count: d.clients.length },
    chip("bad"),
    chip("watch"),
    chip("good"),
    ...(counts["no-data"] > 0 ? [chip("no-data")] : []),
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={r => r.clickupTaskId ?? r.client}
      caption="Clients with ad spend in the last 7 days"
      search={{ placeholder: "Search clients", text: r => r.client }}
      filters={
        <FilterChips
          options={options}
          value={filter}
          onChange={setFilter}
          ariaLabel="Show clients by status"
        />
      }
      emptyText={
        filter === "all"
          ? "No client spent on ads in the last 7 days."
          : "No clients in this group."
      }
      stickyFirst
    />
  );
}

// --- Launches and account issues -------------------------------------------------

function Launches({ d }: { d: DeliveryPayload }) {
  const { inFlight, stuck } = d.launches;
  return (
    <div className="min-w-0">
      <dl className="grid grid-cols-2 gap-4">
        <div className="min-w-0">
          <dt className="text-[13px] text-muted-foreground">In flight</dt>
          <dd className="mt-0.5 text-2xl font-semibold tracking-tight text-foreground">
            {count(inFlight)}
          </dd>
          <dd className="text-xs text-muted-foreground">
            Clients in an onboarding stage
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[13px] text-muted-foreground">Stuck</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            {count(stuck.length)}
            {stuck.length > 0 ? (
              <StatusChip tone="warning" label="Past launch target" />
            ) : null}
          </dd>
          <dd className="text-xs text-muted-foreground">
            Onboarding longer than the target
          </dd>
        </div>
      </dl>

      {stuck.length === 0 ? (
        <EmptyState
          icon={inFlight > 0 ? Rocket : CircleCheck}
          title="No launch is stuck"
          text={
            inFlight > 0
              ? `${plural(inFlight, "launch", "launches")} in flight, all within the target.`
              : undefined
          }
          compact
          className="mt-4"
        />
      ) : (
        <ol className="mt-5 min-w-0 border-t border-[color:var(--ceo-grid)]">
          {stuck.map((s, i) => (
            <li
              key={`${s.client}-${i}`}
              className="flex min-w-0 items-start justify-between gap-3 border-b border-[color:var(--ceo-grid)] py-3 last:border-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-foreground">
                  {s.client}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {s.blocker ?? "No blocker recorded."}
                </p>
              </div>
              <span className="shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums text-foreground">
                {plural(s.days, "day")}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function AccountIssues({ d }: { d: DeliveryPayload }) {
  if (d.accountIssues.length === 0)
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No ad account issues"
        text="Every client ad account on the board can spend."
        compact
      />
    );
  return (
    <ul className="min-w-0">
      {d.accountIssues.map((a, i) => (
        <li
          key={`${a.client}-${i}`}
          className="flex min-w-0 items-start gap-2.5 border-b border-[color:var(--ceo-grid)] py-3 first:pt-0 last:border-0 last:pb-0"
        >
          <OctagonAlert
            className="mt-0.5 size-4 shrink-0"
            style={{ color: "var(--ceo-critical)" }}
            aria-label="Account issue"
          />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-foreground">
              {a.client}
            </p>
            <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">
              {a.issue}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
