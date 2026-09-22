import { useAction, useMutation, useQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { History, LoaderCircle, UserRoundX, Users } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { BarList } from "@/components/ceo/BarList";
import { type Column, DataTable } from "@/components/ceo/DataTable";
import { EmptyState } from "@/components/ceo/EmptyState";
import { FeedList, feedKindIcon } from "@/components/ceo/FeedList";
import { FilterChips, type FilterOption } from "@/components/ceo/FilterChips";
import {
  count,
  date,
  dateTime,
  decimal,
  humanize,
  isNum,
  kuwaitDay,
  pct,
  plural,
  relative,
  shortDate,
} from "@/components/ceo/format";
import { Hint } from "@/components/ceo/Hint";
import { Value } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { ShowMore } from "@/components/ceo/ShowMore";
import { StatTile } from "@/components/ceo/StatTile";
import {
  StatusChip,
  StatusDot,
  type StatusTone,
} from "@/components/ceo/StatusChip";
import { useRefresh } from "@/components/ceo/useCeo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type {
  FeedItem,
  Note,
  TeamPerson,
  TeamStatus,
} from "../../../convex/ceo/payloads";
import type { Roster } from "../../../convex/ceo/people";
import { PeopleCard } from "./peopleCard";
import { PersonPage, usePersonParam } from "./personPage";
import { ScorecardTemplates } from "./scorecardTemplates";
import {
  buildRoster,
  saveError,
  statusOf,
  useLiveStatuses,
} from "./teamRoster";
import type { CeoTabProps } from "./types";

type EodDay = TeamPerson["eodYesterday"];
type Eod14 = TeamPerson["eod14"];

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

// Stable empties so the memos below do not rebuild on every tick.
const NO_PEOPLE: TeamPerson[] = [];
const NO_FEED: FeedItem[] = [];

// --- Departments, derived from each person's role ---

type DeptKey = "media" | "creative" | "client" | "sales" | "ops" | "other";

/**
 * Nothing the cockpit reads carries a department, so the grouping is derived
 * from the role on each person and on each feed event. Order matters: a client
 * sales rep holds a client success seat in the cockpit, so the client rule
 * runs before the sales rule.
 */
const DEPARTMENT_RULES: { key: DeptKey; label: string; match: RegExp }[] = [
  { key: "media", label: "Media buying", match: /media|buyer|paid/i },
  {
    key: "creative",
    label: "Creative",
    match: /creative|editor|video|design|content/i,
  },
  {
    key: "client",
    label: "Client success",
    match: /client|account manager|csm|success|support/i,
  },
  { key: "sales", label: "Sales", match: /sales|setter|closer/i },
  {
    key: "ops",
    label: "Operations",
    match: /system|assistant|operation|admin|finance|bookkeep/i,
  },
];

const OTHER_LABEL = "Other roles";
const NO_ROLE = "none";

const DEPARTMENT_ORDER: DeptKey[] = [
  ...DEPARTMENT_RULES.map(r => r.key),
  "other",
];

/** The department a role falls in; a blank or unmatched role sits under Other roles. */
function deptKey(role: string | null | undefined): DeptKey {
  const r = (role ?? "").trim();
  if (!r) return "other";
  return DEPARTMENT_RULES.find(d => d.match.test(r))?.key ?? "other";
}

const deptLabel = (key: DeptKey) =>
  DEPARTMENT_RULES.find(d => d.key === key)?.label ?? OTHER_LABEL;

/** The department of a feed event, or "none" when the event records no role. */
const feedDept = (f: FeedItem): string => (f.role ? deptKey(f.role) : NO_ROLE);

type Dept = {
  key: DeptKey;
  label: string;
  people: TeamPerson[];
  /** The roles inside the department, so the reader can see how it was derived. */
  roles: string[];
  /** Yesterday's EOD state across the department. */
  due: number;
  onTime: number;
  late: number;
  missed: number;
  lateNames: string[];
  missedNames: string[];
  eod14: Eod14;
  actionsToday: number;
  activeToday: number;
  lastActiveAt: number | null;
  energy: number | null;
  energyPeople: number;
  events: number;
  namedEvents: number;
};

const zeroEod14 = (): Eod14 => ({ due: 0, filed: 0, late: 0, missed: 0 });

/** Share of the last 14 working days filed on time; null when none were due. */
const onTimeRate = (eod: Eod14): number | null =>
  eod.due ? (eod.filed - eod.late) / eod.due : null;

function deptTone(d: Dept): StatusTone {
  if (!d.due) return "neutral";
  if (d.missed > 0) return "serious";
  if (d.late > 0) return "warning";
  return "good";
}

/** Group people and feed events into departments, plus the events that name no role. */
function buildDepartments(
  people: TeamPerson[],
  feed: FeedItem[],
  today: string,
): { departments: Dept[]; unattributed: number } {
  const members = new Map<DeptKey, TeamPerson[]>();
  for (const p of people) {
    const key = deptKey(p.role);
    members.set(key, [...(members.get(key) ?? []), p]);
  }

  const events = new Map<DeptKey, { total: number; named: number }>();
  let unattributed = 0;
  for (const f of feed) {
    if (!f.role) {
      unattributed++;
      continue;
    }
    const key = deptKey(f.role);
    const e = events.get(key) ?? { total: 0, named: 0 };
    e.total++;
    if (f.actor) e.named++;
    events.set(key, e);
  }

  const departments = DEPARTMENT_ORDER.filter(
    k => members.has(k) || events.has(k),
  ).map((key): Dept => {
    const rows = members.get(key) ?? [];
    const named = (state: EodDay) =>
      rows.filter(p => p.eodYesterday === state).map(p => p.name);
    const lateNames = named("late");
    const missedNames = named("missed");
    const energies = rows.map(p => p.energy).filter(isNum);
    const lastActiveAt = Math.max(0, ...rows.map(p => p.lastActiveAt ?? 0));
    const e = events.get(key);
    return {
      key,
      label: deptLabel(key),
      people: rows,
      roles: [...new Set(rows.map(p => p.role).filter(Boolean))].sort(),
      due: rows.filter(p => p.eodYesterday !== "not due").length,
      onTime: named("on time").length,
      late: lateNames.length,
      missed: missedNames.length,
      lateNames,
      missedNames,
      eod14: rows.reduce(
        (t, p) => ({
          due: t.due + p.eod14.due,
          filed: t.filed + p.eod14.filed,
          late: t.late + p.eod14.late,
          missed: t.missed + p.eod14.missed,
        }),
        zeroEod14(),
      ),
      actionsToday: rows.reduce((t, p) => t + p.actionsToday, 0),
      activeToday: rows.filter(
        p => isNum(p.lastActiveAt) && kuwaitDay(p.lastActiveAt) === today,
      ).length,
      lastActiveAt: lastActiveAt || null,
      energy: energies.length
        ? energies.reduce((t, v) => t + v, 0) / energies.length
        : null,
      energyPeople: energies.length,
      events: e?.total ?? 0,
      namedEvents: e?.named ?? 0,
    };
  });

  return { departments, unattributed };
}

