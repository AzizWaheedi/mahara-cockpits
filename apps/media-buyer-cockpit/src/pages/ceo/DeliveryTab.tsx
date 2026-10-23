import {
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  OctagonAlert,
  Rocket,
  ShieldCheck,
} from "lucide-react";
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
import { Kicker } from "@/components/ceo/Kicker";
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
import { LeadSyncTable } from "@/components/LeadSync";
import {
  BOOKING_RATE_GATE,
  CLOSE_RATE_GATE,
  CPB_BAD,
  CPB_GATE,
  SHOW_RATE_GOOD,
} from "@/lib/kpi";
import { cn } from "@/lib/utils";
import type {
  DeliveryPayload,
  DeliveryWindow,
  Note,
} from "@/types/ceo/payloads";
import { dwyCell } from "./DoneWithYouCell";
import {
  BEFORE_CONFIRMED,
  CPB_CONFIRMED_LABEL,
  cpbConfirmedOf,
  daysHaveConfirmed,
  doneWithYouBookingsLine,
  doneWithYouLine,
  doneWithYouOf,
  FALLBACK_CONFIRMED,
  NOT_STORED,
} from "./deliveryCost";
import {
  cplOnlyOf,
  cplOnlyRule,
  DWY_BOOKINGS,
  noLeadClauses,
  statusRule,
  tooFewNote,
} from "./deliveryStatus";
import { DeliveryTimeframeCard } from "./timeframeCards";
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

/**
 * Aziz's status rule (2026-09-21) under the golden rule (2026-10-22): cost per
 * booking decides. The same words the adapter judges by
 * (hermes/ceo-refresh/native/adapters/delivery.js clientStatus), from
 * ./deliveryStatus.ts. A row judged on cost per lead alone (Done With You, or
 * bookings not measured) gets that rule instead, never the booking rule.
 */
function statusHint(status: ClientStatus, row?: ClientRow): string {
  const only = row ? cplOnlyOf(row) : null;
  return only ? cplOnlyRule(status, only, row?.noLeadLine) : statusRule(status);
}

/**
 * The row's own reason under its status: too few to judge on leads (decision
 * 4, 23 Oct 2026), too early on bookings, or why some spend is not measured.
 * Too few and too early read together when both hold (Madana, $11.09).
 */
function rowStatusNote(r: ClientRow): string {
  const few = tooFewNote(r);
  const fewNote = few ? ` ${few}` : "";
  if (r.tooEarly)
    return `${fewNote} Too early to judge: no confirmed booking yet on ${money(r.spendMeasured7d ?? r.spend7d)} of spend, within the ${money(CPB_GATE)} gate.`;
  if (cplOnlyOf(r) === "dwy") return fewNote;
  return `${fewNote}${r.bookingsWhy ? ` ${r.bookingsWhy}` : ""}`;
}

/** Spend with no lead, in the words the campaign verdicts use (decision 4). */
const NO_LEAD = noLeadClauses();

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
    hint: `Cost per lead over the gate but within 50%, or ${NO_LEAD.watch}. Watch, do not scale.`,
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
    hint: `${capitalize(NO_LEAD.bad)}, or cost per lead more than 50% over the gate.`,
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

/** A window's cost per confirmed booking (./deliveryCost.ts), or null. */
const cpbOf = (w: DeliveryWindow) => cpbConfirmedOf(w).value;

/**
 * What the cost per confirmed booking leaves out of a window's spend, in one
 * line: spend whose bookings the board does not store, with what it would
 * read over that spend too, then Done With You spend (decision 2, 23 Oct
 * 2026), which is never added back.
 */
