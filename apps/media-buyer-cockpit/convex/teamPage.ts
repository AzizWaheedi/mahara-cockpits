import type { SbRow } from "./ceo/sbWrite";
import { kuwaitDay } from "./ceo/time";
import {
  addDays,
  hhmm,
  notPlanned,
  overdue,
  pipelineStrip,
  renderOption,
  utcToZoned,
  weekdayOf,
  weekStart,
  zonedToUtc,
} from "./teamCore";
import { db, enc, isBoss, meOf, type Who } from "./teamDb";
import { calendarWriteReady } from "./tools";

/**
 * What the Team meetings screens read: the list with the week at a glance
 * (TeamPage) and one meeting (MeetingPage). Written by team.ts and
 * teamCalendar.ts, which answer every change with the page as it now is.
 */

const PARTS = ["host", "required", "optional"] as const;
const PORTAL = "https://cockpit.maharamedia.com";

export type Person = {
  id: string;
  name: string;
  role: string | null;
  department: string | null;
  email: string | null;
};

function personOf(r: SbRow): Person {
  return {
    id: String(r.id),
    name: String(r.name ?? r.id),
    role: r.role ?? null,
    department: r.department ?? null,
    email: r.email ?? null,
  };
}

export type MeetingSummary = {
  id: string;
  title: string;
  purpose: string | null;
  cadence: string | null;
  department: string | null;
  hostIds: string[];
  peopleIds: string[];
  nextSitting: string | null;
  lastSitting: string | null;
  openItems: number;
  mine: boolean;
  startTime: string | null;
  minutes: number | null;
  weekdays: number[] | null;
  onCalendar: boolean;
};

export type WeekItem = {
  meetingId: string;
  title: string;
  /** The day's own part of the meeting, when it has one ("Role Play"). */
  theme: string | null;
  day: string;
  time: string | null;
  endTime: string | null;
  status: "scheduled" | "moved" | "cancelled";
  onCalendar: boolean;
};

export type WeekDay = { day: string; items: WeekItem[] };

export type Prize = {
  wheelId: string;
  wheelName: string;
  meetingId: string | null;
  meetingTitle: string | null;
  optionId: number;
  label: string;
  rendered: string;
  amount: number | null;
  currency: string | null;
  suffix: string | null;
  condition: string | null;
  active: boolean;
};

export type Overview = {
  today: string;
  me: {
    email: string;
    personId: string | null;
    canCreate: boolean;
    isBoss: boolean;
  };
  people: Person[];
  meetings: MeetingSummary[];
  /** Two weeks from the Saturday this week started on. */
  weeks: WeekDay[][];
  prizes: Prize[] | null;
  calendarReady: boolean;
};

export type Item = {
  id: number;
  text: string;
  ownerId: string | null;
  status: "open" | "done" | "dropped";
  position: number;
  sittingId: string | null;
  addedBy: string | null;
  addedAt: string;
  closedAt: string | null;
  closedBy: string | null;
  /** Past sittings this item has stayed open through. */
  carried: number;
};

export type Sitting = {
  id: string;
  onDate: string;
  notes: string;
  notesBy: string | null;
  notesAt: string | null;
  notesVersion: number;
  startsAt: string | null;
  endsAt: string | null;
  /** The local start and end, "13:30". */
  time: string | null;
  endTime: string | null;
  status: "scheduled" | "moved" | "cancelled";
  goalHit: boolean | null;
  onCalendar: boolean;
  /** Worked out from the meeting's days; stored the first time it is written to. */
  virtual: boolean;
};

export type BlockRow = {
  id: number;
  weekday: number | null;
  position: number;
  minutes: number | null;
  title: string;
  detail: string | null;
};

export type WheelOptionView = {
  id: number;
  label: string;
  rendered: string;
  amount: number | null;
  currency: string | null;
  suffix: string | null;
  condition: string | null;
  active: boolean;
  position: number;
};

export type Wheel = {
  id: string;
  name: string;
  kind: "scenario" | "person" | "prize";
  sourceUrl: string | null;
  lockedUntilGoal: boolean;
  active: boolean;
  position: number;
  options: WheelOptionView[];
};

export type Spin = {
  id: number;
  wheelId: string;
  sittingId: string | null;
  label: string;
  by: string | null;
  forWhom: string | null;
  at: string;
};

