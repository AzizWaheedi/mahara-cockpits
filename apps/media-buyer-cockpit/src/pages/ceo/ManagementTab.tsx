import { Users } from "lucide-react";
import { useMemo, useState } from "react";
import { BarList } from "@/components/ceo/BarList";
import { EmptyState } from "@/components/ceo/EmptyState";
import { FeedList, feedKindIcon } from "@/components/ceo/FeedList";
import { FilterChips, type FilterOption } from "@/components/ceo/FilterChips";
import {
  count,
  dateTime,
  decimal,
  humanize,
  isNum,
  pct,
  plural,
  relative,
} from "@/components/ceo/format";
import { Hint } from "@/components/ceo/Hint";
import { Value } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { ShowMore } from "@/components/ceo/ShowMore";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip, type StatusTone } from "@/components/ceo/StatusChip";
import { cn } from "@/lib/utils";
import type { FeedItem, TeamPerson } from "../../../convex/ceo/payloads";
import type { CeoTabProps } from "./types";

type EodDay = TeamPerson["eodYesterday"];

const EOD: Record<EodDay, { tone: StatusTone; label: string }> = {
  "on time": { tone: "good", label: "EOD on time" },
  late: { tone: "warning", label: "EOD late" },
  missed: { tone: "serious", label: "EOD missed" },
  "not due": { tone: "neutral", label: "No EOD due" },
};

type Cell = "on time" | "late" | "missed";

const CELL_LABEL: Record<Cell, string> = {
  "on time": "Filed on time",
  late: "Filed late",
  missed: "Missed",
};

// Feed kinds are free text from the backend; unknown ones get a tidied name.
const KIND_LABELS: Record<string, string> = {
  eod: "EODs",
  deal: "Deals",
  comment: "Client notes",
  meta: "Meta edits",
  board: "Board",
  cockpit: "Cockpit",
  change: "Changes",
  decision: "Decisions",
  hermes: "Hermes",
  question: "Questions",
  answer: "Answers",
};

const kindLabel = (kind: string) => KIND_LABELS[kind] ?? humanize(kind);

/** People, EOD discipline, the live feed and who acted today. */
export function TeamTab({ sections, now }: CeoTabProps) {
  const team = sections.team;
  const payload = team?.payload ?? null;

  if (!payload)
    return (
      <div className="grid gap-4 lg:gap-6">
        <SectionCard title="Team" section={team}>
          {() => null}
        </SectionCard>
      </div>
    );

  // Warnings (a failing EOD sync) belong beside the EOD numbers; the rule notes fill the quiet side column.
  const warn = payload.notes.filter(n => n.level === "warn");
  const info = payload.notes.filter(n => n.level !== "warn");

  return (
    <div className="grid gap-4 lg:gap-6">
      <SectionCard
        title={
          <>
            People
            <span className="ml-2 font-normal text-muted-foreground">
              {plural(payload.people.length, "person", "people")}
            </span>
          </>
        }
        section={team}
        notes={warn}
        order={0}
      >
        {p => <People people={p.people} now={now} />}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-3 lg:items-start lg:gap-6">
        <SectionCard
          kicker="Last 7 days"
          title="Live feed"
          section={team}
          order={1}
          className="lg:col-span-2"
        >
          {p => <Feed feed={p.feed} now={now} />}
        </SectionCard>
        <SectionCard
          title="Actions today"
          section={team}
          notes={info}
          order={2}
        >
          {p => <ActionsToday people={p.people} />}
        </SectionCard>
      </div>
    </div>
  );
}

// --- People ---

