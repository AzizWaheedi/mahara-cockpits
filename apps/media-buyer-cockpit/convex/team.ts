import { v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, internalQuery } from "./_generated/server";
import { rest, type SbRow } from "./ceo/sbWrite";
import { kuwaitDay } from "./ceo/time";
import { authenticatedAction } from "./functions";
import { flush, note } from "./health";
import { accessFor } from "./roles";

/**
 * Team meetings: the screen at /team, for everybody on the team.
 *
 * Aziz, 2026-09-22: "an entire team section on the cockpit that the whole
 * team can see for team meetings and agendas, including what we're going to
 * cover in each meeting ... a doc and an agenda for each meeting ...
 * everybody can edit it ... We can look back on them in the next meeting
 * and make sure we're getting everything done, and every meeting has a
 * specific purpose."
 *
 * The data is in Supabase (20260922b and 20260923d): the meetings and their
 * sittings come from the calendars through hermes/team-sync every hour. An
 * agenda item belongs to the meeting, not to one sitting, and stays open
 * until somebody closes it, so the next meeting opens with what was not
 * finished. Closing it stamps the sitting it was closed in, which is what
 * "look back on them" reads.
 *
 * Who may do what. Everyone signed in to the portal reads every meeting and
 * edits agendas, the doc and the notes, as in a shared document. Changing
 * who is in a meeting, who hosts it, and what it is for is for its hosts,
 * admins and Aziz. Every write leaves a row in team_changes.
 */

// biome-ignore lint/suspicious/noExplicitAny: PostgREST rows
type Any = Record<string, any>;

type Who = {
  email: string;
  name: string | null;
  isCeo: boolean;
  isAdmin: boolean;
};

const CADENCES = [
  "weekly",
  "every two weeks",
  "monthly",
  "quarterly",
  "as needed",
] as const;
const PARTS = ["host", "required", "optional"] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Anyone with a seat in the portal: any cockpit, admin, or Aziz. */
export const who = internalQuery({
  args: { userId: v.id("users") },
  returns: v.any(),
  handler: async (ctx, { userId }): Promise<Who> => {
    const user = await ctx.db.get(userId);
    const a = await accessFor(ctx, user?.email, userId);
    if (!a.isCeo && !a.isAdmin && a.cockpits.length === 0)
      throw new Error(
        "Team meetings are for the team. Ask Aziz to add you in the portal.",
      );
    return {
      email: a.email,
      name: (user?.name as string | undefined) ?? a.name ?? null,
      isCeo: a.isCeo,
      isAdmin: a.isAdmin,
    };
  },
});

// --- Supabase, noted on the health ledger ----------------------------------

async function db(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<SbRow[]> {
  let rows: SbRow[] | null;
  try {
    rows = await rest(path, init);
  } catch (e) {
    note("supabase", false, String(e instanceof Error ? e.message : e));
    throw new Error(
      "The team meetings could not be read from Supabase just now. Try again in a minute.",
    );
  }
  note("supabase", true);
  if (rows === null)
    throw new Error(
      "The team meetings tables are not in Supabase yet (migration 20260922b).",
    );
  return rows;
}

async function noted<T>(ctx: ActionCtx, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    await flush(ctx);
  }
}

const enc = encodeURIComponent;

