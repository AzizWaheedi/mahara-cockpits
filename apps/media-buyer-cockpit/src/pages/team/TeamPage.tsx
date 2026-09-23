import { useAction } from "convex/react";
import { CalendarDays, Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePageVisible } from "@/lib/usePageVisible";
import { api } from "../../../convex/_generated/api";
import type { MeetingSummary, Overview } from "../../../convex/team";
import {
  dayName,
  errorText,
  Field,
  Initials,
  peopleById,
  selectClass,
} from "./teamKit";

/**
 * Team meetings: every meeting the team holds, what each one is for, and
 * what it will cover next. The whole team sees it; each meeting opens on its
 * own page (MeetingPage). Aziz, 2026-09-22.
 */

const CADENCES = [
  "weekly",
  "every two weeks",
  "monthly",
  "quarterly",
  "as needed",
];

export function TeamPage() {
  const overview = useAction(api.team.overview);
  const saveMeeting = useAction(api.team.saveMeeting);
  const navigate = useNavigate();
  const visible = usePageVisible();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"mine" | "all" | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = (await overview({})) as Overview;
      setData(d);
      setError(null);
      setFilter(f => f ?? (d.meetings.some(m => m.mine) ? "mine" : "all"));
    } catch (e) {
      setError(errorText(e));
    }
  }, [overview]);

  useEffect(() => {
    if (!visible) return;
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load, visible]);

  const byId = useMemo(() => peopleById(data?.people ?? []), [data]);
  const departments = useMemo(
    () =>
      [
        ...new Set(
          (data?.meetings ?? [])
            .map(m => m.department)
            .filter((d): d is string => Boolean(d)),
        ),
      ].sort(),
    [data],
  );
  const shown = useMemo(() => {
    const list = (data?.meetings ?? []).filter(
      m => (filter !== "mine" || m.mine) && (!dept || m.department === dept),
    );
    // What meets soonest first; meetings with no date after them.
    return list.sort(
      (a, b) =>
        (a.nextSitting ?? "9999").localeCompare(b.nextSitting ?? "9999") ||
        a.title.localeCompare(b.title),
    );
  }, [data, filter, dept]);

  if (!data)
    return (
      <div className="mx-auto w-full max-w-5xl p-1">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Reading the
            team's meetings
          </p>
        )}
      </div>
    );

  const noPurpose = data.meetings.filter(m => !m.purpose).length;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h1 className="text-xl font-semibold tracking-tight">
            Team meetings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every meeting the team holds, what it is for, and what it will cover
            next. Whatever is not finished carries over to the next one.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(c => !c)}>
          <Plus aria-hidden /> New meeting
        </Button>
      </header>

      {creating ? (
        <NewMeeting
          departments={departments}
          onCancel={() => setCreating(false)}
          onSave={async m => {
            const page = (await saveMeeting(m)) as { meeting: { id: string } };
            navigate(`/team/${page.meeting.id}`);
          }}
        />
      ) : null}

      {noPurpose ? (
        <p className="rounded-lg border bg-card px-4 py-3 text-sm">
          {noPurpose === data.meetings.length
            ? "No meeting has a purpose written yet."
            : `${noPurpose} of ${data.meetings.length} meetings have no purpose written yet.`}{" "}
          <span className="text-muted-foreground">
            Every meeting needs one sentence on what it is for; its hosts can
            add it on the meeting's page.
          </span>
        </p>
      ) : null}

      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
        {(
          [
            ["mine", "Yours"],
            ["all", "Everyone's"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={chip(filter === key)}
          >
            {label}
            <span className="ml-1.5 tabular-nums opacity-60">
              {key === "mine"
                ? data.meetings.filter(m => m.mine).length
                : data.meetings.length}
            </span>
          </button>
        ))}
        {departments.length ? (
          <span className="mx-1 w-px shrink-0 self-stretch bg-border" />
        ) : null}
        {departments.map(d => (
          <button
            key={d}
            type="button"
            aria-pressed={dept === d}
            onClick={() => setDept(dept === d ? null : d)}
            className={chip(dept === d)}
          >
            {d}
          </button>
        ))}
      </div>

      {shown.length ? (
        <ul className="overflow-hidden rounded-xl border bg-card">
          {shown.map(m => (
            <MeetingRow key={m.id} m={m} byId={byId} today={data.today} />
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border bg-card px-4 py-10 text-center">
          <p className="text-sm font-medium">
            {filter === "mine"
              ? "You are not in any meeting yet."
              : "No meeting here."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {filter === "mine"
              ? "Everyone's shows every meeting the team holds; a host can add you."
              : "Meetings arrive from the team's calendars every hour, or start one with New meeting."}
          </p>
        </div>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

const chip = (on: boolean) =>
  `shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors ${
    on
      ? "border-transparent bg-foreground text-background"
      : "text-muted-foreground hover:text-foreground"
  }`;

function MeetingRow({
  m,
  byId,
  today,
}: {
  m: MeetingSummary;
  byId: ReturnType<typeof peopleById>;
  today: string;
}) {
  const hosts = m.hostIds.map(id => byId.get(id)).filter(Boolean);
  const soon =
    m.nextSitting &&
    Date.parse(`${m.nextSitting}T00:00:00Z`) -
      Date.parse(`${today}T00:00:00Z`) <=
      2 * 86_400_000;
  return (
    <li className="border-b last:border-b-0">
      <Link
        to={`/team/${m.id}`}
        className="grid gap-2 px-4 py-3.5 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"
      >
        <span className="min-w-0">
          <span className="block font-medium" dir="auto">
            {m.title}
          </span>
          <span
            className={`mt-0.5 block text-sm ${m.purpose ? "text-muted-foreground" : "italic text-muted-foreground/80"}`}
            dir="auto"
          >
            {m.purpose ?? "No purpose written yet"}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {hosts.length ? (
              <span className="flex items-center gap-1.5">
                <span className="flex -space-x-1.5">
                  {hosts.slice(0, 3).map(h => (
                    <Initials key={h?.id} person={h} tone="host" />
                  ))}
                </span>
                {hosts.length === 1
                  ? `${hosts[0]?.name.split(" ")[0]} hosts`
                  : `${hosts.length} hosts`}
              </span>
            ) : (
              <span>No host</span>
            )}
            <span>
              {m.peopleIds.length}{" "}
              {m.peopleIds.length === 1 ? "person" : "people"}
            </span>
            {m.cadence ? <span>{m.cadence}</span> : null}
            {m.department ? <span>{m.department}</span> : null}
          </span>
        </span>
        <span className="flex items-center gap-4 text-sm sm:flex-col sm:items-end sm:gap-1">
          <span
            className={`flex items-center gap-1.5 tabular-nums ${soon ? "font-medium" : ""}`}
          >
            <CalendarDays
              className="size-3.5 text-muted-foreground"
              aria-hidden
            />
            {m.nextSitting
              ? m.nextSitting === today
                ? "Today"
                : dayName(m.nextSitting)
              : "No date set"}
          </span>
          <span className="text-xs text-muted-foreground">
            {m.openItems
              ? `${m.openItems} on the agenda`
              : "Nothing on the agenda"}
          </span>
        </span>
      </Link>
    </li>
  );
}

function NewMeeting({
  departments,
  onCancel,
  onSave,
}: {
  departments: string[];
  onCancel: () => void;
  onSave: (m: {
    title: string;
    purpose: string;
    cadence: string;
    department?: string;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [cadence, setCadence] = useState("weekly");
  const [department, setDepartment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-3 rounded-xl border bg-card p-4 sm:p-5"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSave({
            title,
            purpose,
            cadence,
            ...(department ? { department } : {}),
          });
        } catch (err) {
          setError(errorText(err));
          setBusy(false);
        }
      }}
    >
      <h2 className="text-sm font-semibold">A new meeting</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          {id => (
            <Input
              id={id}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="End of month planning"
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            How often
            <AnimatedSelect
              className={selectClass}
              value={cadence}
              onChange={e => setCadence(e.target.value)}
            >
              {CADENCES.map(c => (
                <option key={c} value={c}>
                  {c[0].toUpperCase() + c.slice(1)}
                </option>
              ))}
            </AnimatedSelect>
          </label>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Department
            <AnimatedSelect
              className={selectClass}
              value={department}
              onChange={e => setDepartment(e.target.value)}
            >
              <option value="">Across the team</option>
              {departments.map(d => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </AnimatedSelect>
          </label>
        </div>
      </div>
      <Field label="What it is for, in one sentence">
        {id => (
          <Input
            id={id}
            value={purpose}
            onChange={e => setPurpose(e.target.value)}
            placeholder="Close the month's numbers and set next month's projections."
          />
        )}
      </Field>
      <p className="text-xs text-muted-foreground">
        You host it. Add the people and the first date on its page.
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Make the meeting
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
