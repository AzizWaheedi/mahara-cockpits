/**
 * The three writers of a recording's call row (docs/forms/STAGE2-CONTRACT.md
 * 3.6, 5.2, A7.2 and A7.12, the orchestrator's read): the worker's candidate row
 * (hermes/csm-calls sources.ts, and its re-match loop when the booking or the
 * 1-1 form link arrives after the recording), the webhook's ingest item
 * (supabase/functions/fathom-webhook handler.ts) and the pull's ingest item
 * (cockpit-forms-api fathom.ts), built from the same Fathom meeting and the
 * same MatchInputs, write the same match block (task_id, client_name,
 * match_method, match_confidence, linked_call_id, kind), candidate, room and
 * hints. The ingest keeps whichever block lands first on a matched row (4.3),
 * so a writer that disagrees leaves its own words until the worker re-matches.
 *
 * A7.12 adds three rules, pinned below with the titles compared too: hints only
 * on an unplaced, unsettled candidate (a client-class row carries none, and so
 * does a row the worker's matchMeeting or a person placed, which the webhook
 * and the pull cannot see); the edited title only for the matcher, while the
 * call's and the meeting's title and the kind still fall back to the calendar's
 * meeting_title; and the named booking's client name for a client the clients
 * list no longer holds. The placed rows then go through the real
 * cockpit_fathom_ingest and cockpit_csm_manual_match, on a PGlite database
 * with migrations v and w (20261027f, 20261027g) over what they stand on, cut
 * from the canonical migrations as fathom-intake-supabase.test.ts cuts it.
 *
 * A7.13 makes every writer hold A7.12's first rule at once, and these cases pin
 * it: the manual match leaves hints [] in its own UPDATE, not only after the
 * next write; the worker's next run keeps the client name the CSM placed, from
 * the clients list or, for a client that has left it, from the stored row; an
 * invitee's email names only a client on the clients list, so no writer places
 * a client-class recording that only an unlisted client's contact links; and a
 * settled row stays on no client with hints [], whatever block or hints the
 * webhook's or the pull's item carries.
 *
 * A7.14 and A7.17 make the door and the save run one tie rule: the save runs
 * cockpit_form_recording_tied in SQL, and the door reads rules 1 and 2 itself
 * and asks cockpit_form_recordings_tied about the rest. On the same PGlite
 * database, the door (checkin.calls through its real code, the database
 * answering every RPC it asks), the save (cockpit_form_save as each seat) and
 * the call_match attach (cockpit_csm_attach_recording as the submitting seat,
 * rolled back) must give the same answer for the same seat and recording
 * under each rule, a likely sign alone, a pasted link alone, a call row on no
 * card and a room another card's booking shares; where the door's stricter
 * "on another client" differs (A7.14's order bullet), the window refuses what
 * the save and the attach accept. The drafts' and the transcript's check of a
 * saved call (savedCallRefusal) must read the response's own seat, never the
 * seat asking. Rule 2 as decided in round 3 (only a call row an exact sign or
 * a person placed settles the tie) has landed in 2a in db and forms-api, and
 * its case pins it at the door, the save and the attach for every seat (A7.17,
 * section 13 G12). A7.14's second sentence, decided in round 4 (A7.18): the
 * CSM refused a call that a likely sign put on this card reads
 * OUTSIDE_CS_LIKELY, not OUTSIDE_CS's "is not on this client", at the door,
 * the save and the attach, and a call row on no card keeps OUTSIDE_CS; it has
 * landed in 2a in db and forms-api, and its case pins it (section 13 G13).
 *
 * Each writer runs its real code with fakes: the worker's fathomSource over a
 * fake database (its reads answered from the bookings, staff and form links the
 * MatchInputs list) and the real transport over a fake Fathom; the webhook
 * through makeHandler with its testkit's database and a delivery signed as
 * Fathom signs it; the pull through pullFathom with the forms-api testkit.
 * Only the ingest cases store anything, in their own PGlite database. The
 * meeting carries no transcript, so no writer hears a speaker. Every person,
 * client, link and room is invented: Zoom ids like 12345678901, passcode TEST,
 * Meet codes from the contract's allow-list.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { suggestionsFor } from "../../../hermes/csm-calls/callMatch.ts";
import { type Db, makeTransport } from "../../../hermes/csm-calls/lib.ts";
import { type Ctx, fathomSource } from "../../../hermes/csm-calls/sources.ts";
import { checkinCalls } from "../../../supabase/functions/cockpit-forms-api/calls.ts";
import type { Actor } from "../../../supabase/functions/cockpit-forms-api/door.ts";
import {
  asInputs,
  matchCtx,
  OUTSIDE_CS,
  pullFathom,
  recordingFor,
  recordingOf,
  savedCallRefusal,
  toBooking,
  toClient,
  toRecording,
} from "../../../supabase/functions/cockpit-forms-api/fathom.ts";
import * as pullKit from "../../../supabase/functions/cockpit-forms-api/testkit.ts";
import { RpcError } from "../../../supabase/functions/cockpit-hours-sync/db.ts";
import * as hookKit from "../../../supabase/functions/fathom-webhook/testkit.ts";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

// The ingest cases build a database first; keep direct, ship and readiness
// runs consistent on busy build hosts, as the other PGlite suites do.
setDefaultTimeout(120_000);

type Row = Record<string, any>;

const NOW = Date.parse("2026-10-28T09:00:00Z"); // 12:00 in Kuwait
const CS = "Customer Success";
const CSM = { name: "Test Csm", email: "csm.writers@maharamedia.com" };
const CEDAR = { taskId: "86exwrit1", name: "Cedar Bakery" };
const HARBOUR = { taskId: "86exwrit2", name: "Harbour Optics" };
/** A third client, on the list only where a case says so. */
const MARBLE = { taskId: "86exwrit3", name: "Marble Studio" };
/** A client the clients list no longer holds, whose booking stays in the store. */
const OLIVE = { taskId: "86exwrit4", name: "Olive Grove" };
const LISTED = [CEDAR, HARBOUR];
const CONTACT = {
  name: "Rana Testcontact",
  email: "owner@cedarbakery.example",
};
const OLIVE_CONTACT = {
  name: "Huda Testcontact",
  email: "hello@olivegrove.example",
};
/** Cedar Bakery's check-in, 10:00 in Kuwait; the recordings start 4 minutes later. */
const BOOKED = "2026-10-28T07:00:00.000Z";
const EARLY = "2026-10-28T04:30:00.000Z"; // 2 h 34 min before the recording
/** 30 minutes after the recording starts: a hint, never a possible. */
const LATER = "2026-10-28T07:34:00.000Z";
const ZOOM = "https://us06web.zoom.us/j/12345678901?pwd=TEST";

const csmInvitee = {
  name: CSM.name,
  email: CSM.email,
  email_domain: "maharamedia.com",
  is_external: false,
};
const contactInvitee = (external: boolean, who = CONTACT) => ({
  name: who.name,
  email: who.email,
  email_domain: who.email.split("@")[1],
  is_external: external,
});

/**
 * A Customer Success recording as Fathom lists it with its summary and action
 * items (the worker's read, and the webhook's delivery): impromptu, the CSM
 * its one invitee, 31 minutes, shared with the team.
 */
function meeting(rid: number, over: Row = {}): Row {
  const share = `https://fathom.video/share/TESTwriters${rid}`;
  return {
    title: "Impromptu Google Meet Meeting",
    meeting_title: "Impromptu Google Meet Meeting",
    recording_id: rid,
    url: `https://fathom.video/calls/${rid + 300000000}`,
    share_url: share,
    created_at: "2026-10-28T07:36:00Z",
    scheduled_start_time: "2026-10-28T07:00:00Z",
    scheduled_end_time: "2026-10-28T07:30:00Z",
    recording_start_time: "2026-10-28T07:04:00Z",
    recording_end_time: "2026-10-28T07:35:00Z",
    meeting_url: "https://meet.google.com/abc-defg-hij",
    calendar_invitees_domains_type: "one_or_more_external",
    shared_with: "all_teams",
    calendar_invitees: [csmInvitee],
    recorded_by: {
      name: CSM.name,
      email: CSM.email,
      email_domain: "maharamedia.com",
      team: CS,
    },
    default_summary: {
      template_name: "general",
      markdown_formatted: "## An invented summary\nNothing here is real.",
    },
    action_items: [
      {
        description: "Send the invented report",
        user_generated: false,
        completed: false,
        recording_timestamp: "00:12:03",
        recording_playback_url: `${share}?timestamp=723`,
        assignee: { name: CSM.name, email: CSM.email, team: CS },
      },
    ],
    ...over,
  };
}
/** The same meeting in the pull's light list, which carries no summary. */
const light = (m: Row): Row => ({ ...m, default_summary: null });

type Booked = {
  id: number;
  taskId: string;
  clientName: string;
  kind: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  room: string | null;
  emails: string[];
  contactNames: string[];
};
/** A booking as MatchInputs lists it (3.5): Cedar Bakery's, its contact invited. */
const booking = (
  o: Partial<Booked> & Pick<Booked, "id" | "startsAt">,
): Booked => ({
  taskId: CEDAR.taskId,
  clientName: CEDAR.name,
  kind: "checkin",
  status: "confirmed",
  endsAt: null,
  room: null,
  emails: [CONTACT.email],
  contactNames: [CONTACT.name],
  ...o,
});
/** Harbour Optics's booking 30 minutes after the recording: a hint for a candidate. */
const harbourLater = (id: number): Booked =>
  booking({
    id,
    taskId: HARBOUR.taskId,
    clientName: HARBOUR.name,
    startsAt: LATER,
    emails: ["frontdesk@harbouroptics.example"],
    contactNames: ["Sami Testcontact"],
  });
/** MatchInputs (3.5) for one window: the two clients (or `clients`) and the CSM alone. */
function inputs(
  o: {
    bookings?: Booked[];
    formLinks?: { shareUrl: string; taskId: string }[];
    clients?: { taskId: string; name: string }[];
  } = {},
): Row {
  return {
    from: "2026-10-26T21:00:00.000Z",
    to: new Date(NOW).toISOString(),
    bookings: o.bookings ?? [],
    sales: [],
    formLinks: o.formLinks ?? [],
    clients: (o.clients ?? LISTED).map(c => ({
      taskId: c.taskId,
      name: c.name,
      aliases: [],
    })),
    csmEmails: [CSM.email],
    staff: [{ name: CSM.name, email: CSM.email, role: "the CSM" }],
    client: null,
    store: [],
  };
}

// ---------------------------------------------------------------------------
// The worker: fathomSource over a fake database and the real transport.

/** A MatchInputs booking as its cockpit_csm_calls row (the worker reads the rows). */
const bookingRow = (b: Booked): Row => ({
  id: b.id,
  source: "ghl_appointment",
  source_id: `appt-writers-${b.id}`,
  task_id: b.taskId,
  client_name: b.clientName,
  kind: b.kind,
  status: b.status,
  starts_at: b.startsAt,
  ends_at: b.endsAt,
  room: b.room,
  external_invitees: b.emails.map((email, i) => ({
    email,
    name: b.contactNames[i] ?? null,
  })),
});