function clean(s: unknown, max: number): string {
  return String(s ?? "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function logChange(
  by: string,
  meetingId: string | null,
  what: string,
  detail?: Any,
): Promise<void> {
  await db("team_changes", {
    method: "POST",
    body: { by_whom: by, meeting_id: meetingId, what, detail: detail ?? null },
    prefer: "return=minimal",
  });
}

/** The person on the roster behind the signed-in address, if there is one. */
function meOf(people: SbRow[], w: Who): SbRow | null {
  return (
    people.find(p => String(p.email ?? "").toLowerCase() === w.email) ?? null
  );
}

async function canManage(w: Who, meetingId: string): Promise<boolean> {
  if (w.isCeo || w.isAdmin) return true;
  const people = await db(
    `team_people?select=id,email&email=ilike.${enc(w.email)}`,
  );
  const me = people[0];
  if (!me) return false;
  const rows = await db(
    `team_meeting_people?select=part&meeting_id=eq.${enc(meetingId)}&person_id=eq.${enc(me.id)}&removed=eq.false`,
  );
  return rows.some(r => r.part === "host");
}

async function mustManage(w: Who, meetingId: string): Promise<void> {
  if (!(await canManage(w, meetingId)))
    throw new Error(
      "Only this meeting's hosts, admins and Aziz change who is in it and what it is for. Ask a host.",
    );
}

// --- reads -------------------------------------------------------------------

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

function personOf(r: SbRow): Person {
  return {
    id: String(r.id),
    name: String(r.name ?? r.id),
    role: r.role ?? null,
    department: r.department ?? null,
    email: r.email ?? null,
  };
}

export const overview = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: (ctx): Promise<Overview> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const today = kuwaitDay();
      const [people, meetings, links, sittings, open] = await Promise.all([
        db(
          "team_people?select=id,name,role,department,email,active&active=eq.true&order=name.asc",
        ),
        db(
          "team_meetings?select=id,title,purpose,cadence,department&active=eq.true&order=title.asc",
        ),
        db(
          "team_meeting_people?select=meeting_id,person_id,part&removed=eq.false",
        ),
        db(
          `team_sittings?select=meeting_id,on_date&on_date=gte.${addDays(today, -180)}&order=on_date.asc`,
        ),
        db("team_agenda?select=meeting_id&status=eq.open"),
      ]);
      const me = meOf(people, w);
      return {
        today,
        me: { email: w.email, personId: me?.id ?? null, canCreate: true },
        people: people.map(personOf),
        meetings: meetings.map(m => {
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
        }),
      };
    }),
});

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

async function page(w: Who, id: string): Promise<MeetingPage> {
  const today = kuwaitDay();
  const [meetings, people, links, sittings, items, changes] = await Promise.all(
    [
      db(`team_meetings?select=*&id=eq.${enc(id)}`),
      db(
        "team_people?select=id,name,role,department,email,active&active=eq.true&order=name.asc",
      ),
      db(
        `team_meeting_people?select=person_id,part&meeting_id=eq.${enc(id)}&removed=eq.false`,
      ),
      db(
        `team_sittings?select=*&meeting_id=eq.${enc(id)}&order=on_date.desc&limit=60`,
      ),
      db(
        `team_agenda?select=*&meeting_id=eq.${enc(id)}&or=(status.eq.open,closed_at.gte.${addDays(today, -120)})&order=position.asc,id.asc`,
      ),
      db(
        `team_changes?select=at,by_whom,what&meeting_id=eq.${enc(id)}&order=at.desc&limit=25`,
      ),
    ],
  );
  const m = meetings[0];
  if (!m)
    throw new Error(
      "That meeting is not in the list any more. Go back to Team meetings.",
    );
  const me = meOf(people, w);
  const hosts = links.filter(l => l.part === "host").map(l => l.person_id);
  const manage = w.isCeo || w.isAdmin || Boolean(me && hosts.includes(me.id));
  const pastDays = sittings.map(s => String(s.on_date)).filter(d => d < today);
  return {
    today,
    me: { email: w.email, personId: me?.id ?? null },
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
    people: people.map(personOf),
    members: links.map(l => ({
      personId: String(l.person_id),
      part: (PARTS as readonly string[]).includes(l.part) ? l.part : "required",
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
  };
}

export const meeting = authenticatedAction({
  args: { id: v.string() },
  returns: v.any(),
  handler: (ctx, { id }): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      return page(w, id);
    }),
});

// --- the meeting itself --------------------------------------------------------

export const saveMeeting = authenticatedAction({
  args: {
    id: v.optional(v.string()),
    title: v.string(),
    purpose: v.string(),
    cadence: v.string(),
    department: v.optional(v.string()),
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
        const [before] = await db(
          `team_meetings?select=title,purpose,cadence,department&id=eq.${enc(a.id)}`,
        );
        if (!before)
          throw new Error("That meeting is not in the list any more.");
        // Title, cadence and department are the calendar's until somebody
        // changes one here; then the hourly sync leaves them alone.
        const calendarFields =
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
            ...(calendarFields ? { managed: "cockpit" } : {}),
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
        return page(w, a.id);
      }

      // A new meeting, not from the calendar. Whoever makes it hosts it.
      const base = slug(title) || "meeting";
      const taken = new Set(
        (await db(`team_meetings?select=id&id=like.${enc(`${base}*`)}`)).map(
          r => String(r.id),
        ),
      );
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      const people = await db(
        `team_people?select=id,email&email=ilike.${enc(w.email)}`,
      );
      const me = people[0] ?? null;
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
      await logChange(w.email, id, `made the meeting "${title}"`, {
        purpose,
        cadence: a.cadence,
        department,
      });
      return page(w, id);
    }),
});