/** What the roles line under a department name says. */
function rolesText(d: Dept): string {
  if (d.roles.length) return d.roles.join(", ");
  return d.people.length
    ? "No role recorded"
    : "Activity only, nobody on the roster";
}

// --- Notes ---

const DERIVED_NOTE: Note = {
  level: "info",
  text: "Departments are derived from each person's role. No source the cockpit reads carries a department field, so Account manager and Client sales rep read as Client success, and a role that matches no rule sits under Other roles. Each department names the roles inside it so the grouping can be checked.",
};

const ROSTER_NOTE: Note = {
  level: "info",
  text: "People here are those who filed an EOD in the last 30 days or hold a cockpit seat, minus anyone set to Paused or Left, who are listed under Not active and left out of every count on this card. It is not a head count: nobody who files nothing and holds no seat appears at all.",
};

const SWITCH_NOTE: Note = {
  level: "info",
  text: "Paused and Left are set by hand on each person's card and saved in the cockpit only, with who set it and when. Nothing is sent to ClickUp, Supabase or any other system.",
};

const ACTIVITY_NOTE: Note = {
  level: "info",
  text: "Activity counts feed events from the last 7 days by the role on the event. Cockpit, board and change events carry the cockpit role with no name, so they count toward that role's department without naming a person. Events with no role, such as Hermes runs and answered questions, count under no department.",
};

type CardKey = "departments" | "people" | "activity" | "inactive";

// Each caveat sits beside the numbers it qualifies. Anything unmatched lands
// on the departments card for a warning and the people card otherwise, so no
// note is ever dropped.
const NOTE_ROUTES: readonly (readonly [RegExp, CardKey])[] = [
  [/set by hand on this tab|is marked as (left|paused)/i, "inactive"],
  [/cockpit actions|actions today/i, "activity"],
  [/typeform|sync|meta account activity/i, "departments"],
  [/on time means/i, "departments"],
  [/matched by role|energy|cockpits are not read/i, "people"],
];

function routeNotes(notes: Note[] | null | undefined) {
  const out: Partial<Record<CardKey, Note[]>> = {};
  for (const note of notes ?? []) {
    const key =
      NOTE_ROUTES.find(([re]) => re.test(note.text))?.[1] ??
      (note.level === "warn" ? "departments" : "people");
    out[key] = [...(out[key] ?? []), note];
  }
  return out;
}

/** Management: every department side by side, its people, EODs, activity and output. */
/**
 * Names on this tab come from the EOD roster, which keys people by
 * "<role>:<first>" and carries no payroll id. The file lives against the
 * payroll id, so the two are matched on the name and a name that matches
 * nothing is simply not a link.
 */
const PeopleIndex = createContext<Map<string, number>>(new Map());

function PersonName({ name }: { name: string }) {
  const index = useContext(PeopleIndex);
  const [, setPerson] = usePersonParam();
  const id = index.get(name.trim().toLowerCase());
  if (!id) return <>{name}</>;
  return (
    <button
      type="button"
      onClick={() => setPerson(id)}
      title={`Open ${name}'s file`}
      className="underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
    >
      {name}
    </button>
  );
}

