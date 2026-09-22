import { type ReactNode, useMemo } from "react";
import { ColumnChart } from "@/components/ceo/ColumnChart";
import { type Column, DataTable } from "@/components/ceo/DataTable";
import { Delta } from "@/components/ceo/Delta";
import {
  change,
  count,
  date,
  dateTime,
  decimal,
  diff,
  hour,
  isNum,
  kuwaitDay,
  minutes,
  pct,
  plural,
  relative,
  seconds,
} from "@/components/ceo/format";
import { Hint } from "@/components/ceo/Hint";
import { Na, Value } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { gateTone, StatusChip } from "@/components/ceo/StatusChip";
import { TimeSeriesChart } from "@/components/ceo/TimeSeriesChart";
import { cn } from "@/lib/utils";
import type {
  CallsPayload,
  CallWindow,
  Note,
} from "../../../convex/ceo/payloads";
import { daysLabel } from "../../../convex/ceo/workingHours";
import { CallsSettingsCard } from "./callsSettings";
import { CallsTimeframeCard } from "./timeframeCards";
import type { CeoTabProps } from "./types";

type AgentRow = CallsPayload["byAgent"][number];
type ClientRow = CallsPayload["perClient7d"][number];

/** The first call should reach a new lead within this many minutes. */
const SPEED_TARGET_MIN = 5;
/** An agent with a call this recent reads as on shift. */
const ACTIVE_MS = 30 * 60_000;
/** The hours the by-hour chart always shows, widened by any calls outside them. */
const DAY_FRAME = { from: 9, to: 21 };

/** Talk time reads in hours past an hour; format.minutes turns 48 hours into days, which is wrong for talk. */
function talk(v: number | null | undefined): string {
  if (!isNum(v)) return minutes(v);
  if (v === 0) return "0 min";
  if (v < 60) return minutes(v);
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  if (h >= 10) return `${count(Math.round(v / 60))} h`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Shifts a "YYYY-MM-DD" day by whole days. */
function shiftDay(day: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days))
    .toISOString()
    .slice(0, 10);
}

const LEAD_NOTE =
  /per-client|speed to lead|lead sync|lead phone|client table|no call yet/i;
const AGENT_NOTE = /maqsam accounts|receives inbound/i;
const HISTORY_NOTE = /one-off import|history to/i;

