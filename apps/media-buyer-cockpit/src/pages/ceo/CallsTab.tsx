import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { type Column, DataTable } from "@/components/ceo/DataTable";
import { FilterChips } from "@/components/ceo/FilterChips";
import {
  count,
  date,
  dateTime,
  decimal,
  kuwaitDay,
  pct,
  seconds,
} from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { TabLink } from "@/components/ceo/TabLink";
import { Button } from "@/components/ui/button";
import { api } from "../../../convex/_generated/api";
import {
  type CallCenterMetrics,
  type CallCenterReport,
  callCenterRange,
  parseCallCenterReport,
} from "../../../convex/ceo/callCenterContract";
import type { CeoTabProps } from "./types";

const FIELD =
  "h-9 rounded-md border bg-background px-2 text-sm text-foreground tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
type View = "overall" | "callers" | "clients" | "daily";
type Focus = "calling" | "outcomes";
/** The quick ranges, as the chips beside the dates; "custom" is any other pair of dates. */
type Preset = "1" | "7" | "30" | "custom";
const PRESETS: { key: Exclude<Preset, "custom">; label: string }[] = [
  { key: "1", label: "Today" },
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
];
const VIEWS: { key: View; label: string }[] = [
  { key: "overall", label: "Overall" },
  { key: "callers", label: "Per caller" },
  { key: "clients", label: "Per client" },
  { key: "daily", label: "Day by day" },
];
type TableRow = CallCenterMetrics & { key: string; label: string };
const before = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
const valueText = (values: CallCenterMetrics["values"]) =>
  values.length
    ? values
        .map(
          v => `${v.currency ?? "Unspecified currency"} ${decimal(v.value, 3)}`,
        )
        .join(" · ")
    : "n/a";

/** How each group of numbers is counted, folded one heading at a time. */
const READING: { title: string; text: string }[] = [
  {
    title: "Calls and leads",
    text: "Dials are saved dispositions with a note. Actual calls, connections and response time use Maqsam evidence. New leads, dialed leads and contacted leads use leads created in the selected dates; contacted means a completed call with talk time and may include voicemail. A missing or ambiguous call link stays unverified.",
  },
  {
    title: "Working time",
    text: "Speed starts when the lead arrives and stops at its first actual dial, counting only the first caller’s working hours. The 2-minute share includes all new leads in the selected cohort, including those with no verified dial. Missing schedules have no invented response time. Average call gap removes ringing and talk time.",
  },
  {
    title: "Bookings",
    text: "Confirmed means the main or online booking calendar. Provisional is shown separately. New appointments count by booking creation date; reschedules are not a second booking. Unknown calendar classifications are shown separately. Delivery retains its separate appointment-date view.",
  },
  {
    title: "Outcomes and ownership",
    text: "Show rate is shows ÷ (shows + no-shows); close rate is closed projects ÷ shown appointments. Client sheet outcomes remain authoritative. Leads belong to the first verified caller, otherwise Unassigned; caller rows do not invent who should have called an untouched lead. Project values retain their recorded currencies.",
  },
];

