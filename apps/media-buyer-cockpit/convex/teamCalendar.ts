import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { SbRow } from "./ceo/sbWrite";
import { kuwaitDay } from "./ceo/time";
import { authenticatedAction } from "./functions";
import { flush, note } from "./health";
import {
  addDays,
  applyGuestChanges,
  buildRrule,
  endOf,
  endRrule,
  eventSeries,
  type GuestChange,
  guestUpdates,
  hhmm,
  nextOn,
  patchWithRetry,
  planSeriesChange,
  renamedSummary,
  rruleOf,
  type SeriesChange,
  sendUpdatesFor,
  seriesLine,
  seriesUnchanged,
  utcToZoned,
  wallClock,
  weekdayOf,
  weekdaysOfRrule,
  withOurBlock,
  withRrule,
  zonedToUtc,
} from "./teamCore";
import {
  type Any,
  clean,
  db,
  enc,
  logChange,
  meetingOrRefuse,
  mustManage,
  noted,
  slug,
  type Who,
} from "./teamDb";
import { type MeetingPage, meetingLink, page } from "./teamPage";
import { calendarWriteReady, googleCalendarWriteToken } from "./tools";

/**
 * A meeting's Google Calendar series, changed from the cockpit.
 *
 * The CEO, 2026-09-27: from a meeting's page a host, an admin or the CEO
 * adds or removes people, changes the day, time and length of the series,
 * moves or cancels one sitting, adds a one-off sitting, creates a meeting
 * and ends one, "and each of those changes lands on the real Google
 * Calendar event within seconds and sends the normal Google invite or
 * update to the people affected".
 *
 * Every change: Supabase first, then a row in team_calendar_ops (the
 * outbox), then the Google call in the same action. On success the op is
 * done and the meeting is read back from Google, which is the truth for
 * times and guests. On failure the op waits; the minute drain
 * (outboxDrains.drainAll) tries again, ten times in all, then marks it
 * failed and the page says why with a Retry button. Every write to Google
 * carries If-Match with the etag it was made from; a 412 reads the event
 * again, makes the one change again and sends it once more.
 *
 * Google only lets an event be changed through its organiser's calendar.
 * The writes are the CEO account's (googleCalendarWriteToken), which owns
 * the team's calendars; a series organised on a calendar it cannot edit
 * shows who organises it and offers "Take over".
 *
 * A meeting can be several series, one a day (team_meeting_series): CSM
 * Daily on the CEO's calendar is five weekly series, each with its day's
 * theme in its title. A change to guests, times or the purpose goes to
 * each of them.
 */

const API = "https://www.googleapis.com/calendar/v3";
const MAX_ATTEMPTS = 10;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const CADENCES = [
  "daily",
  "three times a week",
  "twice a week",
  "weekly",
  "every two weeks",
  "monthly",
  "quarterly",
  "as needed",
] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Ev = Any;

// --- Google ----------------------------------------------------------------------------

async function gcal(
  method: string,
  path: string,
  o: { body?: unknown; etag?: string; query?: Record<string, string> } = {},
): Promise<{ status: number; json: Ev | null }> {
  const token = await googleCalendarWriteToken();
  const url = `${API}/${path}${o.query ? `?${new URLSearchParams(o.query)}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(o.etag ? { "If-Match": o.etag } : {}),
      },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
  } catch (e) {
    note("calendar", false, String(e).slice(0, 160));
    throw new Error(
      "Google Calendar could not be reached. The change waits and is tried again.",
    );
  }
  const text = await res.text();
  let json: Ev | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  // A 412 is our own If-Match doing its job, not an outage.
  note(
    "calendar",
    res.ok || res.status === 412,
    res.ok ? undefined : `${method} ${res.status}`,
  );
  return { status: res.status, json };
}

function googleSays(status: number, json: Ev | null): string {
  const said = String(json?.error?.message ?? "").slice(0, 160);
  if (status === 401 || status === 403)
    return `Google Calendar refused the change (${status}): the cockpit's calendar sign-in cannot edit this event.${said ? ` Google says: ${said}` : ""}`;
  if (status === 404 || status === 410)
    return "The event is not on Google Calendar any more.";
  if (status === 412)
    return "The event kept changing on Google Calendar while this was being sent. Try again.";
  if (status === 429 || status >= 500)
    return `Google Calendar is busy (${status}). The change waits and is tried again.`;
  return `Google Calendar did not take the change (${status}).${said ? ` Google says: ${said}` : ""}`;
}

const evPath = (cal: string, id: string) =>
  `calendars/${enc(cal)}/events/${enc(id)}`;

async function readEvent(cal: string, id: string): Promise<Ev> {
  const r = await gcal("GET", evPath(cal, id));
  if (r.status >= 400 || !r.json) throw new Error(googleSays(r.status, r.json));
  return r.json;
}

/** Change an event from Google's current copy, with If-Match and one retry on 412. */
async function writeEvent(
  cal: string,
  id: string,
  change: (fresh: Ev) => Record<string, unknown> | null,
  sendUpdates: "all" | "none",
): Promise<Ev> {
  const res = await patchWithRetry(
    () => readEvent(cal, id),
    change,
    async (body, etag) => {
      const r = await gcal("PATCH", evPath(cal, id), {
        body,
        etag,
        query: { sendUpdates, conferenceDataVersion: "1" },
      });
      return { status: r.status, body: r.json };
    },
  );
  if (res.status >= 400)
    throw new Error(googleSays(res.status, res.body as Ev));
  return res.body as Ev;
}

async function createEvent(
  cal: string,
  body: Ev,
  sendUpdates: "all" | "none",
): Promise<Ev> {
  const r = await gcal("POST", `calendars/${enc(cal)}/events`, {
    body,
    query: { sendUpdates, conferenceDataVersion: "1" },
  });
  if (r.status >= 400 || !r.json) throw new Error(googleSays(r.status, r.json));
  return r.json;
}

/** An event the cockpit made before, found by its private mark: a retry never makes a second. */
async function findMarked(
  cal: string,
  key: string,
  value: string,
): Promise<Ev | null> {
  const r = await gcal("GET", `calendars/${enc(cal)}/events`, {
    query: {
      privateExtendedProperty: `${key}=${value}`,
      maxResults: "5",
      showDeleted: "false",
    },
  });
  if (r.status >= 400) throw new Error(googleSays(r.status, r.json));
  return (
    ((r.json?.items ?? []) as Ev[]).find(e => e.status !== "cancelled") ?? null
  );
}

function guestsOf(ev: Ev): { email: string; optional?: boolean }[] {
  return ((ev.attendees ?? []) as Ev[])
    .filter(a => !a.resource && a.email)
    .map(a => ({
      email: String(a.email),
      ...(a.optional ? { optional: true } : {}),
    }));
}

function sameGuests(a: Ev[], b: Ev[]): boolean {
  const key = (x: Ev[]) =>
    x
      .map(g => `${String(g.email).toLowerCase()}:${g.optional ? 1 : 0}`)
      .sort()
      .join(",");
  return key(a) === key(b);
}

// --- a meeting and the series it is made of ------------------------------------------------

type Part = {
  meeting_id: string;
  cal_calendar: string;
  cal_event_id: string;
  weekday: number | null;
  ends_on: string | null;
  cal_writable: boolean;
};

type Ctx = {
  m: Any;
  today: string;
  tz: string;
  /** The live series (not ended). */
  parts: Part[];
  /** Everything this meeting touches is before today: Google tells nobody. */
  past: boolean;
};

