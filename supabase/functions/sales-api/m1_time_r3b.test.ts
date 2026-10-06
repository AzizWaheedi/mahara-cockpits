// bun test supabase/functions/sales-api/m1_time_r3b.test.ts
//
// Milestone 1, video-link round 3 (second run), the TIME angle on sales-api's
// own path. The pilot settings (m1-scope.md section 3): rooms on, both
// providers, every send channel on, test_only with the lead as the test
// contact, short_link off, count_on_join, settle, wrap and auto_on_miss off,
// live.enabled off, followups.agent off, fallback.scope "intro" as shipped
// ("any" where a manager set it, as m1-scope says). The WhatsApp gate is
// shut (the pilot today: the link goes by email) unless a test opens it.
//
// Each test drives sales-api's own actions (room.create, room.event
// worker.ready and tick, room.status) on testfakes.ts with a clock only the
// test moves; the room worker's handshake is written as the worker writes it
// (contract v2 section 7). A failing test is a finding. Every lead is
// invented (stress-m1t3b-...), every seat is ...@stress.invalid.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { hoursRefusal } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter-m1t3b@stress.invalid";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

/** A Kuwait wall-clock moment (UTC+3) as an instant. */
const kw = (s: string) => Date.parse(`${s}+03:00`);
const iso = (t: number) => new Date(t).toISOString();
const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** The cockpit's own rule for a message that is not a first message: 09:00 to 21:00 on every clock of the lead's. */
const daytime = (country: string, t: number) => hoursRefusal({ segment: "confirm", touch: 2, country, now: t, followups: {} }) === null;

type Outcome = "sent" | "throttled";

interface WorldOpts {
  country?: string;
  phone?: string;
  gate?: boolean;
  scope?: "intro" | "any";
  /** What HighLevel answers each email send in turn (the last repeats). */
  email?: Outcome[];
  /** What HighLevel answers each WhatsApp free text in turn (the last repeats). */
  text?: Outcome[];
  /**
   * PostgREST as production answers it: a select naming a column the table
   * does not have is a 400 (42703), for the tables listed in PROD_COLUMNS.
   */
  prodSchema?: boolean;
  /** The lead's booked demos cannot be read (the database answers 500). */
  demosUnread?: boolean;
}

/**
 * Production's columns (Creative Triage, information_schema.columns, read on
 * 6 October 2026), for the tables this file checks selects against. No
 * migration in the branch (20261003a to d, 20261004a) adds a column to it.
 */
const PROD_COLUMNS: Record<string, readonly string[]> = {
  cockpit_sales_appointments: [
    "appointment_id",
    "contact_id",
    "contact_name",
    "calendar_id",
    "call_type",
    "start_at",
    "booked_at",
    "status",
    "assigned_user_id",
    "assigned_user_name",
    "ad_id",
    "origin",
    "mirrored_at",
  ],
};