export function notMeasuredLine(w: DeliveryWindow): string {
  const left = w.notMeasured ?? [];
  const dwy = doneWithYouLine(doneWithYouOf(w));
  if (left.length === 0) return dwy;
  const total = left.reduce((n, x) => n + x.spend, 0);
  const names = left
    .slice(0, 3)
    .map(x => `${x.client} ${money(x.spend)}`)
    .join(", ");
  // A payload from before 23 Oct 2026 has no measured split to add to.
  const counted = isNum(w.spendMeasured) ? w.spendMeasured + total : w.spend;
  return ` It leaves out ${money(total)} of spend whose bookings the board does not store (${names}${left.length > 3 ? ` and ${left.length - 3} more` : ""}); over all ${money(counted)}${(doneWithYouOf(w)?.spend ?? 0) > 0 ? ", done-with-you spend still left out," : ""} it would read ${money(isNum(w.confirmed) && w.confirmed > 0 ? counted / w.confirmed : null)}.${dwy}`;
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
      <LeadSyncTable />
      <SectionCard
        kicker="Last 7 days"
        title="Client ads"
        section={section}
        notes={topNotes}
        order={0}
      >
        {d => <Headline d={d} yesterdayLabel={yesterdayLabel} />}
      </SectionCard>

      <DeliveryTimeframeCard
        section={section}
        rows={payload?.daily ?? []}
        now={now}
        day={day}
        order={1}
      />

      <SectionCard
        title="Spend, leads and bookings per day"
        section={section}
        order={1}
      >
        {d => <DailyCharts d={d} />}
      </SectionCard>

      <SectionCard
        kicker="Right now"
        title="Campaign health"
        section={section}
        order={2}
      >
        {d => <CampaignHealth d={d} />}
      </SectionCard>

      <SectionCard
        kicker="Last 7 days"
        title="Clients with spend"
        section={section}
        notes={notes.clients}
        order={3}
      >
        {d => (
          <>
            <ClientsTable d={d} />
            <NoOutcomeLedger d={d} />
          </>
        )}
      </SectionCard>

      <div className="grid min-w-0 items-start gap-4 lg:gap-6 @4xl:grid-cols-2">
        <SectionCard
          kicker="Right now"
          title="Launches"
          section={section}
          notes={notes.launch}
          order={4}
        >
          {d => <Launches d={d} />}
        </SectionCard>
        <SectionCard
          kicker="Right now"
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
 * Five tiles straight on the card (no box inside the box). Phones get two
 * columns with the first tile across the top, mid widths a 2 over 3 split,
 * wide cards one row, so five tiles never leave an empty cell.
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
    <div className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-6 @xl:grid-cols-6 @4xl:grid-cols-5">
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
    <div className={cn("flex min-w-0 flex-col", className)}>
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
  const lines = (
    fmt: (v: number | null) => string,
    get: (w: DeliveryWindow) => number | null,
  ) => (
    <WindowLines
      rows={[
        { label: yesterdayLabel, value: fmt(get(y)) },
        { label: "This month, today so far", value: fmt(get(m)) },
      ]}
    />
  );
  const split = isNum(w.confirmed);
  // The board's counts by booking day since 2026-10-22; an older payload
  // counted meetings by the day they were for and says so.
  const byBookingDay = d.bookingSource === "board";
  const cost = cpbConfirmedOf(w, d.bookingSource);

  const tiles = [
    {
      key: "spend",
      lines: lines(money, x => x.spend),
      tile: (
        <StatTile
          variant="plain"
          label="Client ad spend"
          value={money(w.spend)}
          delta={
            <Delta
              value={change(w.spend, p.spend)}
              goodWhen="neither"
              vs={vs}
            />
          }
          hint="Meta spend on each client's whole ad account, in USD, as the Client Performance board counts it: Mahara's campaigns and any other campaign on the account (a client's own campaign before launch included), ads on the compromise list left out. The media buyer's screens count Mahara's campaigns only, so they can read lower. Mahara's own lead-gen spend is a different pool and sits on the Marketing tab. The two are never added."
        />
      ),
    },
    {
      key: "leads",
      lines: lines(count, x => x.leads),
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
      lines: lines(money, x => x.cpl),
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
      lines: lines(count, x => x.bookings),
      tile: (
        <StatTile
          variant="plain"
          label="Bookings"
          value={count(w.bookings)}
          naHint={byBookingDay ? NOT_STORED : undefined}
          delta={<Delta value={change(w.bookings, p.bookings)} vs={vs} />}
          sub={
            split ? (
              <span className="tabular-nums">
                {count(w.confirmed)} confirmed · {count(w.provisional ?? 0)}{" "}
                provisional
              </span>
            ) : undefined
          }
          hint={
            byBookingDay
              ? `Bookings made on these days, as the Client Performance board counts them (cockpit_client_days), by the Kuwait day the booking was made. Confirmed is main and online calendar bookings, leaving out cancelled, invalid, Google Calendar copies, the call centre's call-back bookings and rescheduled bookings whose original still counts; provisional is the Not Confirmed Appointments calendar; the headline is both.${doneWithYouBookingsLine(doneWithYouOf(w))}`
              : "Appointments on the client's booking calendars, on the day the meeting was for. This refresh predates the board's counts by booking day."
          }
        />
      ),
    },
    {
      key: "cpb",
      lines: lines(money, cpbOf),
      tile: (
        <StatTile
          variant="plain"
          label={CPB_CONFIRMED_LABEL}
          value={money(cost.value)}
          naHint={cost.why ?? undefined}
          status={gateChip(cost.value, gates.cpb, "booking")}
          delta={
            <Delta
              value={change(cost.value, cpbOf(p))}
              goodWhen="down"
              vs={vs}
            />
          }
          hint={
            cost.confirmed === null
              ? (cost.why ?? undefined)
              : `${money(cost.spend)} of spend divided by ${plural(cost.confirmed, "confirmed booking")} made in the last 7 days: spend only on the days the board stores bookings. The gate is ${money(gates.cpb)}; over ${money(CPB_BAD)} is off track.${notMeasuredLine(w)}${isNum(w.cpb) && w.cpb !== cost.value ? ` Over every booking, provisional included, it is ${money(w.cpb)}.` : ""}`
          }
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
  // Confirmed bookings by the day they were made, once the refresh reads the
  // board; a day the board stores nothing for is a gap, never a zero. An
  // older payload charts its own total, labelled as such.
  const confirmedSeries = daysHaveConfirmed(d.daily);
  const rows = useMemo(
    () =>
      d.daily.map(r => ({
        ...r,
        booked: confirmedSeries ? (r.confirmed ?? null) : r.bookings,
      })),
    [d.daily, confirmedSeries],
  );
  const total = (k: "spend" | "leads" | "booked") =>
    rows.reduce((s, r) => s + (isNum(r[k]) ? r[k] : 0), 0);
  const last = rows.at(-1);
  const span = rows.length
    ? `${date(rows[0].date)} to ${date(last?.date)}`
    : "no days";
  const spend = total("spend");
  const leads = total("leads");
  const bookings = total("booked");
  const bookingsTitle = confirmedSeries
    ? "Confirmed bookings made"
    : "Bookings";

  return (
    <div className="grid min-w-0 gap-x-6 gap-y-8 @4xl:grid-cols-3">
      <TimeSeriesChart
        initialRange="30d"
        data={rows}
        series={[{ key: "spend", label: "Client ad spend" }]}
        kind="area"
        unit="money"
        title="Client ad spend"
        summary={`${moneyCompact(spend)} total`}
        height={180}
        syncId="ceo-delivery-daily"
        ariaLabel={`Client ad spend per day, ${span}. ${money(spend)} in total, ${money(last?.spend)} on the last day.`}
      />
      <TimeSeriesChart
        initialRange="30d"
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
        initialRange="30d"
        data={rows}
        series={[{ key: "booked", label: bookingsTitle }]}
        kind="area"
        unit="count"
        title={bookingsTitle}
        summary={`${count(bookings)} total`}
        height={180}
        syncId="ceo-delivery-daily"
        ariaLabel={`Client ${bookingsTitle.toLowerCase()} per day, ${span}. ${count(bookings)} in total, ${count(last?.booked)} on the last day.`}
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
      <div className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-6 @xl:grid-cols-3">
        <div className="col-span-2 min-w-0 @xl:col-span-1">
          <StatTile
            variant="plain"
            label="Running on Meta"
            value={count(c.running)}
            sub="Campaigns live now, on the board"
          />
        </div>
        <div className="min-w-0">
          <StatTile
            variant="plain"
            label="Off on the board, still running"
            value={count(c.boardOffButRunning)}
            status={flag(c.boardOffButRunning)}
            sub="Marked off in ClickUp but live on Meta"
          />
        </div>
        <div className="min-w-0">
          <StatTile
            variant="plain"
            label="Spending, not on the board"
            value={count(c.spendingNotOnBoard)}
            status={flag(c.spendingNotOnBoard)}
            sub="Spend in 7 days with no board card, left out of these numbers"
          />
        </div>
      </div>

      <div className="min-w-0 border-t pt-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm font-medium text-foreground">
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
                  className="no-touch relative flex min-w-0 cursor-help items-center gap-1.5 rounded-sm text-sm text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  naHint,
}: {
  value: number | null;
  gate: number;
  noun: string;
  /** Why there is no value, when the row knows better than the default. */
  naHint?: string;
}) {
  if (!isNum(value))
    return (
      <Na
        hint={
          naHint ??
          (noun === "lead"
            ? "No leads in these 7 days"
            : "No confirmed booking was made for this client in these 7 days")
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

/**
 * The tone of a rate in percent against its gate: good at the gate, warning
 * down to the floor (seven tenths of the gate unless `bad` says otherwise),
 * serious below. The client show rate passes `bad` 0: under its one line is
 * watch, never serious (Aziz, 2026-09-21 and 2026-10-12).
 */
export function rateTone(
  p: number,
  gate: number,
  bad?: number,
): "good" | "warning" | "serious" {
  const floor = bad ?? gate * 0.7;
  return p >= gate ? "good" : p >= floor ? "warning" : "serious";
}

/**
 * A funnel rate against its gate, toned by rateTone: green at the gate, amber
 * down to the floor, red below. `detail` opens a tooltip with the figures
 * behind the rate.
 */
function RateCell({
  value,
  gate,
  bad,
  hint,
  detail,
  under = "below the gate",
}: {
  value: number | null;
  /** Percent at which the rate is good. */
  gate: number;
  /** What a rate under the gate is called, read out after the figure. */
  under?: string;
  /** Percent below which the rate is serious; default is 70% of the gate. */
  bad?: number;
  /** Why there is no rate. */
  hint: string;
  /** The counts behind the rate, shown on hover. */
  detail?: string;
}) {
  if (!isNum(value)) return <Na hint={hint} />;
  const tone = rateTone(value * 100, gate, bad);
  const inner = (
    <>
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: STATUS_COLOR[tone] }}
      />
      {pct(value)}
      <span className="sr-only">
        {tone === "good" ? ", at the gate" : `, ${under}`}
      </span>
    </>
  );
  if (!detail)
    return (
      <span className="relative inline-flex items-center gap-1.5 tabular-nums">
        {inner}
      </span>
    );
  return (
    <Hint content={detail}>
      <button
        type="button"
        className="no-touch relative inline-flex cursor-help items-center gap-1.5 rounded-sm tabular-nums underline decoration-muted-foreground/35 decoration-dotted underline-offset-4 after:absolute after:-inset-2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {inner}
      </button>
    </Hint>
  );
}

/** A number with a quieter line under it, right-aligned inside a numeric cell. */
function Stacked({ value, sub }: { value: ReactNode; sub?: ReactNode }) {
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span>{value}</span>
      {sub ? (
        <span className="text-xs font-normal leading-4 text-muted-foreground">
          {sub}
        </span>
      ) : null}
    </span>
  );
}

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
  const provisionalSynced = d.provisionalSynced === true;
  // Rows from a refresh before the board's counts carry no measured spend:
  // their cost per booking reads n/a with that reason, never the old figure.
  const rowCost = (r: ClientRow): number | null =>
    r.spendMeasured7d === undefined ? null : (r.cpbConfirmed7d ?? null);
  const rowCostWhy = (r: ClientRow): string => {
    if (r.spendMeasured7d === undefined)
      return d.bookingSource === "media sync"
        ? FALLBACK_CONFIRMED
        : BEFORE_CONFIRMED;
    if (cplOnlyOf(r) === "dwy") return DWY_BOOKINGS;
    if (r.confirmed7d === null)
      return r.bookingsWhy ?? "Bookings are not measured for this client.";
    if (r.tooEarly)
      return `Too early to judge: no confirmed booking yet on ${money(r.spendMeasured7d)} of spend, within the ${money(d.gates.cpb)} gate.`;
    return `No confirmed booking on ${money(r.spendMeasured7d)} of spend in these 7 days.`;
  };

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
            dir="auto"
            className="block max-w-36 truncate text-left font-medium text-foreground sm:max-w-64"
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
          className="min-w-max"
          hint={`${statusHint(r.status, r)}${rowStatusNote(r)}${
            isNum(r.costPerShownAt60)
              ? ` At a ${SHOW_RATE_GOOD}% show rate, a shown booking would cost ${money(r.costPerShownAt60)}.`
              : ""
          }`}
        />
      ),
      sortValue: r => STATUS[r.status].order,
    },
    {
      key: "campaigns",
      header: "Running",
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
      // The total and its split; n/a when the board stores none of these
      // days for the client (not measured, never zero).
      cell: r =>
        dwyCell(r) ??
        (isNum(r.bookings7d) ? (
          <Stacked
            value={count(r.bookings7d)}
            sub={
              provisionalSynced && isNum(r.confirmed7d)
                ? `${count(r.confirmed7d)} confirmed · ${count(r.provisional7d ?? 0)} provisional`
                : undefined
            }
          />
        ) : (
          <Na
            hint={r.bookingsWhy ?? "Bookings are not measured for this client."}
          />
        )),
      sortValue: r => r.bookings7d,
    },
    {
      key: "cpb",
      header: CPB_CONFIRMED_LABEL,
      numeric: true,
      // Done with you (decision 2): not judged, never n/a.
      cell: r =>
        dwyCell(r) ?? (
          <GateCell
            value={rowCost(r)}
            gate={d.gates.cpb}
            noun="booking"
            naHint={rowCostWhy(r)}
          />
        ),
      sortValue: r => rowCost(r),
    },
    {
      key: "bookRate",
      header: "Lead to booking",
      numeric: true,
      cell: r => {
        // Done with you (decision 2): the client books its own meetings.
        const dwy = dwyCell(r);
        if (dwy) return dwy;
        const x = r.rates30;
        // The confirmed rate is the main one; a payload from before the split carries only the whole.
        const main = x ? (x.bookRateConfirmed ?? x.bookRate) : null;
        return (
          <RateCell
            value={main}
            gate={BOOKING_RATE_GATE}
            hint={
              x && x.leads > 0
                ? "Bookings are not measured for this client in the last 30 days"
                : "No platform leads in the last 30 days"
            }
            detail={
              x && isNum(x.bookRateConfirmed)
                ? `Last 30 days, over ${plural(x.leads, "lead")}: ${pct(x.bookRateConfirmed)} booked a confirmed appointment (${count(x.confirmed)}), ${pct(x.bookRateProvisional)} a provisional one (${count(x.provisional)}), ${pct(x.bookRate)} either (${count(x.bookings)}).`
                : undefined
            }
          />
        );
      },
      sortValue: r =>
        cplOnlyOf(r) === "dwy"
          ? null
          : r.rates30
            ? (r.rates30.bookRateConfirmed ?? r.rates30.bookRate)
            : null,
    },
    {
      key: "showRate",
      header: "Show rate",
      numeric: true,
      cell: r => (
        <RateCell
          value={r.rates30?.showRate ?? null}
          gate={SHOW_RATE_GOOD}
          bad={0}
          under={`under the ${SHOW_RATE_GOOD}% line, a watch`}
          hint="No past meeting with an attendance recorded in the last 30 days"
          detail={
            r.rates30
              ? `Last 30 days: ${count(r.rates30.showed)} showed, ${count(r.rates30.noshow)} did not; the rest have no attendance recorded and count as neither. On track at ${SHOW_RATE_GOOD}%; there is no lower line.`
              : undefined
          }
        />
      ),
      sortValue: r => r.rates30?.showRate ?? null,
    },
    {
      key: "closeRate",
      header: "Close rate",
      numeric: true,
      cell: r => (
        <Stacked
          value={
            <RateCell
              value={r.rates30?.closeRate ?? null}
              gate={CLOSE_RATE_GATE}
              hint="No meeting shown in the last 30 days"
              detail={
                r.rates30
                  ? `Last 30 days: ${count(r.rates30.closes)} marked won by the client in Mahara OS, over ${count(r.rates30.showed)} shown.`
                  : undefined
              }
            />
          }
          sub={
            r.rates30 && (r.rates30.noOutcome ?? 0) > 0
              ? `${count(r.rates30.noOutcome)} no outcome`
              : undefined
          }
        />
      ),
      sortValue: r => r.rates30?.closeRate ?? null,
    },
  ];

  const chip = (key: ClientStatus): FilterOption<Filter> => ({
    key,
    label: STATUS[key].label,
    count: counts[key],
    tone: STATUS[key].tone,
    hint: statusHint(key),
  });
  const every: FilterOption<Filter>[] = [
    { key: "all", label: "All", count: d.clients.length },
    chip("bad"),
    chip("watch"),
    chip("good"),
    chip("no-data"),
  ];
  // A chip with nothing behind it is noise; the chosen one stays so it can be undone.
  const options = every.filter(
    o => o.key === "all" || o.key === filter || (o.count ?? 0) > 0,
  );

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={r => r.clickupTaskId ?? r.client}
      caption="Clients with ad spend in the last 7 days; the rates and the no-outcome counts cover the last 30 full days"
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