/** One PostgREST filter (eq, neq, is, in): all the worker's reads use. */
function holds(value: unknown, cond: string): boolean {
  const v = value ?? null;
  if (cond === "is.null") return v === null;
  if (cond === "not.is.null") return v !== null;
  if (cond === "is.true") return v === true;
  if (cond.startsWith("eq.")) return v !== null && String(v) === cond.slice(3);
  if (cond.startsWith("neq.")) return v !== null && String(v) !== cond.slice(4);
  const list = /^in\.\((.*)\)$/.exec(cond);
  if (list)
    return (
      v !== null &&
      list[1]
        .split(",")
        .map(s => s.replace(/^"|"$/g, ""))
        .includes(String(v))
    );
  throw new Error(`The writers' fake database cannot read ${cond}`);
}

/**
 * The worker's database: its reads over invented tables, and every write kept,
 * never applied. A select of plain columns hands back those columns only (null
 * for one the invented row lacks), as PostgREST does, so a read that leaves a
 * column out gives the worker nothing for it (A7.13: existing() must select
 * client_name); a select with an alias or a JSON path hands back the whole row.
 * Ordering is not needed for so few rows; the store pass's or() and the gone
 * pass's window on raw->>created_at are left out, so neither pass finds
 * anything to do here.
 */
function workerDb(tables: Record<string, Row[]>) {
  const wrote = {
    meetings: [] as Row[],
    calls: [] as Row[],
    patches: [] as { table: string; filter: string; values: Row }[],
  };
  let id = 9101;
  const all = async (table: string, query: string): Promise<Row[]> => {
    if (!(table in tables))
      throw new Error(
        `The worker read ${table}, which this test does not fake`,
      );
    let rows = tables[table];
    for (const part of query.split("&")) {
      const at = part.indexOf("=");
      const key = part.slice(0, at);
      if (
        ["select", "order", "limit", "or"].includes(key) ||
        key.includes("->")
      )
        continue;
      rows = rows.filter(r => holds(r[key], part.slice(at + 1)));
    }
    const select = /(?:^|&)select=([^&]*)/.exec(query)?.[1] ?? "";
    const columns = /^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$/.test(select)
      ? select.split(",")
      : null;
    const out = structuredClone(rows);
    return columns
      ? out.map(r => Object.fromEntries(columns.map(c => [c, r[c] ?? null])))
      : out;
  };
  const refuse = (what: string) => async () => {
    throw new Error(`The worker ${what} in a run of this test`);
  };
  const db = {
    all,
    upsert: async (table: string, rows: Row[]) => {
      if (table !== "cockpit_fathom_meetings")
        throw new Error(`The worker upserted ${table}`);
      wrote.meetings.push(...structuredClone(rows));
    },
    insert: refuse("inserted rows"),
    patch: async (table: string, filter: string, values: Row) => {
      wrote.patches.push({ table, filter, values: structuredClone(values) });
    },
    insertReturning: async (table: string, rows: Row[]) => {
      if (table !== "cockpit_csm_calls")
        throw new Error(`The worker inserted into ${table}`);
      wrote.calls.push(...structuredClone(rows));
      return rows.map(r => ({
        id: id++,
        source: r.source,
        source_id: r.source_id,
      }));
    },
    storage: refuse("stored a transcript"),
    storageRemove: refuse("removed a transcript"),
    ping: async () => true,
  } as unknown as Db;
  return { db, wrote };
}

/** Fathom for the worker's transport: one page of meetings, and no transcript yet. */
const fathomNet = (items: Row[]) =>
  (async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.host !== "api.fathom.ai")
      throw new TypeError(`fetch failed: no fake for ${url.host}`);
    if (url.pathname === "/external/v1/meetings")
      return Response.json({ items, limit: 10, next_cursor: null });
    if (/^\/external\/v1\/recordings\/\d+\/transcript$/.test(url.pathname))
      return Response.json({ transcript: [] });
    throw new TypeError(`fetch failed: no fake for ${url.pathname}`);
  }) as typeof fetch;

/** One worker run (--apply) over these MatchInputs, with Fathom listing `list`. */
async function workerRun(o: {
  list: Row[];
  inputs: Row;
  stored?: { meeting: Row; call: Row };
}) {
  const mi = o.inputs;
  const { db, wrote } = workerDb({
    cockpit_sales_recordings: [],
    cockpit_forms: [{ key: "checkin", provider: "typeform" }],
    cockpit_csm_calls: [
      ...mi.bookings.map(bookingRow),
      ...(o.stored ? [o.stored.call] : []),
    ],
    cockpit_csm_call_forms: [],
    cockpit_people: mi.staff.map((s: Row, i: number) => ({
      id: i + 1,
      name: s.name,
      email: s.email,
      active: true,
    })),
    cockpit_fathom_meetings: o.stored ? [o.stored.meeting] : [],
  });
  const ctx: Ctx = {
    db,
    t: makeTransport(
      { FATHOM_API_KEY: "an-invented-fathom-key-for-tests" },
      "csm-calls:writers",
      fathomNet(o.list),
      async () => {},
    ),
    apply: true,
    now: NOW,
    clients: mi.clients.map((c: Row) => ({ ...c, stopped: false })),
    reasons: new Map(),
    // The Typeform source's links from the stored 1-1 forms (MatchInputs.formLinks).
    shareToTask: new Map(
      mi.formLinks.map((f: Row) => [f.shareUrl, f.taskId] as [string, string]),
    ),
    stateOf: () => undefined,
    plan: {},
  };
  await fathomSource(ctx, "2026-10-21T00:00:00.000Z");
  return wrote;
}

/** A writer's rows for the recording: its meeting row and its call row (the ingest item's two halves). */
type Wrote = { meeting: Row; call: Row };

const VIEW = [
  "task_id",
  "client_name",
  "match_method",
  "match_confidence",
  "linked_call_id",
  "kind",
  "candidate",
  "room",
  "hints",
] as const;
/**
 * What the test compares: the meeting's class, and the call's match block,
 * candidate, room and hints; with `titles` (A7.12) the meeting's title and the
 * call's title too.
 */
const view = (w: Wrote, titles = false): Row => ({
  class: w.meeting.class,
  ...Object.fromEntries(VIEW.map(k => [k, w.call[k]])),
  ...(titles ? { meetingTitle: w.meeting.title, title: w.call.title } : {}),
});

/** The worker's first write of the recording: its meeting row and its call row. */
async function worker(m: Row, mi: Row): Promise<Wrote> {
  const wrote = await workerRun({ list: [m], inputs: mi });
  expect(wrote.meetings).toHaveLength(1);
  expect(wrote.calls).toHaveLength(1);
  return { meeting: wrote.meetings[0], call: wrote.calls[0] };
}

/**
 * The worker's re-match loop: a run before the booking or the 1-1 form link
 * exists stores the recording on no client; a later run, whose window no longer
 * lists it, finds the booking or the link and patches the stored row. `seed`
 * goes on the stored copy first, as an earlier write left it.
 */
async function workerLater(m: Row, mi: Row, seed: Row = {}): Promise<Wrote> {
  const first = await workerRun({ list: [m], inputs: inputs() });
  const [stored] = first.meetings;
  const call: Row = {
    ...first.calls[0],
    id: 9201,
    transcript_path: null,
    settled_reason: null,
    ...seed,
  };
  expect(call.task_id).toBeNull();
  const later = await workerRun({
    list: [],
    inputs: mi,
    stored: { meeting: stored, call },
  });
  const patch = later.patches.filter(
    p => p.table === "cockpit_csm_calls" && p.filter === "id=eq.9201",
  );
  expect(patch).toHaveLength(1);
  return { meeting: stored, call: { ...call, ...patch[0].values } };
}

/** The webhook's ingest item for one signed delivery of the meeting. */
async function webhook(m: Row, mi: Row): Promise<Wrote> {
  const h = hookKit.harness({ now: NOW });
  h.db.matchInputs = mi;
  const res = await h.handler(hookKit.delivery(m, { now: NOW }));
  expect(res.status).toBe(200);
  const items = h.db.items();
  expect(items).toHaveLength(1);
  return { meeting: items[0].meeting, call: items[0].call ?? {} };
}

/** The pull's ingest item for the same meeting in Fathom's light list. */
async function pull(m: Row, mi: Row): Promise<Wrote> {
  const f = pullKit.fakeDeps({
    rpc: {
      cockpit_fathom_ingest: (a: Row) => ({
        ok: true,
        meetings: a.p_items.length,
        calls: [],
      }),
      cockpit_fathom_pull_mark: { ok: true },
    },
    routes: [pullKit.fathomApi({ pages: [[light(m)]] })],
    now: new Date(NOW),
  });
  const pulled = await pullFathom(
    pullKit.opOf(f.deps),
    "an-invented-fathom-key-for-tests",
    asInputs(mi),
  );
  expect(pulled.state).toBe("ok");
  const ingests = f.service.named("cockpit_fathom_ingest");
  expect(ingests).toHaveLength(1);
  expect(ingests[0].args.p_via).toBe("pull");
  const [item] = ingests[0].args.p_items;
  return { meeting: item.meeting, call: item.call ?? {} };
}

/**
 * The hints the matcher gives this recording (the pull's Recording, the same
 * MatchInputs), with `over` on the Recording: what a writer that broke a rule
 * would store, so a case can show it tells the rule from its break.
 */
const hintsOf = (
  m: Row,
  mi: Row,
  cls: "client" | "candidate",
  over: Row = {},
) =>
  suggestionsFor(
    { ...recordingOf(m, cls), ...over },
    mi.bookings.map(toBooking),
    mi.clients.map(toClient),
    matchCtx(asInputs(mi), NOW),
  );

// ---------------------------------------------------------------------------
// The cases of A7.2, each with the block all three must write.

type Case = {
  name: string;
  meeting: Row;
  inputs: Row;
  want: Row;
  /** The booking or link can come after the recording: the re-match loop must write the same. */
  later: boolean;
};
const matched = (o: Row): Row => ({
  task_id: CEDAR.taskId,
  client_name: CEDAR.name,
  linked_call_id: null,
  candidate: false,
  hints: [],
  ...o,
});
const zoomCall = (rid: number, external: boolean, who = CONTACT) =>
  meeting(rid, {
    title: "Impromptu Zoom Meeting",
    meeting_title: "Impromptu Zoom Meeting",
    meeting_url: ZOOM,
    calendar_invitees: [csmInvitee, contactInvitee(external, who)],
  });