function world(now: number, o: WorldOpts = {}) {
  const w = fakeWorld(now);
  if (o.prodSchema) {
    const inner = w.io.db;
    w.io.db = (path, init) => {
      const [table, query = ""] = path.split("?");
      const cols = PROD_COLUMNS[String(table)];
      const sel = /(?:^|&)select=([^&]*)/.exec(query)?.[1];
      if (cols && sel && sel !== "*") {
        const missing = decodeURIComponent(sel)
          .split(",")
          .map(c => c.trim())
          .find(c => c && !cols.includes(c));
        if (missing)
          return Promise.reject(new DbError(`Database said 400: column ${String(table)}.${missing} does not exist`, 400, "42703"));
      }
      return inner(path, init);
    };
  }
  if (o.demosUnread) {
    const inner = w.io.db;
    w.io.db = (path, init) =>
      String(path).startsWith("cockpit_sales_appointments?") && /call_type=eq\.demo/.test(String(path))
        ? Promise.reject(new DbError("Database said 500: the server is restarting", 500))
        : inner(path, init);
  }
  const jobs: Promise<unknown>[] = [];
  const LEAD = `stress-m1t3b-${fakeUuid().slice(-8)}`;
  const phone = o.phone ?? "+96550123456";
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: true,
        test_contacts: [LEAD],
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        count_on_join: false,
        settle: false,
        wrap: false,
        short_link: false,
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: o.scope ?? "intro", auto_on_miss: false },
      },
    },
    { key: "live", value: { enabled: false, slack: false } },
    { key: "followups", value: { enabled: true, agent: false } },
    {
      key: "whatsapp_guard",
      value: o.gate
        ? { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 }
        : { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 },
    },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: iso(now - 5 * S) }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, country: o.country ?? "KW", phone, assigned_to: "G-setter" }]);
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: `c-${LEAD}`, contact_id: LEAD, inbound_whatsapp_at: iso(now - 2 * HOUR) }]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return {
        contact: { id: LEAD, firstName: "Sam", name: "Sam Lee", phone, email: `${LEAD}@example.invalid`, tags: ["roas-qualified"], country: o.country ?? "KW" },
      };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    if (m === "GET" && /^\/conversations\/messages\//.test(p)) {
      const id = decodeURIComponent(p.split("/").pop() ?? "");
      return { message: { id, status: "delivered" } };
    }
    return null as unknown as Row;
  });
  /** Every send HighLevel took (the lead has it). */
  const sent: { channel: string; at: number; body: string }[] = [];
  /** Every send asked of HighLevel, taken or not. */
  const asked: { channel: string; at: number }[] = [];
  const used = new Map<string, number>();
  function next(lane: "email" | "text"): Outcome {
    const list = (lane === "email" ? o.email : o.text) ?? ["sent"];
    const n = used.get(lane) ?? 0;
    used.set(lane, n + 1);
    return list[Math.min(n, list.length - 1)] as Outcome;
  }
  const deps: RoomDeps = {
    io: {
      ...w.io,
      background: p => {
        jobs.push(p.catch(e => w.logs.push(`background: ${String((e as Error)?.message ?? e)}`)));
      },
    },
    audit: async () => {},
    markAppointment: async () => ({ crm: "written" }),
    sendText: async (_who, b) => {
      const lane = b.channel === "email" ? "email" : "text";
      asked.push({ channel: String(b.channel), at: w.clock.now });
      const row: Row = {
        id: fakeUuid(),
        request_id: b.request_id,
        contact_id: b.contact_id,
        channel: b.channel,
        via: "conversation",
        body: b.body,
        source: "room",
        state: "sending",
        created_at: iso(w.clock.now),
      };
      w.db.t("cockpit_sales_messages").push(row);
      if (next(lane) === "throttled") {
        row.state = "failed";
        row.error = "HighLevel said 429: Too Many Requests";
        throw new ApiRefusal(`HighLevel did not send it: ${String(row.error)}`, 502, { certain: true });
      }
      sent.push({ channel: String(b.channel), at: w.clock.now, body: String(b.body ?? "") });
      row.state = "sent";
      row.provider_status = "sent";
      row.ghl_message_id = `m-${fakeUuid().slice(-8)}`;
      return { message: { ...row } };
    },
    sendTemplate: async (_who, t) => {
      asked.push({ channel: "whatsapp_template", at: w.clock.now });
      sent.push({ channel: "whatsapp_template", at: w.clock.now, body: "" });
      const row: Row = {
        id: fakeUuid(),
        request_id: t.requestId,
        contact_id: t.contactId,
        channel: "whatsapp",
        via: "workflow",
        template_key: t.key,
        source: "room",
        state: "delivered",
        provider_status: "delivered",
        created_at: iso(w.clock.now),
      };
      w.db.t("cockpit_sales_messages").push(row);
      return { message: { ...row } };
    },
    upcoming: async () => null,
    sentSince: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  async function drain() {
    for (let i = 0; i < 10; i++) {
      await realSleep(1);
      await Promise.race([Promise.allSettled(jobs.slice()), realSleep(40)]);
    }
  }
  function heartbeat(at: number) {
    for (const r of w.db.t("cockpit_sales_worker_status")) if (r.job === "rooms") r.at = iso(at - 5 * S);
  }
  let meetings = 0;
  /** The room worker (contract v2 section 7): claims, makes the meeting, stores worker.ready, opens the room. */
  async function workerOpens(id: string, at: number) {
    w.clock.now = at;
    heartbeat(at);
    const r = room(id);
    meetings++;
    const mid = `abc-defg-h${meetings}${fakeUuid().slice(-3)}`;
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made in 4.0 s." },
      prefer: "resolution=ignore-duplicates",
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: `https://meet.google.com/${mid}`,
        provider_meeting_id: mid,
        opened_at: w.db.iso(),
        host_by: iso(w.clock.now + 15 * MIN),
        ends_at: iso(w.clock.now + 30 * MIN),
        version: Number(room(id).version) + 1,
      },
    });
    await rooms.desk["room.event"]!(desk, {
      kind: "worker.ready",
      room_id: id,
      payload: { provider: "meet", provider_meeting_id: mid, worker_run: "run-1" },
    });
    await drain();
  }
  /** The lead page's Send a video link (manual), or the dialer's after a missed call that rang at `rang` (fallback). */
  async function create(
    at: number,
    ask: { purpose: "manual" | "fallback"; rang?: number } = { purpose: "manual" },
  ): Promise<{ id: string | null; refused: string | null }> {
    w.clock.now = at;
    heartbeat(at);
    let attempt: string | null = null;
    if (ask.purpose === "fallback" && ask.rang !== undefined) {
      attempt = fakeUuid();
      w.db.seed("cockpit_sales_attempts", [
        {
          id: attempt,
          contact_id: LEAD,
          rep_email: SETTER,
          appointment_id: null,
          item_kind: "lead",
          state: "saved",
          outcome: "no_answer",
          call_state: "no_answer",
          call_duration_s: 0,
          started_at: iso(ask.rang),
          saved_at: iso(ask.rang + 35 * S),
        },
      ]);
    }
    try {
      const out = await rooms.actions["room.create"]!(setter, {
        request_id: crypto.randomUUID(),
        contact_id: LEAD,
        purpose: ask.purpose,
        provider: "meet",
        call_kind: "intro",
        trigger: ask.purpose === "manual" ? "manual" : "no_answer",
        ...(attempt ? { attempt_id: attempt, item_kind: "lead" } : {}),
      });
      return { id: String((out.room as Row).id), refused: null };
    } catch (e) {
      return { id: null, refused: String((e as Error).message) };
    }
  }
  async function tick(id: string, at: number) {
    w.clock.now = at;
    heartbeat(at);
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await drain();
  }
  async function status(id: string): Promise<Row> {
    return ((await rooms.actions["room.status"]!(setter, { room_id: id })) as Row).room as Row;
  }
  return { ...w, rooms, room, sent, asked, workerOpens, create, tick, status, drain, LEAD };
}

