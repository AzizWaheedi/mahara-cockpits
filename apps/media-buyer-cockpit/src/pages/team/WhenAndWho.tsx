import { api, useAction } from "@/lib/cockpitApi";
import {
  ArrowUpRight,
  CalendarPlus,
  Loader2,
  Pencil,
  RotateCcw,
  UserPlus,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import {
  addDays,
  dayLabel,
  seriesLine,
  seriesPreview,
  utcToZoned,
} from "@/lib/teamCore";
import type { MeetingPage as Page, Sitting } from "@/lib/team";
import {
  ConfirmInline,
  DayChips,
  fieldClass,
  Initials,
  peopleById,
  peopleOptions,
  selectClass,
  timeRange,
  useBusy,
} from "./teamKit";

/**
 * When and who: the top of a meeting's page. The series in one line, what
 * Google Calendar holds, the next four sittings, and the people. Hosts,
 * admins and the CEO change it here and it lands on the Google Calendar
 * event (convex/teamCalendar.ts); everyone else reads it.
 */

type Act = (fn: () => Promise<unknown>) => Promise<void>;

function ago(iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

export function WhenAndWho({ page, act }: { page: Page; act: Act }) {
  const m = page.meeting;
  const cal = page.calendar;
  const [editing, setEditing] = useState(false);
  const livePartDays = cal.parts.filter(
    p => !p.endsOn || p.endsOn >= page.today,
  );
  const line =
    m.startTime || m.weekdays?.length
      ? seriesLine({
          weekdays: m.weekdays ?? null,
          startTime: m.startTime ?? null,
          minutes: m.minutes ?? null,
          tz: m.tz,
          rrule: m.rrule,
          onDay: !m.weekdays?.length
            ? (page.next[0]?.onDate ?? m.endsOn)
            : null,
        })
      : "No time set yet";
  return (
    <section
      className="rounded-2xl border bg-card"
      aria-labelledby="when-and-who"
    >
      <div className="grid gap-8 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-10">
        <div className="grid min-w-0 content-start gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="when-and-who" className="text-[15px] font-semibold">
                When and who
              </h2>
              <p className="mt-1 text-lg font-semibold tracking-tight">
                {line}
              </p>
              {m.endsOn && m.weekdays?.length ? (
                <p className="text-sm text-muted-foreground">
                  {m.endsOn < page.today ? "Ended" : "Last sitting"}{" "}
                  {dayLabel(m.endsOn)}
                </p>
              ) : null}
              {livePartDays.length > 1 ? (
                <p className="text-sm text-muted-foreground">
                  On Google Calendar as {livePartDays.length} series, one a day,
                  each titled for its day.
                </p>
              ) : null}
            </div>
            {page.canManage && !editing ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
              >
                <Pencil aria-hidden /> Edit
              </Button>
            ) : null}
          </div>
          <CalendarLine page={page} act={act} />
          {editing ? (
            <SeriesEditor
              page={page}
              act={act}
              onDone={() => setEditing(false)}
            />
          ) : null}
          <NextSittings page={page} act={act} />
          {page.canManage ? <EndMeeting page={page} act={act} /> : null}
        </div>
        <People page={page} act={act} />
      </div>
    </section>
  );
}

// --- Google Calendar, in one line ---------------------------------------------------------

function CalendarLine({ page, act }: { page: Page; act: Act }) {
  const cal = page.calendar;
  const put = useAction(api.teamCalendar.putOnCalendar);
  const take = useAction(api.teamCalendar.takeOver);
  const retry = useAction(api.teamCalendar.retryCalendar);
  const [busy, run] = useBusy();
  const id = page.meeting.id;
  return (
    <div className="grid gap-1.5 text-sm">
      {cal.state === "off" ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground">
          Not on Google Calendar.
          {page.canManage ? (
            <Button
              size="sm"
              variant="teal"
              disabled={busy === "put" || !page.meeting.startTime}
              title={
                page.meeting.startTime
                  ? undefined
                  : "Set its days, start time and length first"
              }
              onClick={() =>
                run("put", () => act(() => put({ meetingId: id })))
              }
            >
              {busy === "put" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <CalendarPlus aria-hidden />
              )}
              Put on calendar
            </Button>
          ) : null}
        </p>
      ) : cal.state === "someone-else" ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground">
          Organised on {cal.organizer ? `${cal.organizer}'s` : "someone else's"}{" "}
          calendar, which the cockpit cannot change.
          {page.canManage ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "take"}
              onClick={() =>
                run("take", () => act(() => take({ meetingId: id })))
              }
            >
              {busy === "take" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              Take over
            </Button>
          ) : null}
        </p>
      ) : (
        <p className="text-muted-foreground">
          On Google Calendar
          {cal.syncedAt ? `, synced ${ago(cal.syncedAt)}` : ""}.
        </p>
      )}
      {cal.waiting ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <span className="size-1.5 rounded-full bg-warning" aria-hidden />
          {cal.waiting === 1 ? "1 change" : `${cal.waiting} changes`} waiting to
          reach Google Calendar
          {cal.ready
            ? "."
            : ": the cockpit's calendar sign-in is not set yet, so they wait until it is."}
        </p>
      ) : null}
      {cal.error ? (
        <p
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-destructive"
          role="alert"
        >
          {cal.error}
          {page.canManage ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "retry"}
              onClick={() =>
                run("retry", () => act(() => retry({ meetingId: id })))
              }
            >
              {busy === "retry" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <RotateCcw aria-hidden />
              )}
              Retry
            </Button>
          ) : null}
        </p>
      ) : null}
      {cal.link || page.meeting.meetLink ? (
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          {cal.link ? (
            <a
              href={cal.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              Open in Google Calendar{" "}
              <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          ) : null}
          {page.meeting.meetLink ? (
            <a
              href={page.meeting.meetLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              Join the call <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

// --- the series: days, time, length ----------------------------------------------------------

function SeriesEditor({
  page,
  act,
  onDone,
}: {
  page: Page;
  act: Act;
  onDone: () => void;
}) {
  const m = page.meeting;
  const setSeries = useAction(api.teamCalendar.setSeries);
  const nextDay = page.next.find(s => s.status !== "cancelled")?.onDate ?? null;
  const [days, setDays] = useState<number[]>(m.weekdays ?? []);
  const [start, setStart] = useState((m.startTime ?? "13:00").slice(0, 5));
  const [minutes, setMinutes] = useState(String(m.minutes ?? 30));
  const [from, setFrom] = useState(nextDay ?? page.today);
  const [busy, setBusy] = useState(false);
  const monthly = /FREQ=MONTHLY/i.test(m.rrule ?? "");
  const change = {
    weekdays: days,
    startTime: start,
    minutes: Number(minutes) || 0,
    from,
  };
  const valid =
    /^\d{2}:\d{2}$/.test(start) &&
    change.minutes >= 5 &&
    change.minutes <= 480 &&
    (days.length > 0 || !m.rrule);
  const linked = page.calendar.state !== "off";
  const parts = page.calendar.parts;
  const preview = useMemo(
    () =>
      valid
        ? seriesPreview({
            linked,
            parts: parts.filter(p => !p.endsOn || p.endsOn >= page.today),
            change: {
              weekdays: days,
              startTime: start,
              minutes: Number(minutes) || 0,
              from,
            },
            next: nextDay,
            tz: m.tz,
            quiet: Boolean(m.endsOn && m.endsOn < page.today),
          })
        : [],
    [
      valid,
      linked,
      parts,
      days,
      start,
      minutes,
      from,
      nextDay,
      m.tz,
      m.endsOn,
      page.today,
    ],
  );
  return (
    <form
      className="grid gap-4 rounded-xl bg-muted/40 p-4"
      onSubmit={async e => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        try {
          await act(() => setSeries({ meetingId: m.id, ...change }));
          onDone();
        } catch {
          // The page shows the error.
        } finally {
          setBusy(false);
        }
      }}
    >
      {monthly ? (
        <p className="text-sm text-muted-foreground">
          It repeats monthly on Google Calendar: the time and length change
          here, its days in Google Calendar.
        </p>
      ) : (
        <DayChips value={days} onChange={setDays} />
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Starts
          <input
            type="time"
            value={start}
            step={300}
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
            From
          </span>
          <DateInput
            value={from}
            min={addDays(page.today, -60)}
            onChange={e => setFrom(e.target.value)}
            aria-label="From"
          />
        </div>
      </div>
      {preview.length ? (
        <div
          className="grid gap-1 border-l-2 border-primary/50 pl-3 text-sm"
          aria-live="polite"
        >
          <p className="font-medium">What changes</p>
          {preview.map(line => (
            <p key={line} className="text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !valid}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {page.calendar.state === "off" ? "Save" : "Save and send"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// --- the next four sittings ------------------------------------------------------------------

function NextSittings({ page, act }: { page: Page; act: Act }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">Next sittings</h3>
      {page.next.length ? (
        <ul className="divide-y rounded-xl border">
          {page.next.map(s => (
            <SittingRow key={s.id} s={s} page={page} act={act} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nothing ahead.{" "}
          {page.canManage
            ? page.calendar.state === "off"
              ? "Set its days under Edit, or add a one-off sitting."
              : "Google Calendar has no sitting in the next weeks."
            : ""}
        </p>
      )}
      {page.canManage ? (
        adding ? (
          <AddOneOff page={page} act={act} onDone={() => setAdding(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="w-fit text-sm text-primary underline-offset-4 hover:underline"
          >
            Add a one-off sitting
          </button>
        )
      ) : null}
    </div>
  );
}

function SittingRow({ s, page, act }: { s: Sitting; page: Page; act: Act }) {
  const move = useAction(api.teamCalendar.moveSitting);
  const cancel = useAction(api.teamCalendar.cancelSitting);
  const [moving, setMoving] = useState(false);
  const [day, setDay] = useState(s.onDate);
  const [start, setStart] = useState(
    s.time ?? page.meeting.startTime?.slice(0, 5) ?? "13:00",
  );
  const [minutes, setMinutes] = useState(
    String(
      s.startsAt && s.endsAt
        ? Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60_000)
        : (page.meeting.minutes ?? 30),
    ),
  );
  const [busy, run] = useBusy();
  const cancelled = s.status === "cancelled";
  // A moved sitting shows where it went; its own day stays its name.
  const at = s.startsAt
    ? utcToZoned(s.startsAt, page.meeting.tz ?? "Asia/Kuwait").day
    : s.onDate;
  const movedFrom =
    s.status !== "moved"
      ? null
      : at !== s.onDate
        ? dayLabel(s.onDate)
        : page.meeting.startTime
          ? page.meeting.startTime.slice(0, 5)
          : null;
  return (
    <li className="grid gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={`min-w-0 flex-1 text-sm ${cancelled ? "text-muted-foreground line-through" : ""}`}
        >
          <span className="font-medium">
            {at === page.today ? "Today" : dayLabel(at)}
          </span>{" "}
          <span className="font-mono text-[13px] text-muted-foreground">
            {timeRange(s.time ?? null, s.endTime ?? null)}
          </span>
          {movedFrom ? (
            <span className="ml-2 text-xs txt-warn">
              moved from {movedFrom}
            </span>
          ) : null}
          {cancelled ? (
            <span className="ml-2 text-xs no-underline">cancelled</span>
          ) : null}
          {s.virtual ? (
            <span className="ml-2 text-xs text-muted-foreground">
              not on the calendar
            </span>
          ) : null}
        </span>
        {page.canManage && !cancelled && !moving ? (
          <span className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setMoving(true)}
            >
              Move
            </Button>
            <ConfirmInline
              ask="Cancel this sitting?"
              yes="Cancel it"
              onYes={() =>
                act(() =>
                  cancel({ meetingId: page.meeting.id, sittingId: s.id }),
                )
              }
            >
              {open => (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={open}
                >
                  Cancel
                </Button>
              )}
            </ConfirmInline>
          </span>
        ) : null}
      </div>
      {moving ? (
        <form
          className="grid gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
          onSubmit={e => {
            e.preventDefault();
            void run("move", async () => {
              await act(() =>
                move({
                  meetingId: page.meeting.id,
                  sittingId: s.id,
                  day,
                  startTime: start,
                  minutes: Number(minutes),
                }),
              );
              setMoving(false);
            });
          }}
        >
          <DateInput
            value={day}
            onChange={e => setDay(e.target.value)}
            aria-label="Move to"
          />
          <input
            type="time"
            value={start}
            step={300}
            onChange={e => setStart(e.target.value)}
            className={`${fieldClass} sm:w-28`}
            aria-label="Start"
          />
          <input
            type="number"
            min={5}
            max={480}
            step={5}
            value={minutes}
            onChange={e => setMinutes(e.target.value)}
            className={`${fieldClass} sm:w-20`}
            aria-label="Minutes"
          />
          <span className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy === "move"}>
              {busy === "move" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              Move it
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setMoving(false)}
            >
              Keep
            </Button>
          </span>
          {s.onCalendar ? (
            <p className="text-xs text-muted-foreground sm:col-span-4">
              Only this sitting moves on Google Calendar; the series stays as it
              is.
            </p>
          ) : null}
        </form>
      ) : null}
    </li>
  );
}

function AddOneOff({
  page,
  act,
  onDone,
}: {
  page: Page;
  act: Act;
  onDone: () => void;
}) {
  const add = useAction(api.teamCalendar.addSitting);
  const [day, setDay] = useState(page.today);
  const [start, setStart] = useState(
    page.meeting.startTime?.slice(0, 5) ?? "13:00",
  );
  const [minutes, setMinutes] = useState(String(page.meeting.minutes ?? 30));
  const [busy, run] = useBusy();
  return (
    <form
      className="grid gap-3 rounded-xl bg-muted/40 p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
      onSubmit={e => {
        e.preventDefault();
        void run("add", async () => {
          await act(() =>
            add({
              meetingId: page.meeting.id,
              date: day,
              startTime: start,
              minutes: Number(minutes),
            }),
          );
          onDone();
        });
      }}
    >
      <DateInput
        value={day}
        min={page.today}
        onChange={e => setDay(e.target.value)}
        aria-label="Date"
      />
      <input
        type="time"
        value={start}
        step={300}
        onChange={e => setStart(e.target.value)}
        className={`${fieldClass} sm:w-28`}
        aria-label="Start"
      />
      <input
        type="number"
        min={5}
        max={480}
        step={5}
        value={minutes}
        onChange={e => setMinutes(e.target.value)}
        className={`${fieldClass} sm:w-20`}
        aria-label="Minutes"
      />
      <span className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy === "add" || !day}>
          {busy === "add" ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : null}
          Add it
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </span>
      {page.calendar.state !== "off" ? (
        <p className="text-xs text-muted-foreground sm:col-span-4">
          It goes on Google Calendar as its own event, with the same guests and
          a Meet link.
        </p>
      ) : null}
    </form>
  );
}

function EndMeeting({ page, act }: { page: Page; act: Act }) {
  const end = useAction(api.teamCalendar.endMeeting);
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState(
    page.next.find(s => s.status !== "cancelled")?.onDate ?? page.today,
  );
  const [busy, run] = useBusy();
  if (page.meeting.endsOn && page.meeting.endsOn < page.today) return null;
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-destructive hover:underline"
      >
        End this meeting
      </button>
    );
  return (
    <form
      className="grid gap-3 rounded-xl border border-destructive/30 p-3"
      onSubmit={e => {
        e.preventDefault();
        void run("end", async () => {
          await act(() => end({ meetingId: page.meeting.id, lastDate: last }));
          setOpen(false);
        });
      }}
    >
      <p className="text-sm">
        The last sitting is the one you pick. After it the series stops on
        Google Calendar
        {page.calendar.state === "off" ? "" : " and everyone invited is told"}.
        Nothing is deleted: its notes, agendas and spins stay here.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <DateInput
          value={last}
          min={addDays(page.today, -1)}
          onChange={e => setLast(e.target.value)}
          aria-label="Last date"
        />
        <Button
          type="submit"
          size="sm"
          variant="destructive"
          disabled={busy === "end"}
        >
          {busy === "end" ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : null}
          End after {dayLabel(last)}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          Keep it
        </Button>
      </div>
    </form>
  );
}

// --- the people --------------------------------------------------------------------------------

const PART_LABEL: Record<string, string> = {
  host: "Hosts",
  required: "In the meeting",
  optional: "Optional",
};

function People({ page, act }: { page: Page; act: Act }) {
  const setPart = useAction(api.teamCalendar.setPart);
  const setEmail = useAction(api.teamCalendar.setEmail);
  const byId = peopleById(page.people);
  const members = new Set(page.members.map(x => x.personId));
  const [busy, run] = useBusy();
  const [adding, setAdding] = useState("");
  const [addPart, setAddPart] = useState<"required" | "optional" | "host">(
    "required",
  );
  const [someoneNew, setSomeoneNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [askEmail, setAskEmail] = useState<{
    personId: string;
    name: string;
    part: string;
  } | null>(null);
  const [email, setEmailText] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const linked = page.calendar.state !== "off";

  const change = (
    personId: string | undefined,
    part: "host" | "required" | "optional" | "off",
    newPerson?: { name: string; email: string },
  ) =>
    act(async () => {
      const res = (await setPart({
        meetingId: page.meeting.id,
        personId,
        part,
        ...(newPerson ? { newPerson } : {}),
      })) as Page | { needsEmail: { personId: string; name: string } };
      if ("needsEmail" in res) {
        setAskEmail({ ...res.needsEmail, part });
        return page;
      }
      return res;
    });

  return (
    <div className="grid min-w-0 content-start gap-3">
      <h3 className="text-sm font-medium">
        Who is in it{" "}
        <span className="font-normal text-muted-foreground">
          {page.members.length}
        </span>
      </h3>
      {!page.members.length ? (
        <p className="text-sm text-muted-foreground">
          Nobody yet.{" "}
          {linked
            ? "People come from the Google Calendar invite, or add them here."
            : "Add them here."}
        </p>
      ) : null}
      {(["host", "required", "optional"] as const).map(part => {
        const list = page.members.filter(x => x.part === part);
        if (!list.length) return null;
        return (
          <div key={part}>
            <p className="text-xs text-muted-foreground">{PART_LABEL[part]}</p>
            <ul className="mt-1.5 grid gap-2">
              {list.map(x => {
                const p = byId.get(x.personId);
                return (
                  <li key={x.personId} className="flex items-center gap-2.5">
                    <Initials
                      person={p}
                      tone={part === "host" ? "host" : "muted"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm" dir="auto">
                        {p?.name ?? x.personId}
                        {x.personId === page.me.personId ? " (you)" : ""}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[p?.role, p?.department].filter(Boolean).join(", ") ||
                          (p?.email ? "" : "No email yet")}
                      </span>
                    </span>
                    {page.canManage ? (
                      <AnimatedSelect
                        className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs"
                        aria-label={`${p?.name ?? "Their"} part`}
                        value={x.part}
                        disabled={busy === x.personId}
                        onChange={e =>
                          run(x.personId, () =>
                            change(
                              x.personId,
                              e.target.value as
                                | "host"
                                | "required"
                                | "optional"
                                | "off",
                            ),
                          )
                        }
                      >
                        <option value="host">Host</option>
                        <option value="required">In it</option>
                        <option value="optional">Optional</option>
                        <option value="off">Take off</option>
                      </AnimatedSelect>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {askEmail ? (
        <form
          className="grid gap-2 rounded-xl bg-muted/40 p-3"
          onSubmit={e => {
            e.preventDefault();
            void run("email", async () => {
              await act(() =>
                setEmail({
                  meetingId: page.meeting.id,
                  personId: askEmail.personId,
                  email,
                }),
              );
              await change(
                askEmail.personId,
                askEmail.part as "host" | "required" | "optional",
              );
              setAskEmail(null);
              setEmailText("");
            });
          }}
        >
          <p className="text-sm">
            {askEmail.name} has no email address on the roster, so the invite
            cannot reach them. Add it:
          </p>
          <Input
            type="email"
            value={email}
            onChange={e => setEmailText(e.target.value)}
            placeholder="name@maharamedia.com"
            aria-label={`${askEmail.name}'s email`}
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={busy === "email" || !email.includes("@")}
            >
              {busy === "email" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              Save and invite
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAskEmail(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {page.canManage ? (
        <form
          className="grid gap-2 border-t pt-3"
          onSubmit={e => {
            e.preventDefault();
            setLocalError(null);
            if (someoneNew) {
              if (newName.trim().length < 2 || !newEmail.includes("@")) {
                setLocalError("Give their name and email address.");
                return;
              }
              void run("add", async () => {
                await change(undefined, addPart, {
                  name: newName,
                  email: newEmail,
                });
                setNewName("");
                setNewEmail("");
                setSomeoneNew(false);
              });
              return;
            }
            if (!adding) return;
            void run("add", async () => {
              await change(adding, addPart);
              setAdding("");
            });
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Add someone</p>
            <button
              type="button"
              className="text-xs text-primary underline-offset-4 hover:underline"
              onClick={() => setSomeoneNew(n => !n)}
            >
              {someoneNew ? "Pick from the team" : "Someone new"}
            </button>
          </div>
          {someoneNew ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Name"
                aria-label="Their name"
              />
              <Input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="Email"
                aria-label="Their email"
              />
            </div>
          ) : (
            <AnimatedSelect
              className={selectClass}
              value={adding}
              onChange={e => setAdding(e.target.value)}
              aria-label="Who to add"
            >
              <option value="">Pick a person</option>
              {peopleOptions(page.people, members)}
            </AnimatedSelect>
          )}
          <div className="flex gap-2">
            <AnimatedSelect
              className={selectClass}
              value={addPart}
              onChange={e =>
                setAddPart(e.target.value as "required" | "optional" | "host")
              }
              aria-label="As"
            >
              <option value="required">In the meeting</option>
              <option value="optional">Optional</option>
              <option value="host">Host</option>
            </AnimatedSelect>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={busy === "add" || (!someoneNew && !adding)}
            >
              {busy === "add" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <UserPlus aria-hidden />
              )}
              Add
            </Button>
          </div>
          {localError ? (
            <p className="text-xs text-destructive">{localError}</p>
          ) : null}
          <p className="text-[11px] leading-snug text-muted-foreground">
            {linked
              ? "Adding or taking someone off sends Google's invite or cancellation to them. A change of part is quiet."
              : "It is not on Google Calendar, so nobody is sent an invite."}
          </p>
        </form>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Its hosts, admins and the CEO change who is in it.
        </p>
      )}
    </div>
  );
}