function People({ people, now }: { people: TeamPerson[]; now: number }) {
  if (people.length === 0)
    return (
      <EmptyState
        icon={Users}
        title="No team members found"
        text="People show once they file an EOD or hold a cockpit seat."
        compact
      />
    );

  return (
    <div className="@container space-y-6">
      <PeopleSummary people={people} />
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[color:var(--ceo-grid)] pt-5">
          <p className="text-[13px] text-muted-foreground">
            EODs over the last 14 working days, Fridays off
          </p>
          <EodLegend />
        </div>
        <ul className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
          {people.map(p => (
            <PersonCard key={p.key} person={p} now={now} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function PeopleSummary({ people }: { people: TeamPerson[] }) {
  const named = (state: EodDay) =>
    people.filter(p => p.eodYesterday === state).map(p => p.name);
  const due = people.filter(p => p.eodYesterday !== "not due").length;
  const onTime = named("on time");
  const late = named("late");
  const missed = named("missed");
  const who = (names: string[]) => (names.length ? names.join(", ") : "Nobody");
  const noneDue = "No EOD was due yesterday";

  const total = people.reduce(
    (t, p) => ({
      due: t.due + p.eod14.due,
      filed: t.filed + p.eod14.filed,
      late: t.late + p.eod14.late,
      missed: t.missed + p.eod14.missed,
    }),
    { due: 0, filed: 0, late: 0, missed: 0 },
  );

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 @3xl:grid-cols-4">
      <StatTile
        variant="plain"
        label="On time yesterday"
        value={due ? count(onTime.length) : null}
        naHint={noneDue}
        sub={due ? `of ${plural(due, "EOD")} due` : undefined}
      />
      <StatTile
        variant="plain"
        label="Late yesterday"
        value={due ? count(late.length) : null}
        naHint={noneDue}
        sub={due ? who(late) : undefined}
      />
      <StatTile
        variant="plain"
        label="Missed yesterday"
        value={due ? count(missed.length) : null}
        naHint={noneDue}
        sub={due ? who(missed) : undefined}
        status={
          missed.length > 0 ? (
            <StatusChip tone="serious" label="Follow up" />
          ) : null
        }
      />
      <StatTile
        variant="plain"
        label="On time, 14 working days"
        value={total.due ? pct((total.filed - total.late) / total.due) : null}
        naHint="No EODs were due in the last 14 working days"
        sub={
          total.due
            ? `${pct(total.filed / total.due)} filed, ${count(total.missed)} of ${count(total.due)} missed`
            : undefined
        }
      />
    </div>
  );
}

function PersonCard({ person, now }: { person: TeamPerson; now: number }) {
  const eod = EOD[person.eodYesterday] ?? EOD["not due"];
  const { due, filed, late, missed } = person.eod14;
  const detail =
    late || missed
      ? [
          late ? `${count(late)} late` : null,
          missed ? `${count(missed)} missed` : null,
        ]
          .filter(Boolean)
          .join(", ")
      : "All on time";

  return (
    <li className="flex min-w-0 flex-col rounded-lg border p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {person.name}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {person.role}
          </p>
        </div>
        <StatusChip tone={eod.tone} label={eod.label} hint="Yesterday's EOD" />
      </div>

      <div className="mt-4 flex-1">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted-foreground">EODs</span>
          <span className="tabular-nums text-foreground">
            {due > 0
              ? `${count(filed)} of ${count(due)} filed`
              : "None due yet"}
          </span>
        </div>
        {due > 0 ? (
          <>
            <EodStrip eod={person.eod14} className="mt-2" />
            <p className="mt-1.5 text-xs text-muted-foreground">{detail}</p>
          </>
        ) : null}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-[color:var(--ceo-grid)] pt-3">
        <div className="min-w-0">
          <dt className="truncate text-[11px] text-muted-foreground">
            Last active
          </dt>
          <dd className="mt-0.5 truncate text-[13px] font-medium text-foreground">
            {isNum(person.lastActiveAt) ? (
              <Hint content={dateTime(person.lastActiveAt, now)}>
                <time
                  dateTime={new Date(person.lastActiveAt).toISOString()}
                  className="tabular-nums"
                >
                  {relative(person.lastActiveAt, now)}
                </time>
              </Hint>
            ) : (
              <Value
                value={null}
                hint="No filing, cockpit visit or named action on record"
              />
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-[11px] text-muted-foreground">
            Actions today
          </dt>
          <dd className="mt-0.5 truncate text-[13px] font-medium tabular-nums text-foreground">
            {count(person.actionsToday)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-[11px] text-muted-foreground">Energy</dt>
          <dd className="mt-0.5 truncate text-[13px] font-medium tabular-nums text-foreground">
            <Value
              value={isNum(person.energy) ? decimal(person.energy) : null}
              hint="Energy is self-reported and only some EOD forms ask for it"
            />
          </dd>
        </div>
      </dl>
    </li>
  );
}

/**
 * One square per EOD that was due, grouped by outcome (the payload gives
 * counts, not dates). Missed days are hollow so absence reads as empty even
 * without color.
 */
function EodStrip({
  eod,
  className,
}: {
  eod: TeamPerson["eod14"];
  className?: string;
}) {
  const onTime = Math.max(0, eod.filed - eod.late);
  const cells: Cell[] = [
    ...Array.from({ length: onTime }, () => "on time" as const),
    ...Array.from({ length: Math.max(0, eod.late) }, () => "late" as const),
    ...Array.from({ length: Math.max(0, eod.missed) }, () => "missed" as const),
  ];
  return (
    <div
      role="img"
      aria-label={`${count(eod.due)} due: ${count(onTime)} on time, ${count(eod.late)} late, ${count(eod.missed)} missed`}
      className={cn("flex flex-wrap gap-0.5", className)}
    >
      {cells.map((c, i) => (
        <Square key={i} kind={c} />
      ))}
    </div>
  );
}

function Square({ kind }: { kind: Cell }) {
  const style =
    kind === "missed"
      ? { boxShadow: "inset 0 0 0 1.5px var(--ceo-serious)" }
      : {
          backgroundColor:
            kind === "late" ? "var(--ceo-warning)" : "var(--ceo-good)",
        };
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-[2px]"
      style={style}
    />
  );
}

function EodLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {(Object.keys(CELL_LABEL) as Cell[]).map(k => (
        <li key={k} className="flex items-center gap-1.5">
          <Square kind={k} />
          {CELL_LABEL[k]}
        </li>
      ))}
    </ul>
  );
}

// --- Live feed ---

const FEED_START = 20;

function Feed({ feed, now }: { feed: FeedItem[]; now: number }) {
  const [kind, setKind] = useState("all");
  const [expanded, setExpanded] = useState(false);

  const kinds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of feed) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [feed]);

  // A kind can drop out of the feed on refresh; fall back to all.
  const active =
    kind === "all" || kinds.some(([k]) => k === kind) ? kind : "all";
  const items = active === "all" ? feed : feed.filter(f => f.kind === active);

  const options: FilterOption<string>[] = [
    { key: "all", label: "All", count: feed.length },
    ...kinds.map(([k, n]) => ({
      key: k,
      label: kindLabel(k),
      count: n,
      icon: feedKindIcon(k),
    })),
  ];

  return (
    <div className="min-w-0">
      {kinds.length > 1 ? (
        <FilterChips
          options={options}
          value={active}
          onChange={setKind}
          ariaLabel="Show activity of kind"
          className="-mx-5 mb-4 px-5"
        />
      ) : null}
      <FeedList
        items={items}
        now={now}
        limit={expanded ? undefined : FEED_START}
        emptyText="No activity in the last 7 days."
      />
      {items.length > FEED_START ? (
        <ShowMore
          total={items.length}
          expanded={expanded}
          onToggle={() => setExpanded(e => !e)}
        />
      ) : null}
    </div>
  );
}

// --- Actions today ---

function ActionsToday({ people }: { people: TeamPerson[] }) {
  const items = useMemo(
    () =>
      [...people]
        .sort(
          (a, b) =>
            b.actionsToday - a.actionsToday || a.name.localeCompare(b.name),
        )
        .map(p => ({
          key: p.key,
          label: p.name,
          value: p.actionsToday,
          sub: p.role,
        })),
    [people],
  );
  const total = items.reduce((t, i) => t + i.value, 0);

  if (total === 0)
    return (
      <EmptyState
        icon={Users}
        title="No named actions yet today"
        text="Counts only actions that record who did them."
        compact
      />
    );

  return (
    <div className="min-w-0">
      <p className="mb-4 text-xs text-muted-foreground">
        {plural(total, "action")} that record who did them
      </p>
      <BarList items={items} ariaLabel="Actions today per person" />
    </div>
  );
}