// ---------------------------------------------------------------------------
// 1. A link pressed by day and tried again (HighLevel's 429) when night
//    begins on the lead's clock.
// ---------------------------------------------------------------------------

describe("Thursday 8 October, Kuwait lead, gate shut (email): the lead page's link pressed at 20:58:30; HighLevel answers 429 until 21:02", () => {
  const press = kw("2026-10-08T20:58:30");
  test("setup: the press and the open are day on the lead's clock; 21:02:41 is night", () => {
    expect(daytime("KW", press)).toBe(true);
    expect(daytime("KW", kw("2026-10-08T20:58:40"))).toBe(true);
    expect(daytime("KW", kw("2026-10-08T21:02:41"))).toBe(false);
  });

  test("setup: the first send meets the 429 and the room says the link is tried again in a minute", async () => {
    const w = world(press, { email: ["throttled", "throttled", "throttled", "throttled", "sent"] });
    const out = await w.create(press);
    expect(out.refused).toBeNull();
    const id = String(out.id);
    await w.workerOpens(id, kw("2026-10-08T20:58:40"));
    expect(w.asked.map(a => a.channel)).toEqual(["email"]);
    expect(w.sent.length).toBe(0);
    expect(String(w.room(id).refusal ?? "")).toMatch(/tried again in a minute\.$/);
  });

  test("control: HighLevel takes it on the re-ask at 21:01:20 (inside the press's three minutes): the link goes", async () => {
    const w = world(press, { email: ["throttled", "throttled", "sent"] });
    const id = String((await w.create(press)).id);
    await w.workerOpens(id, kw("2026-10-08T20:58:40"));
    await w.tick(id, kw("2026-10-08T20:59:41"));
    await w.tick(id, kw("2026-10-08T21:01:20"));
    expect(w.sent.map(s => s.channel)).toEqual(["email"]);
  });

  test("HighLevel takes it on the re-ask at 21:02:41: the link the room has been trying since 20:58:40 still reaches the lead", async () => {
    const w = world(press, { email: ["throttled", "throttled", "throttled", "throttled", "sent"] });
    const id = String((await w.create(press)).id);
    await w.workerOpens(id, kw("2026-10-08T20:58:40"));
    const said: Record<string, string> = {};
    for (const at of ["20:59:41", "21:00:41", "21:01:41", "21:02:41"]) {
      await w.tick(id, kw(`2026-10-08T${at}`));
      said[at] = String(w.room(id).refusal ?? "");
    }
    const r = w.room(id);
    // Found when it fails: the room said "tried again in a minute" at 20:58:40,
    // 20:59:41 and 21:00:41; the re-ask at 21:01:41 runs sendLink's night
    // rule (rooms.ts nightHolds) with the press's grace (PRESS_GRACE_MS,
    // three minutes from 20:58:30) just over, so the link the room was still
    // trying is never sent: the room says "It is night where the lead is, so
    // no message went. Read the link out if you are speaking with them." to
    // a setter who pressed by day for a lead nobody is speaking with, stops
    // the re-ask, and starts the lead's ten minutes (lead_by) on a link the
    // lead never got, so the sweep's R4 closes it as the lead's no-show.
    expect({
      said_2100: said["21:00:41"]?.endsWith("tried again in a minute.") ? "tried again" : said["21:00:41"],
      said_2101: said["21:01:41"]?.endsWith("tried again in a minute.") ? "tried again" : said["21:01:41"],
      sent: w.sent.map(s => s.channel),
      link_sent_at: r.link_sent_at ? "set" : null,
      refusal: r.refusal ?? null,
      // The lead's ten minutes run from a link that went, never from a read-out to nobody.
      lead_by_without_link: !r.link_sent_at && r.lead_by ? iso(Date.parse(String(r.lead_by))) : null,
    }).toEqual({ said_2100: "tried again", said_2101: "tried again", sent: ["email"], link_sent_at: "set", refusal: null, lead_by_without_link: null });
  });
});