const CASES: Case[] = [
  {
    name: "the same room as the client's booking: same_room at 1, linked to the booking, with its kind",
    meeting: meeting(196200001),
    inputs: inputs({
      bookings: [
        booking({
          id: 54101,
          startsAt: BOOKED,
          endsAt: "2026-10-28T07:30:00.000Z",
          room: "meet:abc-defg-hij",
        }),
      ],
    }),
    want: matched({
      class: "candidate",
      match_method: "same_room",
      match_confidence: 1,
      linked_call_id: 54101,
      kind: "checkin",
      room: "meet:abc-defg-hij",
    }),
    later: true,
  },
  {
    name: "the client on the invite, booked 4 minutes before: appointment_time at 1, linked to the booking",
    meeting: zoomCall(196200002, true),
    inputs: inputs({ bookings: [booking({ id: 54102, startsAt: BOOKED })] }),
    want: matched({
      class: "client",
      match_method: "appointment_time",
      match_confidence: 1,
      linked_call_id: 54102,
      kind: "checkin",
      room: "zoom:12345678901",
    }),
    later: true,
  },
  {
    name: "the client on the invite, no booking within 30 minutes: invitee_email at 0.9, no link, the title's kind",
    meeting: zoomCall(196200003, true),
    inputs: inputs({ bookings: [booking({ id: 54103, startsAt: EARLY })] }),
    want: matched({
      class: "client",
      match_method: "invitee_email",
      match_confidence: 0.9,
      kind: "other",
      room: "zoom:12345678901",
    }),
    later: true,
  },
  {
    name: "an impromptu recording with the client's email on its invite, booked 4 minutes before: appointment_time at 1",
    meeting: meeting(196200004, {
      meeting_url: "https://meet.google.com/kln-opqr-stu",
      calendar_invitees: [csmInvitee, contactInvitee(false)],
    }),
    inputs: inputs({ bookings: [booking({ id: 54104, startsAt: BOOKED })] }),
    want: matched({
      class: "candidate",
      match_method: "appointment_time",
      match_confidence: 1,
      linked_call_id: 54104,
      kind: "checkin",
      room: "meet:kln-opqr-stu",
    }),
    later: true,
  },
  {
    name: "an impromptu recording with the client's email on its invite, no booking that near: invitee_email at 0.9",
    meeting: meeting(196200005, {
      meeting_url: "https://meet.google.com/kln-opqr-stu",
      calendar_invitees: [csmInvitee, contactInvitee(false)],
    }),
    inputs: inputs({ bookings: [booking({ id: 54105, startsAt: EARLY })] }),
    want: matched({
      class: "candidate",
      match_method: "invitee_email",
      match_confidence: 0.9,
      kind: "other",
      room: "meet:kln-opqr-stu",
    }),
    later: true,
  },
  {
    name: "its Fathom link in a stored 1-1 form: form_task_id at 0.95, no link, the title's kind",
    meeting: meeting(196200006, {
      meeting_url: "https://meet.google.com/vwx-yzab-cde",
    }),
    inputs: inputs({
      formLinks: [
        {
          shareUrl: "https://fathom.video/share/TESTwriters196200006",
          taskId: CEDAR.taskId,
        },
      ],
    }),
    want: matched({
      class: "candidate",
      match_method: "form_task_id",
      match_confidence: 0.95,
      kind: "other",
      room: "meet:vwx-yzab-cde",
    }),
    later: true,
  },
  {
    name: "nothing exact: a candidate on no client, with the same hints from both bookings near it",
    meeting: meeting(196200007, {
      meeting_url: "https://meet.google.com/vwx-yzab-cde",
    }),
    inputs: inputs({
      bookings: [
        booking({
          id: 54107,
          startsAt: "2026-10-28T06:24:00.000Z",
          room: "meet:abc-defg-hij",
        }),
        booking({
          id: 54108,
          taskId: HARBOUR.taskId,
          clientName: HARBOUR.name,
          startsAt: "2026-10-28T07:34:00.000Z",
          emails: ["frontdesk@harbouroptics.example"],
          contactNames: ["Sami Testcontact"],
        }),
      ],
    }),
    want: {
      class: "candidate",
      task_id: null,
      client_name: null,
      match_method: null,
      match_confidence: null,
      linked_call_id: null,
      kind: "other",
      candidate: true,
      room: "meet:vwx-yzab-cde",
      hints: [
        {
          recordingId: "196200007",
          taskId: HARBOUR.taskId,
          clientName: HARBOUR.name,
          signal: "hint_window",
          label: "hint",
          why: "30 min before Harbour Optics's booked call.",
          bookingId: 54108,
          minutes: 30,
          preselect: false,
          ask: false,
        },
        {
          recordingId: "196200007",
          taskId: CEDAR.taskId,
          clientName: CEDAR.name,
          signal: "hint_window",
          label: "hint",
          why: "40 min after Cedar Bakery's booked call.",
          bookingId: 54107,
          minutes: 40,
          preselect: false,
          ask: false,
        },
      ],
    },
    later: false,
  },
];

describe("one recording, three writers (A7.2)", () => {
  for (const c of CASES)
    test(c.name, async () => {
      const got: Row = {
        worker: view(await worker(c.meeting, c.inputs)),
        webhook: view(await webhook(c.meeting, c.inputs)),
        pull: view(await pull(c.meeting, c.inputs)),
      };
      const want: Row = { worker: c.want, webhook: c.want, pull: c.want };
      if (c.later) {
        got.workerRematch = view(await workerLater(c.meeting, c.inputs));
        want.workerRematch = c.want;
      }
      // Name the writers that differ; the diff below says how.
      const differs = Object.keys(got).filter(
        k => !Bun.deepEquals(got[k], c.want),
      );
      expect(got, `Not the A7.2 block: ${differs.join(", ")}`).toEqual(want);
    });
});

// ---------------------------------------------------------------------------
// The cases of A7.12, each with the row all three must write, titles included.

type Case12 = {
  name: string;
  meeting: Row;
  inputs: Row;
  want: Row;
  /** Run the worker's re-match loop too, over a stored copy carrying this. */
  later: Row | false;
  /** The rule's break, as hintsOf's class and Recording: its hints differ from want.hints. */
  broken?: { cls: "client" | "candidate"; over?: Row };
};
/** An unplaced row's empty match block. */
const unplaced = {
  task_id: null,
  client_name: null,
  match_method: null,
  match_confidence: null,
  linked_call_id: null,
};
/** Both title columns, the meeting's and the call's, holding `title`. */
const titled = (title: string) => ({ meetingTitle: title, title });
/** A hint as suggestionsFor writes it (callMatch.ts strip). */
const hint = (
  rid: string,
  client: { taskId: string; name: string },
  o: Row,
): Row => ({
  recordingId: rid,
  taskId: client.taskId,
  clientName: client.name,
  ...o,
});

const CASES_12: Case12[] = [
  {
    name: "a client-class recording nothing places: no hints from any writer, though bookings near it would give some, and the worker's re-match clears hints a stored copy carries",
    meeting: zoomCall(196200101, true),
    inputs: inputs({ bookings: [harbourLater(54201)] }),
    want: {
      class: "client",
      ...titled("Impromptu Zoom Meeting"),
      ...unplaced,
      kind: "other",
      candidate: false,
      room: "zoom:12345678901",
      hints: [],
    },
    later: {
      hints: [
        hint("196200101", HARBOUR, {
          signal: "hint_window",
          label: "hint",
          why: "30 min before Harbour Optics's booked call.",
          bookingId: 54201,
          minutes: 30,
          preselect: false,
          ask: false,
        }),
      ],
    },
    broken: { cls: "client" },
  },
  {
    name: "an unplaced candidate: the same three hints from every writer (the edited title, a booking 4 minutes before, one 30 minutes after)",
    meeting: meeting(196200102, {
      title: "Harbour Optics follow-up",
      meeting_url: "https://meet.google.com/vwx-yzab-cde",
    }),
    inputs: inputs({
      clients: [...LISTED, MARBLE],
      bookings: [
        booking({ id: 54202, startsAt: BOOKED }),
        booking({
          id: 54203,
          taskId: MARBLE.taskId,
          clientName: MARBLE.name,
          startsAt: LATER,
          emails: ["studio@marblestudio.example"],
          contactNames: ["Lina Testcontact"],
        }),
      ],
    }),
    want: {
      class: "candidate",
      ...titled("Harbour Optics follow-up"),
      ...unplaced,
      kind: "other",
      candidate: true,
      room: "meet:vwx-yzab-cde",
      hints: [
        hint("196200102", HARBOUR, {
          signal: "title",
          label: "likely",
          why: "The title names Harbour Optics.",
          preselect: true,
          ask: true,
        }),
        hint("196200102", CEDAR, {
          signal: "near_booking",
          label: "possible",
          why: "Started 4 min after Cedar Bakery's booked call at 10:00.",
          bookingId: 54202,
          minutes: 4,
          preselect: false,
          ask: true,
        }),
        hint("196200102", MARBLE, {
          signal: "hint_window",
          label: "hint",
          why: "30 min before Marble Studio's booked call.",
          bookingId: 54203,
          minutes: 30,
          preselect: false,
          ask: false,
        }),
      ],
    },
    later: {},
  },
  {
    name: "Fathom's title null: the matcher reads no title (not the calendar's, which names Harbour Optics), while the call's and the meeting's title and the kind come from the calendar's",
    meeting: meeting(196200103, {
      title: null,
      meeting_title: "Harbour Optics check-in",
      meeting_url: "https://meet.google.com/vwx-yzab-cde",
    }),
    inputs: inputs({ bookings: [booking({ id: 54204, startsAt: BOOKED })] }),
    want: {
      class: "candidate",
      ...titled("Harbour Optics check-in"),
      ...unplaced,
      kind: "checkin",
      candidate: true,
      room: "meet:vwx-yzab-cde",
      hints: [
        hint("196200103", CEDAR, {
          signal: "near_booking",
          label: "possible",
          why: "Started 4 min after Cedar Bakery's booked call at 10:00.",
          bookingId: 54204,
          minutes: 4,
          preselect: true,
          ask: true,
        }),
      ],
    },
    later: {},
    broken: { cls: "candidate", over: { title: "Harbour Optics check-in" } },
  },
  {
    name: "the same room as a booking of a client the list no longer holds: the booking's client name",
    meeting: meeting(196200104),
    inputs: inputs({
      bookings: [
        booking({
          id: 54205,
          taskId: OLIVE.taskId,
          clientName: OLIVE.name,
          startsAt: BOOKED,
          endsAt: "2026-10-28T07:30:00.000Z",
          room: "meet:abc-defg-hij",
          emails: [OLIVE_CONTACT.email],
          contactNames: [OLIVE_CONTACT.name],
        }),
      ],
    }),
    want: {
      class: "candidate",
      ...titled("Impromptu Google Meet Meeting"),
      task_id: OLIVE.taskId,
      client_name: OLIVE.name,
      match_method: "same_room",
      match_confidence: 1,
      linked_call_id: 54205,
      kind: "checkin",
      candidate: false,
      room: "meet:abc-defg-hij",
      hints: [],
    },
    later: {},
  },
  {
    name: "that client's contact on the invite, booked 4 minutes before (the worker's matchMeeting path): the booking's client name",
    meeting: zoomCall(196200105, true, OLIVE_CONTACT),
    inputs: inputs({
      bookings: [
        booking({
          id: 54206,
          taskId: OLIVE.taskId,
          clientName: OLIVE.name,
          startsAt: BOOKED,
          emails: [OLIVE_CONTACT.email],
          contactNames: [OLIVE_CONTACT.name],
        }),
      ],
    }),
    want: {
      class: "client",
      ...titled("Impromptu Zoom Meeting"),
      task_id: OLIVE.taskId,
      client_name: OLIVE.name,
      match_method: "appointment_time",
      match_confidence: 1,
      linked_call_id: 54206,
      kind: "checkin",
      candidate: false,
      room: "zoom:12345678901",
      hints: [],
    },
    later: {},
  },
];