export type CreativeRow = {
  id: number;
  client: string;
  angle: string | null;
  kind: "new" | "refresh" | "edit" | null;
  source: string | null;
  creativeRequestId: string | null;
  scriptDue: string | null;
  footageDue: string | null;
  editDue: string | null;
  approvedOn: string | null;
  launchOn: string | null;
  launchedOn: string | null;
  status: string;
  ownerId: string | null;
  slipCount: number;
  notes: string | null;
  updatedBy: string | null;
  updatedAt: string;
  overdue: boolean;
  notPlanned: boolean;
};

export type Strip = ReturnType<typeof pipelineStrip> & {
  slipped: { client: string; angle: string | null; slips: number }[];
};

export type CalendarStatus = {
  state: "off" | "on" | "someone-else";
  /** The cockpit's calendar sign-in is set, so changes can reach Google. */
  ready: boolean;
  syncedAt: string | null;
  error: string | null;
  waiting: number;
  failed: { id: number; op: string; error: string | null; at: string }[];
  /** Who organises it, when that is not the CEO's calendar. */
  organizer: string | null;
  link: string | null;
  parts: {
    calendar: string;
    eventId: string;
    weekday: number | null;
    title: string | null;
    writable: boolean;
    endsOn: string | null;
  }[];
};

export type MeetingPage = {
  today: string;
  me: { email: string; personId: string | null; isBoss: boolean };
  canManage: boolean;
  meeting: {
    id: string;
    title: string;
    purpose: string | null;
    cadence: string | null;
    department: string | null;
    fromCalendar: boolean;
    managed: string;
    doc: string;
    docBy: string | null;
    docAt: string | null;
    docVersion: number;
    tz: string;
    startTime: string | null;
    minutes: number | null;
    weekdays: number[] | null;
    rrule: string | null;
    endsOn: string | null;
    meetLink: string | null;
    pipeline: "board" | "strip" | null;
  };
  calendar: CalendarStatus;
  people: Person[];
  members: { personId: string; part: "host" | "required" | "optional" }[];
  sittings: Sitting[];
  /** The next four, cancelled ones included so they can be seen. */
  next: Sitting[];
  items: Item[];
  changes: { at: string; by: string; what: string }[];
  blocks: BlockRow[];
  wheels: Wheel[];
  spins: Spin[];
  creative: CreativeRow[] | null;
  strip: Strip | null;
};

/** Open the event in Google Calendar: its id and calendar, as Google's own links carry them. */
export function eventLink(
  eventId: string | null,
  calendar: string | null,
): string | null {
  if (!eventId || !calendar) return null;
  const b64 = btoa(`${eventId} ${calendar}`).replace(/=+$/, "");
  return `https://www.google.com/calendar/event?eid=${b64}`;
}

export function meetingLink(id: string): string {
  return `${PORTAL}/team/${encodeURIComponent(id)}`;
}

function sittingOf(s: SbRow, tz: string): Sitting {
  const start = s.starts_at ? utcToZoned(s.starts_at, tz) : null;
  const end = s.ends_at ? utcToZoned(s.ends_at, tz) : null;
  return {
    id: String(s.id),
    onDate: String(s.on_date),
    notes: String(s.notes ?? ""),
    notesBy: s.notes_by ?? null,
    notesAt: s.notes_at ?? null,
    notesVersion: Number(s.notes_version ?? 0),
    startsAt: s.starts_at ?? null,
    endsAt: s.ends_at ?? null,
    time: start?.time ?? null,
    endTime: end?.time ?? null,
    status: (["scheduled", "moved", "cancelled"] as const).includes(s.status)
      ? s.status
      : "scheduled",
    goalHit: s.goal_hit ?? null,
    onCalendar: Boolean(s.cal_instance_id),
    virtual: false,
  };
}

/**
 * The days a meeting that is not on Google Calendar meets on, worked out
 * from its days and time: a sitting exists as a row once something is
 * written to it (notes, a spin, the goal).
 */
export function virtualSittings(
  m: SbRow,
  stored: Set<string>,
  from: string,
  days: number,
): Sitting[] {
  const weekdays: number[] = m.weekdays ?? [];
  if (!weekdays.length || !m.start_time || m.cal_event_id) return [];
  const tz = m.tz || "Asia/Kuwait";
  const out: Sitting[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(from, i);
    if (m.ends_on && day > m.ends_on) break;
    if (!weekdays.includes(weekdayOf(day)) || stored.has(day)) continue;
    const start = zonedToUtc(day, m.start_time, tz);
    const end = new Date(start.getTime() + Number(m.minutes ?? 30) * 60_000);
    out.push({
      id: `${m.id}:${day}`,
      onDate: day,
      notes: "",
      notesBy: null,
      notesAt: null,
      notesVersion: 0,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      time: hhmm(m.start_time),
      endTime: utcToZoned(end, tz).time,
      status: "scheduled",
      goalHit: null,
      onCalendar: false,
      virtual: true,
    });
  }
  return out;
}

