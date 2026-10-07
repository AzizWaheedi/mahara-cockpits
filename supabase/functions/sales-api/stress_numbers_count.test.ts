// bun test supabase/functions/sales-api/stress_numbers_count.test.ts
//
// Stress round 1, numbers and data integrity: the live booking a join makes
// (countLive, rooms.ts runCount) and its undo ("That was not the lead").
// Every join is counted once, untagged and test contacts are never booked on
// a B2B calendar, an undo never leaves a call counted as shown that was not,
// and every HighLevel write the count makes stays traceable (its id kept, an
// audit row). Everything runs on testfakes.ts: no HighLevel, no database.
//
// Each test states the behaviour the specs ask for (D2, C34, the B2B show
// rule: showed, or confirmed or invalid once past, counts as shown). A test
// that fails here is a finding, kept as a regression test for its fix.
import { describe, expect, test } from "bun:test";
import { BOOKING_CALENDARS } from "./dialer.ts";
import type { Who } from "./lib.ts";
import { GhlError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld, seedLeadZoomJoin } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const DAY = 24 * 60 * MIN;
const SETTER = "setter@maharamedia.com";
const CLOSER = "closer@maharamedia.com";
const LEAD = "stress-lead-0000000001";
const TEST_LEAD = "stress-test-000000001";
const MEET_URL = "https://meet.google.com/abc-defg-hij";

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };

const ROOMS_ON = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: false,
  count_on_join: true,
  test_calendar_id: "TESTCAL",
  // D25: live bookings go on their own calendar, outside B2B's show rate.
  live_calendar_id: "LIVECAL",
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: false, whatsapp_template: false, email: false },
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
};

interface Opts {
  rooms?: Row;
  tags?: string[];
  contacts?: Record<string, Row>;
}