describe("Thursday 8 October, Kuwait lead, gate shut (email): the link pressed at 20:58:30 meets HighLevel's 429 for longer than its ten minutes of re-asks", () => {
  const press = kw("2026-10-08T20:58:30");
  test("m1-time-r3b-retried-link-cut-by-night-after-press-grace (the close): past the retry window night stops the link; nothing went, so the lead's ten minutes never start and the room never reads as the lead's no-show", async () => {
    const w = world(press, { email: Array.from({ length: 30 }, () => "throttled" as const) });
    const id = String((await w.create(press)).id);
    await w.workerOpens(id, kw("2026-10-08T20:58:40"));
    for (let m = 59; m <= 70; m++) {
      const hh = m < 60 ? "20" : "21";
      const mm = String(m % 60).padStart(2, "0");
      await w.tick(id, kw(`2026-10-08T${hh}:${mm}:41`));
    }
    const r = w.room(id);
    expect({ sent: w.sent.length, link_sent_at: r.link_sent_at ?? null, refusal: r.refusal ?? null, lead_by: r.lead_by ?? null }).toEqual({
      sent: 0,
      link_sent_at: null,
      refusal: "It is night where the lead is, so no message went. Read the link out if you are speaking with them.",
      lead_by: null,
    });
  });
});

describe("Thursday 8 October, Kuwait lead, scope any, gate shut: a missed call at 20:57:50, Send a video link at 20:58:30; HighLevel answers 429 until 21:02", () => {
  const press = kw("2026-10-08T20:58:30");
  test("the missed call's link the room kept trying reaches the lead once HighLevel takes it", async () => {
    const w = world(press, { scope: "any", email: ["throttled", "throttled", "throttled", "throttled", "sent"] });
    const out = await w.create(press, { purpose: "fallback", rang: kw("2026-10-08T20:57:50") });
    expect(out.refused).toBeNull();
    const id = String(out.id);
    await w.workerOpens(id, kw("2026-10-08T20:58:40"));
    for (const at of ["20:59:41", "21:00:41", "21:01:41", "21:02:41"]) await w.tick(id, kw(`2026-10-08T${at}`));
    const st = await w.status(id);
    // Found when it fails: as above, for the dialer's after-miss link (the
    // call did not connect, so nobody is on the line to read it out to).
    expect({ sent: w.sent.map(s => s.channel), refusal: st.refusal ?? null }).toEqual({ sent: ["email"], refusal: null });
  });
});