function wheelsOf(wheels: SbRow[], options: SbRow[]): Wheel[] {
  return wheels
    .sort(
      (a, b) =>
        Number(a.position ?? 0) - Number(b.position ?? 0) ||
        String(a.id).localeCompare(String(b.id)),
    )
    .map(w => ({
      id: String(w.id),
      name: String(w.name),
      kind: w.kind,
      sourceUrl: w.source_url ?? null,
      lockedUntilGoal: Boolean(w.locked_until_goal),
      active: w.active !== false,
      position: Number(w.position ?? 0),
      options: options
        .filter(o => o.wheel_id === w.id)
        .sort(
          (a, b) =>
            Number(a.position ?? 0) - Number(b.position ?? 0) ||
            Number(a.id) - Number(b.id),
        )
        .map(o => ({
          id: Number(o.id),
          label: String(o.label),
          rendered: renderOption({
            label: String(o.label),
            amount:
              o.amount === null || o.amount === undefined
                ? null
                : Number(o.amount),
            currency: o.currency ?? null,
            amount_suffix: o.amount_suffix ?? null,
          }),
          amount:
            o.amount === null || o.amount === undefined
              ? null
              : Number(o.amount),
          currency: o.currency ?? null,
          suffix: o.amount_suffix ?? null,
          condition: o.condition ?? null,
          active: o.active !== false,
          position: Number(o.position ?? 0),
        })),
    }));
}

function creativeOf(r: SbRow, today: string): CreativeRow {
  const dates = {
    status: String(r.status),
    script_due: r.script_due ?? null,
    footage_due: r.footage_due ?? null,
    edit_due: r.edit_due ?? null,
    launch_on: r.launch_on ?? null,
  };
  return {
    id: Number(r.id),
    client: String(r.client),
    angle: r.angle ?? null,
    kind: r.kind ?? null,
    source: r.source ?? null,
    creativeRequestId: r.creative_request_id ?? null,
    scriptDue: dates.script_due,
    footageDue: dates.footage_due,
    editDue: dates.edit_due,
    approvedOn: r.approved_on ?? null,
    launchOn: dates.launch_on,
    launchedOn: r.launched_on ?? null,
    status: dates.status,
    ownerId: r.owner_id ?? null,
    slipCount: Number(r.slip_count ?? 0),
    notes: r.notes ?? null,
    updatedBy: r.updated_by ?? null,
    updatedAt: String(r.updated_at),
    overdue: overdue(dates, today),
    notPlanned: notPlanned(dates),
  };
}

/** The pipeline rows worth showing: everything open, and what closed in the last five weeks. */
export async function creativeRows(today: string): Promise<CreativeRow[]> {
  const since = addDays(today, -35);
  const rows = await db(
    `team_creative_rows?select=*&or=(status.not.in.(launched,cut),updated_at.gte.${since})&order=launch_on.asc.nullsfirst,id.asc&limit=300`,
  );
  return rows.map(r => creativeOf(r, today));
}