/** The fake world with a tagged lead, a test contact, two seats, and a HighLevel that books. */
function setup(o: Opts = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  const marks: Row[] = [];
  const knobs = {
    upcoming: null as { id: string; start: number } | null | Error,
    /** HighLevel's answer per call, by a test; undefined means "fine". */
    ghl: (_m: string, _p: string, _b: unknown): Row | Error | undefined => undefined,
  };
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON, ...(o.rooms ?? {}) } },
    { key: "live", value: { enabled: false, standby: true } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: SETTER, zoom_user_id: null, zoom_status: "pending", google_ok: true },
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
  ]);
  const contacts: Record<string, Row> = {
    [LEAD]: { firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: o.tags ?? ["roas-qualified"], country: "KW" },
    [TEST_LEAD]: { firstName: "Test", name: "Test Lead", phone: "+96550000001", tags: ["cockpit-test"], country: "KW" },
    ...(o.contacts ?? {}),
  };
  let n = 0;
  w.routes.push(async (m, p, body) => {
    const scripted = knobs.ghl(m, p, body);
    if (scripted instanceof Error) throw scripted;
    if (scripted) return scripted;
    if (m === "GET" && p.startsWith("/contacts/")) {
      const id = p.split("/")[2] as string;
      return contacts[id] ? { contact: { id, ...contacts[id] } } : (null as unknown as Row);
    }
    if (m === "POST" && p === "/calendars/events/appointments") return { id: `live-appt-${++n}` };
    if (m === "PUT" || m === "DELETE") return { ok: true };
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async (who, id, status, opts) => {
      marks.push({ who: who.email, id, status, ...opts });
      // As index.ts markAppointment: the same mark again is a repeat (no new row);
      // otherwise a new disposition row, the earlier one superseded.
      const current = w.db.t("cockpit_sales_dispositions").find(d => d.appointment_id === id && !d.superseded_at);
      if (current && current.status === status) return { ...current, repeated: true };
      if (current) current.superseded_at = w.db.iso();
      w.db.t("cockpit_sales_dispositions").push({ id: fakeUuid(), appointment_id: id, status, marked_by: who.email, superseded_at: null });
      const a = w.db.t("cockpit_sales_appointments").find(x => x.appointment_id === id);
      if (a) a.status = status;
      return {};
    },
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => {
      const u = knobs.upcoming;
      if (u instanceof Error) throw u;
      // As index.ts upcoming() reads it from HighLevel: the call's end, its rep and its status too.
      // The setter's own call (round 3: another rep's call ahead is never moved to the host).
      return u ? { end: u.start + 30 * MIN, assigned_user_id: "G-setter", status: "confirmed", ...u } : u;
    },
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  async function opened(contact = LEAD, b: Row = {}): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: contact,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
      ...b,
    });
    const id = String((out.room as Row).id);
    const r = room(id);
    // The worker: claim, then open (contract v2 section 7).
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, { method: "PATCH", body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 } });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: MEET_URL,
        provider_meeting_id: `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(room(id).version) + 1,
      },
    });
    // The lead opened the short link (the door's write), and Zoom saw them join the room's own
    // meeting: only that is evidence from the lead, so a hand-pressed "The lead is in" counts
    // (without it, it is self_reported: stress_security_rooms, final review).
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    seedLeadZoomJoin(w.db, id);
    return id;
  }
  async function mark(id: string, what: "lead_in" | "not_lead" | "host_in") {
    await rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(room(id).version), what });
    await w.flush();
  }
  async function end(id: string, reason = "finished") {
    await rooms.actions["room.end"]!(setter, { room_id: id, version: Number(room(id).version), reason, confirm: true });
    await w.flush();
  }
  const writes = () => w.ghlCalls.filter(c => c.method !== "GET");
  const posts = () => w.ghlCalls.filter(c => c.method === "POST" && c.path === "/calendars/events/appointments");
  return { ...w, rooms, audits, marks, knobs, room, opened, mark, end, writes, posts };
}

// ---------------------------------------------------------------------------

describe("every join is counted once", () => {
  test("fifty count triggers at once (the press, Zoom's two join events, the tick's re-asks) book once", async () => {
    const w = setup();
    const id = await w.opened();
    await w.mark(id, "lead_in");
    // The tick's re-ask and duplicate webhooks, all at once, against the counted room and a fresh one.
    const tick = Array.from({ length: 50 }, () => w.rooms.desk["room.event"]!({ email: "sales-desk" } as Who, { kind: "tick", payload: { room_ids: [id] } }));
    w.clock.now += 2 * MIN;
    await Promise.all(tick);
    await w.flush();
    expect(w.posts()).toHaveLength(1);
    expect(w.room(id).count_result).toBe("booked");
  });

  test("a second room for the same lead the same hour (the call dropped, the rep made a new room) books no second live call", async () => {
    const w = setup();
    const a = await w.opened();
    await w.mark(a, "lead_in");
    await w.end(a);
    w.clock.now += 5 * MIN;
    const b = await w.opened();
    await w.mark(b, "lead_in");
    // One conversation with one lead is one shown call, not two.
    expect(w.posts()).toHaveLength(1);
  });

  test("when the lead's booked call ahead cannot be read, no new booking is made beside it (missing is never zero)", async () => {
    const w = setup();
    // The lead has an intro booked for tomorrow, and HighLevel's appointment list is down for a moment.
    w.knobs.upcoming = new GhlError("HighLevel said 503: try again", 503);
    const id = await w.opened();
    await w.mark(id, "lead_in");
    // A new "Live ·" booking now would leave the lead with two intros: the live one marked shown
    // and tomorrow's, which the B2B rule counts as shown again once it passes still confirmed.
    expect(w.posts()).toHaveLength(0);
  });
});

describe("no booking for untagged or test contacts outside the test calendar", () => {
  test("an untagged contact, a not-ready one, and a lead who became a client mid-call are never booked", async () => {
    for (const tags of [[], ["roas-unprepared"], ["unqualified"], ["roas-qualified", "client"]]) {
      const client = tags.includes("client");
      const w = setup({ tags: client ? ["roas-qualified"] : tags });
      const id = await w.opened();
      if (client) (await w.io.ghl("GET", `/contacts/${LEAD}`, undefined)).contact; // warm the route
      if (client) w.knobs.ghl = (m, p) => (m === "GET" && p === `/contacts/${LEAD}` ? { contact: { id: LEAD, firstName: "Huda", tags } } : undefined);
      await w.mark(id, "lead_in");
      expect(w.writes()).toHaveLength(0);
      expect(w.room(id).count_result).toBe("not_a_lead");
    }
  });

  test("a test contact is booked only on the test calendar, never on a B2B calendar, whatever the setting says", async () => {
    for (const cal of Object.values(BOOKING_CALENDARS)) {
      const w = setup({ rooms: { test_calendar_id: cal } });
      const id = await w.opened(TEST_LEAD);
      await w.mark(id, "lead_in");
      const onB2b = w.posts().filter(p => Object.values(BOOKING_CALENDARS).includes((p.body as Row).calendarId as never));
      expect(onB2b).toHaveLength(0);
    }
  });
});

describe("a booking the count made is never lost (so the undo can always take it back)", () => {
  test("HighLevel made the booking but the showed status failed: the booking id is kept and the undo deletes it", async () => {
    const w = setup();
    w.knobs.ghl = (m, p, b) =>
      m === "PUT" && p.startsWith("/calendars/events/appointments/") && (b as Row).appointmentStatus === "showed"
        ? new GhlError("HighLevel said 502: bad gateway", 502)
        : undefined;
    const id = await w.opened();
    await w.mark(id, "lead_in");
    expect(w.posts()).toHaveLength(1);
    // The booking exists in HighLevel as confirmed at the join minute: the B2B rule counts it as shown.
    expect(w.room(id).count_appointment_id).toBe("live-appt-1");
    w.knobs.ghl = () => undefined;
    await w.mark(id, "not_lead");
    expect(w.ghlCalls.some(c => c.method === "DELETE" && c.path === "/calendars/events/live-appt-1")).toBe(true);
  });

  test("the lead's booked call was moved to now but the showed status failed: the move is recorded so the undo moves it back", async () => {
    const w = setup();
    const tomorrow = w.clock.now + DAY;
    w.knobs.upcoming = { id: "booked-tomorrow", start: tomorrow };
    w.knobs.ghl = (m, p, b) =>
      m === "PUT" && p === "/calendars/events/appointments/booked-tomorrow" && (b as Row).appointmentStatus === "showed"
        ? new GhlError("HighLevel said 502: bad gateway", 502)
        : undefined;
    const id = await w.opened();
    await w.mark(id, "lead_in");
    const moved = w.ghlCalls.find(c => c.method === "PUT" && (c.body as Row).startTime);
    expect(moved).toBeTruthy(); // tomorrow's intro is now at the join minute
    expect(w.room(id).count_appointment_id).toBe("booked-tomorrow");
    w.knobs.ghl = () => undefined;
    await w.mark(id, "not_lead");
    const back = w.ghlCalls.filter(c => c.method === "PUT" && (c.body as Row).startTime === new Date(tomorrow).toISOString());
    expect(back).toHaveLength(1);
  });

  test("the undo of a move puts the call back whole: its start, its end and its rep, not just its start", async () => {
    const w = setup();
    const tomorrow = w.clock.now + DAY;
    w.knobs.upcoming = { id: "booked-tomorrow", start: tomorrow };
    const id = await w.opened();
    await w.mark(id, "lead_in");
    expect(w.room(id).count_result).toBe("moved");
    const forward = w.ghlCalls.find(c => c.method === "PUT" && (c.body as Row).startTime) as { body: Row };
    expect(forward.body.assignedUserId).toBe("G-setter"); // the host's own call stays theirs
    await w.mark(id, "not_lead");
    const back = w.ghlCalls.filter(c => c.method === "PUT" && (c.body as Row).startTime === new Date(tomorrow).toISOString()).at(-1) as { body: Row };
    expect(back).toBeTruthy();
    // Only startTime goes back: the end stays at today's join minute + 15, before the new start,
    // and the call stays with the setter instead of the rep it was booked with.
    expect(back.body.endTime).toBeDefined();
    expect(Date.parse(String(back.body.endTime))).toBeGreaterThan(tomorrow);
    expect(back.body.assignedUserId).toBeDefined();
  });

  test("every HighLevel write the count makes has an audit row that names the appointment it wrote", async () => {
    const w = setup();
    w.knobs.ghl = (m, p, b) =>
      m === "PUT" && p.startsWith("/calendars/events/appointments/") && (b as Row).appointmentStatus === "showed"
        ? new GhlError("HighLevel said 502: bad gateway", 502)
        : undefined;
    const id = await w.opened();
    await w.mark(id, "lead_in");
    const audited = JSON.stringify(w.audits.filter(a => String(a.action).startsWith("room.count")));
    expect(audited).toContain("live-appt-1");
  });
});

describe("the undo never leaves a call counted as shown that was not", () => {
  function bookedIntro(w: ReturnType<typeof setup>, status: string) {
    w.db.seed("cockpit_sales_appointments", [
      { appointment_id: "intro-1", contact_id: LEAD, call_type: "intro", calendar_id: BOOKING_CALENDARS.intro_qualified, status, start_at: new Date(w.clock.now - 5 * MIN).toISOString(), assigned_user_id: "G-setter" },
    ]);
  }

  test("a booked intro already marked a no-show, then counted, then taken back: it is a no-show again, never confirmed", async () => {
    const w = setup();
    bookedIntro(w, "noshow");
    w.db.t("cockpit_sales_dispositions").push({ id: fakeUuid(), appointment_id: "intro-1", status: "noshow", marked_by: SETTER, superseded_at: null });
    const id = await w.opened(LEAD, { purpose: "fallback", appointment_id: "intro-1", trigger: "no_answer" });
    expect(w.room(id).appointment_id).toBe("intro-1");
    await w.mark(id, "lead_in");
    expect(w.marks.map(m => m.status)).toEqual(["showed"]);
    await w.mark(id, "not_lead");
    // B2B counts confirmed once its start has passed as shown: the undo must put back what was there.
    const statuses = w.ghlCalls.filter(c => c.method === "PUT" && c.path === "/calendars/events/appointments/intro-1").map(c => (c.body as Row).appointmentStatus);
    expect(statuses).not.toContain("confirmed");
  });

  test("the undo takes back only the count's own mark, never a rep's earlier mark of the same call", async () => {
    const w = setup();
    // The setter reached the lead by phone at the intro's time and marked it shown in the dialer,
    // then sent a room link to show their screen. A colleague opens the link first: "That was not the lead".
    bookedIntro(w, "showed");
    w.db.t("cockpit_sales_dispositions").push({ id: "rep-mark", appointment_id: "intro-1", status: "showed", marked_by: SETTER, superseded_at: null });
    const id = await w.opened(LEAD, { purpose: "fallback", appointment_id: "intro-1", trigger: "no_answer" });
    expect(w.room(id).appointment_id).toBe("intro-1");
    await w.mark(id, "lead_in");
    await w.mark(id, "not_lead");
    const repMark = w.db.t("cockpit_sales_dispositions").find(d => d.id === "rep-mark") as Row;
    expect(repMark.superseded_at ?? null).toBeNull();
    const statuses = w.ghlCalls.filter(c => c.method === "PUT" && c.path === "/calendars/events/appointments/intro-1").map(c => (c.body as Row).appointmentStatus);
    expect(statuses).not.toContain("confirmed");
  });

  test("an undo pressed while the count is still booking leaves no booking behind (F7), fifty times over", async () => {
    for (let i = 0; i < 50; i++) {
      const w = setup();
      let release: () => void = () => {};
      const gate = new Promise<void>(r => (release = r));
      w.knobs.ghl = (m, p) => (m === "POST" && p === "/calendars/events/appointments" ? undefined : undefined);
      const id = await w.opened();
      // Hold the POST until the undo has landed.
      const orig = w.io.ghl;
      w.io.ghl = async (m, p, b) => {
        if (m === "POST" && p === "/calendars/events/appointments") await gate;
        return orig(m, p, b);
      };
      await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
      // The count is booking (its claim landed, its POST held at the gate)
      // when the undo comes in: waited for, not left to microtask timing.
      for (let k = 0; k < 200 && !w.room(id).count_claimed_at; k++) await new Promise(r => setTimeout(r, 0));
      expect(w.room(id).count_claimed_at ?? null).not.toBeNull();
      await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
      release();
      await w.flush();
      const made = w.posts().length;
      const deleted = w.ghlCalls.filter(c => c.method === "DELETE").length;
      expect(made - deleted).toBe(0);
      expect(w.room(id).count_result).toBe("undone");
    }
  });
});
