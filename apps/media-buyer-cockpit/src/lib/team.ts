import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  addDays,
  blocksFor,
  clean,
  hhmm,
  notPlanned,
  overdue,
  pipelineStrip,
  renderOption,
  slipsAdded,
  utcToZoned,
  weekdayOf,
  weekStart,
  zonedToUtc,
} from "./teamCore";
import {
  cleanDoc,
  cleanLinks,
  DOC_MAX,
  linksOf,
  type MeetingLink,
  PICTURE_BUCKET,
  picturePaths,
  withPictureUrls,
} from "./teamDoc";

export type Person = {
  id: string;
  name: string;
  role: string | null;
  department: string | null;
  email: string | null;
};

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
  tz: string;
  onCalendar: boolean;
};

export type WeekItem = {
  meetingId: string;
  title: string;
  theme: string | null;
  day: string;
  time: string | null;
  endTime: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: "scheduled" | "moved" | "cancelled";
  onCalendar: boolean;
};

export type WeekDay = {
  day: string;
  items: WeekItem[];
};

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
  weeks: WeekDay[][];
  prizes: Prize[] | null;
  calendarReady?: boolean;
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
  time: string | null;
  endTime: string | null;
  status: "scheduled" | "moved" | "cancelled";
  goalHit: boolean | null;
  onCalendar: boolean;
  virtual: boolean;
  minutes?: number | null;
};

export type BlockRow = {
  id: number;
  weekday: number | null;
  position: number;
  minutes: number | null;
  title: string;
  detail: string | null;
};

export type WheelOption = {
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
  options: WheelOption[];
};

export type Spin = {
  id: number;
  wheelId: string;
  sittingId: string | null;
  label: string;
  spunBy?: string;
  by?: string | null;
  forWhom: string | null;
  at: string;
};

export type CreativeRow = {
  id: number;
  client: string;
  angle: string | null;
  kind: string | null;
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

export type Strip = {
  launchedLastWeek: number;
  plannedLastWeek: number;
  launchingThisWeek: number;
  slippedTwice: number;
  slipped: { client: string; angle: string | null; slips: number }[];
};

export type CalendarStatus = {
  state: "off" | "on" | "someone-else";
  ready: boolean;
  syncedAt: string | null;
  error: string | null;
  waiting: number;
  failed: { id: number; op: string; error: string | null; at: string }[];
  organizer: string | null;
  link: string | null;
  parts: {
    calendar: string;
    eventId: string;
    weekday: number | null;
    title: string | null;
    writable: boolean;
    endsOn: string | null;
    startTime: string | null;
    minutes: number | null;
  }[];
};

export type MeetingPage = {
  today: string;
  me: { email: string; personId: string | null; isBoss?: boolean };
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
    embed: "cs-projections" | "cs-daily" | null;
    links: MeetingLink[];
  };
  people: Person[];
  members: { personId: string; part: "host" | "required" | "optional" }[];
  sittings: Sitting[];
  next: Sitting[];
  items: Item[];
  changes: { at: string; by: string; what: string }[];
  blocks: BlockRow[];
  wheels: Wheel[];
  spins: Spin[];
  creative: CreativeRow[] | null;
  strip: Strip | null;
  calendar: CalendarStatus;
};

export type Saved =
  | { ok: true; page: MeetingPage }
  | {
      ok: false;
      conflict: {
        text: string;
        by: string | null;
        at: string | null;
        version: number;
      };
    };

export interface TeamUserContext {
  email: string;
  isCeo: boolean;
  isAdmin: boolean;
}

type DbRow = Record<string, unknown>;