export function ManagementTab({ sections, now, day }: CeoTabProps) {
  const [personId, setPerson] = usePersonParam();
  const loadRoster = useAction(api.ceo.people.list);
  const [index, setIndex] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let alive = true;
    loadRoster({})
      .then(r => {
        if (!alive) return;
        const roster = r as Roster;
        setIndex(
          new Map(roster.people.map(x => [x.name.trim().toLowerCase(), x.id])),
        );
      })
      .catch(() => {
        // Without the roster the names are plain text, which is the old
        // behaviour and not worth an error on this tab.
      });
    return () => {
      alive = false;
    };
  }, [loadRoster]);
  const team = sections.team;
  const payload = team?.payload ?? null;
  const people = payload?.people ?? NO_PEOPLE;
  const inactive = payload?.inactive ?? NO_PEOPLE;
  const feed = payload?.feed ?? NO_FEED;
  const today = day ?? kuwaitDay(now);

  const live = useLiveStatuses();
  const switcher = useStatusSwitch(today);
  const roster = useMemo(
    () => buildRoster(people, inactive, live.rows, today),
    [people, inactive, live.rows, today],
  );

  const { departments, unattributed } = useMemo(
    () => buildDepartments(roster.active, feed, today),
    [roster.active, feed, today],
  );
  const routed = useMemo(() => routeNotes(payload?.notes), [payload]);

  const ui = useMemo<StatusUi>(
    () => ({
      today,
      now,
      updating: roster.updating,
      setBy: roster.setBy,
      errors: switcher.errors,
      saving: switcher.saving,
      canEdit: live.rows !== null,
      pick: switcher.pick,
      dismiss: switcher.dismiss,
    }),
    [today, now, roster, switcher, live.rows],
  );

  // One person, fullscreen, at ?person=7. Management is where the people are,
  // so this is where their file lives; the payroll roster links into it.
  if (personId !== null)
    return <PersonPage personId={personId} onBack={() => setPerson(null)} />;

  if (!payload)
    return (
      <div className="grid gap-5 lg:gap-7">
        <PeopleCard order={0} />
        <SectionCard title="Management" section={team}>
          {() => null}
        </SectionCard>
      </div>
    );

  const updatingNames = [...roster.active, ...roster.inactive]
    .filter(p => roster.updating.has(p.key))
    .map(p => p.name);

  return (
    <StatusUiContext.Provider value={ui}>
      <PeopleIndex.Provider value={index}>
        <div className="grid gap-5 lg:gap-7">
          <PeopleCard order={0} />

          <SectionCard
            kicker="Yesterday and the last 14 working days"
            title={
              <>
                Departments
                <span className="ml-2 font-normal text-muted-foreground">
                  {plural(departments.length, "department")},{" "}
                  {plural(
                    roster.active.length,
                    "active person",
                    "active people",
                  )}
                  {roster.inactive.length
                    ? `, ${count(roster.inactive.length)} not active`
                    : ""}
                </span>
              </>
            }
            section={team}
            notes={[...(routed.departments ?? []), DERIVED_NOTE, ROSTER_NOTE]}
            order={0}
          >
            <div className="space-y-6">
              <CompanySummary people={roster.active} />
              {updatingNames.length ? (
                <p
                  role="status"
                  className="flex items-start gap-2 text-xs text-muted-foreground"
                >
                  <LoaderCircle
                    className="ceo-spin mt-0.5 size-3.5 shrink-0 animate-spin text-[color:var(--ceo-emphasis)]"
                    aria-hidden
                  />
                  <span>
                    Status saved for {updatingNames.join(", ")}. The counts
                    above already leave out everyone paused or left; their own
                    EOD figures are being recomputed.
                  </span>
                </p>
              ) : null}
              <div className="border-t border-[color:var(--ceo-grid)] pt-5">
                <p className="mb-3 text-[13px] text-muted-foreground">
                  Every department side by side: EOD discipline, activity today
                  and output over the last 7 days
                </p>
                <DepartmentTable departments={departments} now={now} />
              </div>
            </div>
          </SectionCard>

          <SectionCard
            kicker="Yesterday, today and the last 14 working days"
            title="People by department"
            section={team}
            notes={routed.people}
            order={1}
          >
            <PeopleByDept departments={departments} now={now} />
          </SectionCard>

          <SectionCard
            kicker="Paused and left, set by hand"
            title={
              <>
                Not active
                <span className="ml-2 font-normal text-muted-foreground">
                  {plural(roster.inactive.length, "person", "people")}
                </span>
              </>
            }
            section={team}
            notes={[
              ...(live.error
                ? [
                    {
                      level: "warn" as const,
                      text: `Statuses could not be loaded, so the switch is off and this list is the one from the last refresh: ${live.error}`,
                    },
                  ]
                : []),
              ...(payload.inactive === undefined
                ? [
                    {
                      level: "info" as const,
                      text: "The stored team numbers predate the switch. The list fills in fully after the next refresh.",
                    },
                  ]
                : []),
              ...(routed.inactive ?? []),
              SWITCH_NOTE,
            ]}
            order={2}
          >
            <NotActive people={roster.inactive} />
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-3 lg:items-start lg:gap-6">
            <SectionCard
              kicker="Last 7 days"
              title="Live feed"
              section={team}
              order={3}
              className="lg:col-span-2"
            >
              <Feed feed={feed} now={now} />
            </SectionCard>
            <div className="grid min-w-0 gap-4 lg:gap-6">
              <SectionCard
                kicker="Today"
                title="Actions today"
                section={team}
                notes={routed.activity}
                order={4}
              >
                <ActionsToday
                  people={roster.active}
                  inactive={roster.inactive}
                />
              </SectionCard>
              <SectionCard
                kicker="Last 7 days"
                title="Activity by department"
                section={team}
                notes={[ACTIVITY_NOTE]}
                order={5}
              >
                <ActivityByDept
                  departments={departments}
                  unattributed={unattributed}
                />
              </SectionCard>
            </div>
          </div>

          <SectionCard
            kicker="Management"
            title="Not in any source yet"
            section={team}
            order={6}
          >
            <Gaps />
          </SectionCard>

          <ScorecardTemplates order={7} />
        </div>
        <StatusDialog
          target={switcher.editing}
          today={today}
          onClose={switcher.close}
          onConfirm={switcher.confirm}
        />
      </PeopleIndex.Provider>
    </StatusUiContext.Provider>
  );
}

// --- The team switch: Active, Paused, Left (set by hand, 2026-09-16) ---

type HistoryRow = FunctionReturnType<typeof api.ceo.teamStatus.history>[number];

/** The same bounds convex/ceo/teamStatus.ts enforces. */
const FIRST_DAY = "2025-01-01";
const DAYS_AHEAD = 31;
const NOTE_MAX = 300;

const STATUS_OPTIONS: { key: TeamStatus; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "paused", label: "Paused" },
  { key: "left", label: "Left" },
];

function addDay(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function isDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );

type EditTarget = {
  person: TeamPerson;
  status: TeamStatus;
  /** The person is on the Not active list today, whatever the status row says. */
  offNow: boolean;
  /** Prefilled on a retry. */
  since?: string;
  note?: string;
};

type StatusUi = {
  today: string;
  now: number;
  updating: Set<string>;
  setBy: Map<string, string>;
  errors: Record<string, { message: string; retry: EditTarget }>;
  saving: Set<string>;
  canEdit: boolean;
  pick: (target: EditTarget) => void;
  dismiss: (key: string) => void;
};

const StatusUiContext = createContext<StatusUi | null>(null);