export async function page(w: Who, id: string): Promise<MeetingPage> {
  const today = kuwaitDay();
  const [
    meetings,
    people,
    links,
    sittings,
    items,
    changes,
    blocks,
    wheels,
    ops,
    parts,
  ] = await Promise.all([
    db(`team_meetings?select=*&id=eq.${enc(id)}`),
    db(
      "team_people?select=id,name,role,department,email,active&active=eq.true&order=name.asc",
    ),
    db(
      `team_meeting_people?select=person_id,part&meeting_id=eq.${enc(id)}&removed=eq.false`,
    ),
    db(
      `team_sittings?select=*&meeting_id=eq.${enc(id)}&on_date=gte.${addDays(today, -400)}&order=on_date.desc&limit=120`,
    ),
    db(
      `team_agenda?select=*&meeting_id=eq.${enc(id)}&or=(status.eq.open,closed_at.gte.${addDays(today, -120)})&order=position.asc,id.asc`,
    ),
    db(
      `team_changes?select=at,by_whom,what&meeting_id=eq.${enc(id)}&order=at.desc&limit=25`,
    ),
    db(
      `team_meeting_blocks?select=*&meeting_id=eq.${enc(id)}&order=position.asc,id.asc`,
    ),
    db(`team_wheels?select=*&meeting_id=eq.${enc(id)}&order=position.asc`),
    db(
      `team_calendar_ops?select=id,op,status,error,at&meeting_id=eq.${enc(id)}&or=(status.eq.pending,status.eq.failed)&order=id.desc&limit=20`,
    ),
    db(
      `team_meeting_series?select=*&meeting_id=eq.${enc(id)}&order=weekday.asc.nullsfirst`,
    ),
  ]);
  const m = meetings[0];
  if (!m)
    throw new Error(
      "That meeting is not in the list any more. Go back to Team meetings.",
    );
  const tz = String(m.tz ?? "Asia/Kuwait");
  const wheelIds = wheels.map(x => String(x.id));
  const [options, spins, creative] = await Promise.all([
    wheelIds.length
      ? db(
          `team_wheel_options?select=*&wheel_id=in.(${wheelIds.map(x => `"${x}"`).join(",")})`,
        )
      : Promise.resolve([] as SbRow[]),
    wheelIds.length
      ? db(
          `team_wheel_spins?select=*&wheel_id=in.(${wheelIds.map(x => `"${x}"`).join(",")})&order=at.desc&limit=20`,
        )
      : Promise.resolve([] as SbRow[]),
    m.pipeline ? creativeRows(today) : Promise.resolve([] as CreativeRow[]),
  ]);
  const me = meOf(people, w);
  const hosts = links.filter(l => l.part === "host").map(l => l.person_id);
  const manage = isBoss(w) || Boolean(me && hosts.includes(me.id));
  const pastDays = sittings.map(s => String(s.on_date)).filter(d => d < today);
  const stored = sittings.map(s => sittingOf(s, tz));
  const all = [
    ...stored,
    ...virtualSittings(m, new Set(stored.map(s => s.onDate)), today, 21),
  ].sort((a, b) => a.onDate.localeCompare(b.onDate));
  const next = all.filter(s => s.onDate >= today).slice(0, 4);
  const liveParts = parts.filter(p => !p.ends_on || String(p.ends_on) >= today);
  const main =
    parts.find(p => p.cal_event_id === m.cal_event_id) ?? liveParts[0] ?? null;
  const organizerCal = String(main?.cal_calendar ?? m.cal_calendar ?? "");
  const organizerPerson = people.find(
    p => String(p.email ?? "").toLowerCase() === organizerCal.toLowerCase(),
  );
  const writable = m.cal_event_id
    ? liveParts.length
      ? liveParts.every(p => p.cal_writable)
      : Boolean(m.cal_writable)
    : false;
  const failed = ops.filter(o => o.status === "failed");
  return {
    today,
    me: { email: w.email, personId: me?.id ?? null, isBoss: isBoss(w) },
    canManage: manage,
    meeting: {
      id: String(m.id),
      title: String(m.title),
      purpose: m.purpose ?? null,
      cadence: m.cadence ?? null,
      department: m.department ?? null,
      fromCalendar: Boolean(m.cal_event_id),
      managed: String(m.managed ?? "calendar"),
      doc: String(m.doc ?? ""),
      docBy: m.doc_by ?? null,
      docAt: m.doc_at ?? null,
      docVersion: Number(m.doc_version ?? 0),
      tz,
      startTime: m.start_time ?? null,
      minutes:
        m.minutes === null || m.minutes === undefined
          ? null
          : Number(m.minutes),
      weekdays: m.weekdays ?? null,
      rrule: m.rrule ?? null,
      endsOn: m.ends_on ?? null,
      meetLink: m.meet_link ?? null,
      pipeline: m.pipeline ?? null,
    },
    calendar: {
      state: !m.cal_event_id ? "off" : writable ? "on" : "someone-else",
      ready: calendarWriteReady(),
      syncedAt: m.cal_synced_at ?? null,
      error: failed.length
        ? String(failed[0].error ?? m.cal_error ?? "") || null
        : null,
      waiting: ops.filter(o => o.status === "pending").length,
      failed: failed.map(o => ({
        id: Number(o.id),
        op: String(o.op),
        error: o.error ?? null,
        at: String(o.at),
      })),
      organizer: m.cal_event_id
        ? (organizerPerson?.name ?? (organizerCal || null))
        : null,
      link: eventLink(
        main?.cal_event_id ?? m.cal_event_id ?? null,
        organizerCal || null,
      ),
      parts: parts.map(p => ({
        calendar: String(p.cal_calendar),
        eventId: String(p.cal_event_id),
        weekday:
          p.weekday === null || p.weekday === undefined
            ? null
            : Number(p.weekday),
        title: p.cal_title ?? null,
        writable: Boolean(p.cal_writable),
        endsOn: p.ends_on ?? null,
      })),
    },
    people: people.map(personOf),
    members: links.map(l => ({
      personId: String(l.person_id),
      part: (PARTS as readonly string[]).includes(l.part) ? l.part : "required",
    })),
    sittings: all.filter(s => !s.virtual || s.onDate >= today),
    next,
    items: items.map(i => {
      const added = String(i.added_at).slice(0, 10);
      return {
        id: Number(i.id),
        text: String(i.text),
        ownerId: i.owner_id ?? null,
        status: i.status,
        position: Number(i.position ?? 0),
        sittingId: i.sitting_id ?? null,
        addedBy: i.added_by ?? null,
        addedAt: String(i.added_at),
        closedAt: i.closed_at ?? null,
        closedBy: i.closed_by ?? null,
        carried:
          i.status === "open"
            ? pastDays.filter(d => d >= added && d < today).length
            : 0,
      };
    }),
    changes: changes.map(c => ({
      at: String(c.at),
      by: String(c.by_whom),
      what: String(c.what),
    })),
    blocks: blocks.map(b => ({
      id: Number(b.id),
      weekday:
        b.weekday === null || b.weekday === undefined
          ? null
          : Number(b.weekday),
      position: Number(b.position ?? 0),
      minutes:
        b.minutes === null || b.minutes === undefined
          ? null
          : Number(b.minutes),
      title: String(b.title),
      detail: b.detail ?? null,
    })),
    wheels: wheelsOf(wheels, options),
    spins: spins.map(s => ({
      id: Number(s.id),
      wheelId: String(s.wheel_id),
      sittingId: s.sitting_id ?? null,
      label: String(s.result_label),
      by: s.spun_by ?? null,
      forWhom: s.spun_for ?? null,
      at: String(s.at),
    })),
    creative: m.pipeline === "board" ? (creative as CreativeRow[]) : null,
    strip:
      m.pipeline === "strip"
        ? {
            ...pipelineStrip(
              (creative as CreativeRow[]).map(r => ({
                status: r.status,
                script_due: r.scriptDue,
                footage_due: r.footageDue,
                edit_due: r.editDue,
                launch_on: r.launchOn,
                launched_on: r.launchedOn,
                slip_count: r.slipCount,
              })),
              today,
            ),
            slipped: (creative as CreativeRow[])
              .filter(
                r =>
                  r.slipCount >= 2 &&
                  r.status !== "launched" &&
                  r.status !== "cut",
              )
              .map(r => ({
                client: r.client,
                angle: r.angle,
                slips: r.slipCount,
              })),
          }
        : null,
  };
}

