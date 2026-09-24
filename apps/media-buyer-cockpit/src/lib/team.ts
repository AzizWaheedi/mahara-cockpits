import type { SupabaseClient } from "@supabase/supabase-js";

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
};

export type Overview = {
  today: string;
  me: { email: string; personId: string | null; canCreate: boolean };
  people: Person[];
  meetings: MeetingSummary[];
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
};

export type MeetingPage = {
  today: string;
  me: { email: string; personId: string | null };
  canManage: boolean;
  meeting: {
    id: string;
    title: string;
    purpose: string | null;
    cadence: string | null;
    department: string | null;
    fromCalendar: boolean;
    doc: string;
    docBy: string | null;
    docAt: string | null;
    docVersion: number;
  };
  people: Person[];
  members: { personId: string; part: "host" | "required" | "optional" }[];
  sittings: Sitting[];
  items: Item[];
  changes: { at: string; by: string; what: string }[];
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

function kuwaitDay(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function clean(s: unknown, max: number): string {
  return String(s ?? "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

const CADENCES = [
  "weekly",
  "every two weeks",
  "monthly",
  "quarterly",
  "as needed",
] as const;

const PARTS = ["host", "required", "optional"] as const;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

async function logChange(
  client: SupabaseClient,
  by: string,
  meetingId: string | null,
  what: string,
  detail?: Record<string, unknown>,
) {
  try {
    await client.from("team_changes").insert({
      by_whom: by,
      meeting_id: meetingId,
      what,
      detail: detail ?? null,
    });
  } catch (e) {
    console.error("Failed to log team change:", e);
  }
}

async function canManage(
  client: SupabaseClient,
  u: TeamUserContext,
  meetingId: string,
): Promise<boolean> {
  if (u.isCeo || u.isAdmin) return true;
  const { data: people } = await client
    .from("team_people")
    .select("id, email")
    .ilike("email", u.email)
    .limit(1);
  const me = people?.[0];
  if (!me) return false;
  const { data: rows } = await client
    .from("team_meeting_people")
    .select("part")
    .eq("meeting_id", meetingId)
    .eq("person_id", me.id)
    .eq("removed", false);
  return (rows ?? []).some(r => r.part === "host");
}

export async function fetchTeamOverview(
  client: SupabaseClient,
  u: TeamUserContext,
): Promise<Overview> {
  const today = kuwaitDay();
  const [peopleRes, meetingsRes, linksRes, sittingsRes, openRes] =
    await Promise.all([
      client
        .from("team_people")
        .select("id, name, role, department, email, active")
        .eq("active", true)
        .order("name", { ascending: true }),
      client
        .from("team_meetings")
        .select("id, title, purpose, cadence, department, active")
        .eq("active", true)
        .order("title", { ascending: true }),
      client
        .from("team_meeting_people")
        .select("meeting_id, person_id, part, removed")
        .eq("removed", false),
      client
        .from("team_sittings")
        .select("meeting_id, on_date")
        .gte("on_date", addDays(today, -180))
        .order("on_date", { ascending: true }),
      client.from("team_agenda").select("meeting_id").eq("status", "open"),
    ]);

  if (peopleRes.error) throw peopleRes.error;
  if (meetingsRes.error) throw meetingsRes.error;
  if (linksRes.error) throw linksRes.error;
  if (sittingsRes.error) throw sittingsRes.error;
  if (openRes.error) throw openRes.error;

  const people: Person[] = (peopleRes.data ?? []).map(r => ({
    id: String(r.id),
    name: String(r.name ?? r.id),
    role: r.role ?? null,
    department: r.department ?? null,
    email: r.email ?? null,
  }));

  const links = linksRes.data ?? [];
  const sittings = sittingsRes.data ?? [];
  const open = openRes.data ?? [];

  const me =
    people.find(p => String(p.email ?? "").toLowerCase() === u.email.toLowerCase()) ??
    null;

  const meetings: MeetingSummary[] = (meetingsRes.data ?? []).map(m => {
    const mine = links.filter(l => l.meeting_id === m.id);
    const dates = sittings
      .filter(s => s.meeting_id === m.id)
      .map(s => String(s.on_date));
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
    };
  });

  return {
    today,
    me: { email: u.email, personId: me?.id ?? null, canCreate: true },
    people,
    meetings,
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
  ] = await Promise.all([
    client.from("team_meetings").select("*").eq("id", id).maybeSingle(),
    client
      .from("team_people")
      .select("id, name, role, department, email, active")
      .eq("active", true)
      .order("name", { ascending: true }),
    client
      .from("team_meeting_people")
      .select("person_id, part")
      .eq("meeting_id", id)
      .eq("removed", false),
    client
      .from("team_sittings")
      .select("*")
      .eq("meeting_id", id)
      .order("on_date", { ascending: false })
      .limit(60),
    client
      .from("team_agenda")
      .select("*")
      .eq("meeting_id", id)
      .or(`status.eq.open,closed_at.gte.${addDays(today, -120)}`)
      .order("position", { ascending: true }),
    client
      .from("team_changes")
      .select("at, by_whom, what")
      .eq("meeting_id", id)
      .order("at", { ascending: false })
      .limit(25),
  ]);

  if (meetingRes.error) throw meetingRes.error;
  const m = meetingRes.data;
  if (!m) {
    throw new Error(
      "That meeting is not in the list any more. Go back to Team meetings.",
    );
  }

  const people: Person[] = (peopleRes.data ?? []).map(r => ({
    id: String(r.id),
    name: String(r.name ?? r.id),
    role: r.role ?? null,
    department: r.department ?? null,
    email: r.email ?? null,
  }));

  const links = linksRes.data ?? [];
  const sittings = sittingsRes.data ?? [];
  const items = itemsRes.data ?? [];
  const changes = changesRes.data ?? [];

  const me =
    people.find(p => String(p.email ?? "").toLowerCase() === u.email.toLowerCase()) ??
    null;
  const hosts = links.filter(l => l.part === "host").map(l => String(l.person_id));
  const manage = u.isCeo || u.isAdmin || Boolean(me && hosts.includes(me.id));
  const pastDays = sittings
    .map(s => String(s.on_date))
    .filter(d => d < today);

  return {
    today,
    me: { email: u.email, personId: me?.id ?? null },
    canManage: manage,
    meeting: {
      id: String(m.id),
      title: String(m.title),
      purpose: m.purpose ?? null,
      cadence: m.cadence ?? null,
      department: m.department ?? null,
      fromCalendar: Boolean(m.calendar_id),
      doc: String(m.doc ?? ""),
      docBy: m.doc_by ?? null,
      docAt: m.doc_at ?? null,
      docVersion: Number(m.doc_version ?? 0),
    },
    people,
    members: links.map(l => ({
      personId: String(l.person_id),
      part: (PARTS as readonly string[]).includes(l.part)
        ? (l.part as "host" | "required" | "optional")
        : "required",
    })),
    sittings: sittings.map(s => ({
      id: String(s.id),
      onDate: String(s.on_date),
      notes: String(s.notes ?? ""),
      notesBy: s.notes_by ?? null,
      notesAt: s.notes_at ?? null,
      notesVersion: Number(s.notes_version ?? 0),
    })),
    items: items.map(i => {
      const added = String(i.added_at ?? "").slice(0, 10);
      return {
        id: Number(i.id),
        text: String(i.text),
        ownerId: i.owner_id ?? null,
        status: i.status as "open" | "done" | "dropped",
        position: Number(i.position ?? 0),
        sittingId: i.sitting_id ?? null,
        addedBy: i.added_by ?? null,
        addedAt: String(i.added_at ?? ""),
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
  },
): Promise<MeetingPage> {
  const title = clean(a.title, 120);
  const purpose = clean(a.purpose, 300);
  const department = clean(a.department, 60) || null;
  if (title.length < 3) throw new Error("Give the meeting a name.");
  if (purpose.length < 8)
    throw new Error(
      "Say what the meeting is for in one sentence: every meeting has a purpose.",
    );
  if (!(CADENCES as readonly string[]).includes(a.cadence as any))
    throw new Error("Pick how often it meets.");

  if (a.id) {
    const ok = await canManage(client, u, a.id);
    if (!ok)
      throw new Error(
        "Only this meeting's hosts, admins and Aziz change who is in it and what it is for. Ask a host.",
      );
    const { data: before } = await client
      .from("team_meetings")
      .select("title, purpose, cadence, department")
      .eq("id", a.id)
      .maybeSingle();
    if (!before) throw new Error("That meeting is not in the list any more.");

    const calendarFields =
      before.title !== title ||
      before.cadence !== a.cadence ||
      (before.department ?? null) !== department;

    const { error: updErr } = await client
      .from("team_meetings")
      .update({
        title,
        purpose,
        cadence: a.cadence,
        department,
        updated_at: new Date().toISOString(),
        ...(calendarFields ? { managed: "cockpit" } : {}),
      })
      .eq("id", a.id);
    if (updErr) throw updErr;

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

    if (changed.length) {
      await logChange(client, u.email, a.id, changed.join(", "), {
        before,
        after: { title, purpose, cadence: a.cadence, department },
      });
    }
    return fetchMeetingPage(client, u, a.id);
  }

  // Create new meeting
  const base = slug(title) || "meeting";
  const { data: existing } = await client
    .from("team_meetings")
    .select("id")
    .like("id", `${base}%`);
  const taken = new Set((existing ?? []).map(r => String(r.id)));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;

  const { data: people } = await client
    .from("team_people")
    .select("id, email")
    .ilike("email", u.email)
    .limit(1);
  const me = people?.[0] ?? null;

  const { error: insErr } = await client.from("team_meetings").insert({
    id,
    title,
    purpose,
    cadence: a.cadence,
    department,
    host_id: me?.id ?? null,
    active: true,
    managed: "cockpit",
    created_by: u.email,
  });
  if (insErr) throw insErr;

  if (me) {
    await client.from("team_meeting_people").insert({
      meeting_id: id,
      person_id: me.id,
      part: "host",
      source: "cockpit",
      changed_by: u.email,
      changed_at: new Date().toISOString(),
    });
  }

  await logChange(client, u.email, id, `made the meeting "${title}"`, {
    purpose,
    cadence: a.cadence,
    department,
  });

  return fetchMeetingPage(client, u, id);
}

export async function setPart(
  client: SupabaseClient,
  u: TeamUserContext,
  a: {
    meetingId: string;
    personId: string;
    part: "host" | "required" | "optional" | "off";
  },
): Promise<MeetingPage> {
  const ok = await canManage(client, u, a.meetingId);
  if (!ok)
    throw new Error(
      "Only this meeting's hosts, admins and Aziz change who is in it and what it is for. Ask a host.",
    );

  const { data: person } = await client
    .from("team_people")
    .select("id, name")
    .eq("id", a.personId)
    .maybeSingle();
  if (!person) throw new Error("That person is not on the team roster.");

  const { data: current } = await client
    .from("team_meeting_people")
    .select("part, removed")
    .eq("meeting_id", a.meetingId)
    .eq("person_id", a.personId)
    .maybeSingle();

  if (a.part === "off" || (current?.part === "host" && a.part !== "host")) {
    const { data: hosts } = await client
      .from("team_meeting_people")
      .select("person_id")
      .eq("meeting_id", a.meetingId)
      .eq("part", "host")
      .eq("removed", false);
    const others = (hosts ?? []).filter(h => h.person_id !== a.personId);
    if (current?.part === "host" && !current.removed && !others.length)
      throw new Error("Make somebody else the host first: every meeting has one.");
  }

  const now = new Date().toISOString();
  await client.from("team_meeting_people").upsert(
    {
      meeting_id: a.meetingId,
      person_id: a.personId,
      part: a.part === "off" ? (current?.part ?? "required") : a.part,
      removed: a.part === "off",
      source: "cockpit",
      changed_by: u.email,
      changed_at: now,
    },
    { onConflict: "meeting_id,person_id" },
  );

  const { data: hosts } = await client
    .from("team_meeting_people")
    .select("person_id")
    .eq("meeting_id", a.meetingId)
    .eq("part", "host")
    .eq("removed", false)
    .order("changed_at", { ascending: true });

  await client
    .from("team_meetings")
    .update({
      host_id: hosts?.[0]?.person_id ?? null,
      managed: "cockpit",
      updated_at: now,
    })
    .eq("id", a.meetingId);

  const name = String(person.name);
  await logChange(
    client,
    u.email,
    a.meetingId,
    a.part === "off"
      ? `took ${name} off the meeting`
      : !current || current.removed
        ? `added ${name} as ${a.part === "host" ? "a host" : a.part}`
        : `made ${name} ${a.part === "host" ? "a host" : a.part}`,
  );

  return fetchMeetingPage(client, u, a.meetingId);
}

export async function addSitting(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { meetingId: string; date: string },
): Promise<MeetingPage> {
  const ok = await canManage(client, u, a.meetingId);
  if (!ok)
    throw new Error(
      "Only this meeting's hosts, admins and Aziz change who is in it and what it is for. Ask a host.",
    );
  if (!DAY_RE.test(a.date)) throw new Error("Pick a date.");
  const today = kuwaitDay();
  if (a.date < addDays(today, -60) || a.date > addDays(today, 370))
    throw new Error("Pick a date within the year.");

  await client.from("team_sittings").upsert(
    {
      id: `${a.meetingId}:${a.date}`,
      meeting_id: a.meetingId,
      on_date: a.date,
      held: a.date <= today,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );

  await logChange(client, u.email, a.meetingId, `set a meeting on ${a.date}`);
  return fetchMeetingPage(client, u, a.meetingId);
}

export async function saveDoc(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { meetingId: string; text: string; version: number },
): Promise<Saved> {
  const text = String(a.text).slice(0, 60_000);
  const version = Math.trunc(a.version);
  const { data: done } = await client
    .from("team_meetings")
    .update({
      doc: text,
      doc_by: u.email,
      doc_at: new Date().toISOString(),
      doc_version: version + 1,
    })
    .eq("id", a.meetingId)
    .eq("doc_version", version)
    .select("doc_version");

  if (!done || done.length === 0) {
    const { data: now } = await client
      .from("team_meetings")
      .select("doc, doc_by, doc_at, doc_version")
      .eq("id", a.meetingId)
      .maybeSingle();
    if (!now) throw new Error("That meeting is not in the list any more.");
    return {
      ok: false,
      conflict: {
        text: String(now.doc ?? ""),
        by: now.doc_by ?? null,
        at: now.doc_at ?? null,
        version: Number(now.doc_version ?? 0),
      },
    };
  }

  await logChange(client, u.email, a.meetingId, "edited the doc", {
    version: version + 1,
    length: text.length,
  });
  const page = await fetchMeetingPage(client, u, a.meetingId);
  return { ok: true, page };
}

export async function saveNotes(
  client: SupabaseClient,
  u: TeamUserContext,
  a: { sittingId: string; text: string; version: number },
): Promise<Saved> {
  const { data: sitting } = await client
    .from("team_sittings")
    .select("id, meeting_id, on_date")
    .eq("id", a.sittingId)
    .maybeSingle();
  if (!sitting) throw new Error("That meeting date is not in the list any more.");

  const text = String(a.text).slice(0, 30_000);
  const version = Math.trunc(a.version);
  const { data: done } = await client
    .from("team_sittings")
    .update({
      notes: text,
      notes_by: u.email,
      notes_at: new Date().toISOString(),
      notes_version: version + 1,
    })
    .eq("id", a.sittingId)
    .eq("notes_version", version)
    .select("notes_version");

  if (!done || done.length === 0) {
    const { data: now } = await client
      .from("team_sittings")
      .select("notes, notes_by, notes_at, notes_version")
      .eq("id", a.sittingId)
      .maybeSingle();
    return {
      ok: false,
      conflict: {
        text: String(now?.notes ?? ""),
        by: now?.notes_by ?? null,
        at: now?.notes_at ?? null,
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
  const page = await fetchMeetingPage(client, u, String(sitting.meeting_id));
  return { ok: true, page };
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
    .eq("id", a.meetingId)
    .maybeSingle();
  if (!meeting) throw new Error("That meeting is not in the list any more.");

  const { data: last } = await client
    .from("team_agenda")
    .select("position")
    .eq("meeting_id", a.meetingId)
    .eq("status", "open")
    .order("position", { ascending: false })
    .limit(1);

  const { error } = await client.from("team_agenda").insert({
    meeting_id: a.meetingId,
    text,
    owner_id: a.ownerId || null,
    status: "open",
    position: Number(last?.[0]?.position ?? 0) + 1,
    added_by: u.email,
  });
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
    .eq("id", Math.trunc(a.id))
    .maybeSingle();
  if (!item) throw new Error("That agenda item is not there any more.");
  const meetingId = String(item.meeting_id);

  const { data: open } = await client
    .from("team_agenda")
    .select("id, position")
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
      .eq("id", order[i]);
  }
  return fetchMeetingPage(client, u, meetingId);
}