// ---------------------------------------------------------------------------
// 2. "A booked demo counts until it ends" (m1 round 1): the end is read from
//    a column production's appointments table does not have.
// ---------------------------------------------------------------------------

describe("Tuesday 6 October, 14:00 Kuwait, by day: the lead page's Send a video link for the test contact, against production's appointments table", () => {
  const press = kw("2026-10-06T14:00:00");
  test("control: with every column the fake allows, the room is made", async () => {
    const w = world(press);
    const out = await w.create(press);
    expect(out.refused).toBeNull();
    expect(w.room(String(out.id)).state).toBe("requested");
  });

  test("setup: production's cockpit_sales_appointments has start_at and no end_at (no migration in the branch adds one)", () => {
    expect(PROD_COLUMNS.cockpit_sales_appointments).toContain("start_at");
    expect(PROD_COLUMNS.cockpit_sales_appointments).not.toContain("end_at");
  });

  test("the room is made when PostgREST answers as production does (no booked demo, nothing else in the way)", async () => {
    const w = world(press, { prodSchema: true });
    const out = await w.create(press);
    // Found when it fails: room.create reads the lead's booked demos with
    // select=appointment_id,start_at,end_at (rooms.ts, the m1 round 1 fix
    // booked-demo-check-lets-go-at-start: "its end as stored, else its
    // start plus the booked demo's length"). Production's
    // cockpit_sales_appointments has no end_at, so PostgREST answers 400
    // (42703) and the read, inside the Promise.all with nothing catching
    // it, throws out of room.create: every Send a video link for any lead
    // fails, the lead page's and the dialer's after-miss alike, and no room
    // is ever made.
    expect({ refused: out.refused, made: out.id !== null }).toEqual({ refused: null, made: true });
  });

  test("the same from the dialer after a missed call (scope any)", async () => {
    const w = world(press, { prodSchema: true, scope: "any" });
    const out = await w.create(press, { purpose: "fallback", rang: press - 40 * S });
    expect({ refused: out.refused, made: out.id !== null }).toEqual({ refused: null, made: true });
  });

  test("m1-time-r3b-demo-end-column-missing-breaks-room-create (an unread list): the lead's booked demos cannot be read (the database answers 500): the press is refused with a sentence that says what to do, never a 500, and no room is made", async () => {
    const w = world(press, { demosUnread: true });
    const out = await w.create(press);
    expect({ refused: out.refused, made: out.id !== null, rooms: w.db.t("cockpit_sales_rooms").length }).toEqual({
      refused: "The lead's booked calls could not be read, so no room was made. Try again in a minute, or call them.",
      made: false,
      rooms: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// 3. A booked demo's end on the server and on the lead page: one rule each.
//    (Production stores no end, so both use a length from the start; the
//    server's select of end_at is section 2's finding and is left out here.)
// ---------------------------------------------------------------------------

describe("Tuesday 6 October: the lead's demo was booked for 13:00 (no end stored, as production keeps none); the lead page's link at 13:44:59 and 13:50", () => {
  const start = kw("2026-10-06T13:00:00");
  function withDemo(at: number) {
    const w = world(at);
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "stress-m1t3b-demo",
        contact_id: w.LEAD,
        call_type: "demo",
        status: "confirmed",
        start_at: iso(start),
        booked_at: iso(start - 2 * 24 * HOUR),
        assigned_user_id: "G-closer",
        calendar_id: "stress-demo-cal",
      },
    ]);
    return w;
  }
  test("control: at 13:44:59 the server refuses (the demo's booked 45 minutes are not over)", async () => {
    const w = withDemo(start + 44 * MIN + 59 * S);
    const out = await w.create(w.clock.now);
    expect(out.refused).toMatch(/^This lead has a booked demo\./);
  });
  test("at 13:50 the server makes the room (start + rooms.booking_min.demo, 45): the lead page's own rule is apps/sales-cockpit m1_time_r3b_ui.test.ts", async () => {
    const w = withDemo(start + 50 * MIN);
    const out = await w.create(w.clock.now);
    expect(out.refused).toBeNull();
  });
});