export async function overviewOf(w: Who): Promise<Overview> {
  const today = kuwaitDay();
  const from = weekStart(today);
  const until = addDays(from, 13);
  const [people, meetings, links, sittings, open, themes] = await Promise.all([
    db(
      "team_people?select=id,name,role,department,email,active&active=eq.true&order=name.asc",
    ),
    db(
      "team_meetings?select=id,title,purpose,cadence,department,start_time,minutes,weekdays,cal_event_id,ends_on,tz&active=eq.true&order=title.asc",
    ),
    db("team_meeting_people?select=meeting_id,person_id,part&removed=eq.false"),
    db(
      `team_sittings?select=id,meeting_id,on_date,starts_at,ends_at,status,cal_instance_id&on_date=gte.${addDays(today, -180)}&order=on_date.asc`,
    ),
    db("team_agenda?select=meeting_id&status=eq.open"),
    db(
      "team_meeting_blocks?select=meeting_id,weekday,title,position&weekday=not.is.null&order=position.asc",
    ),
  ]);
  const me = meOf(people, w);
  const live = meetings.filter(
    m => !m.ends_on || String(m.ends_on) >= addDays(today, -1),
  );
  const liveIds = new Set(live.map(m => String(m.id)));
  const byMeeting = new Map<string, SbRow[]>();
  for (const s of sittings) {
    if (!liveIds.has(String(s.meeting_id))) continue;
    byMeeting.set(String(s.meeting_id), [
      ...(byMeeting.get(String(s.meeting_id)) ?? []),
      s,
    ]);
  }
  const weekItems: WeekItem[] = [];
  for (const m of live) {
    const tz = String(m.tz ?? "Asia/Kuwait");
    const mine = (byMeeting.get(String(m.id)) ?? []).filter(
      s => s.on_date >= from && s.on_date <= until,
    );
    const rows: Sitting[] = [
      ...mine.map(s => sittingOf(s, tz)),
      ...virtualSittings(
        m,
        new Set(mine.map(s => String(s.on_date))),
        from,
        14,
      ),
    ];
    for (const s of rows) {
      const theme = themes.find(
        t => t.meeting_id === m.id && Number(t.weekday) === weekdayOf(s.onDate),
      );
      weekItems.push({
        meetingId: String(m.id),
        title: String(m.title),
        theme: theme ? String(theme.title) : null,
        day: s.startsAt ? utcToZoned(s.startsAt, tz).day : s.onDate,
        time: s.time ?? (m.start_time ? hhmm(m.start_time) : null),
        endTime: s.endTime,
        status: s.status,
        onCalendar: s.onCalendar,
      });
    }
  }
  const weeks: WeekDay[][] = [0, 7].map(offset =>
    Array.from({ length: 7 }, (_, i) => {
      const day = addDays(from, offset + i);
      return {
        day,
        items: weekItems
          .filter(x => x.day === day)
          .sort(
            (a, b) =>
              String(a.time ?? "99").localeCompare(String(b.time ?? "99")) ||
              a.title.localeCompare(b.title),
          ),
      };
    }),
  );
  let prizes: Prize[] | null = null;
  if (isBoss(w)) {
    const wheels = await db(
      "team_wheels?select=id,name,meeting_id,kind&kind=eq.prize&order=position.asc",
    );
    const options = wheels.length
      ? await db(
          `team_wheel_options?select=*&wheel_id=in.(${wheels.map(x => `"${x.id}"`).join(",")})&order=position.asc,id.asc`,
        )
      : [];
    const titles = new Map(meetings.map(m => [String(m.id), String(m.title)]));
    prizes = options.map(o => {
      const wheel = wheels.find(x => x.id === o.wheel_id);
      return {
        wheelId: String(o.wheel_id),
        wheelName: String(wheel?.name ?? o.wheel_id),
        meetingId: wheel?.meeting_id ?? null,
        meetingTitle: wheel?.meeting_id
          ? (titles.get(String(wheel.meeting_id)) ?? null)
          : null,
        optionId: Number(o.id),
        label: String(o.label),
        rendered: renderOption({
          label: String(o.label),
          amount:
            o.amount === null || o.amount === undefined
              ? null
              : Number(o.amount),
          currency: o.currency ?? null,
          amount_suffix: o.amount_suffix ?? null,
        }),
        amount:
          o.amount === null || o.amount === undefined ? null : Number(o.amount),
        currency: o.currency ?? null,
        suffix: o.amount_suffix ?? null,
        condition: o.condition ?? null,
        active: o.active !== false,
      };
    });
  }
  return {
    today,
    me: {
      email: w.email,
      personId: me?.id ?? null,
      canCreate: true,
      isBoss: isBoss(w),
    },
    people: people.map(personOf),
    meetings: live.map(m => {
      const mine = links.filter(l => l.meeting_id === m.id);
      const dates = [
        ...(byMeeting.get(String(m.id)) ?? [])
          .filter(s => s.status !== "cancelled")
          .map(s => String(s.on_date)),
        ...virtualSittings(m, new Set(), today, 14).map(s => s.onDate),
      ].sort();
      return {
        id: String(m.id),
        title: String(m.title),
        purpose: m.purpose ?? null,
        cadence: m.cadence ?? null,
        department: m.department ?? null,
        hostIds: mine
          .filter(l => l.part === "host")
          .map(l => String(l.person_id)),
        peopleIds: mine.map(l => String(l.person_id)),
        nextSitting: dates.find(d => d >= today) ?? null,
        lastSitting: dates.filter(d => d < today).pop() ?? null,
        openItems: open.filter(o => o.meeting_id === m.id).length,
        mine: Boolean(me && mine.some(l => l.person_id === me.id)),
        startTime: m.start_time ?? null,
        minutes:
          m.minutes === null || m.minutes === undefined
            ? null
            : Number(m.minutes),
        weekdays: m.weekdays ?? null,
        onCalendar: Boolean(m.cal_event_id),
      };
    }),
    weeks,
    prizes,
    calendarReady: calendarWriteReady(),
  };
}