/** Put a person in a meeting, change their part, or take them off. */
export const setPart = authenticatedAction({
  args: {
    meetingId: v.string(),
    personId: v.string(),
    part: v.union(
      v.literal("host"),
      v.literal("required"),
      v.literal("optional"),
      v.literal("off"),
    ),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      await mustManage(w, a.meetingId);
      const [person] = await db(
        `team_people?select=id,name&id=eq.${enc(a.personId)}`,
      );
      if (!person) throw new Error("That person is not on the team roster.");
      const [current] = await db(
        `team_meeting_people?select=part,removed&meeting_id=eq.${enc(a.meetingId)}&person_id=eq.${enc(a.personId)}`,
      );
      if (a.part === "off" || (current?.part === "host" && a.part !== "host")) {
        // A meeting keeps at least one host.
        const hosts = await db(
          `team_meeting_people?select=person_id&meeting_id=eq.${enc(a.meetingId)}&part=eq.host&removed=eq.false`,
        );
        const others = hosts.filter(h => h.person_id !== a.personId);
        if (current?.part === "host" && !current.removed && !others.length)
          throw new Error(
            "Make somebody else the host first: every meeting has one.",
          );
      }
      const now = new Date().toISOString();
      await db("team_meeting_people?on_conflict=meeting_id,person_id", {
        method: "POST",
        body: {
          meeting_id: a.meetingId,
          person_id: a.personId,
          part: a.part === "off" ? (current?.part ?? "required") : a.part,
          removed: a.part === "off",
          source: "cockpit",
          changed_by: w.email,
          changed_at: now,
        },
        prefer: "resolution=merge-duplicates,return=minimal",
      });
      // The meeting's host column follows its first host, and the calendar
      // no longer overrules it.
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
      await logChange(
        w.email,
        a.meetingId,
        a.part === "off"
          ? `took ${name} off the meeting`
          : !current || current.removed
            ? `added ${name} as ${a.part === "host" ? "a host" : a.part}`
            : `made ${name} ${a.part === "host" ? "a host" : a.part}`,
      );
      return page(w, a.meetingId);
    }),
});

/** Add a date the meeting sits on, for meetings the calendar does not carry. */
export const addSitting = authenticatedAction({
  args: { meetingId: v.string(), date: v.string() },
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
      await db("team_sittings?on_conflict=id", {
        method: "POST",
        body: {
          id: `${a.meetingId}:${a.date}`,
          meeting_id: a.meetingId,
          on_date: a.date,
          held: a.date <= today,
        },
        prefer: "resolution=ignore-duplicates,return=minimal",
      });
      await logChange(w.email, a.meetingId, `set a meeting on ${a.date}`);
      return page(w, a.meetingId);
    }),
});

// --- the doc and the notes -----------------------------------------------------

type Saved =
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

/**
 * The meeting's living doc. A save carries the version it started from; if
 * somebody saved in between, nothing is overwritten and their version comes
 * back to choose from.
 */