async function context(meetingId: string): Promise<Ctx> {
  const m = await meetingOrRefuse(meetingId);
  const today = kuwaitDay();
  let parts = (await db(
    `team_meeting_series?select=*&meeting_id=eq.${enc(meetingId)}&order=weekday.asc.nullsfirst`,
  )) as Part[];
  if (!parts.length && m.cal_calendar && m.cal_event_id) {
    const row = {
      meeting_id: meetingId,
      cal_calendar: m.cal_calendar,
      cal_event_id: m.cal_event_id,
      weekday: null,
      cal_title: m.cal_title ?? null,
      cal_writable: Boolean(m.cal_writable),
    };
    await db("team_meeting_series?on_conflict=cal_calendar,cal_event_id", {
      method: "POST",
      body: row,
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    parts = [{ ...row, ends_on: null } as Part];
  }
  const live = parts.filter(p => !p.ends_on || String(p.ends_on) >= today);
  const past = Boolean(m.ends_on && String(m.ends_on) < today);
  return { m, today, tz: String(m.tz ?? "Asia/Kuwait"), parts: live, past };
}

function singleDay(rrule: string | null): number | null {
  const days = weekdaysOfRrule(rrule);
  return days && days.length === 1 ? days[0] : null;
}

async function nextSittingDay(
  meetingId: string,
  today: string,
): Promise<string | null> {
  const [s] = await db(
    `team_sittings?select=on_date&meeting_id=eq.${enc(meetingId)}&on_date=gte.${today}&status=neq.cancelled&order=on_date.asc&limit=1`,
  );
  return s ? String(s.on_date) : null;
}

async function linkSeries(
  meetingId: string,
  ev: Ev,
  weekday: number | null,
  main: boolean,
): Promise<void> {
  const cal = String(ev.organizer?.email ?? "").toLowerCase();
  await db("team_meeting_series?on_conflict=cal_calendar,cal_event_id", {
    method: "POST",
    body: {
      meeting_id: meetingId,
      cal_calendar: cal,
      cal_event_id: String(ev.id),
      weekday,
      cal_title: ev.summary ?? null,
      cal_etag: ev.etag ?? null,
      cal_writable: true,
      updated_at: new Date().toISOString(),
    },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  if (main)
    await db(`team_meetings?id=eq.${enc(meetingId)}`, {
      method: "PATCH",
      body: {
        cal_calendar: cal,
        cal_event_id: String(ev.id),
        calendar_id: String(ev.id).slice(0, 120),
        cal_title: ev.summary ?? null,
        cal_writable: true,
        updated_at: new Date().toISOString(),
      },
      prefer: "return=minimal",
    });
}

async function markEnded(p: Part, lastDay: string): Promise<void> {
  await db(
    `team_meeting_series?cal_calendar=eq.${enc(p.cal_calendar)}&cal_event_id=eq.${enc(p.cal_event_id)}`,
    {
      method: "PATCH",
      body: { ends_on: lastDay, updated_at: new Date().toISOString() },
      prefer: "return=minimal",
    },
  );
}

/** The meeting's people with an address, as Google guests. */
async function peopleAsGuests(
  meetingId: string,
): Promise<{ email: string; optional?: boolean }[]> {
  const links = await db(
    `team_meeting_people?select=person_id,part&meeting_id=eq.${enc(meetingId)}&removed=eq.false`,
  );
  if (!links.length) return [];
  const people = await db(
    `team_people?select=id,email&id=in.(${links.map(l => `"${String(l.person_id).replace(/"/g, "")}"`).join(",")})`,
  );
  return links
    .map(l => {
      const p = people.find(x => x.id === l.person_id);
      return p?.email
        ? {
            email: String(p.email),
            ...(l.part === "optional" ? { optional: true } : {}),
          }
        : null;
    })
    .filter((x): x is { email: string; optional?: boolean } => Boolean(x));
}

function conferenceCopy(c: Ev | undefined): Ev | undefined {
  if (!c?.conferenceId) return undefined;
  return {
    conferenceId: c.conferenceId,
    conferenceSolution: c.conferenceSolution,
    entryPoints: c.entryPoints,
  };
}

const newMeet = (requestId: string) => ({
  createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } },
});

// --- the changes -------------------------------------------------------------------------------

type Op = {
  id: number;
  meeting_id: string;
  sitting_id: string | null;
  op: string;
  payload: Any | null;
  attempts: number;
  requested_by: string | null;
};

async function opCreate(op: Op, c: Ctx): Promise<void> {
  const m = c.m;
  let ev = await findMarked("primary", "teamMeetingId", String(m.id));
  if (!ev) {
    if (!m.start_time || !m.minutes)
      throw new Error(
        "Give the meeting a start time and a length before it goes on the calendar.",
      );
    const days: number[] = m.weekdays ?? [];
    const from = DAY.test(String(op.payload?.from ?? ""))
      ? String(op.payload?.from)
      : c.today;
    const day = days.length ? nextOn(days, from) : from;
    ev = await createEvent(
      "primary",
      {
        summary: String(m.title),
        description: withOurBlock(
          "",
          m.purpose ?? null,
          meetingLink(String(m.id)),
        ),
        start: { dateTime: wallClock(day, m.start_time), timeZone: c.tz },
        end: {
          dateTime: endOf(day, m.start_time, Number(m.minutes)),
          timeZone: c.tz,
        },
        ...(days.length
          ? { recurrence: [buildRrule({ weekdays: days })] }
          : {}),
        attendees: await peopleAsGuests(String(m.id)),
        conferenceData: newMeet(`team-${op.id}`),
        extendedProperties: { private: { teamMeetingId: String(m.id) } },
      },
      sendUpdatesFor(days.length ? null : day, c.today),
    );
  }
  await linkSeries(String(m.id), ev, null, true);
}

async function opGuests(op: Op, c: Ctx): Promise<void> {
  const changes = (op.payload?.changes ?? []) as (GuestChange & {
    personId?: string;
  })[];
  const updates = c.past ? "none" : guestUpdates(changes);
  for (const p of c.parts) {
    await writeEvent(
      p.cal_calendar,
      p.cal_event_id,
      fresh => {
        const next = applyGuestChanges(
          fresh.attendees ?? [],
          changes,
          String(fresh.organizer?.email ?? ""),
        );
        return sameGuests(fresh.attendees ?? [], next)
          ? null
          : { attendees: next };
      },
      updates,
    );
  }
  // Google's optional flag as the cockpit set it, so the sync does not read
  // the change as one made in Google.
  for (const ch of changes)
    if (ch.personId && ch.action !== "remove")
      await db(
        `team_meeting_people?meeting_id=eq.${enc(String(c.m.id))}&person_id=eq.${enc(ch.personId)}`,
        {
          method: "PATCH",
          body: { cal_optional: ch.optional },
          prefer: "return=minimal",
        },
      );
}

