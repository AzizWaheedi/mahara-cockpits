import { z } from "zod";
import {
  addDays,
  applyGuestChanges,
  buildRrule,
  endOf,
  endPlan,
  endRrule,
  eventSeries,
  type GuestChange,
  guestUpdates,
  nextOn,
  patchWithRetry,
  planSeriesChange,
  renamedSummary,
  rruleOf,
  type SeriesChange,
  sendUpdatesFor,
  seriesUnchanged,
  utcToZoned,
  wallClock,
  weekdaysOfRrule,
  withOurBlock,
  withRrule,
  zonedToUtc,
} from "./teamCore";

const rowSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    weekdays: z.array(z.number()).nullable().optional(),
    start_time: z.string().nullable().optional(),
    minutes: z.number().nullable().optional(),
    purpose: z.string().nullable().optional(),
  })
  .passthrough();
type Any = z.infer<typeof rowSchema>;
type SbRow = Any;
const attendeeSchema = z
  .object({
    email: z.string(),
    optional: z.boolean().optional(),
    resource: z.boolean().optional(),
  })
  .passthrough();
const conferenceSchema = z
  .object({
    conferenceId: z.string().optional(),
    conferenceSolution: z.unknown().optional(),
    entryPoints: z
      .array(
        z
          .object({
            entryPointType: z.string().optional(),
            uri: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    createRequest: z.unknown().optional(),
  })
  .passthrough();
const eventSchema = z
  .object({
    id: z.string().optional(),
    etag: z.string().optional(),
    summary: z.string().optional(),
    status: z.string().optional(),
    description: z.string().optional(),
    location: z.string().optional(),
    organizer: z.object({ email: z.string().optional() }).optional(),
    attendees: z.array(attendeeSchema).optional(),
    start: z
      .object({
        dateTime: z.string().optional(),
        timeZone: z.string().optional(),
        date: z.string().optional(),
      })
      .optional(),
    end: z
      .object({
        dateTime: z.string().optional(),
        timeZone: z.string().optional(),
        date: z.string().optional(),
      })
      .optional(),
    originalStartTime: z.object({ dateTime: z.string().optional() }).optional(),
    recurrence: z.array(z.string()).optional(),
    conferenceData: conferenceSchema.optional(),
    hangoutLink: z.string().optional(),
    extendedProperties: z
      .object({ private: z.record(z.string(), z.string()).optional() })
      .optional(),
    reminders: z.unknown().optional(),
    guestsCanModify: z.boolean().optional(),
    guestsCanInviteOthers: z.boolean().optional(),
    error: z.object({ message: z.string().optional() }).optional(),
  })
  .passthrough();
type Ev = z.infer<typeof eventSchema>;
const responseSchema = eventSchema.extend({
  items: z.array(eventSchema).optional(),
});
const claimSchema = z.object({
  id: z.number(),
  meeting_id: z.string(),
  sitting_id: z.string().nullable(),
  op: z.enum([
    "create",
    "guests",
    "series",
    "move",
    "cancel",
    "addOne",
    "describe",
    "end",
    "takeover",
  ]),
  payload: rowSchema.nullable(),
  attempts: z.number(),
  requested_by: z.string().nullable(),
  claim_token: z.string().uuid(),
});
export interface TeamCalendarRuntime {
  db(
    path: string,
    init?: { method?: string; body?: unknown; prefer?: string },
  ): Promise<unknown>;
  calendar(
    method: string,
    path: string,
    options: { body?: unknown; etag?: string; query?: Record<string, string> },
  ): Promise<{ status: number; json: unknown }>;
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  ready(): boolean;
  meetingLink(id: string): string;
}

/** Server-only worker. The runtime owns credentials, bounded requests and health receipts. */
export function createTeamCalendarWorker(runtime: TeamCalendarRuntime) {
  const { meetingLink } = runtime;
  async function db(
    path: string,
    init?: { method?: string; body?: unknown; prefer?: string },
  ): Promise<SbRow[]> {
    return z.array(rowSchema).parse(await runtime.db(path, init));
  }
  const enc = encodeURIComponent;
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const kuwaitDay = () =>
    new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  let claim: { id: number; claim_token: string } | null = null;
  async function gcal(
    method: string,
    path: string,
    options: {
      body?: unknown;
      etag?: string;
      query?: Record<string, string>;
    } = {},
  ) {
    if (
      !claim ||
      !(await runtime.rpc("cockpit_team_calendar_renew", {
        p_id: claim.id,
        p_token: claim.claim_token,
      }))
    )
      throw new Error("Calendar claim expired; do not send this operation.");
    const response = await runtime.calendar(method, path, options);
    return {
      status: response.status,
      json: response.json === null ? null : responseSchema.parse(response.json),
    };
  }
  async function meetingOrRefuse(id: string): Promise<Any> {
    const [meeting] = await db("team_meetings?select=*&id=eq." + enc(id));
    if (!meeting) throw new Error("That meeting is not in the list any more.");
    return meeting;
  }
  async function logChange(by: string, meetingId: string, what: string) {
    await db("team_changes", {
      method: "POST",
      body: { by_whom: by, meeting_id: meetingId, what },
      prefer: "return=minimal",
    });
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
    if (r.status >= 400 || !r.json)
      throw new Error(googleSays(r.status, r.json));
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
    if (r.status >= 400 || !r.json)
      throw new Error(googleSays(r.status, r.json));
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
      ((r.json?.items ?? []) as Ev[]).find(e => e.status !== "cancelled") ??
      null
    );
  }

  function guestsOf(ev: Ev): { email: string; optional?: boolean }[] {
    return (ev.attendees ?? [])
      .filter(a => !a.resource && a.email)
      .map(a => ({
        email: String(a.email),
        ...(a.optional ? { optional: true } : {}),
      }));
  }

  function sameGuests(
    a: z.infer<typeof attendeeSchema>[],
    b: z.infer<typeof attendeeSchema>[],
  ): boolean {
    const key = (x: z.infer<typeof attendeeSchema>[]) =>
      x
        .map(g => `${String(g.email).toLowerCase()}:${g.optional ? 1 : 0}`)
        .sort()
        .join(",");
    return key(a) === key(b);
  }

  // --- a meeting and the series it is made of ------------------------------------------------

  const partSchema = z.object({
    meeting_id: z.string().min(1),
    cal_calendar: z.string().min(1),
    cal_event_id: z.string().min(1),
    weekday: z.number().nullable().optional().default(null),
    ends_on: z.string().nullable().optional().default(null),
    cal_title: z.string().nullable().optional().default(null),
    cal_writable: z.boolean(),
  });
  type Part = z.infer<typeof partSchema>;

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
    const seriesRows = await db(
      `team_meeting_series?select=*&meeting_id=eq.${enc(meetingId)}&order=weekday.asc.nullsfirst`,
    );
    let parts: Part[] = z.array(partSchema).parse(seriesRows);
    if (!parts.length && m.cal_calendar && m.cal_event_id) {
      const row = partSchema.parse({
        meeting_id: meetingId,
        cal_calendar: m.cal_calendar,
        cal_event_id: m.cal_event_id,
        weekday: null,
        ends_on: null,
        cal_title: m.cal_title ?? null,
        cal_writable: Boolean(m.cal_writable),
      });
      await db("team_meeting_series?on_conflict=cal_calendar,cal_event_id", {
        method: "POST",
        body: row,
        prefer: "resolution=merge-duplicates,return=minimal",
      });
      parts = [row];
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

  function conferenceCopy(
    c: z.infer<typeof conferenceSchema> | undefined,
  ): z.infer<typeof conferenceSchema> | undefined {
    if (!c?.conferenceId) return undefined;
    return {
      conferenceId: c.conferenceId,
      conferenceSolution: c.conferenceSolution,
      entryPoints: c.entryPoints,
    };
  }

  const newMeet = (requestId: string) => ({
    createRequest: {
      requestId,
      conferenceSolutionKey: { type: "hangoutsMeet" },
    },
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
    // A sitting that already happened stays: a series never ends before yesterday.
    const floor = addDays(c.today, -1);
    const last = lastDay < floor ? floor : lastDay;
    const master = await readEvent(p.cal_calendar, p.cal_event_id);
    const rrule = rruleOf(master.recurrence);
    const first = eventSeries(master, c.tz).firstDay;
    const how = endPlan(rrule, first, last);
    if (how === "cancel") {
      // Nothing of it falls on or before the last day: cancelled, never
      // deleted (Google keeps it and it can be restored), its stored sittings
      // go with it, and it stops being one of the meeting's series now.
      await writeEvent(
        p.cal_calendar,
        p.cal_event_id,
        () => ({ status: "cancelled" }),
        c.past ? "none" : "all",
      );
      await db(
        `team_sittings?meeting_id=eq.${enc(String(c.m.id))}&on_date=gt.${last}&cal_instance_id=like.${enc(`${p.cal_event_id}\\_2`)}*`,
        {
          method: "PATCH",
          body: { status: "cancelled", held: false },
          prefer: "return=minimal",
        },
      );
      await markEnded(p, floor);
      return;
    }
    if (how === "until" && rrule)
      await writeEvent(
        p.cal_calendar,
        p.cal_event_id,
        f => ({
          recurrence: withRrule(
            f.recurrence,
            endRrule(rruleOf(f.recurrence) ?? rrule, last, c.tz),
          ),
        }),
        c.past || last < c.today ? "none" : "all",
      );
    await markEnded(p, last);
  }

  async function opSeries(op: Op, c: Ctx): Promise<void> {
    const change = op.payload as SeriesChange;
    const next = await nextSittingDay(String(c.m.id), c.today);
    if (c.parts.length <= 1) {
      if (!c.parts[0])
        throw new Error("The meeting is not on Google Calendar.");
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
      sendUpdatesFor(
        day < String(s.on_date) ? String(s.on_date) : day,
        c.today,
      ),
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
        ? await readEvent(
            c.parts[0].cal_calendar,
            c.parts[0].cal_event_id,
          ).catch(() => null)
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
          attendees: main
            ? guestsOf(main)
            : await peopleAsGuests(String(c.m.id)),
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
          attendees: face
            ? guestsOf(face)
            : await peopleAsGuests(String(c.m.id)),
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
      // A series cancelled as it ended keeps the last day it was given.
      const cancelled = ev.status === "cancelled";
      if (!cancelled) read.push({ p, ev, s });
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
            ends_on: cancelled ? (p.ends_on ?? c.today) : s.ends_on,
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
    const main =
      read.find(x => x.p.cal_event_id === c.m.cal_event_id) ?? read[0];
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
    // The meeting's own link follows a live series when its series ended
    // (CSM Daily's link was its Sunday series), as the five-minute sync does.
    if (main.p.cal_event_id !== c.m.cal_event_id) {
      body.cal_calendar = main.p.cal_calendar;
      body.cal_event_id = main.p.cal_event_id;
      body.calendar_id = String(main.p.cal_event_id).slice(0, 120);
    }
    await db(`team_meetings?id=eq.${enc(meetingId)}`, {
      method: "PATCH",
      body,
      prefer: "return=minimal",
    });

    // Sittings: one per occurrence from yesterday to two months ahead.
    const rows: Any[] = [];
    const timeMin = zonedToUtc(
      addDays(c.today, -1),
      "00:00",
      c.tz,
    ).toISOString();
    const timeMax = zonedToUtc(
      addDays(c.today, 62),
      "00:00",
      c.tz,
    ).toISOString();
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
        if (r.status < 400)
          occurrences.push(...((r.json?.items ?? []) as Ev[]));
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
      const had = byId.get(String(r.id));
      if (!had || (had.status === "cancelled" && r.status !== "cancelled"))
        byId.set(String(r.id), r);
    }
    if (byId.size)
      await db("team_sittings?on_conflict=id", {
        method: "POST",
        body: [...byId.values()],
        prefer: "resolution=merge-duplicates,return=minimal",
      });
  }

  async function drain(limit = 25) {
    if (!runtime.ready())
      throw new Error(
        "Google Calendar sign-in is not configured; operations remain queued.",
      );
    const out: { id: number; done: boolean; error?: string }[] = [];
    for (let i = 0; i < Math.min(Math.max(limit, 1), 25); i++) {
      const rows = z
        .array(claimSchema)
        .parse(await runtime.rpc("cockpit_team_calendar_claim", {}));
      const op = rows[0];
      if (!op) break;
      claim = { id: op.id, claim_token: op.claim_token };
      try {
        await runOp(op);
        await readBack(op.meeting_id);
        const accepted = await runtime.rpc("cockpit_team_calendar_finish", {
          p_id: op.id,
          p_token: op.claim_token,
          p_error: null,
        });
        if (!accepted)
          throw new Error(
            "Calendar receipt lost its claim; operation must be reconciled.",
          );
        out.push({ id: op.id, done: true });
      } catch (error) {
        const message = String(
          error instanceof Error ? error.message : error,
        ).slice(0, 400);
        await runtime.rpc("cockpit_team_calendar_finish", {
          p_id: op.id,
          p_token: op.claim_token,
          p_error: message,
        });
        out.push({ id: op.id, done: false, error: message });
      } finally {
        claim = null;
      }
    }
    return out;
  }
  return { drain };
}