export const saveDoc = authenticatedAction({
  args: { meetingId: v.string(), text: v.string(), version: v.number() },
  returns: v.any(),
  handler: (ctx, a): Promise<Saved> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const text = String(a.text).slice(0, 60_000);
      const done = await db(
        `team_meetings?id=eq.${enc(a.meetingId)}&doc_version=eq.${Math.trunc(a.version)}`,
        {
          method: "PATCH",
          body: {
            doc: text,
            doc_by: w.email,
            doc_at: new Date().toISOString(),
            doc_version: Math.trunc(a.version) + 1,
          },
          prefer: "return=representation",
        },
      );
      if (!done.length) {
        const [now] = await db(
          `team_meetings?select=doc,doc_by,doc_at,doc_version&id=eq.${enc(a.meetingId)}`,
        );
        if (!now) throw new Error("That meeting is not in the list any more.");
        return {
          ok: false as const,
          conflict: {
            text: String(now.doc ?? ""),
            by: now.doc_by ?? null,
            at: now.doc_at ?? null,
            version: Number(now.doc_version ?? 0),
          },
        };
      }
      await logChange(w.email, a.meetingId, "edited the doc", {
        version: Math.trunc(a.version) + 1,
        length: text.length,
      });
      return { ok: true as const, page: await page(w, a.meetingId) };
    }),
});

/** Notes for one sitting: what was said. Same rule as the doc. */
export const saveNotes = authenticatedAction({
  args: { sittingId: v.string(), text: v.string(), version: v.number() },
  returns: v.any(),
  handler: (ctx, a): Promise<Saved> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const [sitting] = await db(
        `team_sittings?select=id,meeting_id,on_date&id=eq.${enc(a.sittingId)}`,
      );
      if (!sitting)
        throw new Error("That meeting date is not in the list any more.");
      const text = String(a.text).slice(0, 30_000);
      const done = await db(
        `team_sittings?id=eq.${enc(a.sittingId)}&notes_version=eq.${Math.trunc(a.version)}`,
        {
          method: "PATCH",
          body: {
            notes: text,
            notes_by: w.email,
            notes_at: new Date().toISOString(),
            notes_version: Math.trunc(a.version) + 1,
          },
          prefer: "return=representation",
        },
      );
      if (!done.length) {
        const [now] = await db(
          `team_sittings?select=notes,notes_by,notes_at,notes_version&id=eq.${enc(a.sittingId)}`,
        );
        return {
          ok: false as const,
          conflict: {
            text: String(now?.notes ?? ""),
            by: now?.notes_by ?? null,
            at: now?.notes_at ?? null,
            version: Number(now?.notes_version ?? 0),
          },
        };
      }
      await logChange(
        w.email,
        String(sitting.meeting_id),
        `wrote the notes for ${sitting.on_date}`,
      );
      return {
        ok: true as const,
        page: await page(w, String(sitting.meeting_id)),
      };
    }),
});

// --- the agenda ----------------------------------------------------------------

async function itemOrRefuse(id: number): Promise<SbRow> {
  const [item] = await db(`team_agenda?select=*&id=eq.${Math.trunc(id)}`);
  if (!item) throw new Error("That agenda item is not there any more.");
  return item;
}

export const addItem = authenticatedAction({
  args: {
    meetingId: v.string(),
    text: v.string(),
    ownerId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const text = clean(a.text, 500);
      if (text.length < 3) throw new Error("Write the agenda item first.");
      const [meeting] = await db(
        `team_meetings?select=id&id=eq.${enc(a.meetingId)}`,
      );
      if (!meeting)
        throw new Error("That meeting is not in the list any more.");
      const [last] = await db(
        `team_agenda?select=position&meeting_id=eq.${enc(a.meetingId)}&status=eq.open&order=position.desc&limit=1`,
      );
      await db("team_agenda", {
        method: "POST",
        body: {
          meeting_id: a.meetingId,
          text,
          owner_id: a.ownerId || null,
          status: "open",
          position: Number(last?.position ?? 0) + 1,
          added_by: w.email,
        },
        prefer: "return=minimal",
      });
      await logChange(w.email, a.meetingId, `added "${text.slice(0, 80)}"`);
      return page(w, a.meetingId);
    }),
});