/** One series to new days, time and length: the whole series, or this and following. */
async function changeSeries(
  c: Ctx,
  p: Part,
  change: SeriesChange,
  next: string | null,
): Promise<void> {
  const master = await readEvent(p.cal_calendar, p.cal_event_id);
  const now = eventSeries(master, c.tz);
  // Nothing to change on this series: no split, no update to anyone.
  if (seriesUnchanged(now, change)) return;
  const plan = planSeriesChange(
    {
      startDay: now.firstDay ?? change.from,
      rrule: rruleOf(master.recurrence),
      tz: c.tz,
    },
    change,
    next,
  );
  const updates =
    c.past || (!plan.recurrence && (now.firstDay ?? c.today) < c.today)
      ? "none"
      : "all";
  if (plan.mode === "patch") {
    await writeEvent(
      p.cal_calendar,
      p.cal_event_id,
      fresh => ({
        start: { dateTime: plan.start, timeZone: c.tz },
        end: { dateTime: plan.end, timeZone: c.tz },
        ...(plan.recurrence
          ? { recurrence: withRrule(fresh.recurrence, plan.recurrence[0]) }
          : {}),
      }),
      updates,
    );
    return;
  }
  // This and following: the new series first, so a failure never leaves the
  // meeting with no series; then the old one ends the day before.
  const mark = `${p.cal_event_id}:${change.from}`;
  let fresh = await findMarked(p.cal_calendar, "teamSplitOf", mark);
  if (!fresh)
    fresh = await createEvent(
      p.cal_calendar,
      {
        summary: master.summary,
        description: master.description,
        location: master.location,
        start: { dateTime: plan.start, timeZone: c.tz },
        end: { dateTime: plan.end, timeZone: c.tz },
        recurrence: [
          plan.recurrence[0],
          ...((master.recurrence ?? []) as string[]).filter(r =>
            /^RDATE/i.test(r),
          ),
        ],
        attendees: guestsOf(master),
        ...(conferenceCopy(master.conferenceData)
          ? { conferenceData: conferenceCopy(master.conferenceData) }
          : {}),
        reminders: master.reminders,
        guestsCanModify: master.guestsCanModify,
        guestsCanInviteOthers: master.guestsCanInviteOthers,
        extendedProperties: {
          private: {
            ...(master.extendedProperties?.private ?? {}),
            teamMeetingId: String(c.m.id),
            teamSplitOf: mark,
          },
        },
      },
      updates,
    );
  await writeEvent(
    p.cal_calendar,
    p.cal_event_id,
    f => ({ recurrence: withRrule(f.recurrence, plan.oldRecurrence[0]) }),
    updates,
  );
  await linkSeries(
    String(c.m.id),
    fresh,
    p.weekday,
    c.m.cal_event_id === p.cal_event_id,
  );
  await markEnded(p, addDays(change.from, -1));
}

async function endSeries(c: Ctx, p: Part, lastDay: string): Promise<void> {
  const master = await readEvent(p.cal_calendar, p.cal_event_id);
  const rrule = rruleOf(master.recurrence);
  const first = eventSeries(master, c.tz).firstDay;
  if (!rrule) {
    // A single event after the last day is cancelled, never deleted.
    if (first && first > lastDay)
      await writeEvent(
        p.cal_calendar,
        p.cal_event_id,
        () => ({ status: "cancelled" }),
        c.past ? "none" : "all",
      );
  } else {
    await writeEvent(
      p.cal_calendar,
      p.cal_event_id,
      f => ({
        recurrence: withRrule(
          f.recurrence,
          endRrule(rruleOf(f.recurrence) ?? rrule, lastDay, c.tz),
        ),
      }),
      c.past || lastDay < c.today ? "none" : "all",
    );
  }
  await markEnded(p, lastDay);
}

async function opSeries(op: Op, c: Ctx): Promise<void> {
  const change = op.payload as SeriesChange;
  const next = await nextSittingDay(String(c.m.id), c.today);
  if (c.parts.length <= 1) {
    if (!c.parts[0]) throw new Error("The meeting is not on Google Calendar.");
    await changeSeries(c, c.parts[0], change, next);
    return;
  }
  // A series a day: each day's series keeps its own title and Meet link.
  const have = new Map<number, Part>();
  for (const p of c.parts) {
    const day =
      p.weekday ??
      singleDay(
        rruleOf((await readEvent(p.cal_calendar, p.cal_event_id)).recurrence),
      );
    if (day === null) {
      await changeSeries(c, p, change, next);
      continue;
    }
    have.set(day, p);
    if (change.weekdays.includes(day))
      await changeSeries(c, p, { ...change, weekdays: [day] }, next);
    else await endSeries(c, p, addDays(change.from, -1));
  }
  const sample = c.parts[0]
    ? await readEvent(c.parts[0].cal_calendar, c.parts[0].cal_event_id)
    : null;
  for (const day of change.weekdays.filter(d => !have.has(d))) {
    const mark = `${c.m.id}:${day}:${change.from}`;
    let ev = await findMarked("primary", "teamDayOf", mark);
    const first = nextOn([day], change.from);
    if (!ev)
      ev = await createEvent(
        "primary",
        {
          summary: String(c.m.title),
          description: withOurBlock(
            sample?.description ?? "",
            c.m.purpose ?? null,
            meetingLink(String(c.m.id)),
          ),
          start: {
            dateTime: wallClock(first, change.startTime),
            timeZone: c.tz,
          },
          end: {
            dateTime: endOf(first, change.startTime, change.minutes),
            timeZone: c.tz,
          },
          recurrence: [buildRrule({ weekdays: [day] })],
          attendees: sample
            ? guestsOf(sample)
            : await peopleAsGuests(String(c.m.id)),
          conferenceData: newMeet(`team-${op.id}-${day}`),
          extendedProperties: {
            private: { teamMeetingId: String(c.m.id), teamDayOf: mark },
          },
        },
        c.past ? "none" : "all",
      );
    await linkSeries(String(c.m.id), ev, day, false);
  }
}

/** Which calendar holds an occurrence: its series' organiser's, or the CEO's for a one-off. */
async function calendarOf(c: Ctx, instanceId: string): Promise<string> {
  const all = (await db(
    `team_meeting_series?select=cal_calendar,cal_event_id&meeting_id=eq.${enc(String(c.m.id))}`,
  )) as Part[];
  const series = all.find(p => instanceId.startsWith(`${p.cal_event_id}_`));
  return series?.cal_calendar ?? "primary";
}

async function sittingOrRefuse(id: string): Promise<SbRow> {
  const [s] = await db(`team_sittings?select=*&id=eq.${enc(id)}`);
  if (!s) throw new Error("That sitting is not there any more.");
  return s;
}

async function opMove(op: Op, c: Ctx): Promise<void> {
  const s = await sittingOrRefuse(String(op.sitting_id));
  if (!s.cal_instance_id) return;
  const { day, startTime, minutes } = op.payload as {
    day: string;
    startTime: string;
    minutes: number;
  };
  const cal = await calendarOf(c, String(s.cal_instance_id));
  await writeEvent(
    cal,
    String(s.cal_instance_id),
    () => ({
      start: { dateTime: wallClock(day, startTime), timeZone: c.tz },
      end: { dateTime: endOf(day, startTime, minutes), timeZone: c.tz },
    }),
    sendUpdatesFor(day < String(s.on_date) ? String(s.on_date) : day, c.today),
  );
}

async function opCancel(op: Op, c: Ctx): Promise<void> {
  const s = await sittingOrRefuse(String(op.sitting_id));
  if (!s.cal_instance_id) return;
  const cal = await calendarOf(c, String(s.cal_instance_id));
  await writeEvent(
    cal,
    String(s.cal_instance_id),
    () => ({ status: "cancelled" }),
    sendUpdatesFor(String(s.on_date), c.today),
  );
}