/** All three writers, and the worker's re-match loop when the case asks, write `c.want`, titles included. */
async function sameInAll(c: Case12, rule: string) {
  if (c.broken)
    expect(
      hintsOf(c.meeting, c.inputs, c.broken.cls, c.broken.over),
      "The case cannot tell the rule from its break",
    ).not.toEqual(c.want.hints);
  const got: Row = {
    worker: view(await worker(c.meeting, c.inputs), true),
    webhook: view(await webhook(c.meeting, c.inputs), true),
    pull: view(await pull(c.meeting, c.inputs), true),
  };
  const want: Row = { worker: c.want, webhook: c.want, pull: c.want };
  if (c.later) {
    got.workerRematch = view(
      await workerLater(c.meeting, c.inputs, c.later),
      true,
    );
    want.workerRematch = c.want;
  }
  const differs = Object.keys(got).filter(k => !Bun.deepEquals(got[k], c.want));
  expect(got, `Not the ${rule} row: ${differs.join(", ")}`).toEqual(want);
}

describe("hints and titles, the same in all three writers (A7.12)", () => {
  for (const c of CASES_12) test(c.name, () => sameInAll(c, "A7.12"));
});

// ---------------------------------------------------------------------------
// A7.13: an invitee's email names only a client on the clients list (the
// worker's contacts index), in all three writers.

/**
 * A client-class recording whose one external invitee is Olive Grove's contact,
 * and Olive Grove's booking 2 h 34 min before it: too far for the booking to
 * name its client (appointment_time needs 30 minutes), so only the email links
 * it.
 */
const oliveByEmail = zoomCall(196200301, true, OLIVE_CONTACT);
const oliveEarly = (): Booked =>
  booking({
    id: 54301,
    taskId: OLIVE.taskId,
    clientName: OLIVE.name,
    startsAt: EARLY,
    emails: [OLIVE_CONTACT.email],
    contactNames: [OLIVE_CONTACT.name],
  });

const CASES_13: Case12[] = [
  {
    name: "a client-class recording linked only by the email of a client the list no longer holds: no writer places it, no hints, and the worker's re-match neither places it nor keeps hints a stored copy carries",
    meeting: oliveByEmail,
    inputs: inputs({ bookings: [oliveEarly()] }),
    want: {
      class: "client",
      ...titled("Impromptu Zoom Meeting"),
      ...unplaced,
      kind: "other",
      candidate: false,
      room: "zoom:12345678901",
      hints: [],
    },
    later: {
      hints: [
        hint("196200301", OLIVE, {
          signal: "hint_window",
          label: "hint",
          why: "An invented stale hint.",
          preselect: false,
          ask: false,
        }),
      ],
    },
  },
  {
    name: "the same recording with that client back on the list: every writer places it by the invitee's email at 0.9 (so the case above tells the rule from its break)",
    meeting: oliveByEmail,
    inputs: inputs({ clients: [...LISTED, OLIVE], bookings: [oliveEarly()] }),
    want: {
      class: "client",
      ...titled("Impromptu Zoom Meeting"),
      task_id: OLIVE.taskId,
      client_name: OLIVE.name,
      match_method: "invitee_email",
      match_confidence: 0.9,
      linked_call_id: null,
      kind: "other",
      candidate: false,
      room: "zoom:12345678901",
      hints: [],
    },
    later: {},
  },
];

describe("the invitee's email names a listed client only, the same in all three writers (A7.13)", () => {
  for (const c of CASES_13) test(c.name, () => sameInAll(c, "A7.13"));
});

// ---------------------------------------------------------------------------
// A7.12 and A7.13 through the ingest: a row placed where the webhook and the
// pull cannot see it (by the worker's matchMeeting, or by a person) ends every
// write on its client with no hints, and a row a person set aside ends every
// write on no client with no hints.

const V = "20261027f_forms_core.sql";
const W = "20261027g_fathom_intake.sql";
/** The CSM's seat, every client (cockpit_members.clients empty). */
const CSM_SEAT = "00000000-0000-4000-8000-0000000000a7";