export const editItem = authenticatedAction({
  args: {
    id: v.number(),
    text: v.optional(v.string()),
    ownerId: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const item = await itemOrRefuse(a.id);
      const body: Any = {};
      if (a.text !== undefined) {
        const text = clean(a.text, 500);
        if (text.length < 3) throw new Error("An agenda item needs words.");
        body.text = text;
      }
      if (a.ownerId !== undefined) body.owner_id = a.ownerId || null;
      if (!Object.keys(body).length) return page(w, String(item.meeting_id));
      await db(`team_agenda?id=eq.${Math.trunc(a.id)}`, {
        method: "PATCH",
        body,
        prefer: "return=minimal",
      });
      await logChange(
        w.email,
        String(item.meeting_id),
        body.text !== undefined
          ? `reworded "${String(item.text).slice(0, 60)}"`
          : `gave "${String(item.text).slice(0, 60)}" ${body.owner_id ? "an owner" : "no owner"}`,
      );
      return page(w, String(item.meeting_id));
    }),
});

/**
 * Close an item (done or dropped) or open it again. Closing stamps the
 * sitting it was closed in: the latest meeting on or before today, so the
 * next meeting can look back at what the last one finished.
 */
export const closeItem = authenticatedAction({
  args: {
    id: v.number(),
    status: v.union(v.literal("done"), v.literal("dropped"), v.literal("open")),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const item = await itemOrRefuse(a.id);
      const meetingId = String(item.meeting_id);
      if (a.status === "open") {
        await db(`team_agenda?id=eq.${Math.trunc(a.id)}`, {
          method: "PATCH",
          body: {
            status: "open",
            sitting_id: null,
            closed_at: null,
            closed_by: null,
          },
          prefer: "return=minimal",
        });
        await logChange(
          w.email,
          meetingId,
          `reopened "${String(item.text).slice(0, 60)}"`,
        );
        return page(w, meetingId);
      }
      const today = kuwaitDay();
      const [at] = await db(
        `team_sittings?select=id&meeting_id=eq.${enc(meetingId)}&on_date=lte.${today}&order=on_date.desc&limit=1`,
      );
      await db(`team_agenda?id=eq.${Math.trunc(a.id)}`, {
        method: "PATCH",
        body: {
          status: a.status,
          sitting_id: at?.id ?? null,
          closed_at: new Date().toISOString(),
          closed_by: w.email,
        },
        prefer: "return=minimal",
      });
      await logChange(
        w.email,
        meetingId,
        `${a.status === "done" ? "finished" : "dropped"} "${String(item.text).slice(0, 60)}"`,
      );
      return page(w, meetingId);
    }),
});

/** Move an open item one place up or down the agenda. */
export const moveItem = authenticatedAction({
  args: { id: v.number(), dir: v.union(v.literal("up"), v.literal("down")) },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const item = await itemOrRefuse(a.id);
      const meetingId = String(item.meeting_id);
      const open = await db(
        `team_agenda?select=id,position&meeting_id=eq.${enc(meetingId)}&status=eq.open&order=position.asc,id.asc`,
      );
      const at = open.findIndex(o => Number(o.id) === Math.trunc(a.id));
      const to = a.dir === "up" ? at - 1 : at + 1;
      if (at < 0 || to < 0 || to >= open.length) return page(w, meetingId);
      const order = open.map(o => Number(o.id));
      [order[at], order[to]] = [order[to], order[at]];
      // Positions rewritten 1..n, so ties from older rows cannot stick.
      for (let i = 0; i < order.length; i++)
        await db(`team_agenda?id=eq.${order[i]}`, {
          method: "PATCH",
          body: { position: i + 1 },
          prefer: "return=minimal",
        });
      return page(w, meetingId);
    }),
});