function kuwaitDay(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

const PARTS = ["host", "required", "optional"] as const;

export async function logChange(
  client: SupabaseClient,
  by: string,
  meetingId: string | null,
  what: string,
  detail?: Record<string, unknown>,
) {
  const { error } = await client
    .from("team_changes")
    .insert({
      by_whom: by,
      meeting_id: meetingId,
      what,
      detail: detail ?? null,
    })
    .throwOnError();
  if (error) throw error;
}

async function calendarCommand(
  client: SupabaseClient,
  u: TeamUserContext,
  action: string,
  args: Record<string, unknown>,
): Promise<MeetingPage> {
  const { data, error } = await client.rpc("cockpit_team_calendar_command", {
    p_action: action,
    p_args: args,
  });
  if (error) throw error;
  if (typeof data !== "string")
    throw new Error("The meeting command returned no meeting.");
  return fetchMeetingPage(client, u, data);
}

export async function canManage(
  client: SupabaseClient,
  _u: TeamUserContext,
  meetingId: string,
): Promise<boolean> {
  const { data, error } = await client.rpc("cockpit_team_can_manage", {
    p_meeting_id: meetingId,
  });
  if (error) throw error;
  return Boolean(data);
}

function sittingOfRow(s: DbRow, tz: string): Sitting {
  const startsAt = s.starts_at ? String(s.starts_at) : null;
  const endsAt = s.ends_at ? String(s.ends_at) : null;
  const start = startsAt ? utcToZoned(startsAt, tz) : null;
  const end = endsAt ? utcToZoned(endsAt, tz) : null;
  const rawStatus = String(s.status ?? "scheduled");
  const status = (["scheduled", "moved", "cancelled"] as const).includes(
    rawStatus as "scheduled" | "moved" | "cancelled",
  )
    ? (rawStatus as "scheduled" | "moved" | "cancelled")
    : "scheduled";

  return {
    id: String(s.id),
    onDate: String(s.on_date),
    notes: String(s.notes ?? ""),
    notesBy: s.notes_by ? String(s.notes_by) : null,
    notesAt: s.notes_at ? String(s.notes_at) : null,
    notesVersion: Number(s.notes_version ?? 0),
    startsAt,
    endsAt,
    time: start?.time ?? null,
    endTime: end?.time ?? null,
    status,
    goalHit: typeof s.goal_hit === "boolean" ? s.goal_hit : null,
    onCalendar: Boolean(s.cal_instance_id),
    virtual: false,
  };
}

function virtualSittingsList(
  m: DbRow,
  stored: Set<string>,
  from: string,
  days: number,
): Sitting[] {
  const weekdays = Array.isArray(m.weekdays) ? (m.weekdays as number[]) : [];
  if (!weekdays.length || !m.start_time || m.cal_event_id) return [];
  const tz = String(m.tz ?? "Asia/Kuwait");
  const out: Sitting[] = [];
  const minutes = Number(m.minutes ?? 30);
  for (let i = 0; i < days; i++) {
    const day = addDays(from, i);
    if (!weekdays.includes(weekdayOf(day)) || stored.has(day)) continue;
    const start = zonedToUtc(day, String(m.start_time), tz);
    out.push({
      id: `${String(m.id)}:${day}`,
      onDate: day,
      notes: "",
      notesBy: null,
      notesAt: null,
      notesVersion: 0,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
      time: hhmm(String(m.start_time)),
      endTime: null,
      status: "scheduled",
      goalHit: null,
      onCalendar: false,
      virtual: true,
    });
  }
  return out;
}

export async function fetchTeamOverview(
  client: SupabaseClient,
  u: TeamUserContext,
): Promise<Overview> {
  const today = kuwaitDay();
  const from = weekStart(today);
  const until = addDays(from, 13);

  const [peopleRes, meetingsRes, linksRes, sittingsRes, openRes, themesRes] =
    await Promise.all([
      client
        .from("team_people")
        .select("id, name, role, department, email, active")
        .throwOnError()
        .eq("active", true)
        .order("name", { ascending: true }),
      client
        .from("team_meetings")
        .select(
          "id, title, purpose, cadence, department, start_time, minutes, weekdays, cal_event_id, ends_on, tz, active",
        )
        .throwOnError()
        .eq("active", true)
        .order("title", { ascending: true }),
      client
        .from("team_meeting_people")
        .select("meeting_id, person_id, part, removed")
        .throwOnError()
        .eq("removed", false),
      client
        .from("team_sittings")
        .select(
          "id, meeting_id, on_date, starts_at, ends_at, status, cal_instance_id",
        )
        .throwOnError()
        .gte("on_date", addDays(today, -180))
        .order("on_date", { ascending: true }),
      client
        .from("team_agenda")
        .select("meeting_id")
        .throwOnError()
        .eq("status", "open"),
      client
        .from("team_meeting_blocks")
        .select("meeting_id, weekday, title, position")
        .throwOnError()
        .not("weekday", "is", null)
        .order("position", { ascending: true }),
    ]);

  if (peopleRes.error) throw peopleRes.error;
  if (meetingsRes.error) throw meetingsRes.error;
  if (linksRes.error) throw linksRes.error;
  if (sittingsRes.error) throw sittingsRes.error;
  if (openRes.error) throw openRes.error;

  const people: Person[] = (peopleRes.data ?? []).map(r => ({
    id: String(r.id),
    name: String(r.name ?? r.id),
    role: r.role ? String(r.role) : null,
    department: r.department ? String(r.department) : null,
    email: r.email ? String(r.email) : null,
  }));

  const rawMeetings = meetingsRes.data ?? [];
  const links = linksRes.data ?? [];
  const sittings = sittingsRes.data ?? [];
  const open = openRes.data ?? [];
  const themes = themesRes.data ?? [];

  const me =
    people.find(
      p => String(p.email ?? "").toLowerCase() === u.email.toLowerCase(),
    ) ?? null;

  const live = rawMeetings.filter(
    m => !m.ends_on || String(m.ends_on) >= addDays(today, -1),
  );
  const liveIds = new Set(live.map(m => String(m.id)));

  const byMeeting = new Map<string, DbRow[]>();
  for (const s of sittings) {
    if (!liveIds.has(String(s.meeting_id))) continue;
    const list = byMeeting.get(String(s.meeting_id)) ?? [];
    list.push(s as DbRow);
    byMeeting.set(String(s.meeting_id), list);
  }

  const weekItems: WeekItem[] = [];
  for (const m of live) {
    const tz = String(m.tz ?? "Asia/Kuwait");
    const mine = (byMeeting.get(String(m.id)) ?? []).filter(
      s => String(s.on_date) >= from && String(s.on_date) <= until,
    );
    const rows: Sitting[] = [
      ...mine.map(s => sittingOfRow(s, tz)),
      ...virtualSittingsList(
        m as DbRow,
        new Set(mine.map(s => String(s.on_date))),
        from,
        14,
      ),
    ];
    for (const s of rows) {
      const theme = themes.find(
        t =>
          String(t.meeting_id) === String(m.id) &&
          Number(t.weekday) === weekdayOf(s.onDate),
      );
      weekItems.push({
        meetingId: String(m.id),
        title: String(m.title),
        theme: theme ? String(theme.title) : null,
        day: s.startsAt ? utcToZoned(s.startsAt, tz).day : s.onDate,
        time: s.time ?? (m.start_time ? hhmm(String(m.start_time)) : null),
        endTime: s.endTime,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
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

  const meetings: MeetingSummary[] = live.map(m => {
    const mine = links.filter(l => String(l.meeting_id) === String(m.id));
    const dates = (byMeeting.get(String(m.id)) ?? [])
      .filter(s => s.status !== "cancelled")
      .map(s => String(s.on_date))
      .sort();
    return {
      id: String(m.id),
      title: String(m.title),
      purpose: m.purpose ? String(m.purpose) : null,
      cadence: m.cadence ? String(m.cadence) : null,
      department: m.department ? String(m.department) : null,
      hostIds: mine
        .filter(l => l.part === "host")
        .map(l => String(l.person_id)),
      peopleIds: mine.map(l => String(l.person_id)),
      nextSitting: dates.find(d => d >= today) ?? null,
      lastSitting: dates.filter(d => d < today).pop() ?? null,
      openItems: open.filter(o => String(o.meeting_id) === String(m.id)).length,
      mine: Boolean(me && mine.some(l => String(l.person_id) === me.id)),
      startTime: m.start_time ? String(m.start_time) : null,
      minutes: typeof m.minutes === "number" ? m.minutes : null,
      weekdays: Array.isArray(m.weekdays) ? (m.weekdays as number[]) : null,
      tz: String(m.tz ?? "Asia/Kuwait"),
      onCalendar: Boolean(m.cal_event_id),
    };
  });

  return {
    today,
    me: {
      email: u.email,
      personId: me?.id ?? null,
      canCreate: true,
      isBoss: u.isCeo || u.isAdmin,
    },
    people,
    meetings,
    weeks,
    prizes: null,
  };
}

export async function fetchMeetingPage(
  client: SupabaseClient,
  u: TeamUserContext,
  id: string,
): Promise<MeetingPage> {
  const today = kuwaitDay();
  const [
    meetingRes,
    peopleRes,
    linksRes,
    sittingsRes,
    itemsRes,
    changesRes,
    blocksRes,
    wheelsRes,
    wheelOptionsRes,
    spinsRes,
    creativeRes,
    opsRes,
    seriesRes,
  ] = await Promise.all([
    client
      .from("team_meetings")
      .select("*")
      .throwOnError()
      .eq("id", id)
      .maybeSingle(),
    client
      .from("team_people")
      .select("id, name, role, department, email, active")
      .throwOnError()
      .eq("active", true)
      .order("name", { ascending: true }),
    client
      .from("team_meeting_people")
      .select("person_id, part")
      .throwOnError()
      .eq("meeting_id", id)
      .eq("removed", false),
    client
      .from("team_sittings")
      .select("*")
      .throwOnError()
      .eq("meeting_id", id)
      .gte("on_date", addDays(today, -400))
      .order("on_date", { ascending: false })
      .limit(120),
    client
      .from("team_agenda")
      .select("*")
      .throwOnError()
      .eq("meeting_id", id)
      .or(`status.eq.open,closed_at.gte.${addDays(today, -120)}`)
      .order("position", { ascending: true }),
    client
      .from("team_changes")
      .select("at, by_whom, what")
      .throwOnError()
      .eq("meeting_id", id)
      .order("at", { ascending: false })
      .limit(25),
    client
      .from("team_meeting_blocks")
      .select("*")
      .throwOnError()
      .eq("meeting_id", id)
      .order("position", { ascending: true }),
    client
      .from("team_wheels")
      .select("*")
      .throwOnError()
      .eq("meeting_id", id)
      .order("position", { ascending: true }),
    client
      .from("team_wheel_options")
      .select("*")
      .throwOnError()
      .order("position", { ascending: true }),
    client
      .from("team_wheel_spins")
      .select("*")
      .throwOnError()
      .order("at", { ascending: false })
      .limit(30),
    client
      .from("team_creative_rows")
      .select("*")
      .throwOnError()
      .order("launch_on", { ascending: true })
      .limit(300),
    client
      .from("team_calendar_ops")
      .select("id, op, status, error, at")
      .throwOnError()
      .eq("meeting_id", id)
      .or("status.eq.pending,status.eq.running,status.eq.failed")
      .order("id", { ascending: false })
      .limit(20),
    client
      .from("team_meeting_series")
      .select("*")
      .throwOnError()
      .eq("meeting_id", id)
      .order("weekday", { ascending: true }),
  ]);

  for (const result of [
    meetingRes,
    peopleRes,
    linksRes,
    sittingsRes,
    itemsRes,
    changesRes,
    blocksRes,
    wheelsRes,
    wheelOptionsRes,
    spinsRes,
    creativeRes,
    opsRes,
    seriesRes,
  ]) {
    if (result.error) throw result.error;
  }
  const m = meetingRes.data;
  if (!m) {
    throw new Error(
      "That meeting is not in the list any more. Go back to Team meetings.",
    );
  }

  const people: Person[] = (peopleRes.data ?? []).map(r => ({
    id: String(r.id),
    name: String(r.name ?? r.id),
    role: r.role ? String(r.role) : null,
    department: r.department ? String(r.department) : null,
    email: r.email ? String(r.email) : null,
  }));

  const links = linksRes.data ?? [];
  const rawSittings = sittingsRes.data ?? [];
  const rawItems = itemsRes.data ?? [];
  const rawChanges = changesRes.data ?? [];
  const rawBlocks = blocksRes.data ?? [];
  const rawWheels = wheelsRes.data ?? [];
  const rawOptions = wheelOptionsRes.data ?? [];
  const rawSpins = spinsRes.data ?? [];
  const rawCreative = creativeRes.data ?? [];
  const rawOps = opsRes.data ?? [];
  const rawSeries = seriesRes.data ?? [];

  const tz = String(m.tz ?? "Asia/Kuwait");
  const me =
    people.find(
      p => String(p.email ?? "").toLowerCase() === u.email.toLowerCase(),
    ) ?? null;
  const canManageMeeting = await canManage(client, u, id);

  const sittings: Sitting[] = rawSittings.map(s =>
    sittingOfRow(s as DbRow, tz),
  );
  const nextSittings = sittings
    .filter(s => s.onDate >= today)
    .sort((a, b) => a.onDate.localeCompare(b.onDate))
    .slice(0, 4);

  const pastSittings = sittings.filter(s => s.onDate < today);

  const items: Item[] = rawItems.map(item => {
    let carried = 0;
    if (item.status === "open") {
      const addedDay = String(item.added_at ?? "").slice(0, 10);
      carried = pastSittings.filter(s => s.onDate >= addedDay).length;
    }
    return {
      id: Number(item.id),
      text: String(item.text),
      ownerId: item.owner_id ? String(item.owner_id) : null,
      status: item.status as "open" | "done" | "dropped",
      position: Number(item.position ?? 0),
      sittingId: item.sitting_id ? String(item.sitting_id) : null,
      addedBy: item.added_by ? String(item.added_by) : null,
      addedAt: String(item.added_at),
      closedAt: item.closed_at ? String(item.closed_at) : null,
      closedBy: item.closed_by ? String(item.closed_by) : null,
      carried,
    };
  });

  const blocks: BlockRow[] = rawBlocks.map(b => ({
    id: Number(b.id),
    weekday: typeof b.weekday === "number" ? b.weekday : null,
    position: Number(b.position ?? 0),
    minutes: typeof b.minutes === "number" ? b.minutes : null,
    title: String(b.title),
    detail: b.detail ? String(b.detail) : null,
  }));

  const wheels: Wheel[] = rawWheels.map(w => {
    const opts: WheelOption[] = rawOptions
      .filter(o => String(o.wheel_id) === String(w.id))
      .map(o => ({
        id: Number(o.id),
        label: String(o.label),
        rendered: renderOption({
          label: String(o.label),
          amount: typeof o.amount === "number" ? o.amount : null,
          currency: o.currency ? String(o.currency) : null,
          amount_suffix: o.amount_suffix ? String(o.amount_suffix) : null,
        }),
        amount: typeof o.amount === "number" ? o.amount : null,
        currency: o.currency ? String(o.currency) : null,
        suffix: o.amount_suffix ? String(o.amount_suffix) : null,
        condition: o.condition ? String(o.condition) : null,
        active: o.active !== false,
        position: Number(o.position ?? 0),
      }));
    return {
      id: String(w.id),
      name: String(w.name),
      kind: w.kind as "scenario" | "person" | "prize",
      sourceUrl: w.source_url ? String(w.source_url) : null,
      lockedUntilGoal: Boolean(w.locked_until_goal),
      active: w.active !== false,
      position: Number(w.position ?? 0),
      options: opts,
    };
  });

  const spins: Spin[] = rawSpins.map(sp => ({
    id: Number(sp.id),
    wheelId: String(sp.wheel_id),
    sittingId: sp.sitting_id ? String(sp.sitting_id) : null,
    optionId: typeof sp.option_id === "number" ? sp.option_id : null,
    label: String(sp.result_label),
    spunBy: String(sp.spun_by),
    by: sp.spun_by ? String(sp.spun_by) : null,
    forWhom: sp.spun_for ? String(sp.spun_for) : null,
    at: String(sp.spun_at),
  }));

  const creative: CreativeRow[] = rawCreative.map(cr => {
    const dates = {
      status: String(cr.status),
      script_due: cr.script_due ? String(cr.script_due) : null,
      footage_due: cr.footage_due ? String(cr.footage_due) : null,
      edit_due: cr.edit_due ? String(cr.edit_due) : null,
      launch_on: cr.launch_on ? String(cr.launch_on) : null,
    };
    return {
      id: Number(cr.id),
      client: String(cr.client),
      angle: cr.angle ? String(cr.angle) : null,
      kind: cr.kind ? String(cr.kind) : null,
      source: cr.source ? String(cr.source) : null,
      creativeRequestId: cr.creative_request_id
        ? String(cr.creative_request_id)
        : null,
      scriptDue: dates.script_due,
      footageDue: dates.footage_due,
      editDue: dates.edit_due,
      approvedOn: cr.approved_on ? String(cr.approved_on) : null,
      launchOn: dates.launch_on,
      launchedOn: cr.launched_on ? String(cr.launched_on) : null,
      status: dates.status,
      ownerId: cr.owner_id ? String(cr.owner_id) : null,
      slipCount: Number(cr.slip_count ?? 0),
      notes: cr.notes ? String(cr.notes) : null,
      updatedBy: cr.updated_by ? String(cr.updated_by) : null,
      updatedAt: String(cr.updated_at),
      overdue: overdue(dates, today),
      notPlanned: notPlanned(dates),
    };
  });

  const rawStrip =
    m.pipeline === "strip"
      ? pipelineStrip(
          creative.map(c => ({
            status: c.status,
            script_due: c.scriptDue,
            footage_due: c.footageDue,
            edit_due: c.editDue,
            launch_on: c.launchOn,
            launched_on: c.launchedOn,
            slip_count: c.slipCount,
          })),
          today,
        )
      : null;
  const strip: Strip | null = rawStrip
    ? {
        ...rawStrip,
        slipped: creative
          .filter(c => c.slipCount >= 2)
          .map(c => ({ client: c.client, angle: c.angle, slips: c.slipCount })),
      }
    : null;

  const liveParts = rawSeries.filter(
    s => !s.ends_on || String(s.ends_on) >= today,
  );
  const writable = liveParts.length
    ? liveParts.every(s => s.cal_writable)
    : Boolean(m.cal_writable);
  const { data: workerStatus, error: statusError } = await client.rpc(
    "cockpit_team_calendar_ready",
  );
  if (statusError) throw statusError;
  const paths = picturePaths(String(m.doc ?? ""));
  const pictures = new Map<string, string>();
  if (paths.length) {
    const { data, error } = await client.storage
      .from(PICTURE_BUCKET)
      .createSignedUrls(paths, 7 * 24 * 3600);
    if (error) throw error;
    for (const picture of data ?? [])
      if (picture.path && picture.signedUrl)
        pictures.set(picture.path, picture.signedUrl);
  }
  const calendar: CalendarStatus = {
    state: m.cal_event_id ? (writable ? "on" : "someone-else") : "off",
    ready: Boolean(workerStatus),
    syncedAt: m.cal_synced_at ? String(m.cal_synced_at) : null,
    error: m.cal_error ? String(m.cal_error) : null,
    waiting: rawOps.filter(
      o => o.status === "pending" || o.status === "running",
    ).length,
    failed: rawOps
      .filter(o => o.status === "failed")
      .map(o => ({
        id: Number(o.id),
        op: String(o.op),
        error: o.error ? String(o.error) : null,
        at: String(o.at),
      })),
    organizer: m.cal_calendar ? String(m.cal_calendar) : null,
    link:
      m.cal_event_id && m.cal_calendar
        ? `https://www.google.com/calendar/event?eid=${btoa(`${m.cal_event_id} ${m.cal_calendar}`).replace(/=+$/, "")}`
        : null,
    parts: rawSeries.map(s => ({
      calendar: String(s.cal_calendar ?? ""),
      eventId: String(s.cal_event_id ?? ""),
      weekday: typeof s.weekday === "number" ? s.weekday : null,
      title: s.cal_title ? String(s.cal_title) : null,
      writable: Boolean(s.cal_writable),
      endsOn: s.ends_on ? String(s.ends_on) : null,
      startTime: s.start_time ? String(s.start_time) : null,
      minutes: s.minutes == null ? null : Number(s.minutes),
    })),
  };

  return {
    today,
    me: {
      email: u.email,
      personId: me?.id ?? null,
      isBoss: u.isCeo || u.isAdmin,
    },
    canManage: canManageMeeting,
    meeting: {
      id: String(m.id),
      title: String(m.title),
      purpose: m.purpose ? String(m.purpose) : null,
      cadence: m.cadence ? String(m.cadence) : null,
      department: m.department ? String(m.department) : null,
      fromCalendar: Boolean(m.cal_event_id),
      managed: m.managed ? String(m.managed) : "cockpit",
      doc: withPictureUrls(String(m.doc ?? ""), pictures),
      docBy: m.doc_by ? String(m.doc_by) : null,
      docAt: m.doc_at ? String(m.doc_at) : null,
      docVersion: Number(m.doc_version ?? 0),
      tz,
      startTime: m.start_time ? String(m.start_time) : null,
      minutes: typeof m.minutes === "number" ? m.minutes : null,
      weekdays: Array.isArray(m.weekdays) ? (m.weekdays as number[]) : null,
      rrule: m.rrule ? String(m.rrule) : null,
      endsOn: m.ends_on ? String(m.ends_on) : null,
      meetLink: m.meet_link ? String(m.meet_link) : null,
      pipeline: m.pipeline as "board" | "strip" | null,
      embed:
        m.embed === "cs-projections" || m.embed === "cs-daily" ? m.embed : null,
      links: linksOf(m.links),
    },
    people,
    members: links.map(l => ({
      personId: String(l.person_id),
      part: (PARTS as readonly string[]).includes(l.part as string)
        ? (l.part as "host" | "required" | "optional")
        : "required",
    })),
    sittings,
    next: nextSittings,
    items,
    changes: rawChanges.map(c => ({
      at: String(c.at),
      by: String(c.by_whom),
      what: String(c.what),
    })),
    blocks,
    wheels,
    spins,
    creative: m.pipeline === "board" ? creative : null,
    strip,
    calendar,
  };
}

export async function saveMeeting(
  client: SupabaseClient,
  u: TeamUserContext,
  a: {
    id?: string;
    title: string;
    purpose: string;
    cadence: string;
    department?: string;
    onCalendar?: boolean;
    weekdays?: number[];
    startTime?: string;
    minutes?: number;
    firstDate?: string;
  },
): Promise<MeetingPage> {
  return calendarCommand(client, u, "saveMeeting", a);
}

export async function setPart(
  client: SupabaseClient,
  u: TeamUserContext,
  a: {
    meetingId: string;
    personId?: string;
    part: "host" | "required" | "optional" | "off";
  },
): Promise<MeetingPage> {
  return calendarCommand(client, u, "setPart", a);
}

export async function addSitting(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { meetingId: string; date: string; startTime?: string; minutes?: number },
): Promise<MeetingPage> {
  return calendarCommand(client, u, "addSitting", a);
}

export async function saveDoc(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { meetingId: string; text: string; version: number },
): Promise<Saved> {
  const text = cleanDoc(String(a.text).slice(0, DOC_MAX));
  const version = Math.trunc(a.version);
  const { data: done, error } = await client
    .from("team_meetings")
    .update({
      doc: text,
      doc_by: u.email,
      doc_at: new Date().toISOString(),
      doc_version: version + 1,
    })
    .throwOnError()
    .eq("id", a.meetingId)
    .eq("doc_version", version)
    .select("doc_version")
    .throwOnError();
  if (error) throw error;

  if (!done || done.length === 0) {
    const { data: now } = await client
      .from("team_meetings")
      .select("doc, doc_by, doc_at, doc_version")
      .throwOnError()
      .eq("id", a.meetingId)
      .maybeSingle();
    if (!now) throw new Error("That meeting is not in the list any more.");
    return {
      ok: false,
      conflict: {
        text: String(now.doc ?? ""),
        by: now.doc_by ? String(now.doc_by) : null,
        at: now.doc_at ? String(now.doc_at) : null,
        version: Number(now.doc_version ?? 0),
      },
    };
  }

  await logChange(client, u.email, a.meetingId, "edited the doc", {
    version: version + 1,
    length: text.length,
  });
  const p = await fetchMeetingPage(client, u, a.meetingId);
  return { ok: true, page: p };
}

export async function saveLinks(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { meetingId: string; links: MeetingLink[] },
): Promise<MeetingPage> {
  const links = cleanLinks(a.links);
  const { error } = await client
    .from("team_meetings")
    .update({ links })
    .throwOnError()
    .eq("id", a.meetingId);
  if (error) throw error;
  return fetchMeetingPage(client, u, a.meetingId);
}

export async function saveNotes(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { sittingId: string; text: string; version: number },
): Promise<Saved> {
  const { error: ensureError } = await client.rpc(
    "cockpit_team_ensure_sitting",
    {
      p_meeting_id: a.sittingId.slice(0, -11),
      p_sitting_id: a.sittingId,
    },
  );
  if (ensureError) throw ensureError;
  const { data: sitting } = await client
    .from("team_sittings")
    .select("id, meeting_id, on_date")
    .throwOnError()
    .eq("id", a.sittingId)
    .maybeSingle();
  if (!sitting)
    throw new Error("That meeting date is not in the list any more.");

  const text = String(a.text).slice(0, 30_000);
  const version = Math.trunc(a.version);
  const { data: done, error } = await client
    .from("team_sittings")
    .update({
      notes: text,
      notes_by: u.email,
      notes_at: new Date().toISOString(),
      notes_version: version + 1,
    })
    .throwOnError()
    .eq("id", a.sittingId)
    .eq("notes_version", version)
    .select("notes_version")
    .throwOnError();
  if (error) throw error;

  if (!done || done.length === 0) {
    const { data: now } = await client
      .from("team_sittings")
      .select("notes, notes_by, notes_at, notes_version")
      .throwOnError()
      .eq("id", a.sittingId)
      .maybeSingle();
    return {
      ok: false,
      conflict: {
        text: String(now?.notes ?? ""),
        by: now?.notes_by ? String(now.notes_by) : null,
        at: now?.notes_at ? String(now.notes_at) : null,
        version: Number(now?.notes_version ?? 0),
      },
    };
  }

  await logChange(
    client,
    u.email,
    String(sitting.meeting_id),
    `wrote the notes for ${sitting.on_date}`,
  );
  const p = await fetchMeetingPage(client, u, String(sitting.meeting_id));
  return { ok: true, page: p };
}

export async function addItem(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { meetingId: string; text: string; ownerId?: string },
): Promise<MeetingPage> {
  const text = clean(a.text, 500);
  if (text.length < 3) throw new Error("Write the agenda item first.");

  const { data: meeting } = await client
    .from("team_meetings")
    .select("id")
    .throwOnError()
    .eq("id", a.meetingId)
    .maybeSingle();
  if (!meeting) throw new Error("That meeting is not in the list any more.");

  const { data: last } = await client
    .from("team_agenda")
    .select("position")
    .throwOnError()
    .eq("meeting_id", a.meetingId)
    .eq("status", "open")
    .order("position", { ascending: false })
    .limit(1);

  const { error } = await client
    .from("team_agenda")
    .insert({
      meeting_id: a.meetingId,
      text,
      owner_id: a.ownerId || null,
      status: "open",
      position: Number(last?.[0]?.position ?? 0) + 1,
      added_by: u.email,
    })
    .throwOnError();
  if (error) throw error;

  await logChange(client, u.email, a.meetingId, `added "${text.slice(0, 80)}"`);
  return fetchMeetingPage(client, u, a.meetingId);
}

export async function editItem(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { id: number; text?: string; ownerId?: string | null },
): Promise<MeetingPage> {
  const { data: item } = await client
    .from("team_agenda")
    .select("*")
    .throwOnError()
    .eq("id", Math.trunc(a.id))
    .maybeSingle();
  if (!item) throw new Error("That agenda item is not there any more.");

  const body: Record<string, unknown> = {};
  if (a.text !== undefined) {
    const text = clean(a.text, 500);
    if (text.length < 3) throw new Error("An agenda item needs words.");
    body.text = text;
  }
  if (a.ownerId !== undefined) body.owner_id = a.ownerId || null;
  if (!Object.keys(body).length)
    return fetchMeetingPage(client, u, String(item.meeting_id));

  await client
    .from("team_agenda")
    .update(body)
    .throwOnError()
    .eq("id", Math.trunc(a.id));

  await logChange(
    client,
    u.email,
    String(item.meeting_id),
    body.text !== undefined
      ? `reworded "${String(item.text).slice(0, 60)}"`
      : `gave "${String(item.text).slice(0, 60)}" ${body.owner_id ? "an owner" : "no owner"}`,
  );
  return fetchMeetingPage(client, u, String(item.meeting_id));
}

export async function closeItem(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { id: number; status: "done" | "dropped" | "open" },
): Promise<MeetingPage> {
  const { data: item } = await client
    .from("team_agenda")
    .select("*")
    .throwOnError()
    .eq("id", Math.trunc(a.id))
    .maybeSingle();
  if (!item) throw new Error("That agenda item is not there any more.");
  const meetingId = String(item.meeting_id);

  if (a.status === "open") {
    await client
      .from("team_agenda")
      .update({
        status: "open",
        sitting_id: null,
        closed_at: null,
        closed_by: null,
      })
      .throwOnError()
      .eq("id", Math.trunc(a.id));

    await logChange(
      client,
      u.email,
      meetingId,
      `reopened "${String(item.text).slice(0, 60)}"`,
    );
    return fetchMeetingPage(client, u, meetingId);
  }

  const today = kuwaitDay();
  const { data: at } = await client
    .from("team_sittings")
    .select("id")
    .throwOnError()
    .eq("meeting_id", meetingId)
    .lte("on_date", today)
    .order("on_date", { ascending: false })
    .limit(1);

  await client
    .from("team_agenda")
    .update({
      status: a.status,
      sitting_id: at?.[0]?.id ?? null,
      closed_at: new Date().toISOString(),
      closed_by: u.email,
    })
    .throwOnError()
    .eq("id", Math.trunc(a.id));

  await logChange(
    client,
    u.email,
    meetingId,
    `${a.status === "done" ? "finished" : "dropped"} "${String(item.text).slice(0, 60)}"`,
  );
  return fetchMeetingPage(client, u, meetingId);
}

export async function moveItem(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { id: number; dir: "up" | "down" },
): Promise<MeetingPage> {
  const { data: item } = await client
    .from("team_agenda")
    .select("*")
    .throwOnError()
    .eq("id", Math.trunc(a.id))
    .maybeSingle();
  if (!item) throw new Error("That agenda item is not there any more.");
  const meetingId = String(item.meeting_id);

  const { data: open } = await client
    .from("team_agenda")
    .select("id, position")
    .throwOnError()
    .eq("meeting_id", meetingId)
    .eq("status", "open")
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (!open) return fetchMeetingPage(client, u, meetingId);
  const at = open.findIndex(o => Number(o.id) === Math.trunc(a.id));
  const to = a.dir === "up" ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= open.length)
    return fetchMeetingPage(client, u, meetingId);

  const order = open.map(o => Number(o.id));
  [order[at], order[to]] = [order[to], order[at]];

  for (let i = 0; i < order.length; i++) {
    await client
      .from("team_agenda")
      .update({ position: i + 1 })
      .throwOnError()
      .eq("id", order[i]);
  }
  return fetchMeetingPage(client, u, meetingId);
}

// --- Run of Show (Blocks) ---

export async function saveBlock(
  client: SupabaseClient,
  u: TeamUserContext,
  a: {
    meetingId: string;
    id?: number;
    weekday?: number | null;
    minutes?: number | null;
    title: string;
    detail?: string | null;
  },
): Promise<MeetingPage> {
  const title = clean(a.title, 200);
  if (!title) throw new Error("Give the block a title.");
  const detail = a.detail !== undefined ? clean(a.detail, 1000) || null : null;
  const minutes = typeof a.minutes === "number" ? Math.trunc(a.minutes) : null;
  if (typeof minutes === "number" && (minutes < 0 || minutes > 480))
    throw new Error("A block runs between 0 and 480 minutes.");
  const weekday =
    typeof a.weekday === "number" && a.weekday >= 0 && a.weekday <= 6
      ? a.weekday
      : null;
  const now = new Date().toISOString();

  if (a.id !== undefined) {
    const { data: b } = await client
      .from("team_meeting_blocks")
      .select("*")
      .throwOnError()
      .eq("id", a.id)
      .maybeSingle();
    if (!b) throw new Error("That block is not there any more.");
    if (String(b.meeting_id) !== a.meetingId)
      throw new Error("That block belongs to another meeting.");

    await client
      .from("team_meeting_blocks")
      .update({
        title,
        ...(detail !== undefined ? { detail } : {}),
        ...(minutes !== undefined ? { minutes } : {}),
        ...(weekday !== undefined ? { weekday } : {}),
        updated_by: u.email,
        updated_at: now,
      })
      .throwOnError()
      .eq("id", a.id);

    await logChange(
      client,
      u.email,
      a.meetingId,
      `changed "${title.slice(0, 60)}" in the run of show`,
      { before: b },
    );
    return fetchMeetingPage(client, u, a.meetingId);
  }

  const { data: last } = await client
    .from("team_meeting_blocks")
    .select("position")
    .throwOnError()
    .eq("meeting_id", a.meetingId)
    .order("position", { ascending: false })
    .limit(1);

  await client
    .from("team_meeting_blocks")
    .insert({
      meeting_id: a.meetingId,
      weekday,
      position: Number(last?.[0]?.position ?? 0) + 1,
      minutes,
      title,
      detail,
      updated_by: u.email,
      updated_at: now,
    })
    .throwOnError();

  await logChange(
    client,
    u.email,
    a.meetingId,
    `added "${title.slice(0, 60)}" to the run of show`,
  );
  return fetchMeetingPage(client, u, a.meetingId);
}

export async function deleteBlock(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { id: number },
): Promise<MeetingPage> {
  const { data: b } = await client
    .from("team_meeting_blocks")
    .select("*")
    .throwOnError()
    .eq("id", a.id)
    .maybeSingle();
  if (!b) throw new Error("That block is not there any more.");
  const meetingId = String(b.meeting_id);

  await client
    .from("team_meeting_blocks")
    .delete()
    .throwOnError()
    .eq("id", a.id);

  await logChange(
    client,
    u.email,
    meetingId,
    `took "${String(b.title).slice(0, 60)}" out of the run of show`,
    { block: b },
  );
  return fetchMeetingPage(client, u, meetingId);
}

export async function moveBlock(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { id: number; dir: "up" | "down"; weekday?: number | null },
): Promise<MeetingPage> {
  const { data: b } = await client
    .from("team_meeting_blocks")
    .select("*")
    .throwOnError()
    .eq("id", a.id)
    .maybeSingle();
  if (!b) throw new Error("That block is not there any more.");
  const meetingId = String(b.meeting_id);

  const { data: all } = await client
    .from("team_meeting_blocks")
    .select("id, weekday, position")
    .throwOnError()
    .eq("meeting_id", meetingId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (!all) return fetchMeetingPage(client, u, meetingId);
  const blockList = all.map(x => ({
    id: Number(x.id),
    weekday: typeof x.weekday === "number" ? x.weekday : null,
    position: Number(x.position ?? 0),
    minutes: null,
    title: "",
    detail: null,
  }));

  const shown = blocksFor(blockList, a.weekday ?? null);
  const at = shown.findIndex(x => x.id === Math.trunc(a.id));
  const to = a.dir === "up" ? at - 1 : at + 1;
  if (at >= 0 && to >= 0 && to < shown.length) {
    const swapWith = shown[to];
    const itemA = all.find(x => Number(x.id) === a.id);
    const itemB = all.find(x => Number(x.id) === swapWith.id);
    if (itemA && itemB) {
      await client
        .from("team_meeting_blocks")
        .update({ position: itemB.position })
        .throwOnError()
        .eq("id", itemA.id);
      await client
        .from("team_meeting_blocks")
        .update({ position: itemA.position })
        .throwOnError()
        .eq("id", itemB.id);
    }
  }

  return fetchMeetingPage(client, u, meetingId);
}

// --- Wheels & Spins ---

export async function saveWheel(
  client: SupabaseClient,
  u: TeamUserContext,
  a: {
    meetingId: string;
    id?: string;
    name: string;
    kind?: "scenario" | "person" | "prize";
    lockedUntilGoal?: boolean;
    active?: boolean;
    sourceUrl?: string | null;
  },
): Promise<MeetingPage> {
  const name = clean(a.name, 80);
  if (name.length < 2) throw new Error("Give the wheel a name.");
  const sourceUrl = a.sourceUrl ? clean(a.sourceUrl, 300) : null;
  if (sourceUrl && !/^https:\/\//.test(sourceUrl))
    throw new Error("A source link starts with https://.");
  const stamp = {
    updated_by: u.email,
    updated_at: new Date().toISOString(),
  };

  if (a.id) {
    const { data: wheel } = await client
      .from("team_wheels")
      .select("*")
      .throwOnError()
      .eq("id", a.id)
      .maybeSingle();
    if (!wheel) throw new Error("That wheel is not there any more.");
    if (wheel.kind === "prize" && !u.isCeo && !u.isAdmin)
      throw new Error("Only the CEO and admins change prize wheels.");

    await client
      .from("team_wheels")
      .update({
        name,
        ...(a.lockedUntilGoal !== undefined && wheel.kind === "prize"
          ? { locked_until_goal: a.lockedUntilGoal }
          : {}),
        ...(a.active !== undefined ? { active: a.active } : {}),
        ...(sourceUrl !== undefined ? { source_url: sourceUrl } : {}),
        ...stamp,
      })
      .throwOnError()
      .eq("id", a.id);

    await logChange(
      client,
      u.email,
      String(wheel.meeting_id ?? a.meetingId),
      `changed the ${name} wheel`,
      { before: wheel },
    );
    return fetchMeetingPage(client, u, String(wheel.meeting_id ?? a.meetingId));
  }

  const kind = a.kind ?? "scenario";
  if (kind === "prize" && !u.isCeo && !u.isAdmin)
    throw new Error("Only the CEO and admins add prize wheels.");

  const base = slug(`${a.meetingId}-${name}`) || "wheel";
  const { data: existing } = await client
    .from("team_wheels")
    .select("id")
    .throwOnError()
    .like("id", `${base}%`);
  const taken = new Set((existing ?? []).map(r => String(r.id)));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;

  const { data: last } = await client
    .from("team_wheels")
    .select("position")
    .throwOnError()
    .eq("meeting_id", a.meetingId)
    .order("position", { ascending: false })
    .limit(1);

  await client
    .from("team_wheels")
    .insert({
      id,
      meeting_id: a.meetingId,
      name,
      kind,
      source_url: sourceUrl ?? null,
      locked_until_goal: kind === "prize" ? (a.lockedUntilGoal ?? true) : false,
      active: true,
      position: Number(last?.[0]?.position ?? 0) + 1,
      ...stamp,
    })
    .throwOnError();

  await logChange(client, u.email, a.meetingId, `added the ${name} wheel`, {
    wheel: id,
    kind,
  });
  return fetchMeetingPage(client, u, a.meetingId);
}

export async function deleteWheel(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { id: string },
): Promise<MeetingPage> {
  const { data: wheel } = await client
    .from("team_wheels")
    .select("*")
    .throwOnError()
    .eq("id", a.id)
    .maybeSingle();
  if (!wheel) throw new Error("That wheel is not there any more.");
  if (wheel.kind === "prize" && !u.isCeo && !u.isAdmin)
    throw new Error("Only the CEO and admins delete prize wheels.");

  await client.from("team_wheels").delete().throwOnError().eq("id", a.id);
  await logChange(
    client,
    u.email,
    wheel.meeting_id ? String(wheel.meeting_id) : null,
    `deleted the ${wheel.name} wheel`,
    { wheel },
  );
  return fetchMeetingPage(client, u, String(wheel.meeting_id ?? ""));
}

export async function saveWheelOption(
  client: SupabaseClient,
  u: TeamUserContext,
  a: {
    wheelId: string;
    id?: number;
    label: string;
    condition?: string | null;
    amount?: number | null;
    currency?: string | null;
    suffix?: string | null;
    active?: boolean;
  },
): Promise<MeetingPage> {
  const { data: wheel } = await client
    .from("team_wheels")
    .select("*")
    .throwOnError()
    .eq("id", a.wheelId)
    .maybeSingle();
  if (!wheel) throw new Error("That wheel is not there any more.");
  if (wheel.kind === "prize" && !u.isCeo && !u.isAdmin)
    throw new Error("Only the CEO and admins change prize options.");

  const label = clean(a.label, 200);
  if (!label) throw new Error("An option needs words.");

  const body: Record<string, unknown> = {
    label,
    ...(a.condition !== undefined
      ? { condition: a.condition ? clean(a.condition, 200) : null }
      : {}),
    ...(a.amount !== undefined
      ? { amount: a.amount === null ? null : Math.round(a.amount * 100) / 100 }
      : {}),
    ...(a.currency !== undefined
      ? { currency: a.currency ? clean(a.currency, 8).toUpperCase() : null }
      : {}),
    ...(a.suffix !== undefined
      ? { amount_suffix: a.suffix ? clean(a.suffix, 8) : null }
      : {}),
    ...(a.active !== undefined ? { active: a.active } : {}),
    updated_by: u.email,
    updated_at: new Date().toISOString(),
  };

  const meetingId = String(wheel.meeting_id ?? "");
  if (a.id !== undefined) {
    await client
      .from("team_wheel_options")
      .update(body)
      .throwOnError()
      .eq("id", Math.trunc(a.id));
    await logChange(
      client,
      u.email,
      meetingId || null,
      `changed "${label}" on the ${wheel.name} wheel`,
    );
  } else {
    const { data: last } = await client
      .from("team_wheel_options")
      .select("position")
      .throwOnError()
      .eq("wheel_id", a.wheelId)
      .order("position", { ascending: false })
      .limit(1);

    await client
      .from("team_wheel_options")
      .insert({
        wheel_id: a.wheelId,
        active: true,
        position: Number(last?.[0]?.position ?? 0) + 1,
        ...body,
      })
      .throwOnError();
    await logChange(
      client,
      u.email,
      meetingId || null,
      `added "${label}" to the ${wheel.name} wheel`,
    );
  }

  return fetchMeetingPage(client, u, meetingId);
}

export async function deleteWheelOption(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { id: number },
): Promise<MeetingPage> {
  const { data: option } = await client
    .from("team_wheel_options")
    .select("*")
    .throwOnError()
    .eq("id", Math.trunc(a.id))
    .maybeSingle();
  if (!option) throw new Error("That option is not there any more.");
  const { data: wheel } = await client
    .from("team_wheels")
    .select("*")
    .throwOnError()
    .eq("id", option.wheel_id)
    .maybeSingle();
  if (wheel?.kind === "prize" && !u.isCeo && !u.isAdmin)
    throw new Error("Only the CEO and admins delete prize options.");

  await client
    .from("team_wheel_options")
    .delete()
    .throwOnError()
    .eq("id", Math.trunc(a.id));
  await logChange(
    client,
    u.email,
    wheel?.meeting_id ? String(wheel.meeting_id) : null,
    `took "${option.label}" off the ${wheel?.name ?? "wheel"}`,
    { option },
  );
  return fetchMeetingPage(client, u, String(wheel?.meeting_id ?? ""));
}

export async function moveWheelOption(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { id: number; dir: "up" | "down" },
): Promise<MeetingPage> {
  const { data: option } = await client
    .from("team_wheel_options")
    .select("*")
    .throwOnError()
    .eq("id", Math.trunc(a.id))
    .maybeSingle();
  if (!option) throw new Error("That option is not there any more.");
  const { data: rows } = await client
    .from("team_wheel_options")
    .select("id, position")
    .throwOnError()
    .eq("wheel_id", option.wheel_id)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (rows) {
    const at = rows.findIndex(r => Number(r.id) === Math.trunc(a.id));
    const to = a.dir === "up" ? at - 1 : at + 1;
    if (at >= 0 && to >= 0 && to < rows.length) {
      const order = rows.map(r => Number(r.id));
      [order[at], order[to]] = [order[to], order[at]];
      for (let i = 0; i < order.length; i++) {
        await client
          .from("team_wheel_options")
          .update({ position: i + 1 })
          .throwOnError()
          .eq("id", order[i]);
      }
    }
  }
  const { data: wheel } = await client
    .from("team_wheels")
    .select("meeting_id")
    .throwOnError()
    .eq("id", option.wheel_id)
    .maybeSingle();
  return fetchMeetingPage(client, u, String(wheel?.meeting_id ?? ""));
}

export async function setPrizeAmount(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { optionId: number; amount: number; meetingId?: string },
): Promise<MeetingPage | Overview> {
  if (!u.isCeo && !u.isAdmin)
    throw new Error("Only the CEO and admins set prize amounts.");

  const amount = Math.round(a.amount * 100) / 100;
  await client
    .from("team_wheel_options")
    .update({
      amount,
      updated_by: u.email,
      updated_at: new Date().toISOString(),
    })
    .throwOnError()
    .eq("id", Math.trunc(a.optionId));

  if (a.meetingId) return fetchMeetingPage(client, u, a.meetingId);
  return fetchTeamOverview(client, u);
}

export async function spin(
  client: SupabaseClient,
  u: TeamUserContext,
  a: {
    wheelId: string;
    sittingId: string;
    among?: string[];
    forPerson?: string;
  },
): Promise<{
  page: MeetingPage;
  result: { wheelId: string; index: number; label: string; choices: string[] };
}> {
  const { data, error } = await client.rpc("cockpit_team_spin", {
    p_wheel_id: a.wheelId,
    p_sitting_id: a.sittingId,
    p_among: a.among ?? null,
    p_for_person: a.forPerson ?? null,
  });
  if (error) throw error;
  const draw = z
    .object({
      meetingId: z.string(),
      result: z.object({
        wheelId: z.string(),
        index: z.number().int().nonnegative(),
        label: z.string(),
        choices: z.array(z.string()),
      }),
    })
    .parse(data);
  return {
    page: await fetchMeetingPage(client, u, draw.meetingId),
    result: draw.result,
  };
}

export async function setGoalHit(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { sittingId: string; hit: boolean | null },
): Promise<MeetingPage> {
  return calendarCommand(client, u, "setGoalHit", a);
}

// --- Creative Pipeline ---

export async function saveCreativeRow(
  client: SupabaseClient,
  u: TeamUserContext,
  a: {
    meetingId: string;
    id?: number;
    client: string;
    angle?: string | null;
    kind?: string | null;
    source?: string | null;
    creativeRequestId?: string | null;
    scriptDue?: string | null;
    footageDue?: string | null;
    editDue?: string | null;
    approvedOn?: string | null;
    launchOn?: string | null;
    launchedOn?: string | null;
    status?: string;
    ownerId?: string | null;
    notes?: string | null;
  },
): Promise<MeetingPage> {
  const clientName = clean(a.client, 120);
  if (!clientName) throw new Error("Name the client the video is for.");
  const today = kuwaitDay();

  const body: Record<string, unknown> = {
    client: clientName,
    ...(a.angle !== undefined
      ? { angle: a.angle ? clean(a.angle, 200) : null }
      : {}),
    ...(a.kind !== undefined ? { kind: a.kind || null } : {}),
    ...(a.source !== undefined ? { source: a.source || null } : {}),
    ...(a.creativeRequestId !== undefined
      ? { creative_request_id: a.creativeRequestId || null }
      : {}),
    ...(a.scriptDue !== undefined ? { script_due: a.scriptDue || null } : {}),
    ...(a.footageDue !== undefined
      ? { footage_due: a.footageDue || null }
      : {}),
    ...(a.editDue !== undefined ? { edit_due: a.editDue || null } : {}),
    ...(a.approvedOn !== undefined
      ? { approved_on: a.approvedOn || null }
      : {}),
    ...(a.launchOn !== undefined ? { launch_on: a.launchOn || null } : {}),
    ...(a.launchedOn !== undefined
      ? { launched_on: a.launchedOn || null }
      : {}),
    ...(a.status !== undefined ? { status: a.status } : {}),
    ...(a.ownerId !== undefined ? { owner_id: a.ownerId || null } : {}),
    ...(a.notes !== undefined
      ? { notes: a.notes ? clean(a.notes, 2000) : null }
      : {}),
    updated_by: u.email,
    updated_at: new Date().toISOString(),
  };

  if (body.status === "launched" && body.launched_on === undefined)
    body.launched_on = today;
  if (body.status === "approved" && body.approved_on === undefined)
    body.approved_on = today;

  if (a.id !== undefined) {
    const { data: before } = await client
      .from("team_creative_rows")
      .select("*")
      .throwOnError()
      .eq("id", Math.trunc(a.id))
      .maybeSingle();
    if (!before) throw new Error("That row is not on the pipeline any more.");

    const slips = slipsAdded(
      before as never,
      { ...before, ...body } as never,
      today,
    );
    if (slips) body.slip_count = Number(before.slip_count ?? 0) + slips;

    await client
      .from("team_creative_rows")
      .update(body)
      .throwOnError()
      .eq("id", Math.trunc(a.id));

    await logChange(
      client,
      u.email,
      a.meetingId,
      slips
        ? `moved a passed date on ${clientName}'s video: slip ${body.slip_count}`
        : `updated ${clientName}'s video on the pipeline`,
      { before, after: body },
    );
    return fetchMeetingPage(client, u, a.meetingId);
  }

  await client
    .from("team_creative_rows")
    .insert({
      ...body,
      status: body.status ?? "planned",
      created_by: u.email,
    })
    .throwOnError();

  await logChange(
    client,
    u.email,
    a.meetingId,
    `added a ${body.kind ?? "new"} video for ${clientName} to the pipeline`,
  );
  return fetchMeetingPage(client, u, a.meetingId);
}

export async function deleteCreativeRow(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { meetingId: string; id: number },
): Promise<MeetingPage> {
  const { data: row } = await client
    .from("team_creative_rows")
    .select("*")
    .throwOnError()
    .eq("id", Math.trunc(a.id))
    .maybeSingle();
  if (!row) throw new Error("That row is not on the pipeline any more.");

  await client
    .from("team_creative_rows")
    .delete()
    .throwOnError()
    .eq("id", Math.trunc(a.id));

  await logChange(
    client,
    u.email,
    a.meetingId,
    `took ${row.client}'s video off the pipeline`,
    { row },
  );
  return fetchMeetingPage(client, u, a.meetingId);
}

export async function openCreativeRequests(
  client: SupabaseClient,
  _u: TeamUserContext,
): Promise<
  Array<{
    id: string;
    client: string;
    campaign: string | null;
    reason: string | null;
    note: string | null;
    status: string;
    createdAt: string;
  }>
> {
  const [requestsRes, rowsRes] = await Promise.all([
    client
      .from("cockpit_creative_requests")
      .select(
        "id, client_name, campaign_name, request_reason, note, status, created_at",
      )
      .throwOnError()
      .in("status", ["requested", "script_ready", "editing", "asset_ready"])
      .order("created_at", { ascending: false })
      .limit(60),
    client
      .from("team_creative_rows")
      .select("creative_request_id")
      .throwOnError()
      .not("creative_request_id", "is", null),
  ]);

  const onBoard = new Set(
    (rowsRes.data ?? []).map(r => String(r.creative_request_id)),
  );
  return (requestsRes.data ?? [])
    .filter(r => !onBoard.has(String(r.id)))
    .map(r => ({
      id: String(r.id),
      client: String(r.client_name ?? r.campaign_name ?? "Client"),
      campaign: r.campaign_name ? String(r.campaign_name) : null,
      reason: r.request_reason ? String(r.request_reason) : null,
      note: r.note ? String(r.note) : null,
      status: String(r.status),
      createdAt: String(r.created_at).slice(0, 10),
    }));
}

// --- Calendar / Attendance Operations ---

export async function setSeries(
  client: SupabaseClient,
  u: TeamUserContext,
  a: {
    meetingId: string;
    weekdays: number[];
    startTime: string;
    minutes: number;
    from: string;
  },
): Promise<MeetingPage> {
  return calendarCommand(client, u, "setSeries", a);
}

export async function moveSitting(
  client: SupabaseClient,
  u: TeamUserContext,
  a: {
    meetingId: string;
    sittingId: string;
    day: string;
    startTime: string;
    minutes: number;
  },
): Promise<MeetingPage> {
  return calendarCommand(client, u, "moveSitting", a);
}

export async function cancelSitting(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { meetingId: string; sittingId: string },
): Promise<MeetingPage> {
  return calendarCommand(client, u, "cancelSitting", a);
}

export async function endMeeting(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { meetingId: string; lastDate: string },
): Promise<MeetingPage> {
  return calendarCommand(client, u, "endMeeting", a);
}

export async function setEmail(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { meetingId: string; personId: string; email: string },
): Promise<MeetingPage> {
  return calendarCommand(client, u, "setEmail", a);
}

export async function putOnCalendar(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { meetingId: string; from?: string },
): Promise<MeetingPage> {
  return calendarCommand(client, u, "putOnCalendar", a);
}

export async function takeOver(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { meetingId: string },
): Promise<MeetingPage> {
  return calendarCommand(client, u, "takeOver", a);
}

export async function retryCalendar(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { meetingId: string },
): Promise<MeetingPage> {
  return calendarCommand(client, u, "retryCalendar", a);
}