describe("a placed or settled row keeps no hints through the ingest (A7.12, A7.13)", () => {
  let db: PGlite;

  function cut(file: string, pattern: RegExp, what: string): string {
    const hit = migration(file).match(pattern);
    if (!hit) throw new Error(`Canonical definition missing: ${what}`);
    return hit[0];
  }
  async function asOwner() {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
    await db.query("SELECT set_config('request.jwt.claims','',false)");
  }
  /** As PostgREST with the service key: role service_role in the claims. */
  async function asService<T>(fn: () => Promise<T>): Promise<T> {
    await asOwner();
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    await db.exec("SET ROLE service_role");
    try {
      return await fn();
    } finally {
      await asOwner();
    }
  }
  /** A row as JSON gives it back (dates as text, numbers as numbers): what a REST read hands the worker. */
  const plain = (r: Row): Row =>
    JSON.parse(
      JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? Number(v) : v)),
    );

  /**
   * What v and w stand on, from the canonical migrations as
   * fathom-intake-supabase.test.ts cuts them, without what only other
   * functions read: the sync state (row types in w), the roster and the client
   * gate (the manual match), the call store with 20261011c's grants, the sales
   * index stand-in (w's sales exclusion is LANGUAGE sql, so its tables come
   * first) and the service gate.
   */
  async function standOn() {
    await db.exec(
      cut(
        "20260921e_tap_charges.sql",
        /create table if not exists public\.cockpit_sync_state \([\s\S]*?\n\);/,
        "cockpit_sync_state",
      ),
    );
    await db.exec(
      "ALTER TABLE public.cockpit_sync_state ADD COLUMN IF NOT EXISTS detail jsonb;",
    );
    for (const [pattern, what] of [
      [
        /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_source_state\([^\n]*\n/,
        "cockpit_csm_source_state",
      ],
      [
        /INSERT INTO public\.cockpit_csm_source_state[^\n]*\n/,
        "cockpit_csm_source_state rows",
      ],
      [
        /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_sources\([^\n]*\n/,
        "cockpit_csm_sources",
      ],
    ] as const)
      await db.exec(cut("20260927v_csm_read_models.sql", pattern, what));
    await db.exec(
      cut(
        "20260927a_cockpit_ask_ai_jobs.sql",
        /CREATE OR REPLACE FUNCTION public\.cockpit_ask_ai_owner_allowed\([\s\S]*?\$\$;/,
        "cockpit_ask_ai_owner_allowed",
      ),
    );
    for (const [pattern, what] of [
      [
        /CREATE FUNCTION public\.cockpit_csm_client_gate_for_actor\([\s\S]*?END \$\$;/,
        "gate for actor",
      ],
      [
        /CREATE FUNCTION public\.cockpit_csm_client_gate\(p_task_id text\)[^\n]*\n/,
        "gate",
      ],
      [
        /REVOKE ALL ON FUNCTION public\.cockpit_csm_client_gate_for_actor[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_client_gate\(text\) TO authenticated;/,
        "gate grants",
      ],
    ] as const)
      await db.exec(
        cut("20261006c_csm_onboarding_checkins.sql", pattern, what),
      );
    const store = "20261011c_csm_call_store.sql";
    for (const table of [
      "cockpit_csm_calls",
      "cockpit_csm_call_forms",
      "cockpit_fathom_meetings",
      "cockpit_csm_meta_activities",
      "cockpit_csm_changes",
      "cockpit_csm_unmatched",
      "cockpit_csm_match_audit",
    ])
      await db.exec(
        cut(
          store,
          new RegExp(
            `CREATE TABLE IF NOT EXISTS public\\.${table}\\([\\s\\S]*?\\n\\);`,
          ),
          table,
        ),
      );
    await db.exec(
      cut(
        store,
        /DO \$\$\nDECLARE t text;\nBEGIN\n {2}FOREACH t IN ARRAY ARRAY\['cockpit_csm_calls'[\s\S]*?public\.cockpit_csm_match_audit_id_seq TO service_role;/,
        "store grants",
      ),
    );
    await db.exec(`
      CREATE TABLE public.cockpit_sales_recordings (
        recording_id text PRIMARY KEY, title text, recorded_by text, started_at timestamptz, duration_s integer,
        share_url text, contact_id text, appointment_id text, matched_by text, indexed_at timestamptz NOT NULL DEFAULT now(),
        source text, kind text, language text, people jsonb, summary text, action_items text, transcript_path text,
        transcript_chars integer, transcript_sha text, note_path text, duplicate_of text,
        hidden_reason text CHECK (hidden_reason IN ('duplicate','too short','client service','internal')));
      CREATE TABLE public.cockpit_sales_call_notes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recording_id text NOT NULL UNIQUE, contact_id text, call_type text,
        call_at timestamptz, rep text, notes jsonb NOT NULL, verdict text, verdict_why text, model text,
        written_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE public.cockpit_sales_recordings ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.cockpit_sales_call_notes ENABLE ROW LEVEL SECURITY;`);
    await db.exec(
      cut(
        "20261009a_cockpit_team_hours.sql",
        /CREATE OR REPLACE FUNCTION public\.cockpit_hours_require_service\(\)[\s\S]*?\$\$;/,
        "cockpit_hours_require_service",
      ),
    );
    await db.exec(`
      REVOKE ALL ON FUNCTION public.cockpit_hours_require_service() FROM PUBLIC, anon, authenticated, service_role;
      REVOKE ALL ON public.cockpit_sync_state, public.cockpit_csm_source_state, public.cockpit_csm_sources,
        public.cockpit_sales_recordings, public.cockpit_sales_call_notes FROM anon, authenticated;`);
  }

  /** The CSM's seat, and the roster the client gate reads: the clients MatchInputs lists. */
  async function seats() {
    await member(db, CSM_SEAT, CSM.email, ["csm"]);
    const snap = "2026-10-28T08:00:00Z";
    for (const c of LISTED)
      await db.query(
        "INSERT INTO public.cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)",
        [
          `c-${c.taskId}`,
          [c.name],
          JSON.stringify({
            _id: `c-${c.taskId}`,
            taskId: c.taskId,
            name: c.name,
            stage: "Active",
          }),
          snap,
        ],
      );
    await db.query(
      "UPDATE public.cockpit_csm_source_state SET ready=true,row_count=$1,source_snapshot_at=$2 WHERE table_name='clients'",
      [LISTED.length, snap],
    );
  }

  beforeAll(async () => {
    db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
    await standOn();
    await seats();
    await db.exec(migration(V));
    await db.exec(migration(W));
  });
  afterAll(async () => {
    await db?.close();
  });

  /**
   * The worker's write, as its REST upsert sends it (on_conflict, Prefer
   * resolution=merge-duplicates) with the service key: the columns it names
   * and no other.
   */
  async function workerWrites(
    table: "cockpit_fathom_meetings" | "cockpit_csm_calls",
    row: Row,
  ): Promise<Row> {
    const conflict =
      table === "cockpit_csm_calls" ? "source, source_id" : "recording_id";
    const cols = Object.keys(row).map(c => `"${c}"`);
    const sql = `INSERT INTO public.${table} (${cols.join(", ")})
      SELECT ${cols.join(", ")} FROM jsonb_populate_record(NULL::public.${table}, $1::jsonb)
      ON CONFLICT (${conflict}) DO UPDATE SET ${cols.map(c => `${c} = EXCLUDED.${c}`).join(", ")}
      RETURNING *`;
    return asService(async () =>
      plain((await db.query<Row>(sql, [JSON.stringify(row)])).rows[0]),
    );
  }
  /** cockpit_fathom_ingest with the service key, as the webhook and the pull call it. */
  const ingest = (w: Wrote, via: "webhook" | "pull") =>
    asService(
      async () =>
        (
          await db.query<{ r: Row }>(
            "SELECT public.cockpit_fathom_ingest($1::jsonb, $2) AS r",
            [JSON.stringify([w]), via],
          )
        ).rows[0].r,
    );
  const stored = async (rid: string): Promise<Wrote> => {
    await asOwner();
    const [meetingRow] = (
      await db.query<Row>(
        "SELECT * FROM public.cockpit_fathom_meetings WHERE recording_id = $1",
        [rid],
      )
    ).rows;
    const [call] = (
      await db.query<Row>(
        "SELECT * FROM public.cockpit_csm_calls WHERE source = 'fathom' AND source_id = $1",
        [rid],
      )
    ).rows;
    return { meeting: plain(meetingRow), call: plain(call) };
  };
  /** The stored row's match block, candidate and hints. */
  const block = (w: Wrote): Row => ({
    class: w.meeting.class,
    task_id: w.call.task_id,
    client_name: w.call.client_name,
    match_method: w.call.match_method,
    match_confidence:
      w.call.match_confidence == null ? null : Number(w.call.match_confidence),
    linked_call_id: w.call.linked_call_id,
    kind: w.call.kind,
    candidate: w.call.candidate,
    hints: w.call.hints,
  });
  /** The queue entry the worker writes for a candidate on no client (unmatchedQueue); its id. */
  async function queueEntry(call: Row): Promise<number> {
    await asOwner();
    const [{ id }] = (
      await db.query<{ id: number }>(
        `INSERT INTO public.cockpit_csm_unmatched(item_kind, item_ref, title, at, reason, hint, host_email)
         VALUES ('call', $1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          String(call.id),
          call.title,
          call.starts_at,
          "Impromptu recording with no client yet. Put it on its client here, or paste its Fathom link in the 1-1 form.",
          call.hints[0]?.why ?? null,
          CSM.email,
        ],
      )
    ).rows;
    return id;
  }
  /** One browser RPC as the CSM's seat. */
  async function asCsm(sql: string, args: unknown[]): Promise<Row> {
    await actor(db, CSM_SEAT);
    try {
      return (await db.query<{ r: Row }>(sql, args)).rows[0].r;
    } finally {
      await asOwner();
    }
  }
  /** The CSM's pick in the queue: "This is {client}". */
  const placeByHand = async (call: Row, taskId: string): Promise<Row> =>
    asCsm("SELECT public.cockpit_csm_manual_match($1, $2) AS r", [
      await queueEntry(call),
      taskId,
    ]);
  /** The CSM's "Not a 1-1 call" in the queue, with its reason. */
  const settleByHand = async (call: Row, reason: string): Promise<Row> =>
    asCsm("SELECT public.cockpit_csm_candidate_settle($1, $2) AS r", [
      await queueEntry(call),
      reason,
    ]);

  test("a candidate a person placed: hints [] from the manual match itself; the webhook's and the pull's items, which cannot see that, still carry its hints, and the stored row ends each ingest on the client with hints []; the worker's next runs keep the CSM's client name and write [] too (A7.12, A7.13)", async () => {
    const m = meeting(196200201, {
      meeting_url: "https://meet.google.com/vwx-yzab-cde",
    });
    const mi = inputs({ bookings: [harbourLater(54211)] });
    const rid = "196200201";

    // The worker's first write: a candidate on no client, with Harbour's hint.
    const first = await worker(m, mi);
    expect(view(first)).toMatchObject({
      class: "candidate",
      task_id: null,
      candidate: true,
    });
    const hints = first.call.hints;
    expect(hints).toHaveLength(1);
    await workerWrites("cockpit_fathom_meetings", first.meeting);
    const row = await workerWrites("cockpit_csm_calls", first.call);
    expect(block(await stored(rid)).hints, "stored before the pick").toEqual(
      hints,
    );

    // The CSM puts it on Cedar Bakery from the queue.
    expect(await placeByHand(row, CEDAR.taskId)).toMatchObject({
      ok: true,
      taskId: CEDAR.taskId,
      clientName: CEDAR.name,
    });
    const placed = {
      class: "candidate",
      task_id: CEDAR.taskId,
      client_name: CEDAR.name,
      match_method: "manual",
      match_confidence: 1,
      linked_call_id: null,
      kind: "other",
      candidate: false,
      hints: [],
    };
    // The manual match's own UPDATE leaves no hints (A7.13), before any other write.
    expect(block(await stored(rid)), "right after the manual match").toEqual(
      placed,
    );

    // The webhook's delivery, then the pull's light list: each item is a
    // candidate on no client with the same hints, and each ingest leaves the
    // person's match with none.
    for (const [via, write] of [
      ["webhook", webhook],
      ["pull", pull],
    ] as const) {
      const item = await write(m, mi);
      expect(view(item)).toMatchObject({
        class: "candidate",
        task_id: null,
        candidate: true,
        hints,
      });
      expect(await ingest(item, via)).toMatchObject({
        ok: true,
        meetings: 1,
        calls: [{ recordingId: rid, taskId: CEDAR.taskId }],
      });
      expect(block(await stored(rid)), `after the ${via}'s ingest`).toEqual(
        placed,
      );
    }

    // The worker's next run reads the stored row: the person's match stays,
    // no candidate, no hints, and the client's name stays the one the CSM
    // placed (A7.13: existing() selects client_name and keepManual keeps it).
    // A run while Cedar Bakery is on the clients list takes the list's name; a
    // run after it has left the list keeps the stored one, never null.
    for (const [when, clients] of [
      ["while the client is listed", LISTED],
      ["after the client has left the list", [HARBOUR]],
    ] as const) {
      const again = await workerRun({
        list: [m],
        inputs: inputs({ clients, bookings: [harbourLater(54211)] }),
        stored: await stored(rid),
      });
      expect(again.calls).toHaveLength(1);
      expect(again.calls[0].client_name, `the worker's row ${when}`).toBe(
        CEDAR.name,
      );
      const rewritten = await workerWrites("cockpit_csm_calls", again.calls[0]);
      expect(
        block({ meeting: first.meeting, call: rewritten }),
        `after the worker's next run ${when}`,
      ).toEqual(placed);
    }
  });

  test("a candidate the call_match attach placed (2b, as the submitting seat): hints [] from the attach's own UPDATE, its queue entry resolved; the webhook's and the pull's items still carry its hints, and the stored row ends each ingest on the client with hints [] (A7.13)", async () => {
    const m = meeting(196200204, {
      meeting_url: "https://meet.google.com/vwx-yzab-cde",
    });
    const mi = inputs({ bookings: [harbourLater(54214)] });
    const rid = "196200204";

    const first = await worker(m, mi);
    const hints = first.call.hints;
    expect(hints).toHaveLength(1);
    await workerWrites("cockpit_fathom_meetings", first.meeting);
    const row = await workerWrites("cockpit_csm_calls", first.call);
    const entry = await queueEntry(row);

    // The CSM sends notes naming this recording; call_match puts it on Cedar Bakery.
    await asOwner();
    const attached = (
      await db.query<{ r: Row }>(
        "SELECT public.cockpit_csm_attach_recording($1,$2,$3,$4::jsonb) AS r",
        [
          CEDAR.taskId,
          CEDAR.name,
          rid,
          JSON.stringify({ actorId: CSM_SEAT, email: CSM.email }),
        ],
      )
    ).rows[0].r;
    expect(attached).toMatchObject({ ok: true, taskId: CEDAR.taskId });
    const placed = {
      class: "candidate",
      task_id: CEDAR.taskId,
      client_name: CEDAR.name,
      match_method: "manual",
      match_confidence: 1,
      linked_call_id: null,
      kind: "other",
      candidate: false,
      hints: [],
    };
    expect(block(await stored(rid)), "right after the attach").toEqual(placed);
    const [queue] = (
      await db.query<Row>(
        "SELECT resolved_task_id FROM public.cockpit_csm_unmatched WHERE id = $1",
        [entry],
      )
    ).rows;
    expect(queue.resolved_task_id).toBe(CEDAR.taskId);

    for (const [via, write] of [
      ["webhook", webhook],
      ["pull", pull],
    ] as const) {
      const item = await write(m, mi);
      expect(view(item)).toMatchObject({
        class: "candidate",
        task_id: null,
        candidate: true,
        hints,
      });
      expect(await ingest(item, via)).toMatchObject({ ok: true });
      expect(block(await stored(rid)), `after the ${via}'s ingest`).toEqual(
        placed,
      );
    }
  });

  test("a client-class recording the worker's matchMeeting placed by the client's name in its title (a rule exactMatch lacks): the webhook's and the pull's items leave it on no client, and the stored row keeps the worker's match with hints [] through each ingest", async () => {
    const m = meeting(196200202, {
      title: "Cedar Bakery monthly review",
      meeting_title: "Cedar Bakery monthly review",
      meeting_url: ZOOM,
      calendar_invitees: [csmInvitee, contactInvitee(true)],
    });
    // Harbour's booking 30 minutes after: hints a writer could wrongly give it.
    const mi = inputs({ bookings: [harbourLater(54212)] });
    const rid = "196200202";
    expect(hintsOf(m, mi, "client")).not.toEqual([]);

    const first = await worker(m, mi);
    const byName = {
      class: "client",
      task_id: CEDAR.taskId,
      client_name: CEDAR.name,
      match_method: "name",
      match_confidence: 0.6,
      linked_call_id: null,
      kind: "other",
      candidate: false,
      hints: [],
    };
    expect(block(first)).toEqual(byName);
    await workerWrites("cockpit_fathom_meetings", first.meeting);
    await workerWrites("cockpit_csm_calls", first.call);
    expect(block(await stored(rid))).toEqual(byName);

    for (const [via, write] of [
      ["webhook", webhook],
      ["pull", pull],
    ] as const) {
      const item = await write(m, mi);
      expect(block(item)).toEqual({ ...byName, ...unplaced });
      await ingest(item, via);
      expect(block(await stored(rid)), `after the ${via}'s ingest`).toEqual(
        byName,
      );
    }
  });

  test("a candidate the CSM set aside as not a 1-1 call: hints [] from the settle itself; it stays on no client with hints [] through the webhook's and the pull's items, first carrying hints, then an exact block (its booking's room, which arrived later); the worker's next run leaves it there (A7.13)", async () => {
    const m = meeting(196200203, {
      meeting_url: "https://meet.google.com/vwx-yzab-cde",
    });
    const rid = "196200203";
    const before = inputs({ bookings: [harbourLater(54213)] });
    // Cedar Bakery's booking in the recording's room, stored after the settle.
    const sameRoom = booking({
      id: 54214,
      startsAt: BOOKED,
      endsAt: "2026-10-28T07:30:00.000Z",
      room: "meet:vwx-yzab-cde",
    });
    const after = inputs({ bookings: [harbourLater(54213), sameRoom] });

    const first = await worker(m, before);
    expect(first.call.hints).toHaveLength(1);
    await workerWrites("cockpit_fathom_meetings", first.meeting);
    const row = await workerWrites("cockpit_csm_calls", first.call);

    expect(await settleByHand(row, "not_client")).toMatchObject({
      ok: true,
      reason: "not_client",
    });
    const aside = {
      class: "candidate",
      ...unplaced,
      kind: "other",
      candidate: false,
      hints: [],
      settled_reason: "not_client",
    };
    const settled = async () => {
      const w = await stored(rid);
      return { ...block(w), settled_reason: w.call.settled_reason };
    };
    expect(await settled(), "right after the settle").toEqual(aside);

    for (const [mi, carries] of [
      [before, "hints"],
      [after, "an exact block"],
    ] as const)
      for (const [via, write] of [
        ["webhook", webhook],
        ["pull", pull],
      ] as const) {
        // Neither writer sees the settle (MatchInputs.store is empty here), so
        // each item is what it would be for an open recording.
        const item = await write(m, mi);
        if (carries === "hints")
          expect(block(item)).toMatchObject({
            task_id: null,
            candidate: true,
            hints: first.call.hints,
          });
        else
          expect(block(item)).toMatchObject({
            task_id: CEDAR.taskId,
            match_method: "same_room",
            linked_call_id: 54214,
            candidate: false,
            hints: [],
          });
        expect(await ingest(item, via)).toMatchObject({
          ok: true,
          calls: [{ recordingId: rid, taskId: null }],
        });
        expect(
          await settled(),
          `after the ${via}'s item carrying ${carries}`,
        ).toEqual(aside);
      }

    // The worker never matches a settled row; its write keeps it on no client
    // and leaves settled_reason, which it never names.
    const again = await workerRun({
      list: [m],
      inputs: after,
      stored: await stored(rid),
    });
    expect(again.calls).toHaveLength(1);
    expect(again.calls[0]).not.toHaveProperty("settled_reason");
    await workerWrites("cockpit_csm_calls", again.calls[0]);
    expect(await settled(), "after the worker's next run").toEqual(aside);
  });

  // -------------------------------------------------------------------------
  // A7.14 and A7.17: one tie rule. The window saves through PostgREST, past
  // the door, so if the door and the save read the rule differently the
  // window offers a call the save refuses, or hides one it would take.
  describe("the door and the save run one tie rule (A7.14, A7.17)", () => {
    const CEO_SEAT = "00000000-0000-4000-8000-0000000000c1";
    const ADMIN_SEAT = "00000000-0000-4000-8000-0000000000a1";
    /**
     * Holds csm and the ceo role, so it passes the client gate, yet it is not
     * the CEO (the CEO is by address), not an admin and not one of the CSM's
     * own seats: rule 4 lets it use only the recordings it made.
     */
    const RECORDER_SEAT = "00000000-0000-4000-8000-0000000000b1";
    const CEO_MAIL = "aziz@maharamedia.com";
    const ADMIN_MAIL = "admin.writers@maharamedia.com";
    const RECORDER_MAIL = "closer.writers@maharamedia.com";
    /** The door's verified users, as cockpit_forms_actor returns them. */
    const SEATS = {
      csm: {
        actorId: CSM_SEAT,
        email: CSM.email,
        ceo: false,
        admin: false,
        csm: true,
        roles: ["csm"],
      },
      ceo: {
        actorId: CEO_SEAT,
        email: CEO_MAIL,
        ceo: true,
        admin: false,
        csm: false,
        roles: [],
      },
      admin: {
        actorId: ADMIN_SEAT,
        email: ADMIN_MAIL,
        ceo: false,
        admin: true,
        csm: false,
        roles: ["admin"],
      },
      recorder: {
        actorId: RECORDER_SEAT,
        email: RECORDER_MAIL,
        ceo: false,
        admin: false,
        csm: true,
        roles: ["csm", "ceo"],
      },
    } satisfies Record<string, Actor>;
    type Seat = keyof typeof SEATS;
    const SEAT_KEYS = Object.keys(SEATS) as Seat[];
    /** What one side says: the call can stand here, the tie rule refuses it, or it is another client's. */
    type Verdict = "tied" | "outside" | "other";
    /**
     * A7.14's second sentence (round 4, A7.18): the tie rule's refusal for a
     * recording whose call row is on this card but was placed by a likely sign
     * (rule 2 did not settle it). The contract's words stand here, and the G13
     * case checks that fathom.ts exports OUTSIDE_CS_LIKELY with these words.
     */
    const OUTSIDE_CS_LIKELY =
      "That recording is from outside Customer Success and was put on this client only by a name or email domain in it. If it is this client's call, ask an admin to send the 1-1 notes with it.";
    /** Either of the tie rule's two sentences: the verdict is the same, the words say where the call row is. */
    const tieRefusal = (m: string | null) =>
      m === OUTSIDE_CS || m === OUTSIDE_CS_LIKELY;

    beforeAll(async () => {
      // What the door's match inputs and the notes' views read besides the
      // store, cut from the canonical migrations as forms-core-supabase.test.ts
      // cuts them: the people (staff roles), the media side's client links
      // (aliases), and the two postgres-only name helpers.
      await asOwner();
      await db.exec(
        cut(
          "20260919b_people.sql",
          /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/,
          "cockpit_people",
        ),
      );
      for (const [pattern, what] of [
        [
          /CREATE TABLE IF NOT EXISTS public\.cockpit_media_source_state\([\s\S]*?\n\);/,
          "cockpit_media_source_state",
        ],
        [
          /INSERT INTO public\.cockpit_media_source_state[^\n]*\n/,
          "cockpit_media_source_state rows",
        ],
        [
          /CREATE TABLE IF NOT EXISTS public\.cockpit_media_sources\([\s\S]*?\n\);/,
          "cockpit_media_sources",
        ],
      ] as const)
        await db.exec(cut("20260927w_media_read_models.sql", pattern, what));
      for (const [file, pattern, what, sig] of [
        [
          "20261024a_brand_blueprints.sql",
          /CREATE OR REPLACE FUNCTION public\.cockpit_blueprint_first_name\(p_email text\)[\s\S]*?END \$\$;/,
          "cockpit_blueprint_first_name",
          "cockpit_blueprint_first_name(text)",
        ],
        [
          "20261025n_slack_notices.sql",
          /CREATE OR REPLACE FUNCTION public\.cockpit_slack_notice_role_of\(p_email text\)[\s\S]*?END \$\$;/,
          "cockpit_slack_notice_role_of",
          "cockpit_slack_notice_role_of(text)",
        ],
      ] as const) {
        await db.exec(cut(file, pattern, what));
        await db.exec(
          `REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated, service_role;`,
        );
      }
      await db.exec(`REVOKE ALL ON public.cockpit_people, public.cockpit_media_source_state, public.cockpit_media_sources
        FROM anon, authenticated;`);
      await member(db, CEO_SEAT, CEO_MAIL, []);
      await member(db, ADMIN_SEAT, ADMIN_MAIL, ["admin"]);
      await member(db, RECORDER_SEAT, RECORDER_MAIL, ["csm", "ceo"]);
    });

    /** Minutes after 08:00 Kuwait on the day of NOW: inside the window's "since yesterday". */
    const AT = (min: number) =>
      new Date(Date.parse("2026-10-28T05:00:00Z") + min * 60_000).toISOString();
    const share = (rid: string) => `https://fathom.video/share/TESTtie${rid}`;
    let nextRid = 196300100;
    /** A client-class (or candidate) recording in the store, as the worker writes it (class set, so the trigger keeps its content). */
    async function recording(o: {
      by: string;
      team: string | null;
      start: number;
      title?: string;
      room?: string | null;
      invitees?: string[];
      cls?: "client" | "candidate";
    }): Promise<string> {
      const rid = String(nextRid++);
      const title = o.title ?? "Impromptu Zoom Meeting";
      const invitees = [
        { name: "Invented Recorder", email: o.by, is_external: false },
        ...(o.invitees ?? []).map(email => ({
          name: "Invented Contact",
          email,
          is_external: true,
        })),
      ];
      await asOwner();
      await db.query(
        `INSERT INTO public.cockpit_fathom_meetings(recording_id,title,starts_at,ends_at,recorded_by_email,recorded_by_name,
           external,invitees,url,share_url,summary,raw,class,room,recorder_team)
         VALUES($1,$2,$3,$4,$5,'Invented Recorder',true,$6::jsonb,$7,$8,'Invented summary.',$9::jsonb,$12,$10,$11)`,
        [
          rid,
          title,
          AT(o.start),
          AT(o.start + 30),
          o.by,
          JSON.stringify(invitees),
          `https://fathom.video/calls/${Number(rid) + 300000000}`,
          share(rid),
          JSON.stringify({
            title,
            meeting_title: title,
            recorded_by: {
              name: "Invented Recorder",
              email: o.by,
              team: o.team,
            },
            calendar_invitees: invitees,
            calendar_invitees_domains_type: "one_or_more_external",
            shared_with: "all_teams",
          }),
          o.room ?? null,
          o.team,
          o.cls ?? "client",
        ],
      );
      return rid;
    }
    let nextAppt = 1;
    /** A GoHighLevel booking on a card, with its invitees. */
    async function appointment(
      client: { taskId: string; name: string },
      o: { start: string; room?: string | null; emails?: string[] },
    ): Promise<void> {
      await asOwner();
      await db.query(
        `INSERT INTO public.cockpit_csm_calls(source,source_id,task_id,client_name,match_method,match_confidence,kind,title,
           starts_at,ends_at,status,room,external_invitees)
         VALUES('ghl_appointment',$1,$2,$3,'client_id_field',1,'checkin','Check-in',$4,$5,'confirmed',$6,$7::jsonb)`,
        [
          `appt-tie-${nextAppt++}`,
          client.taskId,
          client.name,
          o.start,
          new Date(Date.parse(o.start) + 30 * 60_000).toISOString(),
          o.room ?? null,
          JSON.stringify(
            (o.emails ?? []).map(email => ({
              email,
              name: "Invented Contact",
            })),
          ),
        ],
      );
    }
    /**
     * A recording's call row on a client: as a person placed it, unless `by`
     * names the worker's matchMeeting rule that wrote it (its name rule is
     * `name` at 0.6, its company-domain rule `invitee_email` at 0.8).
     */
    async function placed(
      rid: string,
      client: { taskId: string; name: string },
      start: number,
      by: { method: string; confidence: number; host: string } = {
        method: "manual",
        confidence: 1,
        host: CEO_MAIL,
      },
    ): Promise<void> {
      await asOwner();
      await db.query(
        `INSERT INTO public.cockpit_csm_calls(source,source_id,task_id,client_name,match_method,match_confidence,kind,title,
           starts_at,status,host_email)
         VALUES('fathom',$1,$2,$3,$4,$5,'other','Recorded call',$6,'held',$7)`,
        [
          rid,
          client.taskId,
          client.name,
          by.method,
          by.confidence,
          AT(start),
          by.host,
        ],
      );
    }
    /**
     * A recording's call row on no card, as the worker writes it: an unplaced
     * candidate's (candidate true), or a client-class recording no rule could
     * place (candidate false, no match block).
     */
    async function unplaced(
      rid: string,
      start: number,
      host: string,
      candidate: boolean,
    ): Promise<void> {
      await asOwner();
      await db.query(
        `INSERT INTO public.cockpit_csm_calls(source,source_id,kind,title,starts_at,status,host_email,candidate)
         VALUES('fathom',$1,'other','Recorded call',$2,'held',$3,$4)`,
        [rid, AT(start), host, candidate],
      );
    }

    /** One RPC of the door, answered by this database as the service role, refusals as the door's client raises them. */
    const viaDb = (sql: string, keys: string[]) => async (a: Row) => {
      try {
        return await asService(
          async () =>
            (
              await db.query<{ r: unknown }>(
                sql,
                keys.map(k => a[k] ?? null),
              )
            ).rows[0].r,
        );
      } catch (e) {
        throw new RpcError(
          (e as Error).message,
          (e as { code?: string }).code ?? null,
        );
      }
    };
    const dbRpc = {
      cockpit_csm_client_gate_for_actor: viaDb(
        "SELECT public.cockpit_csm_client_gate_for_actor($1::uuid,$2) AS r",
        ["p_actor", "p_task_id"],
      ),
      cockpit_fathom_match_inputs: viaDb(
        "SELECT public.cockpit_fathom_match_inputs($1::timestamptz,$2::timestamptz,$3) AS r",
        ["p_from", "p_to", "p_task_id"],
      ),
      cockpit_fathom_find_link: viaDb(
        "SELECT public.cockpit_fathom_find_link($1) AS r",
        ["p_url"],
      ),
      cockpit_form_recordings_tied: viaDb(
        "SELECT public.cockpit_form_recordings_tied($1,$2::text[],$3::uuid,$4::uuid) AS r",
        ["p_task_id", "p_recording_ids", "p_actor", "p_response_id"],
      ),
      // No Fathom key in the vault: no pull and no network; the store answers (A7.16).
      cockpit_forms_key_get: null,
    };
    const door = () => pullKit.fakeDeps({ rpc: dbRpc, now: new Date(NOW) });

    /**
     * What checkin.calls shows this seat for the recording: its link pasted, or
     * listed by its own signs. With `words`, a disabled view gives its sentence
     * as written.
     */
    async function doorSays(
      seat: Actor,
      rid: string,
      client = CEDAR,
      paste = true,
      words = false,
    ): Promise<Verdict | string> {
      const out = await checkinCalls(pullKit.opOf(door().deps, seat), {
        taskId: client.taskId,
        responseId: null,
        shareUrl: paste ? share(rid) : null,
        refresh: false,
      });
      const v = [out.picked, ...out.others].find(x => x?.recordingId === rid);
      if (!v) return "not listed";
      if (v.blocked === null) return "tied";
      if (words) return v.blocked;
      if (tieRefusal(v.blocked)) return "outside";
      return v.blocked.startsWith("On ") ? "other" : v.blocked;
    }

    /** One browser RPC as a seat. */
    async function asSeat<T>(
      seat: string,
      sql: string,
      args: unknown[],
    ): Promise<T> {
      await actor(db, seat);
      try {
        return (await db.query<{ r: T }>(sql, args)).rows[0].r;
      } finally {
        await asOwner();
      }
    }
    /** The seat's open notes on the card are discarded, then new ones open (a shadow draft in 2a). */
    async function freshNotes(seat: string, client = CEDAR): Promise<string> {
      await asOwner();
      const open = (
        await db.query<{ id: string }>(
          "SELECT id FROM public.cockpit_form_responses WHERE form_key='checkin' AND task_id=$1 AND created_by_id=$2 AND state='draft'",
          [client.taskId, seat],
        )
      ).rows;
      for (const r of open)
        await asSeat(
          seat,
          "SELECT public.cockpit_form_discard($1::uuid) AS r",
          [r.id],
        );
      const opened = await asSeat<Row>(
        seat,
        "SELECT public.cockpit_form_open('checkin',$1,$2::uuid,false) AS r",
        [client.taskId, crypto.randomUUID()],
      );
      return opened.response.id;
    }
    /**
     * The window's save of the call, as PostgREST runs it for the seat; the
     * browser's why says pasted, which is never trusted. With `words`, a
     * refusal gives its sentence as written.
     */
    async function saveTo(
      seat: string,
      responseId: string,
      rid: string,
      words = false,
    ): Promise<Verdict | string> {
      try {
        const out = await asSeat<Row>(
          seat,
          "SELECT public.cockpit_form_save($1::uuid,$2::jsonb,$3,NULL) AS r",
          [
            responseId,
            JSON.stringify({
              call: {
                value: { kind: "fathom", recordingId: rid, why: "pasted" },
                seen: null,
              },
            }),
            "writers-tie-0001",
          ],
        );
        return out.applied.includes("call")
          ? "tied"
          : `not applied: ${JSON.stringify(out.conflicts)}`;
      } catch (e) {
        const m = (e as Error).message;
        if (words) return m;
        if (tieRefusal(m)) return "outside";
        return m.startsWith("That recording is on ") ? "other" : m;
      }
    }
    const saveSays = async (seat: Actor, rid: string, client = CEDAR) =>
      saveTo(seat.actorId, await freshNotes(seat.actorId, client), rid);
    /**
     * v's call_match attach (2b: cockpit_form_apply_sql_effects calls it with
     * the submitting seat), run as the owner and rolled back, so a recording
     * it places stays where it was for the next seat and the next case. With
     * `words`, a refusal gives its sentence as written.
     */
    async function attachSays(
      seat: Actor,
      rid: string,
      client = CEDAR,
      words = false,
    ): Promise<Verdict | string> {
      await asOwner();
      await db.exec("BEGIN");
      try {
        const out = (
          await db.query<{ r: Row }>(
            "SELECT public.cockpit_csm_attach_recording($1,$2,$3,$4::jsonb) AS r",
            [
              client.taskId,
              client.name,
              rid,
              JSON.stringify({ actorId: seat.actorId, email: seat.email }),
            ],
          )
        ).rows[0].r;
        return out.ok === true && out.taskId === client.taskId
          ? "tied"
          : `not attached: ${JSON.stringify(out)}`;
      } catch (e) {
        const m = (e as Error).message;
        if (words) return m;
        if (tieRefusal(m)) return "outside";
        return m.startsWith("That recording is on ") ? "other" : m;
      } finally {
        await db.exec("ROLLBACK");
      }
    }
    /** The three sides for one seat and recording: the window's listing, the save, the attach. */
    const sides = async (seat: Actor, rid: string, client = CEDAR) => ({
      door: await doorSays(seat, rid, client),
      save: await saveSays(seat, rid, client),
      attach: await attachSays(seat, rid, client),
    });
    /** The same three sides in their own words: the window's disabled line, the save's and the attach's refusal ("tied" where it stands). */
    const sidesSay = async (seat: Actor, rid: string, client = CEDAR) => ({
      door: await doorSays(seat, rid, client, true, true),
      save: await saveTo(
        seat.actorId,
        await freshNotes(seat.actorId, client),
        rid,
        true,
      ),
      attach: await attachSays(seat, rid, client, true),
    });

    test("for each seat and recording, the door with the database answering, the save and the call_match attach give one answer: each of the four rules ties, a call row on no card settles nothing, a likely sign, a pasted link or a room another card's booking shares ties only for a seat that may place the call, and an address on two cards' bookings ties it for each; where the door's stricter 'on another client' differs, the window refuses what the save and the attach accept", async () => {
      const SALES = "Sales";
      const all = (v: Verdict): Record<Seat, Verdict> => ({
        csm: v,
        ceo: v,
        admin: v,
        recorder: v,
      });
      // Rule 1: the recorder's Fathom team, or one of the CSM's own seats with no team.
      const csTeam = await recording({
        by: "cs.colleague@maharamedia.com",
        team: CS,
        start: 0,
      });
      const csmOwn = await recording({ by: CSM.email, team: null, start: 10 });
      // Rule 2: its call row is on this card, placed by a person (`manual`); on another card it is that client's.
      const onCedar = await recording({ by: CEO_MAIL, team: SALES, start: 20 });
      await placed(onCedar, CEDAR, 20);
      const onHarbour = await recording({
        by: CEO_MAIL,
        team: SALES,
        start: 30,
      });
      await placed(onHarbour, HARBOUR, 30);
      // Rule 3: the same room as this card's booking within 90 minutes, no other card's there.
      const ROOM = "zoom:55500011122";
      await appointment(CEDAR, { start: AT(35), room: ROOM });
      const sameRoom = await recording({
        by: CEO_MAIL,
        team: SALES,
        start: 40,
        room: ROOM,
      });
      // Rule 3: an external invitee on this listed card's booking three days before, outside the window's inputs.
      await appointment(CEDAR, {
        start: "2026-10-25T05:00:00.000Z",
        emails: ["partner@cedar-tie.invalid"],
      });
      const invited = await recording({
        by: CEO_MAIL,
        team: SALES,
        start: 50,
        invitees: ["partner@cedar-tie.invalid"],
      });
      // Rule 3: its share link in a stored 1-1 form of this card.
      const formed = await recording({ by: CEO_MAIL, team: SALES, start: 60 });
      await asOwner();
      await db.query(
        `INSERT INTO public.cockpit_csm_call_forms(token,form_id,form_kind,task_id,submitted_at,answers,recording_url)
         VALUES('writers-tie-form-1','fRokTITH','checkin',$1,$2,$3::jsonb,$4)`,
        [
          CEDAR.taskId,
          AT(100),
          JSON.stringify([
            {
              ref: "recording",
              type: "url",
              value: share(formed),
              title: "Fathom link",
            },
          ]),
          share(formed),
        ],
      );
      // A likely sign alone: the CEO's call whose title names the client.
      const titled = await recording({
        by: CEO_MAIL,
        team: SALES,
        start: 70,
        title: `${CEDAR.name} pricing review`,
      });
      // A pasted link alone: the recorder's call with no sign for any client.
      const bare = await recording({
        by: RECORDER_MAIL,
        team: SALES,
        start: 80,
      });
      // A7.14 rule 3 word for word: one address on live bookings of two listed cards ties the call for each.
      for (const client of [CEDAR, HARBOUR])
        await appointment(client, {
          start:
            client === CEDAR
              ? "2026-10-24T06:00:00.000Z"
              : "2026-10-24T09:00:00.000Z",
          emails: ["ops@shared-tie.invalid"],
        });
      const twoCards = await recording({
        by: CEO_MAIL,
        team: SALES,
        start: 90,
        invitees: ["ops@shared-tie.invalid"],
      });
      // A call row on no card settles nothing (A7.14, A7.17): the CSM's own
      // unplaced candidate is tied by rule 1, and a closer's client-class
      // call that no rule could place only by rule 4.
      const csmCandidate = await recording({
        by: CSM.email,
        team: CS,
        start: 100,
        cls: "candidate",
      });
      await unplaced(csmCandidate, 100, CSM.email, true);
      const closerUnplaced = await recording({
        by: RECORDER_MAIL,
        team: SALES,
        start: 110,
      });
      await unplaced(closerUnplaced, 110, RECORDER_MAIL, false);
      // Rule 3's room clause: another card's booking in the same room within
      // 90 minutes means the room names neither card, so only rule 4 is left.
      const SHARED = "zoom:55500033344";
      await appointment(CEDAR, { start: AT(125), room: SHARED });
      await appointment(HARBOUR, { start: AT(140), room: SHARED });
      const sharedRoom = await recording({
        by: CEO_MAIL,
        team: SALES,
        start: 130,
        room: SHARED,
      });
      // The door's stricter "on another client" (A7.14's order bullet): the
      // room holds only Harbour's booking, an exact sign for Harbour that no
      // writer has stored yet, so the window refuses it on Cedar; the save
      // and the attach, which cannot run the matcher, read the tie rule, whose
      // invitee clause (the address on Cedar's booking two days before) ties it.
      const HARBOUR_ROOM = "zoom:55500055566";
      await appointment(HARBOUR, { start: AT(150), room: HARBOUR_ROOM });
      await appointment(CEDAR, {
        start: "2026-10-26T05:00:00.000Z",
        emails: ["finance@cedar-tie.invalid"],
      });
      const roomElsewhere = await recording({
        by: CEO_MAIL,
        team: SALES,
        start: 155,
        room: HARBOUR_ROOM,
        invitees: ["finance@cedar-tie.invalid"],
      });

      const placer: Record<Seat, Verdict> = {
        csm: "outside",
        ceo: "tied",
        admin: "tied",
        recorder: "outside",
      };
      const cases: [string, string, Record<Seat, Verdict>][] = [
        ["rule 1, the Customer Success team", csTeam, all("tied")],
        ["rule 1, a CSM seat with no team", csmOwn, all("tied")],
        ["rule 2, its call row on this card", onCedar, all("tied")],
        ["its call row on another card", onHarbour, all("other")],
        ["rule 3, the same room", sameRoom, all("tied")],
        [
          "rule 3, the client on an older booking's invite",
          invited,
          all("tied"),
        ],
        ["rule 3, its link in a stored 1-1 form", formed, all("tied")],
        [
          "a likely sign alone: rule 4 for the CEO and an admin",
          titled,
          placer,
        ],
        [
          "a pasted link alone: rule 4 for the CEO, an admin and its recorder",
          bare,
          { ...placer, recorder: "tied" },
        ],
        ["an address on two cards' bookings", twoCards, all("tied")],
        [
          "a call row on no card, the CSM's candidate: rule 1",
          csmCandidate,
          all("tied"),
        ],
        [
          "a call row on no card, a closer's unplaced call: rule 4 for the CEO, an admin and its recorder",
          closerUnplaced,
          { ...placer, recorder: "tied" },
        ],
        [
          "a room another card's booking shares: rule 4 for the CEO and an admin",
          sharedRoom,
          placer,
        ],
      ];
      const got: Record<string, unknown> = {};
      const want: Record<string, unknown> = {};
      for (const [name, rid, verdicts] of cases)
        for (const seat of SEAT_KEYS) {
          const key = `${name} · ${seat}`;
          got[key] = await sides(SEATS[seat], rid);
          want[key] = {
            door: verdicts[seat],
            save: verdicts[seat],
            attach: verdicts[seat],
          };
        }
      // The other card holding the same address reads the same, on every side.
      got["an address on two cards' bookings, on the other card · csm"] =
        await sides(SEATS.csm, twoCards, HARBOUR);
      want["an address on two cards' bookings, on the other card · csm"] = {
        door: "tied",
        save: "tied",
        attach: "tied",
      };
      // Where the door's "on another client" is stricter, the window never
      // offers the call; the save and the attach hold it to the tie rule.
      for (const seat of SEAT_KEYS) {
        const key = `a room that names another card, an invitee on this card's booking · ${seat}`;
        got[key] = await sides(SEATS[seat], roomElsewhere);
        want[key] = { door: "other", save: "tied", attach: "tied" };
      }
      // Unpasted, the title lists the CEO's call for every seat: disabled for the CSM, usable for the CEO.
      got["the title, listed without a paste"] = {
        csm: await doorSays(SEATS.csm, titled, CEDAR, false),
        ceo: await doorSays(SEATS.ceo, titled, CEDAR, false),
      };
      want["the title, listed without a paste"] = {
        csm: "outside",
        ceo: "tied",
      };
      expect(got).toEqual(want);
    });

    // A7.14 rule 2 as decided in round 3 and landed in 2a (A7.17, section 13
    // G12): only a call row an exact sign or a person placed settles the tie
    // (db: v's rule 2, the attach with no own-card shortcut, the store item's
    // onTaskConfidence; forms-api: callMatch placedExactly, tiedHere,
    // needsTie, 5.2 row 3b). The worker's matchMeeting places every
    // client-class meeting, a closer's call the sales desk has not indexed
    // included, by a client's name in its title (`name`, 0.6) or an invitee
    // at a client's company domain (`invitee_email`, 0.8). Such a row is held
    // to rules 1, 3 and 4 at the door, the save and the attach alike. Which of
    // the tie rule's two sentences the CSM reads is pinned in the next case.
    test("rule 2 ties only a call row an exact sign or a person placed: a closer's call the worker put on this card by its title's client name or by a company domain is held to rules 1, 3 and 4, so the tie rule refuses the CSM at the door, the save and the attach, and the CEO, an admin and its recorder may use it", async () => {
      const SALES = "Sales";
      const byName = await recording({
        by: RECORDER_MAIL,
        team: SALES,
        start: 170,
        title: `${CEDAR.name} pricing review`,
      });
      await placed(byName, CEDAR, 170, {
        method: "name",
        confidence: 0.6,
        host: RECORDER_MAIL,
      });
      const byDomain = await recording({
        by: RECORDER_MAIL,
        team: SALES,
        start: 180,
        invitees: ["buyer@cedarbakery-tie.invalid"],
      });
      await placed(byDomain, CEDAR, 180, {
        method: "invitee_email",
        confidence: 0.8,
        host: RECORDER_MAIL,
      });
      const want: Record<Seat, Verdict> = {
        csm: "outside",
        ceo: "tied",
        admin: "tied",
        recorder: "tied",
      };
      const got: Record<string, unknown> = {};
      const wanted: Record<string, unknown> = {};
      for (const [name, rid] of [
        ["placed by the client's name in its title", byName],
        ["placed by a company domain", byDomain],
      ] as const)
        for (const seat of SEAT_KEYS) {
          got[`${name} · ${seat}`] = await sides(SEATS[seat], rid);
          wanted[`${name} · ${seat}`] = {
            door: want[seat],
            save: want[seat],
            attach: want[seat],
          };
        }
      expect(got).toEqual(wanted);
    });

    // A7.14's two sentences, decided in round 4 (A7.18, R4-regressions-2):
    // OUTSIDE_CS says "is not on this client", which was true only while rule
    // 2 tied every row on this card. A call the worker put on this card by a
    // likely sign sits on the client's Calls card, and no admin tool in 2a can
    // match a row already on a card, so the CSM reads OUTSIDE_CS_LIKELY there
    // (the door when rec.onTask is this card, v's save and attach when the
    // call row's task_id is this card); a call row on no card keeps
    // OUTSIDE_CS. Landed in 2a by db (v) and forms-api (fathom.ts, calls.ts,
    // drafts.ts, the transcript); this case pins it (section 13 G13).
    test("A7.14's second sentence (round 4, A7.18, section 13 G13): the CSM refused a closer's call that the worker put on this card by a name or a company domain reads OUTSIDE_CS_LIKELY, word for word, at the door, the save and the attach, a closer's call whose row is on no card keeps OUTSIDE_CS, and fathom.ts exports the sentence", async () => {
      const SALES = "Sales";
      const byName = await recording({
        by: RECORDER_MAIL,
        team: SALES,
        start: 190,
        title: `${CEDAR.name} renewal pricing`,
      });
      await placed(byName, CEDAR, 190, {
        method: "name",
        confidence: 0.6,
        host: RECORDER_MAIL,
      });
      const byDomain = await recording({
        by: RECORDER_MAIL,
        team: SALES,
        start: 200,
        invitees: ["orders@cedarbakery-tie.invalid"],
      });
      await placed(byDomain, CEDAR, 200, {
        method: "invitee_email",
        confidence: 0.8,
        host: RECORDER_MAIL,
      });
      const onNoCard = await recording({
        by: RECORDER_MAIL,
        team: SALES,
        start: 210,
      });
      await unplaced(onNoCard, 210, RECORDER_MAIL, false);
      const api = (await import(
        "../../../supabase/functions/cockpit-forms-api/fathom.ts"
      )) as unknown as Record<string, unknown>;
      const everySide = (m: string) => ({ door: m, save: m, attach: m });
      expect({
        export: api.OUTSIDE_CS_LIKELY ?? null,
        "placed by the client's name in its title": await sidesSay(
          SEATS.csm,
          byName,
        ),
        "placed by a company domain": await sidesSay(SEATS.csm, byDomain),
        "a call row on no card": await sidesSay(SEATS.csm, onNoCard),
      }).toEqual({
        export: OUTSIDE_CS_LIKELY,
        "placed by the client's name in its title":
          everySide(OUTSIDE_CS_LIKELY),
        "placed by a company domain": everySide(OUTSIDE_CS_LIKELY),
        "a call row on no card": everySide(OUTSIDE_CS),
      });
    });

    test("the drafts' and the transcript's check of a saved call (savedCallRefusal) reads the response's own seat, never the seat asking, and agrees with that seat's save", async () => {
      const titled = await recording({
        by: CEO_MAIL,
        team: "Sales",
        start: 120,
        title: `${CEDAR.name} renewal review`,
      });
      const ceoNotes = await freshNotes(CEO_SEAT);
      const csmNotes = await freshNotes(CSM_SEAT);
      expect({
        ceo: await saveTo(CEO_SEAT, ceoNotes, titled),
        csm: await saveTo(CSM_SEAT, csmNotes, titled),
      }).toEqual({
        ceo: "tied",
        csm: "outside",
      });
      const f = door();
      const check = async (asker: Actor, responseId: string) => {
        const op = pullKit.opOf(f.deps, asker);
        const { item, inputs } = await recordingFor(
          op,
          CEDAR.taskId,
          titled,
          AT(120),
        );
        if (!item) return "not in the store";
        const refusal = await savedCallRefusal(
          op,
          toRecording(item),
          CEDAR.taskId,
          inputs.bookings.map(toBooking),
          matchCtx(inputs, NOW),
          responseId,
        );
        return refusal === null ? "tied" : refusal.reason;
      };
      expect({
        "the CEO's notes, the CEO asking": await check(SEATS.ceo, ceoNotes),
        "the CEO's notes, the CSM asking": await check(SEATS.csm, ceoNotes),
        "the CSM's notes, the CSM asking": await check(SEATS.csm, csmNotes),
        "the CSM's notes, the CEO asking": await check(SEATS.ceo, csmNotes),
      }).toEqual({
        "the CEO's notes, the CEO asking": "tied",
        "the CEO's notes, the CSM asking": "tied",
        "the CSM's notes, the CSM asking": "outside",
        "the CSM's notes, the CEO asking": "outside",
      });
      // Each ask names the response and no seat.
      expect(
        f.service
          .named("cockpit_form_recordings_tied")
          .map(c => [c.args.p_actor, c.args.p_response_id]),
      ).toEqual([
        [null, ceoNotes],
        [null, ceoNotes],
        [null, csmNotes],
        [null, csmNotes],
      ]);
    });
  });
});
