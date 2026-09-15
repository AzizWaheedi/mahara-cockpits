import { CircleCheck, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { type Column, DataTable } from "@/components/ceo/DataTable";
import { FilterChips, type FilterOption } from "@/components/ceo/FilterChips";
import {
  capitalize,
  count,
  dateTime,
  humanize,
  isNum,
  minutes,
  plural,
  relative,
} from "@/components/ceo/format";
import { Hint } from "@/components/ceo/Hint";
import { Na } from "@/components/ceo/Na";
import { RefreshButton } from "@/components/ceo/RefreshButton";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import {
  StatusChip,
  StatusDot,
  type StatusTone,
} from "@/components/ceo/StatusChip";
import {
  type AnyCeoSection,
  type CeoSections,
  SECTION_KEYS,
  type SectionKey,
  STALE_AFTER_MS,
} from "@/components/ceo/useCeo";
import type { MachinePayload } from "../../../convex/ceo/payloads";
import {
  feedState,
  jobState,
  type MachineState as State,
  syncEvery,
  syncState,
} from "./machineState";
import type { CeoTabProps } from "./types";

type Job = MachinePayload["jobs"][number];
type Source = MachinePayload["sources"][number];
type Feed = MachinePayload["feeds"][number];

/** Display names for the cockpit's own data sources (keys from the health runbook). */
const SOURCE_LABELS: Record<string, string> = {
  meta: "Meta ads",
  clickup: "ClickUp",
  sheets: "Google Sheets",
  docs: "Google Docs",
  calendar: "Google Calendar",
  ghl: "GoHighLevel",
  fathom: "Fathom call recordings",
  slack: "Slack",
  bridge_csm: "Client success cockpit",
  bridge_creative: "Creative cockpit",
  whapi: "WhatsApp (WHAPI)",
  resend: "Email (Resend)",
  jobs: "Scheduled jobs",
  hermes: "Hermes",
};

const SECTION_NAMES: Record<SectionKey, string> = {
  money: "Money",
  growth: "Growth",
  delivery: "Client delivery",
  calls: "Calls",
  clients: "Clients",
  team: "Team",
  portal: "Client portal",
  machine: "Machine and data trust",
};

const PROJECT: Record<Feed["project"], string> = {
  b2b: "B2B",
  triage: "Creative Triage",
};

/** "ceo refresh" as "CEO refresh": job keys are lower case in the ledger. */
const jobName = (job: string) =>
  capitalize(job).replace(/\b(ceo|kpi|ai|eod)\b/gi, w => w.toUpperCase());

const sourceLabel = (key: string) => SOURCE_LABELS[key] ?? humanize(key);

const severity: Record<StatusTone, number> = {
  critical: 0,
  serious: 1,
  warning: 2,
  neutral: 3,
  good: 4,
};

/** "a, b and c". */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function sourceState(s: Source): State {
  // The ledger lists every known source, including ones never checked yet.
  if (typeof s.ok !== "boolean")
    return { tone: "neutral", label: "Not checked" };
  return s.ok
    ? { tone: "good", label: "Working" }
    : { tone: "serious", label: "Failing" };
}

function sectionState(s: AnyCeoSection | null, now: number): State {
  if (!s) return { tone: "neutral", label: "Not computed" };
  if (!s.ok) return { tone: "serious", label: "Refresh failed" };
  if (now - s.computedAt > STALE_AFTER_MS)
    return { tone: "warning", label: "Stale" };
  return { tone: "good", label: "Fresh" };
}

/** Sync age, jobs, sources, outside feeds, the Hermes queue and every section's trust. */
export function MachineTab({ sections, now }: CeoTabProps) {
  const machine = sections.machine;
  const payload = machine?.payload ?? null;
  // Warnings lead on the status card; the explanatory notes sit with the feeds they explain.
  const warn = payload?.notes.filter(n => n.level === "warn") ?? [];
  const info = payload?.notes.filter(n => n.level !== "warn") ?? [];

  return (
    <div className="grid gap-4 lg:gap-6">
      <SectionCard
        title="Machine status"
        section={machine}
        notes={warn}
        order={0}
      >
        {p => <Status m={p} now={now} />}
      </SectionCard>

      {payload ? (
        <>
          <SectionCard
            title="Outside feeds"
            section={machine}
            notes={info}
            order={1}
          >
            {p => <Feeds feeds={p.feeds} now={now} />}
          </SectionCard>
          <div className="grid gap-4 2xl:grid-cols-2 2xl:items-start 2xl:gap-6">
            <SectionCard title="Cockpit jobs" section={machine} order={2}>
              {p => <Jobs jobs={p.jobs} now={now} />}
            </SectionCard>
            <SectionCard
              title="Cockpit data sources"
              section={machine}
              order={3}
            >
              {p => <Sources sources={p.sources} now={now} />}
            </SectionCard>
          </div>
        </>
      ) : null}

      <SectionCard
        title="CEO sections"
        order={4}
        actions={<RetrySections sections={sections} now={now} />}
      >
        <SectionsTrust sections={sections} now={now} />
      </SectionCard>
    </div>
  );
}

// --- Status ---

function Status({ m, now }: { m: MachinePayload; now: number }) {
  const feedsBad = m.feeds.filter(f => !f.ok).length;
  const everyMin = syncEvery(m);
  const sync = syncState(m.syncAgeMin, everyMin);
  const ok: State = { tone: "good", label: "OK" };

  const problems: string[] = [];
  if (m.failingJobs) problems.push(`${plural(m.failingJobs, "job")} failing`);
  if (m.staleJobs) problems.push(`${plural(m.staleJobs, "job")} overdue`);
  if (m.failingSources)
    problems.push(`${plural(m.failingSources, "data source")} failing`);
  if (feedsBad)
    problems.push(`${plural(feedsBad, "outside feed")} not healthy`);
  if (m.hermes.failed)
    problems.push(`${plural(m.hermes.failed, "Hermes task")} failed`);
  if (sync.tone === "serious" && isNum(m.syncAgeMin))
    problems.push(`the cockpit sync last ran ${minutes(m.syncAgeMin)} ago`);

  const chip = (s: State) => <StatusChip tone={s.tone} label={s.label} />;

  return (
    <div className="@container space-y-5">
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-lg bg-muted/60 px-3 py-2.5"
      >
        {problems.length === 0 ? (
          <CircleCheck
            className="mt-0.5 size-4 shrink-0"
            style={{ color: "var(--ceo-good)" }}
            aria-hidden
          />
        ) : (
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0"
            style={{ color: "var(--ceo-warning)" }}
            aria-hidden
          />
        )}
        <p className="text-sm leading-5 text-foreground">
          {problems.length === 0
            ? "Everything is running."
            : `${capitalize(joinList(problems))}.`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 @xl:grid-cols-3 @5xl:grid-cols-6">
        <StatTile
          variant="plain"
          label="Cockpit sync age"
          value={
            isNum(m.syncAgeMin)
              ? m.syncAgeMin < 1
                ? "Just now"
                : minutes(m.syncAgeMin)
              : null
          }
          naHint="The cockpit sync has not reported a run yet"
          status={isNum(m.syncAgeMin) ? chip(sync) : null}
          sub={`Runs every ${minutes(everyMin)}`}
        />
        <StatTile
          variant="plain"
          label="Failing jobs"
          value={count(m.failingJobs)}
          status={chip(
            m.failingJobs ? { tone: "critical", label: "Failing" } : ok,
          )}
          sub={`of ${plural(m.jobs.length, "scheduled job")}`}
        />
        <StatTile
          variant="plain"
          label="Overdue jobs"
          value={count(m.staleJobs)}
          status={chip(
            m.staleJobs ? { tone: "warning", label: "Overdue" } : ok,
          )}
          sub="No run in 3 intervals"
        />
        <StatTile
          variant="plain"
          label="Failing sources"
          value={count(m.failingSources)}
          status={chip(
            m.failingSources ? { tone: "serious", label: "Failing" } : ok,
          )}
          sub={`of ${plural(m.sources.length, "data source")}`}
        />
        <StatTile
          variant="plain"
          label="Outside feeds not healthy"
          value={m.feeds.length ? count(feedsBad) : null}
          naHint="Outside feed health could not be read this run"
          status={
            m.feeds.length
              ? chip(feedsBad ? { tone: "serious", label: "Behind" } : ok)
              : null
          }
          sub={
            m.feeds.length ? `of ${plural(m.feeds.length, "feed")}` : undefined
          }
        />
        <StatTile
          variant="plain"
          label="Hermes queue"
          value={count(m.hermes.queued)}
          status={chip(
            m.hermes.failed
              ? { tone: "warning", label: `${count(m.hermes.failed)} failed` }
              : ok,
          )}
          sub={
            isNum(m.hermes.lastDoneAt)
              ? `Last task done ${relative(m.hermes.lastDoneAt, now)}`
              : "No finished task on record"
          }
        />
      </div>
    </div>
  );
}

// --- Tables ---

function When({
  at,
  now,
  naHint,
}: {
  at: number | null | undefined;
  now: number;
  naHint: string;
}) {
  if (!isNum(at)) return <Na hint={naHint} />;
  return (
    <Hint content={dateTime(at, now)} side="left">
      <time
        dateTime={new Date(at).toISOString()}
        className="whitespace-nowrap tabular-nums"
      >
        {relative(at, now)}
      </time>
    </Hint>
  );
}

/** Name on top, the error in muted text under it, so the reason never needs a hover. */
function NameWithError({ name, error }: { name: string; error?: string }) {
  return (
    <div className="min-w-0">
      <p className="font-medium text-foreground">{name}</p>
      {error ? (
        <p className="mt-0.5 line-clamp-2 max-w-md break-words text-xs leading-relaxed text-muted-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type ProjectFilter = "all" | Feed["project"];

function Feeds({ feeds, now }: { feeds: Feed[]; now: number }) {
  const [project, setProject] = useState<ProjectFilter>("all");

  // Problems first, then the longest behind.
  const sorted = useMemo(
    () =>
      [...feeds].sort(
        (a, b) =>
          severity[feedState(a).tone] - severity[feedState(b).tone] ||
          (b.lagMin ?? -1) - (a.lagMin ?? -1) ||
          a.name.localeCompare(b.name),
      ),
    [feeds],
  );
  const rows =
    project === "all" ? sorted : sorted.filter(f => f.project === project);

  const columns: Column<Feed>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Feed",
        cell: f => <NameWithError name={f.name} error={f.error} />,
        sortValue: f => f.name,
        className: "min-w-56",
      },
      {
        key: "status",
        header: "Status",
        cell: f => {
          const s = feedState(f);
          return <StatusChip tone={s.tone} label={s.label} />;
        },
        sortValue: f => severity[feedState(f).tone],
      },
      {
        key: "last",
        header: "Last success",
        numeric: true,
        cell: f => (
          <When
            at={f.lastSuccessAt}
            now={now}
            naHint="No successful sync on record"
          />
        ),
        sortValue: f => f.lastSuccessAt,
      },
      {
        key: "project",
        header: "System",
        cell: f => (
          <span className="whitespace-nowrap text-muted-foreground">
            {PROJECT[f.project]}
          </span>
        ),
        sortValue: f => PROJECT[f.project],
        hideBelow: "md",
      },
    ],
    [now],
  );

  const options: FilterOption<ProjectFilter>[] = [
    { key: "all", label: "All", count: feeds.length },
    {
      key: "b2b",
      label: PROJECT.b2b,
      count: feeds.filter(f => f.project === "b2b").length,
    },
    {
      key: "triage",
      label: PROJECT.triage,
      count: feeds.filter(f => f.project === "triage").length,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(f, i) => `${f.project}-${f.name}-${i}`}
      filters={
        <FilterChips
          options={options}
          value={project}
          onChange={setProject}
          ariaLabel="Show feeds from"
        />
      }
      caption="Outside feeds with their status and last successful sync"
      emptyText="No outside feed health was read this run"
    />
  );
}

function Jobs({ jobs, now }: { jobs: Job[]; now: number }) {
  const rows = useMemo(
    () =>
      [...jobs].sort(
        (a, b) =>
          severity[jobState(a, now).tone] - severity[jobState(b, now).tone] ||
          a.job.localeCompare(b.job),
      ),
    [jobs, now],
  );
  const columns: Column<Job>[] = useMemo(
    () => [
      {
        key: "job",
        header: "Job",
        cell: j => <NameWithError name={jobName(j.job)} error={j.error} />,
        sortValue: j => j.job,
        className: "min-w-44",
      },
      {
        key: "status",
        header: "Status",
        cell: j => {
          const s = jobState(j, now);
          return <StatusChip tone={s.tone} label={s.label} />;
        },
        sortValue: j => severity[jobState(j, now).tone],
      },
      {
        key: "at",
        header: "Last run",
        numeric: true,
        cell: j => <When at={j.at} now={now} naHint="No run on record" />,
        sortValue: j => j.at,
      },
      {
        key: "every",
        header: "Every",
        numeric: true,
        cell: j => minutes(j.everyMin),
        sortValue: j => j.everyMin,
        hideBelow: "sm",
      },
      {
        key: "streak",
        header: "Fails in a row",
        numeric: true,
        cell: j =>
          j.streak > 0 ? (
            <span className="inline-flex items-center justify-end gap-1.5">
              <StatusDot
                tone={j.streak >= 3 ? "critical" : "warning"}
                label="Failing streak"
              />
              {count(j.streak)}
            </span>
          ) : (
            <span className="text-muted-foreground">0</span>
          ),
        sortValue: j => j.streak,
      },
    ],
    [now],
  );
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={j => j.job}
      caption="Cockpit scheduled jobs"
      emptyText="No scheduled job has reported yet"
    />
  );
}

function Sources({ sources, now }: { sources: Source[]; now: number }) {
  const rows = useMemo(
    () =>
      [...sources].sort(
        (a, b) =>
          severity[sourceState(a).tone] - severity[sourceState(b).tone] ||
          sourceLabel(a.source).localeCompare(sourceLabel(b.source)),
      ),
    [sources],
  );
  const columns: Column<Source>[] = useMemo(
    () => [
      {
        key: "source",
        header: "Source",
        cell: s => (
          <NameWithError
            name={sourceLabel(s.source)}
            error={s.ok === false ? s.lastError : undefined}
          />
        ),
        sortValue: s => sourceLabel(s.source),
        className: "min-w-44",
      },
      {
        key: "status",
        header: "Status",
        cell: s => {
          const st = sourceState(s);
          return <StatusChip tone={st.tone} label={st.label} />;
        },
        sortValue: s => severity[sourceState(s).tone],
      },
      {
        key: "ok",
        header: "Last good",
        numeric: true,
        cell: s => (
          <When
            at={s.lastOkAt}
            now={now}
            naHint="No successful check on record"
          />
        ),
        sortValue: s => s.lastOkAt,
      },
    ],
    [now],
  );
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={s => s.source}
      caption="Cockpit data sources"
      emptyText="No data source has reported yet"
    />
  );
}

// --- CEO sections ---

/** One retry for every section that failed, went stale or never ran. */
function RetrySections({
  sections,
  now,
}: {
  sections: CeoSections;
  now: number;
}) {
  const keys = SECTION_KEYS.filter(
    key =>
      sectionState(sections[key] as AnyCeoSection | null, now).tone !== "good",
  );
  if (!keys.length) return null;
  return (
    <RefreshButton
      only={keys}
      size="sm"
      label={`Retry ${plural(keys.length, "section")}`}
    />
  );
}

type SectionRow = { key: SectionKey; section: AnyCeoSection | null };

function SectionsTrust({
  sections,
  now,
}: {
  sections: CeoSections;
  now: number;
}) {
  const rows: SectionRow[] = SECTION_KEYS.map(key => ({
    key,
    section: sections[key] as AnyCeoSection | null,
  }));

  const columns: Column<SectionRow>[] = [
    {
      key: "section",
      header: "Section",
      cell: r => (
        <NameWithError
          name={r.section?.label ?? SECTION_NAMES[r.key]}
          error={
            r.section?.ok === false ? (r.section.error ?? undefined) : undefined
          }
        />
      ),
      sortValue: r => r.section?.label ?? SECTION_NAMES[r.key],
      className: "min-w-48",
    },
    {
      key: "status",
      header: "Status",
      cell: r => {
        const s = sectionState(r.section, now);
        return <StatusChip tone={s.tone} label={s.label} />;
      },
      sortValue: r => severity[sectionState(r.section, now).tone],
    },
    {
      key: "computed",
      header: "Last try",
      numeric: true,
      cell: r => (
        <When
          at={r.section?.computedAt || null}
          now={now}
          naHint="Not computed yet"
        />
      ),
      sortValue: r => r.section?.computedAt ?? null,
    },
    {
      key: "good",
      header: "Last good",
      numeric: true,
      cell: r => (
        <When
          at={r.section?.lastOkAt}
          now={now}
          naHint="No successful refresh on record"
        />
      ),
      sortValue: r => r.section?.lastOkAt ?? null,
    },
    {
      key: "sources",
      header: "Sources",
      cell: r =>
        r.section?.sources.length ? (
          <ul className="flex min-w-64 flex-wrap gap-x-4 gap-y-1">
            {r.section.sources.map(s => (
              <li
                key={s.name}
                className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs"
                title={s.note}
              >
                <StatusDot
                  tone={s.ok ? "good" : "serious"}
                  label={s.ok ? "Working" : "Failing"}
                />
                <span className="text-foreground/85">{s.name}</span>
                {isNum(s.freshestAt) ? (
                  <span className="tabular-nums text-muted-foreground">
                    {relative(s.freshestAt, now)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-xs text-muted-foreground">None listed</span>
        ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={r => r.key}
      caption="Every CEO section with its refresh status and sources"
    />
  );
}