async function opAddOne(op: Op, c: Ctx): Promise<void> {
  const s = await sittingOrRefuse(String(op.sitting_id));
  const { day, startTime, minutes } = op.payload as {
    day: string;
    startTime: string;
    minutes: number;
  };
  let ev = await findMarked("primary", "teamSittingId", String(s.id));
  if (!ev) {
    const main = c.parts[0]
      ? await readEvent(c.parts[0].cal_calendar, c.parts[0].cal_event_id).catch(
          () => null,
        )
      : null;
    ev = await createEvent(
      "primary",
      {
        summary: String(c.m.title),
        description: withOurBlock(
          main?.description ?? "",
          c.m.purpose ?? null,
          meetingLink(String(c.m.id)),
        ),
        start: { dateTime: wallClock(day, startTime), timeZone: c.tz },
        end: { dateTime: endOf(day, startTime, minutes), timeZone: c.tz },
        attendees: main ? guestsOf(main) : await peopleAsGuests(String(c.m.id)),
        conferenceData: newMeet(`team-${op.id}`),
        extendedProperties: {
          private: {
            teamMeetingId: String(c.m.id),
            teamSittingId: String(s.id),
          },
        },
      },
      sendUpdatesFor(day, c.today),
    );
  }
  await db(`team_sittings?id=eq.${enc(String(s.id))}`, {
    method: "PATCH",
    body: { cal_instance_id: String(ev.id) },
    prefer: "return=minimal",
  });
}

async function opDescribe(op: Op, c: Ctx): Promise<void> {
  const { title, oldTitle, purpose } = (op.payload ?? {}) as {
    title?: string;
    oldTitle?: string;
    purpose?: string | null;
  };
  for (const p of c.parts)
    await writeEvent(
      p.cal_calendar,
      p.cal_event_id,
      fresh => {
        const body: Record<string, unknown> = {};
        if (title && oldTitle && title !== oldTitle) {
          const s = renamedSummary(
            String(fresh.summary ?? ""),
            oldTitle,
            title,
            c.parts.length === 1,
          );
          if (s !== fresh.summary) body.summary = s;
        }
        if (purpose !== undefined) {
          const d = withOurBlock(
            fresh.description,
            purpose,
            meetingLink(String(c.m.id)),
          );
          if (d !== (fresh.description ?? "")) body.description = d;
        }
        return Object.keys(body).length ? body : null;
      },
      c.past ? "none" : "all",
    );
}

async function opEnd(op: Op, c: Ctx): Promise<void> {
  const last = String(op.payload?.lastDate ?? "");
  if (!DAY.test(last)) throw new Error("Pick the meeting's last date.");
  for (const p of c.parts) await endSeries(c, p, last);
}

/**
 * A series organised on a calendar the cockpit cannot edit: a new one on the
 * CEO's calendar from the next sitting (same title, guests and time, a new
 * Meet link). The old one is ended where the cockpit can; where it cannot,
 * the change log says so, so nothing is silently doubled.
 */
async function opTakeover(op: Op, c: Ctx): Promise<void> {
  const from = String(op.payload?.from ?? c.today);
  const mark = `${c.m.id}:${from}`;
  const old = c.parts[0];
  let face: Ev | null = null;
  for (const cal of [old?.cal_calendar, "primary"].filter(
    Boolean,
  ) as string[]) {
    if (face || !old) break;
    face = await readEvent(cal, old.cal_event_id).catch(() => null);
  }
  const days: number[] = c.m.weekdays ?? [];
  if (!c.m.start_time || !c.m.minutes)
    throw new Error(
      "The meeting needs a start time and a length to be taken over.",
    );
  let ev = await findMarked("primary", "teamTakeoverOf", mark);
  if (!ev) {
    const first = days.length ? nextOn(days, from) : from;
    ev = await createEvent(
      "primary",
      {
        summary: String(face?.summary ?? c.m.title),
        description: withOurBlock(
          face?.description ?? "",
          c.m.purpose ?? null,
          meetingLink(String(c.m.id)),
        ),
        start: { dateTime: wallClock(first, c.m.start_time), timeZone: c.tz },
        end: {
          dateTime: endOf(first, c.m.start_time, Number(c.m.minutes)),
          timeZone: c.tz,
        },
        ...(days.length
          ? { recurrence: [buildRrule({ weekdays: days })] }
          : {}),
        attendees: face ? guestsOf(face) : await peopleAsGuests(String(c.m.id)),
        conferenceData: newMeet(`team-${op.id}`),
        extendedProperties: {
          private: { teamMeetingId: String(c.m.id), teamTakeoverOf: mark },
        },
      },
      c.past ? "none" : "all",
    );
  }
  const stuck: string[] = [];
  for (const p of c.parts) {
    try {
      await endSeries(c, p, addDays(from, -1));
    } catch {
      stuck.push(p.cal_calendar);
    }
  }
  await linkSeries(String(c.m.id), ev, null, true);
  if (stuck.length)
    await logChange(
      "Google Calendar",
      String(c.m.id),
      `took the series over; the old one on ${stuck.join(", ")} is still running: ask its organiser to end it`,
    );
}

async function runOp(op: Op): Promise<void> {
  const c = await context(op.meeting_id);
  switch (op.op) {
    case "create":
      return opCreate(op, c);
    case "guests":
      return opGuests(op, c);
    case "series":
      return opSeries(op, c);
    case "move":
      return opMove(op, c);
    case "cancel":
      return opCancel(op, c);
    case "addOne":
      return opAddOne(op, c);
    case "describe":
      return opDescribe(op, c);
    case "end":
      return opEnd(op, c);
    case "takeover":
      return opTakeover(op, c);
    default:
      throw new Error(
        `The cockpit does not know the calendar change "${op.op}".`,
      );
  }
}

// --- reading Google back --------------------------------------------------------------------

/**
 * After a change: the meeting as Google now has it (times, days, the Meet
 * link, each series' title and etag) and its sittings for the next two
 * months, one per occurrence. The five-minute sync does the same for
 * changes made in Google itself.
 */
