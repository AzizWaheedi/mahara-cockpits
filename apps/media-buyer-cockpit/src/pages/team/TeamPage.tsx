import { CalendarDays, Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { usePageVisible } from "@/lib/usePageVisible";
import { fetchTeamOverview, saveMeeting as saveMeetingApi, type MeetingSummary, type Overview } from "@/lib/team";
import { api } from "@/lib/cockpitApi";
import { DAY_NAMES, dayLabel, seriesLine } from "../../../convex/teamCore";
import type { Prize, WeekDay } from "../../../convex/teamPage";
import { CADENCES } from "./MeetingPage";
import { chip, DayChips, dayName, errorText, Field, fieldClass, Initials, peopleById, selectClass, timeRange } from "./teamKit";

/**
 * Team meetings: every meeting the team holds, the week at its real times,
 * what each one is for and what it will cover next. The whole team sees it;
 * each meeting opens on its own page (MeetingPage).
 */

export function TeamPage() {
  const auth = useCockpitAuth();
  const setAmount = useAction(api.team.setPrizeAmount);
  const navigate = useNavigate();
  const visible = usePageVisible();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"mine" | "all" | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const userContext = useMemo(
    () => ({
      email: auth.email ?? "",
      isCeo: auth.isCeo,
      isAdmin: auth.isAdmin,
    }),
    [auth.email, auth.isCeo, auth.isAdmin],
  );

  const load = useCallback(async () => {
    if (!auth.client) return;
    try {
      const d = await fetchTeamOverview(auth.client, userContext);
      setData(d);
      setError(null);
      setFilter(f => f ?? (d.meetings.some(m => m.mine) ? "mine" : "all"));
    } catch (e) {
      setError(errorText(e));
    }
  }, [auth.client, userContext]);

  const saveMeeting = useCallback(
    async (args: {
      title: string;
      purpose: string;
      cadence: string;
      department?: string;
    }) => {
      if (!auth.client) throw new Error("Not signed in");
      return saveMeetingApi(auth.client, userContext, args);
    },
    [auth.client, userContext],
  );

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
      <div className="mx-auto w-full max-w-6xl p-1">
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
    <div className="mx-auto grid w-full max-w-6xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight">
            Team meetings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every meeting the team holds, when it meets and what it will cover
            next. Changes made here land on Google Calendar.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(c => !c)}>
          <Plus aria-hidden /> New meeting
        </Button>
      </header>

      {creating ? (
        <NewMeeting
          departments={departments}
          today={data.today}
          onCancel={() => setCreating(false)}
          onSave={async m => {
            const page = (await saveMeeting(m)) as { meeting: { id: string } };
            navigate(`/team/${page.meeting.id}`);
          }}
        />
      ) : null}

      <WeekView weeks={data.weeks} today={data.today} />

      {data.prizes?.length ? (
        <Prizes
          prizes={data.prizes}
          onAmount={async (optionId, amount) => {
            try {
              setData((await setAmount({ optionId, amount })) as Overview);
            } catch (e) {
              setError(errorText(e));
            }
          }}
        />
      ) : null}

      {noPurpose ? (
        <p className="rounded-2xl border bg-card px-4 py-3 text-sm sm:px-6">
          {noPurpose === data.meetings.length
            ? "No meeting has a purpose written yet."
            : `${noPurpose} of ${data.meetings.length} meetings have no purpose written yet.`}{" "}
          <span className="text-muted-foreground">
            Every meeting needs one sentence on what it is for; its hosts can
            add it on the meeting's page.
          </span>
        </p>
      ) : null}

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
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
        <ul className="overflow-hidden rounded-2xl border bg-card">
          {shown.map(m => (
            <MeetingRow key={m.id} m={m} byId={byId} today={data.today} />
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border bg-card px-4 py-10 text-center">
          <p className="text-sm font-medium">
            {filter === "mine"
              ? "You are not in any meeting yet."
              : "No meeting here."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {filter === "mine"
              ? "Everyone's shows every meeting the team holds; a host can add you."
              : "Meetings arrive from the team's calendars within five minutes, or start one with New meeting."}
          </p>
        </div>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

// --- the week ------------------------------------------------------------------------------------

/** Seven days from Saturday, every meeting at its real time; a dashed one is not on Google Calendar. */
function WeekView({ weeks, today }: { weeks: WeekDay[][]; today: string }) {
  const [which, setWhich] = useState(0);
  const days = weeks[which] ?? [];
  const empty = days.every(d => !d.items.length);
  return (
    <section className="rounded-2xl border bg-card" aria-labelledby="week">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-6 sm:pt-5">
        <h2 id="week" className="text-[15px] font-semibold">
          The week
        </h2>
        <div className="flex gap-1.5">
          {["This week", "Next week"].map((label, i) => (
            <button
              key={label}
              type="button"
              aria-pressed={which === i}
              onClick={() => setWhich(i)}
              className={chip(which === i)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {empty ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
          No meeting that week.
        </p>
      ) : (
        <ol className="mt-3 grid border-t lg:grid-cols-7 lg:divide-x">
          {days.map(d => (
            <li
              key={d.day}
              className={`grid content-start gap-1.5 border-b px-4 py-3 lg:border-b-0 lg:px-2.5 ${d.day === today ? "bg-primary/[0.06]" : ""}`}
            >
              <p
                className={`text-xs ${d.day === today ? "font-semibold text-primary" : "text-muted-foreground"}`}
              >
                {d.day === today
                  ? "Today"
                  : DAY_NAMES[new Date(`${d.day}T00:00:00Z`).getUTCDay()]}{" "}
                <span className="font-normal">
                  {dayLabel(d.day).split(" ").slice(1).join(" ")}
                </span>
              </p>
              {d.items.length ? (
                <ul className="grid gap-1.5">
                  {d.items.map(x => (
                    <li key={`${x.meetingId}-${x.day}`}>
                      <Link
                        to={`/team/${x.meetingId}`}
                        className={`block rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-muted ${
                          x.onCalendar
                            ? "bg-muted/50"
                            : "border border-dashed border-border"
                        } ${x.status === "cancelled" ? "line-through opacity-60" : ""}`}
                        title={
                          x.onCalendar ? undefined : "Not on Google Calendar"
                        }
                      >
                        <span className="block font-mono text-[11px] text-muted-foreground">
                          {timeRange(x.time, x.endTime) || "No time"}
                          {x.status === "moved" ? " moved" : ""}
                        </span>
                        <span
                          className="block font-medium leading-snug"
                          dir="auto"
                        >
                          {x.title}
                        </span>
                        {x.theme ? (
                          <span className="block text-muted-foreground">
                            {x.theme}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hidden text-xs text-muted-foreground/60 lg:block">
                  Nothing
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// --- prizes -------------------------------------------------------------------------------------

/** Every prize on every wheel, one list, the amount set in place. The CEO and admins only. */
function Prizes({
  prizes,
  onAmount,
}: {
  prizes: Prize[];
  onAmount: (optionId: number, amount: number) => Promise<void>;
}) {
  const withAmount = prizes.filter(p => p.label.includes("{amount}"));
  return (
    <details className="rounded-2xl border bg-card">
      <summary className="cursor-pointer px-4 py-3 text-[15px] font-semibold sm:px-6">
        Prizes{" "}
        <span className="font-normal text-muted-foreground">
          {withAmount.length} amounts to set
        </span>
      </summary>
      <ul className="divide-y border-t">
        {prizes.map(p => (
          <li
            key={p.optionId}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm sm:px-6"
          >
            <span className="min-w-0 flex-1">
              <span
                className={p.active ? "" : "text-muted-foreground line-through"}
              >
                {p.rendered}
              </span>
              {p.condition ? (
                <span className="text-muted-foreground"> ({p.condition})</span>
              ) : null}
              <span className="block text-xs text-muted-foreground">
                {p.wheelName}
                {p.meetingTitle ? `, ${p.meetingTitle}` : ""}
              </span>
            </span>
            {p.label.includes("{amount}") ? (
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                {p.suffix ? null : (
                  <span>
                    {p.currency && p.currency !== "USD" ? p.currency : "$"}
                  </span>
                )}
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.01}
                  defaultValue={p.amount ?? ""}
                  aria-label={`Amount for ${p.rendered}`}
                  onBlur={e => {
                    const value = Number(e.target.value);
                    if (e.target.value !== "" && value !== p.amount)
                      void onAmount(p.optionId, value);
                  }}
                  className="h-8 w-24 rounded-md border border-input bg-transparent px-2 text-right font-mono text-sm tabular-nums"
                />
                {p.suffix ? <span>{p.suffix}</span> : null}
              </label>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

// --- the list -------------------------------------------------------------------------------------

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
  const series =
    m.startTime && m.minutes
      ? seriesLine({
          weekdays: m.weekdays,
          startTime: m.startTime,
          minutes: m.minutes,
        }).replace(/, Kuwait time$/, "")
      : null;
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
          {/* A missing purpose is counted once, in the note above the list. */}
          {m.purpose ? (
            <span
              className="mt-0.5 block text-sm text-muted-foreground"
              dir="auto"
            >
              {m.purpose}
            </span>
          ) : null}
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
            {series ? (
              <span>{series}</span>
            ) : m.cadence ? (
              <span>{m.cadence}</span>
            ) : null}
            {m.department ? <span>{m.department}</span> : null}
            {!m.onCalendar && series ? (
              <span className="txt-warn">Not on Google Calendar</span>
            ) : null}
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
  today,
  onCancel,
  onSave,
}: {
  departments: string[];
  today: string;
  onCancel: () => void;
  onSave: (m: {
    title: string;
    purpose: string;
    cadence: string;
    department?: string;
    onCalendar: boolean;
    weekdays: number[];
    startTime?: string;
    minutes?: number;
    firstDate?: string;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [cadence, setCadence] = useState("weekly");
  const [department, setDepartment] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState("13:00");
  const [minutes, setMinutes] = useState("30");
  const [first, setFirst] = useState(today);
  const [offCalendar, setOffCalendar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-4 rounded-2xl border bg-card p-4 sm:p-6"
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
            onCalendar: !offCalendar,
            weekdays: days,
            startTime: start,
            minutes: Number(minutes),
            firstDate: first,
          });
        } catch (err) {
          setError(errorText(err));
          setBusy(false);
        }
      }}
    >
      <h2 className="text-[15px] font-semibold">A new meeting</h2>
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
      <DayChips
        value={days}
        onChange={setDays}
        label="Days (none for a one-off)"
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Starts
          <input
            type="time"
            step={300}
            value={start}
            onChange={e => setStart(e.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Minutes
          <input
            type="number"
            inputMode="numeric"
            min={5}
            max={480}
            step={5}
            value={minutes}
            onChange={e => setMinutes(e.target.value)}
            className={fieldClass}
          />
        </label>
        <div className="col-span-2 grid gap-1 sm:col-span-1">
          <span className="text-xs font-medium text-muted-foreground">
            {days.length ? "First from" : "On"}
          </span>
          <DateInput
            value={first}
            onChange={e => setFirst(e.target.value)}
            aria-label={days.length ? "First from" : "On"}
          />
        </div>
      </div>
      <span className="flex items-center gap-2 text-sm">
        <Checkbox
          id="new-meeting-off-calendar"
          checked={offCalendar}
          onCheckedChange={v => setOffCalendar(v === true)}
        />
        <label htmlFor="new-meeting-off-calendar">
          Leave it off Google Calendar
        </label>
      </span>
      <p className="text-xs text-muted-foreground">
        You host it.{" "}
        {offCalendar
          ? "It stays in the cockpit; put it on the calendar from its page any time."
          : "It goes on your Google Calendar with a Meet link; add the people on its page and they get the invite."}
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