/** Dials, connects, agents, hours, per-client calls and speed to lead. */
export function CallsTab({ sections, now, day }: CeoTabProps) {
  const section = sections.calls;
  const payload = section?.payload ?? null;
  const today = day ?? kuwaitDay(now);
  const computedDay = section?.computedAt
    ? kuwaitDay(section.computedAt)
    : today;
  const behind = computedDay !== today;
  const yesterdayLabel = behind ? date(shiftDay(computedDay, -1)) : "Yesterday";

  // Each note shows once, on the card whose numbers it qualifies.
  const notes = useMemo(() => {
    const out = {
      top: [] as Note[],
      daily: [] as Note[],
      agents: [] as Note[],
      leads: [] as Note[],
    };
    for (const n of payload?.notes ?? []) {
      if (LEAD_NOTE.test(n.text)) out.leads.push(n);
      else if (AGENT_NOTE.test(n.text)) out.agents.push(n);
      else if (HISTORY_NOTE.test(n.text)) out.daily.push(n);
      else out.top.push(n);
    }
    return out;
  }, [payload]);

  const topNotes: Note[] = behind
    ? [
        {
          level: "warn",
          text: `These numbers were computed on ${date(computedDay)} and have not refreshed since, so today means ${date(computedDay)}.`,
        },
        ...notes.top,
      ]
    : notes.top;

  const lastCall = payload?.lastCallAt ?? null;

  // With nothing to show, one card says so instead of six identical empty states.
  if (!payload)
    return (
      <div className="grid min-w-0">
        <SectionCard title="Calls" section={section}>
          {() => null}
        </SectionCard>
      </div>
    );

  return (
    <div className="@container grid min-w-0 gap-4 lg:gap-6">
      <SectionCard
        kicker={behind ? date(computedDay) : "Today so far"}
        title="Call centre"
        section={section}
        notes={topNotes}
        order={0}
        actions={
          payload ? (
            <Hint content={isNum(lastCall) ? relative(lastCall, now) : null}>
              <button
                type="button"
                className="cursor-default rounded-sm text-xs text-muted-foreground tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Last call {isNum(lastCall) ? dateTime(lastCall, now) : "n/a"}
              </button>
            </Hint>
          ) : null
        }
      >
        {d => <Headline d={d} yesterdayLabel={yesterdayLabel} />}
      </SectionCard>

      <div className="grid min-w-0 gap-4 lg:gap-6 @4xl:grid-cols-12">
        <CallsTimeframeCard
          section={section}
          rows={payload?.daily ?? []}
          now={now}
          day={day}
          order={1}
          className="@4xl:col-span-12"
        />

        <SectionCard
          kicker="Last 7 days"
          title="Gap between calls"
          section={section}
          order={2}
          className="@4xl:col-span-12"
        >
          {d => <GapBody d={d} />}
        </SectionCard>

        <SectionCard
          kicker="Last 30 days"
          title="Dials and connected per day"
          section={section}
          notes={notes.daily}
          order={1}
          className="@4xl:col-span-7"
        >
          {d => <DailyChart d={d} computedDay={computedDay} />}
        </SectionCard>
        <SectionCard
          kicker={behind ? date(computedDay) : "Today"}
          title="Dials and connected by hour"
          section={section}
          order={2}
          className="@4xl:col-span-5"
        >
          {d => (
            <HourChart
              d={d}
              when={behind ? `on ${date(computedDay)}` : "today"}
            />
          )}
        </SectionCard>
      </div>

      <SectionCard
        kicker={
          behind
            ? `${date(computedDay)} and last 7 days`
            : "Today and last 7 days"
        }
        title="Agents"
        section={section}
        notes={notes.agents}
        order={3}
      >
        {d => <AgentsTable d={d} now={now} behind={behind} />}
      </SectionCard>

      <div className="grid min-w-0 items-start gap-4 lg:gap-6 @5xl:grid-cols-12">
        <SectionCard
          kicker="Last 7 days"
          title="Calls per client"
          section={section}
          order={4}
          className="@5xl:col-span-8"
        >
          {d => <ClientsTable d={d} />}
        </SectionCard>
        <div className="grid min-w-0 gap-4 lg:gap-6 @5xl:col-span-4">
          <SectionCard
            kicker="Last 7 days"
            title="Speed to lead"
            section={section}
            notes={notes.leads}
            order={5}
          >
            {d => <SpeedToLead d={d} />}
          </SectionCard>
          <CallsSettingsCard inForce={payload.workingHours} order={6} />
        </div>
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

/** Yesterday and the last 7 days under a tile's value, with the 7-day change below them. */
function WindowLines({
  yesterdayLabel,
  yesterday,
  last7,
  delta,
}: {
  yesterdayLabel: string;
  yesterday: string;
  last7: string;
  delta: ReactNode;
}) {
  return (
    <div className="border-t border-[color:var(--ceo-grid)] pt-2 text-xs leading-5 text-muted-foreground">
      <dl className="space-y-0.5">
        <div className="flex min-w-0 items-baseline justify-between gap-2">
          <dt className="min-w-0 truncate">{yesterdayLabel}</dt>
          <dd className="shrink-0 font-medium tabular-nums text-foreground">
            <Value value={yesterday} />
          </dd>
        </div>
        <div className="flex min-w-0 items-baseline justify-between gap-2">
          <dt className="min-w-0 truncate">Last 7 days</dt>
          <dd className="shrink-0 font-medium tabular-nums text-foreground">
            <Value value={last7} />
          </dd>
        </div>
      </dl>
      <div className="flex min-w-0 justify-end text-right [&>span]:justify-end">
        {delta}
      </div>
    </div>
  );
}

type TileSpec = {
  key: string;
  label: string;
  format: (v: number | null | undefined) => string;
  pick: (c: CallWindow) => number | null;
  delta: ReactNode;
  hint?: string;
  naHint?: string;
};

function Headline({
  d,
  yesterdayLabel,
}: {
  d: CallsPayload;
  yesterdayLabel: string;
}) {
  const { today: t, yesterday: y, last7: w, prevLast7: p } = d;
  const vs = "vs prior 7 days";

  const tiles: TileSpec[] = [
    {
      key: "dials",
      label: "Dials",
      format: count,
      pick: c => c.dials,
      delta: <Delta value={change(w.dials, p.dials)} vs={vs} />,
      hint: "Outbound calls with one agent.",
    },
    {
      key: "connected",
      label: "Connected",
      format: count,
      pick: c => c.connected,
      delta: <Delta value={change(w.connected, p.connected)} vs={vs} />,
      hint: "Outbound calls answered with some talk time. Can include voicemail.",
    },
    {
      key: "rate",
      label: "Connect rate",
      format: pct,
      pick: c => c.connectRate,
      delta: (
        <Delta
          value={diff(w.connectRate, p.connectRate)}
          kind="points"
          vs={vs}
        />
      ),
      hint: "Connected calls as a share of dials.",
      naHint: "No dials yet, so there is no connect rate.",
    },
    {
      key: "talk",
      label: "Talk time",
      format: talk,
      pick: c => c.talkMinutes,
      delta: <Delta value={change(w.talkMinutes, p.talkMinutes)} vs={vs} />,
      hint: isNum(t.avgTalkSec)
        ? `Time on connected outbound calls. Today averages ${seconds(t.avgTalkSec)} per connected call.`
        : "Time on connected outbound calls.",
    },
    {
      key: "conversations",
      // A no-break space keeps "90 s" together when the label wraps.
      label: "Conversations over 90\u00a0s",
      format: count,
      pick: c => c.conversations90s,
      delta: (
        <Delta value={change(w.conversations90s, p.conversations90s)} vs={vs} />
      ),
      hint: "Connected calls that lasted 90 seconds or more. The Backend tab calls the same number conversations today.",
    },
  ];

  return (
    <div className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border bg-[var(--ceo-grid)] @xl:grid-cols-6 @4xl:grid-cols-5">
      {tiles.map((s, i) => (
        <div
          key={s.key}
          className={cn("flex min-w-0 flex-col bg-card p-4", TILE_SPANS[i])}
        >
          <StatTile
            variant="plain"
            label={s.label}
            value={s.format(s.pick(t))}
            hint={s.hint}
            naHint={s.naHint}
          />
          {/* On the cell floor, so the lines align across a row whatever the label wraps to. */}
          <div className="mt-auto pt-3">
            <WindowLines
              yesterdayLabel={yesterdayLabel}
              yesterday={s.format(s.pick(y))}
              last7={s.format(s.pick(w))}
              delta={s.delta}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * How long agents are off the phone between their own calls, counted in
 * working minutes only (Aziz, 2026-09-22). Talk time says how long they were
 * on; this says how long they were not, during hours somebody is meant to be
 * dialling. An overnight or a weekend is never idle time, so the number is
 * about the shift and not about the calendar.
 *
 * The median leads because one long break drags a mean. The count over half an
 * hour is the part worth acting on: a median of three minutes with nineteen
 * half-hour holes is a different week from a steady eight.
 */
function GapBody({ d }: { d: CallsPayload }) {
  const h = d.workingHours;
  const hoursLine = h
    ? `${h.start} to ${h.end}, ${daysLabel(h.days)}`
    : "the hours set on this tab";
  const g = d.gap;
  if (!g || (!g.last7 && !g.today))
    return (
      <p className="text-sm text-muted-foreground">
        No gap to measure yet. It needs two calls by the same agent on the same
        working day.
      </p>
    );
  const w = g.last7;
  const t = g.today;
  return (
    <div className="grid min-w-0 gap-5">
      <div className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-5 @xl:grid-cols-4">
        <StatTile
          variant="plain"
          label="Median gap, 7 days"
          value={<Value value={minutes(w?.medianMin)} />}
          hint="The middle gap between one call ending and the next starting, working minutes only."
        />
        <StatTile
          variant="plain"
          label="Gaps over 30 minutes"
          value={<Value value={count(w?.over30)} />}
          hint="Over the last 7 days. This is the number worth asking about."
        />
        <StatTile
          variant="plain"
          label="Longest gap"
          value={<Value value={minutes(w?.longestMin)} />}
          hint="The single longest stretch inside working hours in the last 7 days."
        />
        <StatTile
          variant="plain"
          label="Median gap today"
          value={<Value value={minutes(t?.medianMin)} />}
          hint={
            t
              ? `Across ${t.gaps} gap${t.gaps === 1 ? "" : "s"} so far today.`
              : "Nothing to measure yet today."
          }
        />
      </div>
      <p className="ceo-facts">
        {w
          ? `${count(w.gaps)} gaps measured over 7 days, mean ${minutes(w.meanMin)}. `
          : ""}
        Counted on the working clock, {hoursLine}. A gap longer than a full
        working day is left out: that is a day off, not somebody sitting still.
      </p>
    </div>
  );
}

// --- Charts ---------------------------------------------------------------------

function DailyChart({
  d,
  computedDay,
}: {
  d: CallsPayload;
  computedDay: string;
}) {
  // The day the numbers were computed is still in progress; its dip would read as a drop.
  const rows = d.daily.filter(r => r.date < computedDay);
  const dials = rows.reduce((s, r) => s + r.dials, 0);
  const connected = rows.reduce((s, r) => s + r.connected, 0);
  const first = rows[0]?.date;
  const last = rows.at(-1)?.date;
  return (
    <TimeSeriesChart
      data={rows}
      series={[
        { key: "dials", label: "Dials" },
        { key: "connected", label: "Connected" },
      ]}
      unit="count"
      summary="Full days only"
      height={240}
      ariaLabel={`Dials and connected calls per day from ${date(first)} to ${date(last)}: ${count(dials)} dials and ${count(connected)} connected, a ${pct(dials ? connected / dials : null)} connect rate.`}
      emptyText="No full days of calls yet."
    />
  );
}

/** `when` is "today", or "on Mon 14 Sep" when the numbers are from an earlier day. */
function HourChart({ d, when }: { d: CallsPayload; when: string }) {
  const { rows, busiest } = useMemo(() => {
    const active = d.byHourToday.filter(h => h.dials > 0 || h.connected > 0);
    const from = Math.min(DAY_FRAME.from, ...active.map(h => h.hour));
    const to = Math.max(DAY_FRAME.to, ...active.map(h => h.hour));
    const byHour = new Map(d.byHourToday.map(h => [h.hour, h]));
    const framed = [];
    for (let h = from; h <= to; h++) {
      const row = byHour.get(h);
      framed.push({
        hour: h,
        dials: row?.dials ?? 0,
        connected: row?.connected ?? 0,
      });
    }
    const top = active.reduce<(typeof active)[number] | null>(
      (best, h) => (!best || h.dials > best.dials ? h : best),
      null,
    );
    return { rows: active.length ? framed : [], busiest: top };
  }, [d.byHourToday]);

  return (
    <ColumnChart
      data={rows}
      x="hour"
      series={[
        { key: "dials", label: "Dials" },
        { key: "connected", label: "Connected" },
      ]}
      unit="count"
      formatX={h => String(Number(h))}
      formatXLong={h => {
        const n = Number(h);
        return `${hour(n)} to ${n >= 23 ? "24:00" : hour(n + 1)}`;
      }}
      xHeader="Hour"
      capLabel="max"
      height={240}
      summary={busiest ? `Busiest ${hour(busiest.hour)}` : undefined}
      ariaLabel={
        busiest
          ? `Dials and connected calls by Kuwait hour ${when}. Busiest hour ${hour(busiest.hour)} with ${plural(busiest.dials, "dial")} and ${count(busiest.connected)} connected.`
          : `Dials and connected calls by Kuwait hour ${when}. No calls yet.`
      }
      emptyText={when === "today" ? "No calls yet today." : `No calls ${when}.`}
    />
  );
}

// --- Agents -----------------------------------------------------------------------

function AgentsTable({
  d,
  now,
  behind,
}: {
  d: CallsPayload;
  now: number;
  /** The numbers are from an earlier day, so "today" would be wrong. */
  behind: boolean;
}) {
  const columns: Column<AgentRow>[] = [
    {
      key: "agent",
      header: "Agent",
      cell: r => {
        const active = isNum(r.lastCallAt) && now - r.lastCallAt <= ACTIVE_MS;
        return (
          <span className="inline-flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{
                backgroundColor: active ? "var(--ceo-good)" : "transparent",
              }}
            />
            <span className="max-w-48 truncate font-medium text-foreground">
              {r.agent}
            </span>
            {active ? (
              <span className="sr-only">, called in the last 30 minutes</span>
            ) : null}
          </span>
        );
      },
      sortValue: r => r.agent,
    },
    {
      key: "todayDials",
      header: behind ? "Dials" : "Dials today",
      numeric: true,
      cell: r => count(r.today.dials),
      sortValue: r => r.today.dials,
    },
    {
      key: "todayConnected",
      header: "Connected",
      numeric: true,
      cell: r => count(r.today.connected),
      sortValue: r => r.today.connected,
    },
    {
      key: "todayRate",
      header: "Connect rate",
      numeric: true,
      cell: r => <Value value={pct(r.today.connectRate)} />,
      sortValue: r => r.today.connectRate,
    },
    {
      key: "todayTalk",
      header: "Talk time",
      numeric: true,
      cell: r => talk(r.today.talkMinutes),
      sortValue: r => r.today.talkMinutes,
    },
    {
      key: "gap",
      header: "Gap, 7 days",
      numeric: true,
      // The median, because one long break drags a mean. Beside it, how many
      // of this agent's gaps ran past half an hour, which is the part to ask
      // about.
      cell: r => (
        <span className="inline-flex min-w-0 items-baseline gap-1.5">
          <Value value={minutes(r.gap7d?.medianMin)} />
          {r.gap7d?.over30 ? (
            <span className="text-xs text-muted-foreground">
              {count(r.gap7d.over30)} over 30
            </span>
          ) : null}
        </span>
      ),
      sortValue: r => r.gap7d?.medianMin ?? null,
    },
    {
      key: "weekDials",
      header: "7-day dials",
      numeric: true,
      cell: r => count(r.last7.dials),
      sortValue: r => r.last7.dials,
    },
    {
      key: "weekRate",
      header: "7-day rate",
      numeric: true,
      cell: r => <Value value={pct(r.last7.connectRate)} />,
      sortValue: r => r.last7.connectRate,
    },
    {
      key: "weekTalk",
      header: "7-day talk",
      numeric: true,
      cell: r => talk(r.last7.talkMinutes),
      sortValue: r => r.last7.talkMinutes,
      hideBelow: "lg",
    },
    {
      key: "lastCall",
      header: "Last call",
      numeric: true,
      cell: r =>
        isNum(r.lastCallAt) ? (
          <span className="text-muted-foreground">
            {dateTime(r.lastCallAt, now)}
          </span>
        ) : (
          <Na />
        ),
      sortValue: r => r.lastCallAt,
    },
  ];

  return (
    <DataTable
      rows={d.byAgent}
      columns={columns}
      rowKey={r => r.agent}
      initialSort={{ key: "todayDials", dir: "desc" }}
      caption="Call centre agents, today and the last 7 days"
      emptyText="No agent has dialed in the last 30 days."
      stickyFirst
    />
  );
}

// --- Lead-linked numbers ---------------------------------------------------------

function ClientsTable({ d }: { d: CallsPayload }) {
  const columns: Column<ClientRow>[] = [
    {
      key: "client",
      header: "Client",
      cell: r => (
        <span
          title={r.client}
          className="block max-w-36 truncate font-medium text-foreground sm:max-w-56"
        >
          {r.client}
        </span>
      ),
      sortValue: r => r.client,
    },
    {
      key: "dials",
      header: "Dials",
      numeric: true,
      cell: r => count(r.dials),
      sortValue: r => r.dials,
    },
    {
      key: "connected",
      header: "Connected",
      numeric: true,
      cell: r => count(r.connected),
      sortValue: r => r.connected,
    },
    {
      key: "rate",
      header: "Connect rate",
      numeric: true,
      cell: r => <Value value={pct(r.dials ? r.connected / r.dials : null)} />,
      sortValue: r => (r.dials ? r.connected / r.dials : null),
    },
    {
      key: "leads",
      header: "Leads called",
      numeric: true,
      cell: r => count(r.leadsCalled),
      sortValue: r => r.leadsCalled,
    },
    {
      key: "perLead",
      header: "Calls per lead",
      numeric: true,
      cell: r => <Value value={decimal(r.callsPerLead)} />,
      sortValue: r => r.callsPerLead,
    },
  ];

  return (
    <DataTable
      rows={d.perClient7d}
      columns={columns}
      rowKey={r => r.clickupTaskId ?? r.client}
      initialSort={{ key: "dials", dir: "desc" }}
      search={
        d.perClient7d.length > 8
          ? { placeholder: "Search clients", text: r => r.client }
          : undefined
      }
      limit={10}
      caption="Dials per client over the last 7 days"
      emptyText="No dials matched to client leads yet."
      stickyFirst
    />
  );
}

function SpeedToLead({ d }: { d: CallsPayload }) {
  const s = d.speedToLead;
  // Older payloads carry no working clock; then the plain clock is the figure.
  const hasWorking = s.workingMedianMinutes7d !== undefined;
  const working = s.workingMedianMinutes7d ?? null;
  const plain = s.medianMinutes7d;
  const main = hasWorking ? working : plain;
  const share = hasWorking
    ? (s.workingWithin5minShare7d ?? null)
    : s.within5minShare7d;
  const tone = gateTone(main, SPEED_TARGET_MIN);
  const noSample =
    s.sample === 0
      ? "No new lead has been called in this window yet."
      : undefined;
  const hours = d.workingHours;
  const hoursText = hours
    ? `${hours.start} to ${hours.end}, ${daysLabel(hours.days)}`
    : null;

  return (
    <div className="min-w-0 space-y-5">
      <StatTile
        variant="plain"
        label="Median time to first call"
        value={
          isNum(main) ? (
            <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span>{minutes(main)}</span>
              {hasWorking ? (
                <span className="text-sm font-normal tracking-normal text-muted-foreground">
                  {minutes(plain)} on the plain clock
                </span>
              ) : null}
            </span>
          ) : (
            minutes(main)
          )
        }
        naHint={noSample}
        status={
          isNum(main) ? (
            <StatusChip
              tone={tone}
              label={
                tone === "good"
                  ? `Within ${SPEED_TARGET_MIN} min`
                  : `Over ${SPEED_TARGET_MIN} min`
              }
            />
          ) : null
        }
        sub={
          <>
            {hasWorking ? (
              <span className="block">
                Working minutes only
                {hoursText ? `, ${hoursText}` : ""}
              </span>
            ) : null}
            {s.sample > 0 ? (
              <span className="block">
                Across {plural(s.sample, "called lead")}
                {s.since ? ` since ${date(s.since)}` : ""}
              </span>
            ) : null}
          </>
        }
        hint={
          hasWorking
            ? "From the moment a Done For You lead lands to the first outbound call to that phone, on the working clock: it starts at the later of the lead's creation and the next working window, and only working minutes count. The plain clock counts every minute. Leads not called yet are left out of both."
            : "From the moment a Done For You lead lands to the first outbound call to that phone. Leads not called yet are left out. The working clock fills in after the next refresh."
        }
      />

      <div className="min-w-0 border-t border-[color:var(--ceo-grid)] pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13px] text-muted-foreground">
            Called within {SPEED_TARGET_MIN}
            {hasWorking ? " working" : ""} minutes
          </p>
          <p className="text-lg font-semibold tracking-tight text-foreground">
            <Value value={pct(share)} hint={noSample} />
          </p>
        </div>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--ceo-emphasis-track)]"
          aria-hidden
        >
          {isNum(share) ? (
            <div
              className="h-full rounded-full"
              style={{
                width: `${(Math.min(1, Math.max(0, share)) * 100).toFixed(2)}%`,
                minWidth: share > 0 ? 4 : 0,
                backgroundColor: "var(--ceo-emphasis)",
              }}
            />
          ) : null}
        </div>
        {hasWorking ? (
          <p className="mt-2 text-xs text-muted-foreground">
            On the plain clock:{" "}
            <span className="font-medium text-foreground tabular-nums">
              <Value value={pct(s.within5minShare7d)} hint={noSample} />
            </span>
            . A call before the clock starts counts as 0 minutes.
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          {s.since
            ? `Counting starts ${date(s.since)}, the first day calls carry the lead phone.`
            : "Counting starts on the first day calls carry the lead phone."}
        </p>
      </div>
    </div>
  );
}