async function readBack(meetingId: string): Promise<void> {
  const c = await context(meetingId);
  if (!c.parts.length) return;
  const stamp = new Date().toISOString();
  const read: { p: Part; ev: Ev; s: ReturnType<typeof eventSeries> }[] = [];
  for (const p of c.parts) {
    const ev = await readEvent(p.cal_calendar, p.cal_event_id).catch(
      () => null,
    );
    if (!ev) continue;
    const s = eventSeries(ev, c.tz);
    read.push({ p, ev, s });
    await db(
      `team_meeting_series?cal_calendar=eq.${enc(p.cal_calendar)}&cal_event_id=eq.${enc(p.cal_event_id)}`,
      {
        method: "PATCH",
        body: {
          cal_title: ev.summary ?? null,
          cal_etag: ev.etag ?? null,
          rrule: s.rrule,
          start_time: s.start_time,
          minutes: s.minutes,
          meet_link: s.meet_link,
          ends_on: s.ends_on,
          weekday:
            s.weekdays?.length === 1
              ? s.weekdays[0]
              : c.parts.length > 1
                ? p.weekday
                : null,
          cal_writable: true,
          updated_at: stamp,
        },
        prefer: "return=minimal",
      },
    );
  }
  if (!read.length) return;
  const main = read.find(x => x.p.cal_event_id === c.m.cal_event_id) ?? read[0];
  const days = new Set<number>();
  for (const x of read) {
    const own = x.s.weekdays ?? [];
    // A series that ends before its next sitting is over as far as the page
    // goes: its day is no longer one the meeting meets on (CSM Daily's
    // Sunday once the Sunday meeting took its place).
    if (x.s.ends_on && own.length && nextOn(own, c.today) > x.s.ends_on)
      continue;
    for (const d of own) days.add(d);
  }
  const body: Any = {
    start_time: main.s.start_time,
    minutes: main.s.minutes,
    meet_link: main.s.meet_link,
    rrule: main.s.rrule,
    cal_etag: main.ev.etag ?? null,
    weekdays:
      read.length > 1 ? [...days].sort((a, b) => a - b) : main.s.weekdays,
    ends_on:
      read.length > 1
        ? read.some(x => !x.s.ends_on)
          ? null
          : read
              .map(x => String(x.s.ends_on))
              .sort()
              .pop()
        : main.s.ends_on,
    cal_writable: true,
    cal_synced_at: stamp,
    cal_error: null,
    updated_at: stamp,
  };
  if (read.length === 1) body.cal_title = main.ev.summary ?? null;
  await db(`team_meetings?id=eq.${enc(meetingId)}`, {
    method: "PATCH",
    body,
    prefer: "return=minimal",
  });

  // Sittings: one per occurrence from yesterday to two months ahead.
  const rows: Any[] = [];
  const timeMin = zonedToUtc(addDays(c.today, -1), "00:00", c.tz).toISOString();
  const timeMax = zonedToUtc(addDays(c.today, 62), "00:00", c.tz).toISOString();
  for (const x of read) {
    const occurrences: Ev[] = [];
    if (x.s.rrule) {
      const r = await gcal(
        "GET",
        `${evPath(x.p.cal_calendar, x.p.cal_event_id)}/instances`,
        {
          query: { timeMin, timeMax, showDeleted: "true", maxResults: "250" },
        },
      );
      if (r.status < 400) occurrences.push(...((r.json?.items ?? []) as Ev[]));
    } else occurrences.push(x.ev);
    for (const e of occurrences) {
      const startIso = e.start?.dateTime ?? e.originalStartTime?.dateTime;
      const origIso = e.originalStartTime?.dateTime ?? e.start?.dateTime;
      if (!startIso || !origIso) continue;
      const onDate = utcToZoned(origIso, c.tz).day;
      rows.push({
        id: `${meetingId}:${onDate}`,
        meeting_id: meetingId,
        on_date: onDate,
        starts_at: new Date(startIso).toISOString(),
        ends_at: e.end?.dateTime
          ? new Date(e.end.dateTime).toISOString()
          : null,
        cal_instance_id: String(e.id),
        status:
          e.status === "cancelled"
            ? "cancelled"
            : Date.parse(startIso) !== Date.parse(origIso)
              ? "moved"
              : "scheduled",
        held: onDate <= c.today && e.status !== "cancelled",
      });
    }
  }
  const byId = new Map<string, Any>();
  for (const r of rows) {
    const had = byId.get(r.id);
    if (!had || (had.status === "cancelled" && r.status !== "cancelled"))
      byId.set(r.id, r);
  }
  if (byId.size)
    await db("team_sittings?on_conflict=id", {
      method: "POST",
      body: [...byId.values()],
      prefer: "resolution=merge-duplicates,return=minimal",
    });
}

// --- the outbox ---------------------------------------------------------------------------

async function enqueue(
  w: Who,
  meetingId: string,
  op: string,
  payload: Any | null,
  sittingId: string | null = null,
): Promise<void> {
  await db("team_calendar_ops", {
    method: "POST",
    body: {
      meeting_id: meetingId,
      sitting_id: sittingId,
      op,
      payload,
      requested_by: w.email,
    },
    prefer: "return=minimal",
  });
}

/**
 * A meeting's waiting changes, oldest first. Each is claimed before it runs
 * (the attempt count only moves once), so the minute drain and the page
 * never send the same change twice at once.
 */
async function runWaiting(
  meetingId: string,
): Promise<{ done: number; failed: string | null }> {
  // No calendar sign-in on the deployment yet: the changes wait, untouched,
  // rather than using up their ten tries on an error nobody can fix here.
  if (!calendarWriteReady()) {
    const message =
      "Waiting for Google Calendar: the cockpit's calendar sign-in is not set on the deployment yet. The change goes out once it is.";
    await db(`team_meetings?id=eq.${enc(meetingId)}`, {
      method: "PATCH",
      body: { cal_error: message },
      prefer: "return=minimal",
    });
    return { done: 0, failed: message };
  }
  const ops = (await db(
    `team_calendar_ops?select=*&meeting_id=eq.${enc(meetingId)}&status=eq.pending&order=id.asc&limit=10`,
  )) as Op[];
  let done = 0;
  for (const op of ops) {
    const claimed = await db(
      `team_calendar_ops?id=eq.${op.id}&status=eq.pending&attempts=eq.${op.attempts}`,
      {
        method: "PATCH",
        body: { attempts: op.attempts + 1, tried_at: new Date().toISOString() },
        prefer: "return=representation",
      },
    );
    if (!claimed.length) continue;
    try {
      await runOp(op);
      await db(`team_calendar_ops?id=eq.${op.id}`, {
        method: "PATCH",
        body: {
          status: "done",
          done_at: new Date().toISOString(),
          error: null,
        },
        prefer: "return=minimal",
      });
      done++;
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(
        0,
        400,
      );
      const last = op.attempts + 1 >= MAX_ATTEMPTS;
      await db(`team_calendar_ops?id=eq.${op.id}`, {
        method: "PATCH",
        body: { status: last ? "failed" : "pending", error: message },
        prefer: "return=minimal",
      });
      await db(`team_meetings?id=eq.${enc(meetingId)}`, {
        method: "PATCH",
        body: { cal_error: message },
        prefer: "return=minimal",
      });
      return { done, failed: message };
    }
  }
  if (done)
    await readBack(meetingId).catch(e =>
      console.error(`team read-back ${meetingId}: ${String(e).slice(0, 200)}`),
    );
  return { done, failed: null };
}

/** Change, write it down, try it now: the page answers with the meeting as it now is. */
async function sendNow(
  w: Who,
  meetingId: string,
  op: string,
  payload: Any | null,
  sittingId: string | null = null,
): Promise<void> {
  await enqueue(w, meetingId, op, payload, sittingId);
  await runWaiting(meetingId);
}

/** The minute drain: every meeting with a change still waiting, oldest first. */
export const drain = internalAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    if (!calendarWriteReady()) return { waiting: "calendar sign-in not set" };
    const since = new Date(Date.now() - 90_000).toISOString();
    const waiting = await db(
      `team_calendar_ops?select=meeting_id&status=eq.pending&or=(tried_at.is.null,tried_at.lt.${since})&order=id.asc&limit=25`,
    ).catch(() => [] as SbRow[]);
    const meetings = [...new Set(waiting.map(r => String(r.meeting_id)))].slice(
      0,
      5,
    );
    const out: Record<string, unknown> = {};
    for (const id of meetings) {
      try {
        out[id] = await runWaiting(id);
      } catch (e) {
        out[id] = `FAILED ${String(e).slice(0, 160)}`;
      }
    }
    await flush(ctx);
    return out;
  },
});

// --- the page's actions --------------------------------------------------------------------

function checkSeries(a: {
  weekdays: number[];
  startTime: string;
  minutes: number;
}): void {
  if (!a.weekdays.every(d => Number.isInteger(d) && d >= 0 && d <= 6))
    throw new Error("Pick the days from Sunday to Saturday.");
  if (!TIME.test(a.startTime))
    throw new Error("Give the start time as hours and minutes, like 13:30.");
  if (!Number.isInteger(a.minutes) || a.minutes < 5 || a.minutes > 480)
    throw new Error("A meeting runs between 5 minutes and 8 hours.");
}