function successText(
  name: string,
  status: TeamStatus,
  since: string,
  today: string,
) {
  const when = shortDate(since);
  if (status === "active") return `${name} is active again from ${when}.`;
  if (since > today)
    return status === "paused"
      ? `${name} pauses from ${when}. EODs stay due until then.`
      : `${name} leaves on ${when}. EODs stay due until then.`;
  return status === "paused"
    ? `${name} is paused from ${when}. The EOD counts leave ${name} out now.`
    : `${name} is marked as left from ${when}. The EOD counts leave ${name} out now.`;
}

/**
 * The switch: which person is being edited, the save with Convex's
 * optimistic update (rolled back by Convex if the server refuses), the error
 * per person and a refresh of the team section once it is saved.
 */
function useStatusSwitch(today: string) {
  const { refresh } = useRefresh();
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [errors, setErrors] = useState<StatusUi["errors"]>({});
  const [saving, setSaving] = useState<Set<string>>(() => new Set());

  const setStatus = useMutation(api.ceo.teamStatus.set);
  // Convex applies this at once and rolls it back if the server refuses.
  const mutate = useMemo(
    () =>
      setStatus.withOptimisticUpdate((store, args) => {
        const rows = store.getQuery(api.ceo.teamStatus.list, {});
        if (rows === undefined) return;
        const note = args.note?.trim();
        store.setQuery(api.ceo.teamStatus.list, {}, [
          ...rows.filter(r => r.personKey !== args.personKey),
          {
            personKey: args.personKey,
            status: args.status,
            since: args.since,
            note: note ? note : null,
            setAt: Date.now(),
            setBy: "Aziz",
          },
        ]);
      }),
    [setStatus],
  );

  const dismiss = useCallback((key: string) => {
    setErrors(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const save = useCallback(
    async (target: EditTarget, since: string, note: string) => {
      const { person, status } = target;
      const key = person.key;
      dismiss(key);
      setSaving(prev => new Set(prev).add(key));
      try {
        await mutate({
          personKey: key,
          status,
          since,
          note: note || undefined,
        });
        toast.success(successText(person.name, status, since, today));
        // The save already queues a recompute of the team section; this
        // shows it on the page's refresh button too.
        void refresh(["team"]);
      } catch (e) {
        const message = saveError(e);
        setErrors(prev => ({
          ...prev,
          [key]: { message, retry: { ...target, since, note } },
        }));
        toast.error(`${person.name}'s status was not changed. ${message}`);
      } finally {
        setSaving(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [mutate, refresh, dismiss, today],
  );

  const pick = useCallback((target: EditTarget) => setEditing(target), []);
  const close = useCallback(() => setEditing(null), []);
  const confirm = useCallback(
    (target: EditTarget, since: string, note: string) => {
      setEditing(null);
      void save(target, since, note);
    },
    [save],
  );

  return useMemo(
    () => ({ editing, errors, saving, pick, close, confirm, dismiss }),
    [editing, errors, saving, pick, close, confirm, dismiss],
  );
}

/** Active, Paused, Left for one person; a click opens the confirm step. */
function StatusControl({
  person,
  offNow,
}: {
  person: TeamPerson;
  offNow: boolean;
}) {
  const ui = useContext(StatusUiContext);
  if (!ui) return null;
  const current = statusOf(person);
  const saving = ui.saving.has(person.key);
  const error = ui.errors[person.key];
  const updating = ui.updating.has(person.key);
  return (
    <div className="mt-3 border-t border-[color:var(--ceo-grid)] pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">Status</span>
        <div
          role="group"
          aria-label={`Status of ${person.name}`}
          className="inline-flex rounded-md border bg-background/60 p-0.5"
        >
          {STATUS_OPTIONS.map(o => {
            const on = o.key === current;
            // Active with no status ever set has no date or note to change.
            const nothingToEdit =
              on && current === "active" && !person.statusSince;
            return (
              <button
                key={o.key}
                type="button"
                aria-pressed={on}
                disabled={!ui.canEdit || saving || nothingToEdit}
                title={
                  !ui.canEdit
                    ? "Statuses are not loaded, so the switch is off"
                    : nothingToEdit
                      ? "Active, never paused or marked as left"
                      : on
                        ? "Change the date or the note"
                        : undefined
                }
                onClick={() => ui.pick({ person, status: o.key, offNow })}
                className={cn(
                  "h-6 rounded-[5px] px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                  on
                    ? "bg-[var(--ceo-emphasis-wash)] text-foreground shadow-[inset_0_0_0_1px_var(--ceo-emphasis)]"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
      {saving ? (
        <p
          role="status"
          className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <LoaderCircle
            className="ceo-spin size-3.5 animate-spin text-[color:var(--ceo-emphasis)]"
            aria-hidden
          />
          Saving
        </p>
      ) : updating ? (
        <p
          role="status"
          className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <LoaderCircle
            className="ceo-spin size-3.5 animate-spin text-[color:var(--ceo-emphasis)]"
            aria-hidden
          />
          Saved. The EOD figures on this card update after the refresh.
        </p>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="ceo-stale mt-2 rounded-md border px-2.5 py-2 text-xs text-foreground"
        >
          <p>Not saved: {error.message} The status is back to what it was.</p>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            <button
              type="button"
              onClick={() => ui.pick(error.retry)}
              className="rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => ui.dismiss(person.key)}
              className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A status that is set but not in force yet, or a recent return, on an active card. */
function ScheduledLine({ person }: { person: TeamPerson }) {
  const ui = useContext(StatusUiContext);
  const since = person.statusSince;
  if (!ui || !since) return null;
  const status = statusOf(person);
  let text: string | null = null;
  if (status !== "active" && since > ui.today)
    text = `${status === "paused" ? "Pauses from" : "Leaves on"} ${date(since)}`;
  else if (status === "active" && daysBetween(since, ui.today) <= 14)
    text = `Set to active from ${date(since)}`;
  if (!text) return null;
  return (
    <p className="mt-1 text-xs text-foreground">
      {text}
      {person.statusNote ? (
        <span className="text-muted-foreground">. {person.statusNote}</span>
      ) : null}
    </p>
  );
}

/** One person's status changes, loaded when opened. */
function StatusHistory({ personKey }: { personKey: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <History className="size-3.5" aria-hidden />
        {open ? "Hide status changes" : "Status changes"}
      </button>
      {open ? <HistoryList personKey={personKey} /> : null}
    </div>
  );
}

function HistoryList({ personKey }: { personKey: string }) {
  const ui = useContext(StatusUiContext);
  const queries = useMemo(
    () => ({
      history: { query: api.ceo.teamStatus.history, args: { personKey } },
    }),
    [personKey],
  );
  const res = useQueries(queries).history as HistoryRow[] | Error | undefined;
  const now = ui?.now ?? Date.now();
  if (res === undefined)
    return <p className="mt-2 text-xs text-muted-foreground">Loading</p>;
  if (res instanceof Error)
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        The changes could not be loaded. {saveError(res, "")}
      </p>
    );
  if (!res.length)
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        No change recorded yet.
      </p>
    );
  return (
    <ol className="mt-2 space-y-2 border-l border-[color:var(--ceo-grid)] pl-3">
      {res.map(r => (
        <li key={`${r.at}:${r.what}`} className="text-xs leading-relaxed">
          <p className="text-foreground">{r.what}</p>
          <p className="text-muted-foreground tabular-nums">
            {r.by}, {dateTime(r.at, now)}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** The confirm step: the start day, an optional note, and what the change does. */
function StatusDialog({
  target,
  today,
  onClose,
  onConfirm,
}: {
  target: EditTarget | null;
  today: string;
  onClose: () => void;
  onConfirm: (target: EditTarget, since: string, note: string) => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      {target ? (
        <StatusDialogBody
          key={`${target.person.key}:${target.status}`}
          target={target}
          today={today}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      ) : null}
    </Dialog>
  );
}

function StatusDialogBody({
  target,
  today,
  onClose,
  onConfirm,
}: {
  target: EditTarget;
  today: string;
  onClose: () => void;
  onConfirm: (target: EditTarget, since: string, note: string) => void;
}) {
  const { person, status, offNow } = target;
  const name = person.name;
  const current = statusOf(person);
  const same = current === status;
  const currentSince = person.statusSince ?? null;
  const [since, setSince] = useState(
    target.since ?? (same && currentSince ? currentSince : today),
  );
  const [note, setNote] = useState(
    target.note ?? (same ? (person.statusNote ?? "") : ""),
  );

  const max = status === "active" ? today : addDay(today, DAYS_AHEAD);
  const problem = !isDay(since)
    ? "Pick a date."
    : since < FIRST_DAY
      ? `The date cannot be before ${date(FIRST_DAY)}.`
      : since > max
        ? status === "active"
          ? "A return to active cannot be dated ahead. Set it on the day."
          : `The date can be at most ${DAYS_AHEAD} days ahead, ${date(max)}.`
        : null;

  const title = same
    ? status === "active"
      ? `Change ${name}'s return date`
      : `Change ${name}'s ${status === "paused" ? "pause" : "leaving date"}`
    : status === "paused"
      ? `Pause ${name}?`
      : status === "left"
        ? `Mark ${name} as left?`
        : `Set ${name} back to active?`;

  const offWord = current === "left" ? "leaving date" : "pause";
  // A pause or leave dated ahead that has not started yet.
  const planned =
    current !== "active" && currentSince !== null && currentSince > today;
  const effect = same
    ? `Change the start date or the note. The EOD counts follow the new date.`
    : status === "paused"
      ? `From that day ${name} owes no EOD and is left out of every EOD count, on this tab and on Today. The card moves to Not active.`
      : status === "left"
        ? `From that day ${name} owes no EOD and is left out of every EOD count. If ${name} files an EOD again it shows as a note and the status stays Left. ${name} drops off the list 30 days after that day.`
        : planned
          ? offNow
            ? `${name} owes EODs again from that day, and the ${offWord} planned for ${date(currentSince)} is cancelled.`
            : `This cancels the ${offWord} planned for ${date(currentSince)}. ${name} keeps owing EODs as now.`
          : `${name} owes EODs again from that day. The days between the ${offWord} and that day stay not due.`;

  const dateLabel =
    status === "active"
      ? "Active again from"
      : status === "paused"
        ? "Paused from"
        : "Left on";
  const dateHelp =
    status === "active"
      ? "Today or an earlier day."
      : `Today, an earlier day, or up to ${DAYS_AHEAD} days ahead. EODs stay due until that day.`;
  // Setting active on the day the pause started undoes it: no day is skipped.
  const undoDay =
    status === "active" &&
    current !== "active" &&
    currentSince &&
    currentSince <= today
      ? currentSince
      : null;

  // Re-saving the same status with the same date and note changes nothing.
  const unchanged =
    same &&
    since === (currentSince ?? "") &&
    note.trim() === (person.statusNote ?? "").trim();

  const confirmLabel = same
    ? "Save"
    : status === "paused"
      ? `Pause ${name}`
      : status === "left"
        ? `Mark ${name} as left`
        : `Set ${name} to active`;

  return (
    <DialogContent className="ceo-root sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {person.role}. {effect}
        </DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-4"
        onSubmit={e => {
          e.preventDefault();
          if (!problem && !unchanged) onConfirm(target, since, note.trim());
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="ceo-status-since">{dateLabel}</Label>
          <Input
            id="ceo-status-since"
            type="date"
            required
            value={since}
            min={FIRST_DAY}
            max={max}
            onChange={e => setSince(e.target.value)}
            aria-invalid={problem ? true : undefined}
            aria-describedby="ceo-status-since-help"
          />
          <p
            id="ceo-status-since-help"
            className={cn(
              "text-xs",
              problem ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {problem ?? dateHelp}
          </p>
          {undoDay && since !== undoDay ? (
            <button
              type="button"
              onClick={() => setSince(undoDay)}
              className="justify-self-start rounded-sm text-left text-xs font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Set by mistake? Use {date(undoDay)}, the day the {offWord}{" "}
              started, so no day is skipped
            </button>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ceo-status-note">
            Note
            <span className="font-normal text-muted-foreground">optional</span>
          </Label>
          <Textarea
            id="ceo-status-note"
            rows={2}
            maxLength={NOTE_MAX}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={
              status === "paused"
                ? "On leave until 1 Oct"
                : status === "left"
                  ? "Contract ended"
                  : "Back from leave"
            }
            className="min-h-[64px]"
          />
          <p className="text-right text-[11px] text-muted-foreground tabular-nums">
            {count(note.length)} of {count(NOTE_MAX)}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Saved in the cockpit only, with your name and the time, and listed in
          this person's status changes. Nothing is sent to ClickUp or any other
          system.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={problem !== null || unchanged}
            title={unchanged ? "Change the date or the note first" : undefined}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** Paused and left people, each with status, since, note and the switch. */
function NotActive({ people }: { people: TeamPerson[] }) {
  if (!people.length)
    return (
      <EmptyState
        icon={UserRoundX}
        title="Everyone on the list is active"
        text="Set someone to Paused or Left on their card above. From that day they owe no EOD and are left out of every EOD count."
        compact
      />
    );
  return (
    <div className="@container">
      <ul className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
        {people.map(p => (
          <InactiveCard key={p.key} person={p} />
        ))}
      </ul>
    </div>
  );
}

function InactiveCard({ person }: { person: TeamPerson }) {
  const ui = useContext(StatusUiContext);
  const today = ui?.today ?? kuwaitDay();
  const now = ui?.now ?? Date.now();
  const status = statusOf(person);
  const since = person.statusSince ?? null;
  const ahead = since !== null && since > today;
  const days = since !== null && !ahead ? daysBetween(since, today) : null;
  const setBy = ui?.setBy.get(person.key) ?? null;
  // Someone already off with a later status set (a paused person with a
  // leaving date ahead) is off today under the earlier status.
  const label = ahead
    ? "Not active"
    : status === "left"
      ? "Left"
      : status === "paused"
        ? "Paused"
        : "Active";
  const sinceText =
    since === null
      ? null
      : ahead
        ? `${status === "left" ? "Leaves on" : "Pauses from"} ${date(since)}`
        : `${date(since)}, ${days === 0 ? "today" : `${plural(days ?? 0, "day")} ago`}`;
  const { due, filed, late } = person.eod14;
  const before = status === "left" ? "before leaving" : "before the pause";

  return (
    <li className="flex min-w-0 flex-col rounded-lg border p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            <PersonName name={person.name} />
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {person.role}
          </p>
        </div>
        <StatusChip
          tone="neutral"
          label={label}
          hint={
            ahead
              ? "Off today under an earlier status. The status below starts later; see the status changes."
              : "Set by hand. No EOD is due from the start day on."
          }
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <dt className="truncate text-[11px] text-muted-foreground">
            {status === "left" ? "Left on" : "Paused from"}
          </dt>
          <dd className="mt-0.5 text-[13px] font-medium text-foreground">
            <Value
              value={sinceText}
              hint="Not recomputed yet: the start day shows after the refresh"
            />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-[11px] text-muted-foreground">Set</dt>
          <dd className="mt-0.5 text-[13px] font-medium text-foreground">
            {isNum(person.statusSetAt) ? (
              <Hint content={dateTime(person.statusSetAt, now)}>
                <button
                  type="button"
                  className="cursor-help rounded-sm text-left underline decoration-muted-foreground/35 decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {setBy ? `${setBy}, ` : ""}
                  {relative(person.statusSetAt, now)}
                </button>
              </Hint>
            ) : (
              <Value
                value={null}
                hint="When it was set shows after the refresh"
              />
            )}
          </dd>
        </div>
      </dl>

      {person.statusNote ? (
        <p className="mt-3 break-words rounded-md bg-muted/50 px-2.5 py-1.5 text-xs text-foreground">
          {person.statusNote}
        </p>
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-[color:var(--ceo-grid)] pt-3">
        <div className="min-w-0">
          <dt className="truncate text-[11px] text-muted-foreground">
            EODs {before}
          </dt>
          <dd className="mt-0.5 text-[13px] font-medium tabular-nums text-foreground">
            {due > 0 ? (
              <Hint
                content={`Of the last 14 working days, only the ones ${before} count. ${count(late)} late.`}
              >
                <button
                  type="button"
                  className="cursor-help rounded-sm underline decoration-muted-foreground/35 decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {`${count(filed)} of ${count(due)} filed`}
                </button>
              </Hint>
            ) : (
              <span className="text-muted-foreground">None due</span>
            )}
          </dd>
        </div>
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
      </dl>

      <div className="flex-1" />
      <StatusHistory personKey={person.key} />
      <StatusControl person={person} offNow />
    </li>
  );
}

// --- Company summary ---

function CompanySummary({ people }: { people: TeamPerson[] }) {
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
    zeroEod14(),
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
        value={pct(onTimeRate(total))}
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

// --- Departments side by side ---

/** A number with a tooltip, for table cells where the detail does not fit. */
function CellHint({ hint, children }: { hint?: string; children: ReactNode }) {
  if (!hint) return <>{children}</>;
  return (
    <Hint content={hint}>
      <button
        type="button"
        className="cursor-help rounded-sm underline decoration-muted-foreground/35 decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </button>
    </Hint>
  );
}

const NO_EOD_DUE = "No EOD was due in this department yesterday";

function DepartmentTable({
  departments,
  now,
}: {
  departments: Dept[];
  now: number;
}) {
  const columns: Column<Dept>[] = [
    {
      key: "department",
      header: "Department",
      cell: d => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{d.label}</p>
          <p className="truncate text-xs text-muted-foreground">
            {rolesText(d)}
          </p>
        </div>
      ),
      sortValue: d => d.label,
      className: "min-w-[11rem]",
    },
    {
      key: "people",
      header: "People",
      numeric: true,
      cell: d => count(d.people.length),
      sortValue: d => d.people.length,
    },
    {
      key: "yesterday",
      header: "On time yesterday",
      numeric: true,
      cell: d =>
        d.due ? (
          <span className="inline-flex items-center gap-1.5">
            <StatusDot
              tone={deptTone(d)}
              label={`${count(d.onTime)} of ${count(d.due)} on time`}
            />
            {`${count(d.onTime)} of ${count(d.due)}`}
          </span>
        ) : (
          <Value value={null} hint={NO_EOD_DUE} />
        ),
      sortValue: d => (d.due ? d.onTime / d.due : null),
    },
    {
      key: "missed",
      header: "Missed yesterday",
      numeric: true,
      cell: d =>
        d.due ? (
          <CellHint
            hint={d.missedNames.length ? d.missedNames.join(", ") : undefined}
          >
            {count(d.missed)}
          </CellHint>
        ) : (
          <Value value={null} hint={NO_EOD_DUE} />
        ),
      sortValue: d => (d.due ? d.missed : null),
    },
    {
      key: "ontime14",
      header: "On time, 14 days",
      numeric: true,
      cell: d => (
        <Value
          value={pct(onTimeRate(d.eod14))}
          hint="No EODs were due in this department in the last 14 working days"
        />
      ),
      sortValue: d => onTimeRate(d.eod14),
      hideBelow: "sm",
    },
    {
      key: "actions",
      header: "Actions today",
      numeric: true,
      cell: d => (
        <CellHint
          hint={`${count(d.activeToday)} of ${plural(d.people.length, "person", "people")} active today`}
        >
          {count(d.actionsToday)}
        </CellHint>
      ),
      sortValue: d => d.actionsToday,
      hideBelow: "sm",
    },
    {
      key: "events",
      header: "Events, 7 days",
      numeric: true,
      cell: d => (
        <CellHint
          hint={`${count(d.namedEvents)} of ${count(d.events)} name the person who did it. Cockpit and board events carry the role with no name.`}
        >
          {count(d.events)}
        </CellHint>
      ),
      sortValue: d => d.events,
      hideBelow: "md",
    },
    {
      key: "active",
      header: "Last active",
      numeric: true,
      cell: d =>
        isNum(d.lastActiveAt) ? (
          <Hint content={dateTime(d.lastActiveAt, now)}>
            <time
              dateTime={new Date(d.lastActiveAt).toISOString()}
              className="tabular-nums"
            >
              {relative(d.lastActiveAt, now)}
            </time>
          </Hint>
        ) : (
          <Value
            value={null}
            hint="No filing, cockpit visit or named action on record"
          />
        ),
      sortValue: d => d.lastActiveAt,
      hideBelow: "lg",
    },
  ];

  return (
    <DataTable
      rows={departments}
      columns={columns}
      rowKey={d => d.key}
      stickyFirst
      caption="Each department with its people, EOD discipline, activity today and output over the last 7 days"
      emptyText="No departments to show yet"
    />
  );
}

// --- People, grouped by department ---

function PeopleByDept({
  departments,
  now,
}: {
  departments: Dept[];
  now: number;
}) {
  const [filter, setFilter] = useState<string>("all");
  const withPeople = departments.filter(d => d.people.length > 0);
  const total = withPeople.reduce((t, d) => t + d.people.length, 0);

  if (total === 0)
    return (
      <EmptyState
        icon={Users}
        title="Nobody active on the list"
        text="People show once they file an EOD or hold a cockpit seat. Anyone set to Paused or Left is under Not active."
        compact
      />
    );

  // A department can drop out on refresh; fall back to all.
  const active =
    filter === "all" || withPeople.some(d => d.key === filter) ? filter : "all";
  const shown =
    active === "all" ? withPeople : withPeople.filter(d => d.key === active);

  const options: FilterOption<string>[] = [
    { key: "all", label: "All", count: total },
    ...withPeople.map(d => ({
      key: d.key as string,
      label: d.label,
      count: d.people.length,
      hint: rolesText(d),
    })),
  ];

  return (
    <div className="@container space-y-5">
      {/* The chips keep their own row: the scroller needs the full card width on a phone. */}
      {withPeople.length > 1 ? (
        <FilterChips
          options={options}
          value={active}
          onChange={setFilter}
          ariaLabel="Show a department"
          className="-mx-5 px-5"
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-[13px] text-muted-foreground">
          EODs over the last 14 working days, Fridays off
        </p>
        <EodLegend />
      </div>
      <div className="space-y-6">
        {shown.map(d => (
          <DeptGroup key={d.key} dept={d} now={now} />
        ))}
      </div>
    </div>
  );
}

function DeptGroup({ dept, now }: { dept: Dept; now: number }) {
  return (
    <section className="border-t border-[color:var(--ceo-grid)] pt-4 first:border-0 first:pt-0">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            {dept.label}
            <span className="ml-2 font-normal text-muted-foreground">
              {plural(dept.people.length, "person", "people")}
            </span>
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {rolesText(dept)}
          </p>
        </div>
        <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <Fact
            label="On time, 14 days"
            value={pct(onTimeRate(dept.eod14))}
            hint="No EODs were due in this department in the last 14 working days"
          />
          <Fact
            label="Active today"
            value={`${count(dept.activeToday)} of ${count(dept.people.length)}`}
          />
          <Fact label="Actions today" value={count(dept.actionsToday)} />
          <Fact label="Events, 7 days" value={count(dept.events)} />
          <Fact
            label="Energy"
            value={dept.energyPeople ? decimal(dept.energy) : null}
            hint="Energy is self-reported and only some EOD forms ask for it"
          />
        </dl>
      </header>
      <ul className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
        {dept.people.map(p => (
          <PersonCard key={p.key} person={p} now={now} />
        ))}
      </ul>
    </section>
  );
}

function Fact({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-medium tabular-nums text-foreground">
        <Value value={value} hint={hint} />
      </dd>
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
            <PersonName name={person.name} />
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {person.role}
          </p>
          <ScheduledLine person={person} />
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
      {isNum(person.statusSetAt) ? (
        <StatusHistory personKey={person.key} />
      ) : null}
      <StatusControl person={person} offNow={false} />
    </li>
  );
}

/**
 * One square per EOD that was due, grouped by outcome (the payload gives
 * counts, not dates). Missed days are hollow so absence reads as empty even
 * without color.
 */
function EodStrip({ eod, className }: { eod: Eod14; className?: string }) {
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
  const [dept, setDept] = useState("all");
  const [kind, setKind] = useState("all");
  const [expanded, setExpanded] = useState(false);

  const depts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of feed) {
      const k = feedDept(f);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...DEPARTMENT_ORDER, NO_ROLE]
      .filter(k => counts.has(k))
      .map(k => [k, counts.get(k) ?? 0] as const);
  }, [feed]);

  // A department or a kind can drop out of the feed on refresh; fall back to all.
  const activeDept =
    dept === "all" || depts.some(([k]) => k === dept) ? dept : "all";

  const inDept = useMemo(
    () =>
      activeDept === "all"
        ? feed
        : feed.filter(f => feedDept(f) === activeDept),
    [feed, activeDept],
  );

  const kinds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of inDept) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [inDept]);

  const activeKind =
    kind === "all" || kinds.some(([k]) => k === kind) ? kind : "all";
  const items =
    activeKind === "all" ? inDept : inDept.filter(f => f.kind === activeKind);

  const deptOptions: FilterOption<string>[] = [
    { key: "all", label: "All", count: feed.length },
    ...depts.map(([k, n]) => ({
      key: k,
      label: k === NO_ROLE ? "No role" : deptLabel(k as DeptKey),
      count: n,
      hint:
        k === NO_ROLE
          ? "Events that record no role, such as Hermes runs and answered questions"
          : "Events carrying a role in this department, named or not",
    })),
  ];

  const kindOptions: FilterOption<string>[] = [
    { key: "all", label: "All", count: inDept.length },
    ...kinds.map(([k, n]) => ({
      key: k,
      label: kindLabel(k),
      count: n,
      icon: feedKindIcon(k),
    })),
  ];

  return (
    <div className="min-w-0">
      {depts.length > 1 ? (
        <FilterChips
          options={deptOptions}
          value={activeDept}
          onChange={setDept}
          ariaLabel="Show activity from a department"
          className="-mx-5 mb-2 px-5"
        />
      ) : null}
      {kinds.length > 1 ? (
        <FilterChips
          options={kindOptions}
          value={activeKind}
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

function ActionsToday({
  people,
  inactive,
}: {
  people: TeamPerson[];
  /** Paused and left people still show what they did, marked as such. */
  inactive: TeamPerson[];
}) {
  const items = useMemo(
    () =>
      [
        ...people.map(p => ({ p, off: false })),
        ...inactive
          .filter(p => p.actionsToday > 0)
          .map(p => ({ p, off: true })),
      ]
        .sort(
          (a, b) =>
            b.p.actionsToday - a.p.actionsToday ||
            a.p.name.localeCompare(b.p.name),
        )
        .map(({ p, off }) => ({
          key: p.key,
          label: p.name,
          value: p.actionsToday,
          sub: off
            ? `${p.role}, ${statusOf(p) === "left" ? "left" : "paused"}`
            : p.role,
        })),
    [people, inactive],
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

// --- Output by department ---

function ActivityByDept({
  departments,
  unattributed,
}: {
  departments: Dept[];
  unattributed: number;
}) {
  const items = [
    ...departments
      .filter(d => d.events > 0)
      .map(d => ({
        key: d.key,
        label: d.label,
        value: d.events,
        sub: `${count(d.namedEvents)} named`,
      })),
    ...(unattributed > 0
      ? [
          {
            key: NO_ROLE,
            label: "No role recorded",
            value: unattributed,
            sub: "no department",
          },
        ]
      : []),
  ].sort((a, b) => b.value - a.value);

  if (items.length === 0)
    return (
      <EmptyState
        icon={Users}
        title="No activity in the last 7 days"
        text="Events appear as people file, close deals and change campaigns."
        compact
      />
    );

  return <BarList items={items} ariaLabel="Feed events by department" />;
}

// --- What the tab cannot show ---

const GAPS: { label: string; hint: string; sub: string }[] = [
  {
    label: "Head count",
    hint: "No HR or people table reaches the cockpit",
    sub: "The roster on this tab is whoever filed an EOD in the last 30 days or holds a cockpit seat. Paused and Left are set by hand here, not read from a system.",
  },
  {
    label: "Department per person",
    hint: "No table carries a department field",
    sub: "The departments here are derived from each person's role, which is the only signal that exists.",
  },
  {
    label: "Start date, contract and pay",
    hint: "Nothing the cockpit reads carries them",
    sub: "Not in either Supabase project, not in ClickUp and not in any sheet the cockpit reads.",
  },
  {
    label: "Hours worked and utilisation",
    hint: "No time tracking data reaches the cockpit",
    sub: "Hubstaff appears in the expense import as a vendor line only.",
  },
  {
    label: "Public holidays",
    hint: "The EOD rule knows no public holidays",
    sub: "Friday is treated as off and nothing else is, so a holiday reads as a missed EOD for everybody. Leave counts only when a person is set to Paused on this tab.",
  },
];

function Gaps() {
  return (
    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
      {GAPS.map(g => (
        <StatTile
          key={g.label}
          variant="plain"
          label={g.label}
          value={null}
          naHint={g.hint}
          sub={g.sub}
        />
      ))}
    </div>
  );
}