/** One date window and source for the company, callers and client comparison. */
export function CallsTab({ sections, now, day, goTab }: CeoTabProps) {
  const stored = sections.calls?.payload?.report;
  const today = day ?? kuwaitDay(now);
  const [from, setFrom] = useState(stored?.from ?? before(today, 29));
  const [to, setTo] = useState(stored?.to ?? today);
  const [custom, setCustom] = useState<CallCenterReport | null>(null);
  const [view, setView] = useState<View>("overall");
  const [focus, setFocus] = useState<Focus>("calling");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const load = useAction(api.ceo.queries.callCenterReport);
  const report = custom ?? stored;
  const stale = !custom && sections.calls && !sections.calls.ok;
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );

  async function read(start = from, end = to) {
    const id = ++request.current;
    setError(null);
    try {
      callCenterRange(start, end);
      setBusy(true);
      const result = await load({ from: start, to: end });
      if (id === request.current)
        setCustom(parseCallCenterReport(result, start, end));
    } catch {
      if (id === request.current)
        setError(
          "The report could not be refreshed. Check the dates (up to 93 days), then retry. Any report below still shows its original dates and timestamp.",
        );
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  function preset(days: number) {
    const start = before(today, days - 1);
    setFrom(start);
    setTo(today);
    void read(start, today);
  }
  // The chip that matches the dates on screen, so a quick range reads as chosen.
  const activePreset: Preset =
    PRESETS.find(p => to === today && from === before(today, Number(p.key) - 1))
      ?.key ?? "custom";
  const rows: TableRow[] = !report
    ? []
    : view === "callers"
      ? report.callers.map(r => ({
          ...r,
          key: r.email ?? "unassigned",
          label: r.name || r.email || "Unassigned",
        }))
      : view === "clients"
        ? report.clients.map(r => ({
            ...r,
            key: r.id ?? "unassigned",
            label: r.name || "Unassigned client",
          }))
        : report.daily.map(r => ({ ...r, key: r.day, label: r.day }));

  return (
    <div className="@container grid min-w-0 gap-4 lg:gap-6">
      <SectionCard
        title="Call center scorecard"
        kicker="Shared with dialer"
        order={0}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
            <label className="grid gap-1 text-xs text-muted-foreground">
              From
              <input
                type="date"
                className={FIELD}
                value={from}
                max={today}
                onChange={e => setFrom(e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              To
              <input
                type="date"
                className={FIELD}
                value={to}
                max={today}
                onChange={e => setTo(e.target.value)}
              />
            </label>
            <Button type="button" disabled={busy} onClick={() => void read()}>
              {busy ? "Loading…" : "Load report"}
            </Button>
            <FilterChips
              ariaLabel="Date presets"
              value={activePreset}
              onChange={key => {
                if (!busy && key !== "custom") preset(Number(key));
              }}
              options={PRESETS}
              className="basis-full sm:basis-auto sm:pb-1"
            />
          </div>
          {stale ? (
            <p role="status" className="text-sm text-destructive">
              The latest scheduled report failed to refresh. The last good
              report remains below with its original dates. Use Load report to
              retry.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {report ? (
            <p className="text-sm text-muted-foreground">
              Showing{" "}
              <strong className="font-medium text-foreground">
                {date(report.from)} to {date(report.to)}
              </strong>
              , Kuwait dates. Calculated{" "}
              {dateTime(Date.parse(report.generatedAt), now)}. Import coverage
              is listed below.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Load the shared report to see the same call center figures as the
              dialer. Previous independent call-center calculations have been
              retired.
            </p>
          )}
          <FilterChips
            ariaLabel="Scorecard view"
            value={view}
            onChange={setView}
            options={VIEWS}
            className="border-t pt-4"
          />
        </div>
      </SectionCard>

      {report && view === "overall" ? (
        <Overview metrics={report.overall} />
      ) : null}
      {report && view !== "overall" ? (
        <SectionCard
          title={
            view === "callers"
              ? "Caller comparison"
              : view === "clients"
                ? "Client comparison"
                : "Daily results"
          }
          order={1}
          actions={
            <FilterChips
              ariaLabel="Metric columns"
              value={focus}
              onChange={setFocus}
              options={[
                { key: "calling", label: "Calling & response" },
                { key: "outcomes", label: "Bookings & outcomes" },
              ]}
            />
          }
        >
          <DataTable
            key={`${view}:${focus}`}
            rows={rows}
            columns={columns(focus, view)}
            rowKey={r => r.key}
            initialSort={{
              key: view === "daily" ? "label" : "dials",
              dir: "desc",
            }}
            stickyFirst
            search={
              view === "daily"
                ? undefined
                : {
                    placeholder:
                      view === "clients" ? "Find a client" : "Find a caller",
                    text: r => r.label,
                  }
            }
            caption={`${view} call center metrics, ${report.from} to ${report.to}`}
            emptyText="No matching activity is recorded in this range."
          />
        </SectionCard>
      ) : null}

      {report ? (
        <SectionCard
          title="How to read these numbers"
          order={2}
          notes={report.warnings.map(text => ({ level: "info", text }))}
          actions={
            // Working hours live on the roster; the speed rules below read them.
            <TabLink tab="team" label="Team & payroll" goTab={goTab} />
          }
        >
          {/* Each rule folds under its heading, so the card is a list of
              four questions until one needs answering. */}
          <div className="divide-y text-sm">
            {READING.map(r => (
              <details key={r.title} className="py-3 first:pt-0">
                <summary className="text-sm font-medium text-foreground">
                  {r.title}
                </summary>
                <p className="mt-2 max-w-prose leading-relaxed text-muted-foreground">
                  {r.text}
                </p>
              </details>
            ))}
            <details className="py-3 last:pb-0">
              <summary className="text-sm font-medium text-foreground">
                Source coverage
              </summary>
              <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted-foreground">
                Supabase shared report v{report.version}. Current roster
                schedules and date exceptions apply to history; recorded breaks
                and effective-dated schedule history are not available. Mahara’s
                own sales funnel remains separate.
              </p>
              <dl className="mt-3 grid gap-2 text-xs text-muted-foreground @lg:grid-cols-2">
                {Object.entries(report.coverage)
                  .filter(
                    ([, value]) =>
                      value === null ||
                      ["string", "number", "boolean"].includes(typeof value),
                  )
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt className="font-medium text-foreground">
                        {key
                          .replace(/([a-z])([A-Z])/g, "$1 $2")
                          .replaceAll("_", " ")}
                      </dt>
                      <dd>{value === null ? "Unavailable" : String(value)}</dd>
                    </div>
                  ))}
              </dl>
            </details>
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}

function Overview({ metrics: m }: { metrics: CallCenterMetrics }) {
  return (
    <>
      <SectionCard title="Lead response" order={1}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 @xl:grid-cols-4">
          <StatTile
            variant="plain"
            label="New leads"
            value={count(m.leads)}
            sub={`${count(m.noVerifiedDial)} with no verified dial`}
          />
          <StatTile
            variant="plain"
            label="Leads dialed"
            value={count(m.leadsDialed)}
            sub={`${count(m.leadsContacted)} contacted`}
          />
          <StatTile
            variant="plain"
            label="Average speed to lead"
            value={seconds(m.avgSpeedSeconds)}
            sub={`Median ${seconds(m.medianSpeedSeconds)} · ${count(m.speedSamples)} timed leads`}
            hint="Working time from creation to first actual dial; untimed leads are excluded from the average and median."
          />
          <StatTile
            variant="plain"
            label="Within 2 working minutes"
            value={pct(m.withinTwoMinutesRate)}
            sub={`${count(m.withinTwoMinutes)} of ${count(m.leads)} new leads`}
          />
        </div>
      </SectionCard>
      <SectionCard title="Calling activity" order={2}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 @xl:grid-cols-4">
          <StatTile
            variant="plain"
            label="Dials"
            value={count(m.dials)}
            sub="Saved dispositions with notes"
          />
          <StatTile
            variant="plain"
            label="Actual calls"
            value={count(m.providerDials)}
            sub={`${count(m.connections)} connected · ${pct(m.connectionRate)}`}
          />
          <StatTile
            variant="plain"
            label="Talk time"
            value={`${decimal(m.talkSeconds / 60)} min`}
          />
          <StatTile
            variant="plain"
            label="Average call gap"
            value={seconds(m.avgCallGapSeconds)}
            sub={`${count(m.callGapSamples)} measured gaps`}
          />
        </div>
      </SectionCard>
      <SectionCard title="Bookings and client outcomes" order={3}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 @xl:grid-cols-4">
          <StatTile
            variant="plain"
            label="Confirmed bookings"
            value={count(m.confirmedBookings)}
            sub="Main and online calendar"
          />
          <StatTile
            variant="plain"
            label="Provisional bookings"
            value={count(m.provisionalBookings)}
            sub="Not confirmed appointments"
          />
          <StatTile
            variant="plain"
            label="Show rate"
            value={pct(m.showRate)}
            sub={`${count(m.shows)} shows · ${count(m.noShow)} no-shows`}
          />
          <StatTile
            variant="plain"
            label="Close rate"
            value={pct(m.closeRate)}
            sub={`${count(m.closed)} projects · ${valueText(m.values)}`}
          />
        </div>
        {m.unclassifiedBookings > 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {count(m.unclassifiedBookings)} bookings have an unclassified
            calendar and are outside the two booking totals.
          </p>
        ) : null}
      </SectionCard>
    </>
  );
}

function columns(focus: Focus, view: View): Column<TableRow>[] {
  const identity: Column<TableRow> = {
    key: "label",
    header:
      view === "callers" ? "Caller" : view === "clients" ? "Client" : "Day",
    cell: r => (
      <span className="block min-w-32 max-w-56 whitespace-normal font-medium">
        {view === "daily" ? date(r.label) : r.label}
      </span>
    ),
    sortValue: r => r.label,
  };
  const metric = (
    key: keyof CallCenterMetrics,
    header: string,
    format = count,
  ): Column<TableRow> => ({
    key,
    header,
    numeric: true,
    cell: r => format(r[key] as number | null),
    sortValue: r => r[key] as number | null,
  });
  return [
    identity,
    metric("dials", "Dials"),
    ...(focus === "calling"
      ? [
          metric("providerDials", "Actual calls"),
          metric("connections", "Connected"),
          metric("connectionRate", "Connect rate", pct),
          metric("leads", "New leads"),
          metric("leadsDialed", "Leads dialed"),
          metric("leadsContacted", "Contacted"),
          metric("noVerifiedDial", "No verified dial"),
          metric("avgSpeedSeconds", "Avg speed", seconds),
          metric("medianSpeedSeconds", "Median speed", seconds),
          metric("speedSamples", "Timed leads"),
          metric("withinTwoMinutesRate", "Within 2 min", pct),
          metric("avgCallGapSeconds", "Avg call gap", seconds),
          metric("callGapSamples", "Gap samples"),
        ]
      : [
          metric("confirmedBookings", "Confirmed"),
          metric("provisionalBookings", "Provisional"),
          metric("unclassifiedBookings", "Unclassified"),
          metric("shows", "Shows"),
          metric("noShow", "No-shows"),
          metric("showRate", "Show rate", pct),
          metric("closed", "Closed projects"),
          metric("closeRate", "Close rate", pct),
          {
            key: "values",
            header: "Project value",
            numeric: true,
            cell: (r: TableRow) => valueText(r.values),
          },
        ]),
  ];
}