/** Make a meeting, or change its name, purpose, cadence or department. */
export const saveMeeting = authenticatedAction({
  args: {
    id: v.optional(v.string()),
    title: v.string(),
    purpose: v.string(),
    cadence: v.string(),
    department: v.optional(v.string()),
    onCalendar: v.optional(v.boolean()),
    weekdays: v.optional(v.array(v.number())),
    startTime: v.optional(v.string()),
    minutes: v.optional(v.number()),
    firstDate: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const title = clean(a.title, 120);
      const purpose = clean(a.purpose, 300);
      const department = clean(a.department, 60) || null;
      if (title.length < 3) throw new Error("Give the meeting a name.");
      if (purpose.length < 8)
        throw new Error(
          "Say what the meeting is for in one sentence: every meeting has a purpose.",
        );
      if (!(CADENCES as readonly string[]).includes(a.cadence))
        throw new Error("Pick how often it meets.");

      if (a.id) {
        await mustManage(w, a.id);
        const before = await meetingOrRefuse(
          a.id,
          "title,purpose,cadence,department,cal_event_id",
        );
        // A name, cadence or department set here makes the meeting the
        // cockpit's: the sync never marks it inactive.
        const own =
          before.title !== title ||
          before.cadence !== a.cadence ||
          (before.department ?? null) !== department;
        await db(`team_meetings?id=eq.${enc(a.id)}`, {
          method: "PATCH",
          body: {
            title,
            purpose,
            cadence: a.cadence,
            department,
            updated_at: new Date().toISOString(),
            ...(own ? { managed: "cockpit" } : {}),
          },
          prefer: "return=minimal",
        });
        const changed = [
          before.title !== title ? `renamed it "${title}"` : null,
          before.purpose !== purpose ? "set its purpose" : null,
          before.cadence !== a.cadence ? `made it ${a.cadence}` : null,
          (before.department ?? null) !== department
            ? department
              ? `put it under ${department}`
              : "took its department off"
            : null,
        ].filter(Boolean);
        if (changed.length)
          await logChange(w.email, a.id, changed.join(", "), {
            before,
            after: { title, purpose, cadence: a.cadence, department },
          });
        if (
          before.cal_event_id &&
          (before.title !== title || before.purpose !== purpose)
        )
          await sendNow(w, a.id, "describe", {
            ...(before.title !== title
              ? { title, oldTitle: before.title }
              : {}),
            ...(before.purpose !== purpose ? { purpose } : {}),
          });
        return page(w, a.id);
      }

      // A new meeting. Whoever makes it hosts it, and it goes on the
      // calendar unless the box to leave it off was ticked.
      const weekdays = [...new Set(a.weekdays ?? [])].sort((x, y) => x - y);
      const onCalendar = a.onCalendar !== false;
      if (onCalendar || a.startTime) {
        if (!a.startTime || !a.minutes)
          throw new Error("Give it a start time and a length.");
        checkSeries({
          weekdays,
          startTime: a.startTime,
          minutes: Math.trunc(a.minutes),
        });
      }
      if (a.firstDate && !DAY.test(a.firstDate))
        throw new Error("Pick the first date.");
      if (onCalendar && !weekdays.length && !a.firstDate)
        throw new Error("Pick its days, or the date of the one sitting.");
      const base = slug(title) || "meeting";
      const taken = new Set(
        (await db(`team_meetings?select=id&id=like.${enc(`${base}*`)}`)).map(
          r => String(r.id),
        ),
      );
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      const [me] = await db(
        `team_people?select=id,email&email=ilike.${enc(w.email)}`,
      );
      await db("team_meetings", {
        method: "POST",
        body: {
          id,
          title,
          purpose,
          cadence: a.cadence,
          department,
          host_id: me?.id ?? null,
          active: true,
          managed: "cockpit",
          created_by: w.email,
          tz: "Asia/Kuwait",
          start_time: a.startTime ?? null,
          minutes: a.minutes ? Math.trunc(a.minutes) : null,
          weekdays: weekdays.length ? weekdays : null,
          ends_on: !weekdays.length && a.firstDate ? a.firstDate : null,
        },
        prefer: "return=minimal",
      });
      if (me)
        await db("team_meeting_people", {
          method: "POST",
          body: {
            meeting_id: id,
            person_id: me.id,
            part: "host",
            source: "cockpit",
            changed_by: w.email,
            changed_at: new Date().toISOString(),
          },
          prefer: "return=minimal",
        });
      if (!weekdays.length && a.firstDate)
        await db("team_sittings?on_conflict=id", {
          method: "POST",
          body: {
            id: `${id}:${a.firstDate}`,
            meeting_id: id,
            on_date: a.firstDate,
            starts_at: a.startTime
              ? zonedToUtc(
                  a.firstDate,
                  a.startTime,
                  "Asia/Kuwait",
                ).toISOString()
              : null,
            ends_at:
              a.startTime && a.minutes
                ? new Date(
                    zonedToUtc(
                      a.firstDate,
                      a.startTime,
                      "Asia/Kuwait",
                    ).getTime() +
                      a.minutes * 60_000,
                  ).toISOString()
                : null,
            held: a.firstDate <= kuwaitDay(),
          },
          prefer: "resolution=ignore-duplicates,return=minimal",
        });
      await logChange(w.email, id, `made the meeting "${title}"`, {
        purpose,
        cadence: a.cadence,
        department,
        onCalendar,
      });
      if (onCalendar)
        await sendNow(w, id, "create", { from: a.firstDate ?? kuwaitDay() });
      return page(w, id);
    }),
});