// --- Past appointments with no outcome ---------------------------------------------

/** The CRM's status word as a person would say it. */
function crmStatus(s: string | null): string {
  if (!s) return "No status";
  const words: Record<string, string> = {
    confirmed: "Confirmed",
    showed: "Showed",
    noshow: "No-show",
    new: "New",
  };
  return words[s] ?? capitalize(s);
}

/**
 * One client's past appointments that nobody has reported on, behind a
 * disclosure: day and time, calendar, CRM status. Never the contact.
 */
function ClientNoOutcome({ c }: { c: ClientRow }) {
  const total = c.rates30?.noOutcome ?? 0;
  const list = c.noOutcome ?? [];
  const newest = list[0]?.at;
  return (
    <li className="min-w-0">
      <details className="group min-w-0">
        <summary className="no-marker flex min-w-0 cursor-pointer select-none list-none items-center gap-2.5 rounded-sm py-2.5 text-sm hover:bg-[var(--ceo-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight
            className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
            aria-hidden
          />
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span
              dir="auto"
              className="min-w-0 max-w-full truncate text-left font-medium text-foreground"
            >
              {c.client}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {plural(total, "appointment")}
              {newest ? ` · newest ${date(newest)}` : ""}
            </span>
          </span>
        </summary>
        {list.length ? (
          <ol className="mb-3 ml-6 min-w-0 divide-y divide-[color:var(--ceo-grid)] rounded-xl bg-muted/40">
            {list.map((a, i) => (
              <li
                key={`${a.at}-${i}`}
                className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 px-3 py-1.5 text-xs"
              >
                <span className="whitespace-nowrap tabular-nums text-foreground">
                  {date(a.at)}, {a.at.slice(11, 16)}
                </span>
                <span className="truncate text-muted-foreground">
                  {a.calendar || "No calendar"}
                </span>
                <span className="whitespace-nowrap text-muted-foreground">
                  {crmStatus(a.status)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mb-3 ml-6 text-xs text-muted-foreground">
            The list was not stored with this payload; it fills in at the next
            refresh.
          </p>
        )}
        {total > list.length && list.length > 0 ? (
          <p className="mb-3 ml-6 text-xs text-muted-foreground tabular-nums">
            The newest {count(list.length)} of {count(total)}.
          </p>
        ) : null}
      </details>
    </li>
  );
}

/**
 * The appointments to chase: past, on a booking calendar, with no outcome in
 * Mahara OS and no mark on the attendance sheet, per client, most first.
 * The line above it says how much of the book has an outcome at all, so the
 * close rates in the table are read with their coverage.
 */
function NoOutcomeLedger({ d }: { d: DeliveryPayload }) {
  const rows = useMemo(
    () =>
      d.clients
        .filter(c => (c.rates30?.noOutcome ?? 0) > 0)
        .sort(
          (a, b) => (b.rates30?.noOutcome ?? 0) - (a.rates30?.noOutcome ?? 0),
        ),
    [d.clients],
  );
  const o = d.outcomes;
  const total = rows.reduce((s, c) => s + (c.rates30?.noOutcome ?? 0), 0);
  // A payload from before the outcomes read has nothing to show here.
  if (!o && rows.length === 0) return null;

  return (
    <div className="mt-6 min-w-0 border-t border-[color:var(--ceo-grid)] pt-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <Kicker className="mb-1.5">Last 30 days</Kicker>
          <h3 className="text-sm font-semibold leading-5 text-foreground">
            Past appointments with no outcome in Mahara OS
          </h3>
        </div>
        {o ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            {count(o.withOutcome)} of {count(o.pastAppointments)} past
            appointments across every client have an outcome
            {o.since ? `, reported since ${date(o.since)}` : ""} ·{" "}
            {count(o.won)} won · {count(total)} to chase below
          </p>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Every past appointment has an outcome"
          text="Nothing to chase in the last 30 days."
          compact
        />
      ) : (
        <ul className="min-w-0 divide-y divide-[color:var(--ceo-grid)]">
          {rows.map(c => (
            <ClientNoOutcome key={c.clickupTaskId ?? c.client} c={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Launches and account issues -------------------------------------------------

function Launches({ d }: { d: DeliveryPayload }) {
  const { inFlight, stuck } = d.launches;
  return (
    <div className="min-w-0">
      <dl className="grid grid-cols-2 gap-4">
        <div className="min-w-0">
          <dt className="text-sm text-muted-foreground">In flight</dt>
          <dd className="mt-0.5 text-2xl font-semibold tracking-tight text-foreground">
            {count(inFlight)}
          </dd>
          <dd className="text-xs text-muted-foreground">
            Clients in an onboarding stage
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-sm text-muted-foreground">Stuck</dt>
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
        <ol className="mt-6 min-w-0 border-t border-[color:var(--ceo-grid)]">
          {stuck.map((s, i) => (
            <li
              key={`${s.client}-${i}`}
              className="flex min-w-0 items-start justify-between gap-3 border-b border-[color:var(--ceo-grid)] py-3 last:border-0 last:pb-0"
            >
              <div className="min-w-0">
                <p
                  dir="auto"
                  className="truncate text-left text-sm font-medium text-foreground"
                >
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
            <p
              dir="auto"
              className="truncate text-left text-sm font-medium text-foreground"
            >
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