/** Put a person in a meeting, change their part, or take them off: on the invite too. */
export const setPart = authenticatedAction({
  args: {
    meetingId: v.string(),
    personId: v.optional(v.string()),
    newPerson: v.optional(v.object({ name: v.string(), email: v.string() })),
    part: v.union(
      v.literal("host"),
      v.literal("required"),
      v.literal("optional"),
      v.literal("off"),
    ),
  },
  returns: v.any(),
  handler: (
    ctx,
    a,
  ): Promise<
    MeetingPage | { needsEmail: { personId: string; name: string } }
  > =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      await mustManage(w, a.meetingId);
      const m = await meetingOrRefuse(a.meetingId, "id,cal_event_id");
      let person: SbRow | undefined;
      if (a.newPerson) {
        const name = clean(a.newPerson.name, 80);
        const email = clean(a.newPerson.email, 120).toLowerCase();
        if (name.length < 2) throw new Error("Give the new person's name.");
        if (!EMAIL.test(email))
          throw new Error(
            "Give the new person's email address, so the invite reaches them.",
          );
        const [known] = await db(
          `team_people?select=id,name,email&email=ilike.${enc(email)}`,
        );
        if (known) person = known;
        else {
          const base = slug(name) || "person";
          const taken = new Set(
            (await db(`team_people?select=id&id=like.${enc(`${base}*`)}`)).map(
              r => String(r.id),
            ),
          );
          let id = base;
          for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
          await db("team_people", {
            method: "POST",
            body: { id, name, email, active: true },
            prefer: "return=minimal",
          });
          person = { id, name, email };
          await logChange(
            w.email,
            a.meetingId,
            `put ${name} on the team roster`,
          );
        }
      } else {
        [person] = await db(
          `team_people?select=id,name,email&id=eq.${enc(String(a.personId ?? ""))}`,
        );
      }
      if (!person) throw new Error("That person is not on the team roster.");
      const personId = String(person.id);
      // Nobody can be invited without an address: the page asks for it.
      if (m.cal_event_id && a.part !== "off" && !person.email)
        return { needsEmail: { personId, name: String(person.name) } };
      const [current] = await db(
        `team_meeting_people?select=part,removed&meeting_id=eq.${enc(a.meetingId)}&person_id=eq.${enc(personId)}`,
      );
      if (a.part === "off" || (current?.part === "host" && a.part !== "host")) {
        const hosts = await db(
          `team_meeting_people?select=person_id&meeting_id=eq.${enc(a.meetingId)}&part=eq.host&removed=eq.false`,
        );
        if (
          current?.part === "host" &&
          !current.removed &&
          !hosts.some(h => h.person_id !== personId)
        )
          throw new Error(
            "Make somebody else the host first: every meeting has one.",
          );
      }
      const now = new Date().toISOString();
      await db("team_meeting_people?on_conflict=meeting_id,person_id", {
        method: "POST",
        body: {
          meeting_id: a.meetingId,
          person_id: personId,
          part: a.part === "off" ? (current?.part ?? "required") : a.part,
          removed: a.part === "off",
          source: "cockpit",
          changed_by: w.email,
          changed_at: now,
        },
        prefer: "resolution=merge-duplicates,return=minimal",
      });
      const hosts = await db(
        `team_meeting_people?select=person_id&meeting_id=eq.${enc(a.meetingId)}&part=eq.host&removed=eq.false&order=changed_at.asc.nullsfirst`,
      );
      await db(`team_meetings?id=eq.${enc(a.meetingId)}`, {
        method: "PATCH",
        body: {
          host_id: hosts[0]?.person_id ?? null,
          managed: "cockpit",
          updated_at: now,
        },
        prefer: "return=minimal",
      });
      const name = String(person.name);
      const added = !current || current.removed;
      await logChange(
        w.email,
        a.meetingId,
        a.part === "off"
          ? `took ${name} off the meeting`
          : added
            ? `added ${name} as ${a.part === "host" ? "a host" : a.part}`
            : `made ${name} ${a.part === "host" ? "a host" : a.part}`,
      );
      if (
        m.cal_event_id &&
        person.email &&
        !(a.part === "off" && (!current || current.removed))
      ) {
        const email = String(person.email);
        const change: GuestChange & { personId: string } =
          a.part === "off"
            ? { email, action: "remove", personId }
            : added
              ? {
                  email,
                  action: "add",
                  optional: a.part === "optional",
                  personId,
                }
              : {
                  email,
                  action: "part",
                  optional: a.part === "optional",
                  personId,
                };
        await sendNow(w, a.meetingId, "guests", { changes: [change] });
      }
      return page(w, a.meetingId);
    }),
});

/** A person's address, asked for when they are invited without one. */
export const setEmail = authenticatedAction({
  args: { meetingId: v.string(), personId: v.string(), email: v.string() },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      await mustManage(w, a.meetingId);
      const email = clean(a.email, 120).toLowerCase();
      if (!EMAIL.test(email)) throw new Error("That is not an email address.");
      const [taken] = await db(
        `team_people?select=id,name&email=ilike.${enc(email)}`,
      );
      if (taken && taken.id !== a.personId)
        throw new Error(
          `That address is already ${taken.name}'s on the roster.`,
        );
      const done = await db(`team_people?id=eq.${enc(a.personId)}`, {
        method: "PATCH",
        body: { email, updated_at: new Date().toISOString() },
        prefer: "return=representation",
      });
      if (!done.length)
        throw new Error("That person is not on the team roster.");
      await logChange(
        w.email,
        a.meetingId,
        `gave ${done[0].name} an email address for invites`,
      );
      return page(w, a.meetingId);
    }),
});

/** The days, start and length of the series, from a date on. */
export const setSeries = authenticatedAction({
  args: {
    meetingId: v.string(),
    weekdays: v.array(v.number()),
    startTime: v.string(),
    minutes: v.number(),
    from: v.string(),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      await mustManage(w, a.meetingId);
      const weekdays = [...new Set(a.weekdays)].sort((x, y) => x - y);
      const minutes = Math.trunc(a.minutes);
      checkSeries({ weekdays, startTime: a.startTime, minutes });
      if (!DAY.test(a.from))
        throw new Error("Pick the date the change starts from.");
      const m = await meetingOrRefuse(a.meetingId);
      if (m.rrule && !weekdays.length)
        throw new Error("A repeating meeting needs at least one day.");
      await db(`team_meetings?id=eq.${enc(a.meetingId)}`, {
        method: "PATCH",
        body: {
          weekdays: weekdays.length ? weekdays : null,
          start_time: a.startTime,
          minutes,
          managed: "cockpit",
          updated_at: new Date().toISOString(),
        },
        prefer: "return=minimal",
      });
      const line = seriesLine({
        weekdays,
        startTime: a.startTime,
        minutes,
        tz: m.tz,
      });
      await logChange(
        w.email,
        a.meetingId,
        `set the series to ${line}, from ${a.from}`,
        {
          before: {
            weekdays: m.weekdays,
            start_time: m.start_time,
            minutes: m.minutes,
          },
        },
      );
      if (m.cal_event_id)
        await sendNow(w, a.meetingId, "series", {
          weekdays,
          startTime: a.startTime,
          minutes,
          from: a.from,
        });
      else {
        // Not on the calendar: stored sittings from the date follow the new time.
        const rows = await db(
          `team_sittings?select=id,on_date&meeting_id=eq.${enc(a.meetingId)}&on_date=gte.${a.from}&status=neq.cancelled`,
        );
        for (const s of rows) {
          const start = zonedToUtc(
            String(s.on_date),
            a.startTime,
            String(m.tz ?? "Asia/Kuwait"),
          );
          await db(`team_sittings?id=eq.${enc(String(s.id))}`, {
            method: "PATCH",
            body: {
              starts_at: start.toISOString(),
              ends_at: new Date(
                start.getTime() + minutes * 60_000,
              ).toISOString(),
            },
            prefer: "return=minimal",
          });
        }
      }
      return page(w, a.meetingId);
    }),
});

/** A sitting a meeting's days produce, stored the first time something is written to it. */
export async function ensureSitting(
  meetingId: string,
  sittingId: string,
): Promise<SbRow> {
  const [s] = await db(`team_sittings?select=*&id=eq.${enc(sittingId)}`);
  if (s) return s;
  const day = sittingId.slice(meetingId.length + 1);
  if (!sittingId.startsWith(`${meetingId}:`) || !DAY.test(day))
    throw new Error("That sitting is not there any more.");
  const m = await meetingOrRefuse(meetingId);
  const weekdays: number[] = m.weekdays ?? [];
  if (!weekdays.includes(weekdayOf(day)) || !m.start_time)
    throw new Error("The meeting does not sit on that day.");
  const tz = String(m.tz ?? "Asia/Kuwait");
  const start = zonedToUtc(day, m.start_time, tz);
  const [row] = await db("team_sittings?on_conflict=id", {
    method: "POST",
    body: {
      id: sittingId,
      meeting_id: meetingId,
      on_date: day,
      starts_at: start.toISOString(),
      ends_at: new Date(
        start.getTime() + Number(m.minutes ?? 30) * 60_000,
      ).toISOString(),
      held: day <= kuwaitDay(),
    },
    prefer: "resolution=merge-duplicates,return=representation",
  });
  return row;
}

/** One sitting to another day or time; the series stays as it is. */
export const moveSitting = authenticatedAction({
  args: {
    meetingId: v.string(),
    sittingId: v.string(),
    day: v.string(),
    startTime: v.string(),
    minutes: v.number(),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      await mustManage(w, a.meetingId);
      const minutes = Math.trunc(a.minutes);
      checkSeries({ weekdays: [], startTime: a.startTime, minutes });
      if (!DAY.test(a.day)) throw new Error("Pick the day it moves to.");
      const s = await ensureSitting(a.meetingId, a.sittingId);
      const m = await meetingOrRefuse(a.meetingId, "tz");
      const start = zonedToUtc(
        a.day,
        a.startTime,
        String(m.tz ?? "Asia/Kuwait"),
      );
      await db(`team_sittings?id=eq.${enc(a.sittingId)}`, {
        method: "PATCH",
        body: {
          starts_at: start.toISOString(),
          ends_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
          status: "moved",
        },
        prefer: "return=minimal",
      });
      await logChange(
        w.email,
        a.meetingId,
        `moved the ${s.on_date} sitting to ${a.day} ${hhmm(a.startTime)}`,
      );
      if (s.cal_instance_id)
        await sendNow(
          w,
          a.meetingId,
          "move",
          { day: a.day, startTime: a.startTime, minutes },
          a.sittingId,
        );
      return page(w, a.meetingId);
    }),
});

/** One sitting off; its notes stay. */
export const cancelSitting = authenticatedAction({
  args: { meetingId: v.string(), sittingId: v.string() },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      await mustManage(w, a.meetingId);
      const s = await ensureSitting(a.meetingId, a.sittingId);
      await db(`team_sittings?id=eq.${enc(a.sittingId)}`, {
        method: "PATCH",
        body: { status: "cancelled", held: false },
        prefer: "return=minimal",
      });
      await logChange(
        w.email,
        a.meetingId,
        `cancelled the ${s.on_date} sitting`,
      );
      if (s.cal_instance_id)
        await sendNow(w, a.meetingId, "cancel", null, a.sittingId);
      return page(w, a.meetingId);
    }),
});

/** A one-off sitting: on the calendar too, with the same guests and a Meet link. */
export const addSitting = authenticatedAction({
  args: {
    meetingId: v.string(),
    date: v.string(),
    startTime: v.optional(v.string()),
    minutes: v.optional(v.number()),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      await mustManage(w, a.meetingId);
      if (!DAY.test(a.date)) throw new Error("Pick a date.");
      const today = kuwaitDay();
      if (a.date < addDays(today, -60) || a.date > addDays(today, 370))
        throw new Error("Pick a date within the year.");
      const m = await meetingOrRefuse(a.meetingId);
      const startTime = a.startTime || (m.start_time ? hhmm(m.start_time) : "");
      const minutes = Math.trunc(a.minutes ?? Number(m.minutes ?? 30));
      if (startTime) checkSeries({ weekdays: [], startTime, minutes });
      const id = `${a.meetingId}:${a.date}`;
      const [had] = await db(`team_sittings?select=id,status&id=eq.${enc(id)}`);
      if (had && had.status !== "cancelled")
        throw new Error(
          "It already meets that day. Move that sitting instead.",
        );
      const start = startTime
        ? zonedToUtc(a.date, startTime, String(m.tz ?? "Asia/Kuwait"))
        : null;
      await db("team_sittings?on_conflict=id", {
        method: "POST",
        body: {
          id,
          meeting_id: a.meetingId,
          on_date: a.date,
          held: a.date <= today,
          status: "scheduled",
          starts_at: start?.toISOString() ?? null,
          ends_at: start
            ? new Date(start.getTime() + minutes * 60_000).toISOString()
            : null,
          cal_instance_id: null,
        },
        prefer: "resolution=merge-duplicates,return=minimal",
      });
      await logChange(
        w.email,
        a.meetingId,
        `added a sitting on ${a.date}${startTime ? ` at ${startTime}` : ""}`,
      );
      if (m.cal_event_id && startTime)
        await sendNow(
          w,
          a.meetingId,
          "addOne",
          { day: a.date, startTime, minutes },
          id,
        );
      return page(w, a.meetingId);
    }),
});

/** A meeting that is not on the calendar yet: a series on the CEO's calendar with a Meet link. */
export const putOnCalendar = authenticatedAction({
  args: { meetingId: v.string(), from: v.optional(v.string()) },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      await mustManage(w, a.meetingId);
      const m = await meetingOrRefuse(a.meetingId);
      if (m.cal_event_id) throw new Error("It is on Google Calendar already.");
      if (!m.start_time || !m.minutes)
        throw new Error(
          "Set its days, start time and length first, under Edit.",
        );
      await logChange(w.email, a.meetingId, "put it on Google Calendar");
      await sendNow(w, a.meetingId, "create", {
        from: a.from && DAY.test(a.from) ? a.from : kuwaitDay(),
      });
      return page(w, a.meetingId);
    }),
});

/** End a meeting: the series stops after its last date. Nothing is deleted. */
export const endMeeting = authenticatedAction({
  args: { meetingId: v.string(), lastDate: v.string() },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      await mustManage(w, a.meetingId);
      if (!DAY.test(a.lastDate))
        throw new Error("Pick the meeting's last date.");
      const m = await meetingOrRefuse(a.meetingId);
      await db(`team_meetings?id=eq.${enc(a.meetingId)}`, {
        method: "PATCH",
        body: {
          ends_on: a.lastDate,
          managed: "cockpit",
          updated_at: new Date().toISOString(),
        },
        prefer: "return=minimal",
      });
      await logChange(
        w.email,
        a.meetingId,
        `ended the meeting after ${a.lastDate}`,
      );
      if (m.cal_event_id)
        await sendNow(w, a.meetingId, "end", { lastDate: a.lastDate });
      else {
        // Sittings after the last date: gone when empty, cancelled when something hangs on them.
        const later = await db(
          `team_sittings?select=id,notes,goal_hit&meeting_id=eq.${enc(a.meetingId)}&on_date=gt.${a.lastDate}`,
        );
        for (const s of later)
          await db(`team_sittings?id=eq.${enc(String(s.id))}`, {
            method:
              String(s.notes ?? "").trim() || s.goal_hit !== null
                ? "PATCH"
                : "DELETE",
            ...(String(s.notes ?? "").trim() || s.goal_hit !== null
              ? { body: { status: "cancelled" } }
              : {}),
            prefer: "return=minimal",
          });
      }
      return page(w, a.meetingId);
    }),
});

/** A series organised on a calendar the cockpit cannot edit, recreated on the CEO's. */
export const takeOver = authenticatedAction({
  args: { meetingId: v.string() },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      await mustManage(w, a.meetingId);
      const m = await meetingOrRefuse(a.meetingId);
      if (!m.cal_event_id)
        throw new Error("It is not on Google Calendar: use Put on calendar.");
      const next =
        (await nextSittingDay(a.meetingId, kuwaitDay())) ?? kuwaitDay();
      await logChange(
        w.email,
        a.meetingId,
        `took the series over onto the CEO's calendar from ${next}`,
      );
      await sendNow(w, a.meetingId, "takeover", { from: next });
      return page(w, a.meetingId);
    }),
});

/** Try the changes that failed again. */
export const retryCalendar = authenticatedAction({
  args: { meetingId: v.string() },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      await mustManage(w, a.meetingId);
      await db(
        `team_calendar_ops?meeting_id=eq.${enc(a.meetingId)}&status=eq.failed`,
        {
          method: "PATCH",
          body: { status: "pending", attempts: 0, error: null, tried_at: null },
          prefer: "return=minimal",
        },
      );
      await logChange(w.email, a.meetingId, "tried the calendar changes again");
      await runWaiting(a.meetingId);
      return page(w, a.meetingId);
    }),
});
