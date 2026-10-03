// bun test supabase/functions/sales-api/stress_numbers_r4.test.ts
//
// Stress round 4, numbers and data integrity: the live count (rooms.ts
// runCount, upcomingWhole, currentCall) when it runs later than the join.
//
// The count is the record of one conversation: the call the lead was in at
// the minute they joined (D2: "Book and mark shown, quietly, the minute a
// tagged lead joins"). It does not always run at that minute:
//   - a join only a hand press reported (a Meet room while rooms.short_link
//     is off, which is how the rooms ship, C23) waits for a manager's
//     room.count_confirm, often the next morning;
//   - a count whose HighLevel read failed is asked again by the sweep each
//     minute for an hour (REASK_WINDOW_S);
//   - a count waits while a sibling room's count is in flight.
// Whatever it reads at that later moment must be the lead's calls as they
// stood at the join. A call booked during or after the conversation (the
// closer books "Demo 2" for next week before hanging up; the setter books
// tomorrow's intro) is the outcome of the call, never the call itself: it is
// never moved back onto the join's minute, and never marked shown for it.
//
// Each test states the behaviour the specs ask for (D2, D25, the B2B show
// rule: showed, or confirmed once past, counts as shown). A test that fails
// here is a finding, kept as a regression test for its fix.
// Everything runs on testfakes.ts: no HighLevel, no database, no Zoom.
import { describe, expect, test } from "bun:test";
import { BOOKING_CALENDARS } from "./dialer.ts";
import type { Who } from "./lib.ts";
import { GhlError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SETTER = "setter@stress.invalid";
const CLOSER = "closer@stress.invalid";
const LEAD = "stress-lead-r4-000001";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";
const MEETING = "81234567890";
const DEMO2_CAL = "NDBNz6Og4yfpdpWmHrue"; // "Demo 2", type demo in the calendars setting

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer" };
const manager: Who = { signed_in: true, seat: true, manager: true, email: "manager@stress.invalid", name: "Mona Manager", role: "manager" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const ROOMS_ON = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: false,
  count_on_join: true,
  test_calendar_id: "TESTCAL",
  live_calendar_id: "LIVECAL",
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: false, whatsapp_template: false, email: false },
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
};

/** A call the lead has on HighLevel, with when it was booked (HighLevel's dateAdded). */
interface Booked {
  id: string;
  start: number;
  booked_at: number;
  assigned_user_id: string;
  kind: "intro" | "demo";
}

function setup(start?: number) {
  const w = fakeWorld(start);
  const audits: Row[] = [];
  const marks: Row[] = [];
  const knobs = {
    /** The lead's calls on HighLevel: what upcoming() would find. */
    calls: [] as Booked[],
    /** upcoming() throws this many times first (HighLevel could not be read). */
    upcomingFails: 0,
  };
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON } },
    { key: "live", value: { enabled: false, standby: true } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true },
    { email: "manager@stress.invalid", name: "Mona Manager", role: "manager", ghl_user_id: "G-manager", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true },
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
  ]);
  let n = 0;
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`)
      return {
        events: knobs.calls.map(c => ({
          id: c.id,
          calendarId: c.kind === "demo" ? DEMO2_CAL : BOOKING_CALENDARS.intro_qualified,
          startTime: new Date(c.start).toISOString(),
          endTime: new Date(c.start + 30 * MIN).toISOString(),
          dateAdded: new Date(c.booked_at).toISOString(),
          appointmentStatus: "confirmed",
          assignedUserId: c.assigned_user_id,
        })),
      };
    if (m === "GET" && p.startsWith("/calendars/events/appointments/")) {
      const id = p.split("/").at(-1) as string;
      const c = knobs.calls.find(x => x.id === id);
      if (c)
        return {
          appointment: {
            id,
            appointmentStatus: "confirmed",
            startTime: new Date(c.start).toISOString(),
            endTime: new Date(c.start + 30 * MIN).toISOString(),
            assignedUserId: c.assigned_user_id,
            dateAdded: new Date(c.booked_at).toISOString(),
          },
        };
      const a = w.db.t("cockpit_sales_appointments").find(x => x.appointment_id === id);
      return a ? { appointment: { id, appointmentStatus: a.status, startTime: a.start_at, assignedUserId: a.assigned_user_id } } : (null as unknown as Row);
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
    markAppointment: async (who, id, status) => {
      marks.push({ who: who.email, id, status, at: w.clock.now });
      const current = w.db.t("cockpit_sales_dispositions").find(d => d.appointment_id === id && !d.superseded_at);
      if (current && current.status === status) return { ...current, repeated: true };
      if (current) current.superseded_at = w.db.iso();
      const made = { id: fakeUuid(), appointment_id: id, status, marked_by: who.email, superseded_at: null };
      w.db.t("cockpit_sales_dispositions").push(made);
      return { ...made };
    },
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    // index.ts upcoming(), as HighLevel answers it: the lead's next call of the
    // kind that starts after now, whenever it was booked. A third argument a
    // fix may pass ({booked_before}) is honoured, and booked_at is returned so
    // a caller can tell a call booked after the join.
    upcoming: (async (_contact: string, kind: "intro" | "demo", opts?: { booked_before?: number | string | null }) => {
      if (knobs.upcomingFails > 0) {
        knobs.upcomingFails -= 1;
        throw new Error("HighLevel said 503");
      }
      const bound = opts?.booked_before == null ? null : typeof opts.booked_before === "number" ? opts.booked_before : Date.parse(opts.booked_before);
      const ahead = knobs.calls
        .filter(c => c.kind === kind && c.start > w.clock.now && (bound === null || c.booked_at < bound))
        .sort((a, b) => a.start - b.start)[0];
      return ahead
        ? {
            id: ahead.id,
            start: ahead.start,
            end: ahead.start + 30 * MIN,
            assigned_user_id: ahead.assigned_user_id,
            status: "confirmed",
            booked_at: ahead.booked_at,
          }
        : null;
    }) as RoomDeps["upcoming"],
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;

  /** A room the worker opened. leadOpened: the short link was opened (evidence from the lead). */
  async function opened(who: Who, b: Row = {}, o: { provider?: "meet" | "zoom"; leadOpened?: boolean } = {}): Promise<string> {
    const provider = o.provider ?? "meet";
    const out = await rooms.actions["room.create"]!(who, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider,
      call_kind: "intro",
      purpose: "manual",
      ...b,
    });
    const id = String((out.room as Row).id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(room(id).version) + 1 },
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: provider === "zoom" ? ZOOM_URL : MEET_URL,
        provider_meeting_id: provider === "zoom" ? MEETING : `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 60 * MIN).toISOString(),
        version: Number(room(id).version) + 1,
      },
    });
    if (o.leadOpened !== false)
      await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    return id;
  }
  async function mark(who: Who, id: string, what: "lead_in" | "not_lead" | "host_in") {
    await rooms.actions["room.mark"]!(who, { room_id: id, version: Number(room(id).version), what });
    await w.flush();
  }
  async function end(who: Who, id: string, reason = "finished") {
    await rooms.actions["room.end"]!(who, { room_id: id, version: Number(room(id).version), reason, confirm: true });
    await w.flush();
  }
  async function tick(ids: string[]) {
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: ids } });
    await w.flush();
  }
  async function confirm(id: string) {
    await rooms.actions["room.count_confirm"]!(manager, { room_id: id });
    await w.flush();
  }
  /** Every write the count made to a call's start (a move), by appointment id. */
  const moves = (apptId: string) =>
    w.ghlCalls.filter(c => c.method === "PUT" && c.path === `/calendars/events/appointments/${apptId}` && Boolean((c.body as Row)?.startTime));
  const posts = () => w.ghlCalls.filter(c => c.method === "POST" && c.path === "/calendars/events/appointments");
  return { ...w, rooms, audits, marks, knobs, room, opened, mark, end, tick, confirm, moves, posts };
}

// ---------------------------------------------------------------------------

describe("the count records the call the lead was in at the join, never one booked after it", () => {
  test("count-moves-call-booked-after-join (count_confirm): the closer books Demo 2 for next week before hanging up; the manager's confirm the next morning must not move Demo 2 back onto yesterday's join", async () => {
    const w = setup();
    const joinAt = w.clock.now; // Sunday 10:00 Kuwait
    // The closer's live demo on Meet (short link off as shipped): the lead's
    // join is only the closer's press, so it waits for a manager.
    const id = await w.opened(closer, { call_kind: "demo" }, { provider: "meet", leadOpened: false });
    await w.mark(closer, id, "lead_in");
    expect(w.room(id).count_result).toBe("self_reported");
    // Forty minutes into the call the closer books Demo 2 for next Sunday.
    w.clock.now = joinAt + 40 * MIN;
    w.knobs.calls.push({ id: "demo-2", start: joinAt + 7 * DAY, booked_at: w.clock.now, assigned_user_id: "G-closer", kind: "demo" });
    w.clock.now = joinAt + 50 * MIN;
    await w.end(closer, id);
    // Monday 09:00: the manager reads the alert and confirms the join.
    w.clock.now = joinAt + 23 * HOUR;
    await w.confirm(id);
    // runCount reads upcoming() as of now: Demo 2 is "the lead's call ahead",
    // mine, end known, so it is moved to Sunday 10:00, given showed, and the
    // lead's real follow-up next week is gone from the calendar (toNotify off,
    // so nobody is told). The call booked after the join is never moved.
    expect(w.moves("demo-2")).toHaveLength(0);
    expect(w.marks.filter(m => m.id === "demo-2")).toHaveLength(0);
    // The live demo itself is still counted once (a Live booking at the join).
    expect(w.posts()).toHaveLength(1);
  });

  test("count-moves-call-booked-after-join (HighLevel unreadable at the join): the sweep's re-ask forty minutes later must not move the intro the setter booked during the call", async () => {
    const w = setup();
    const joinAt = w.clock.now;
    // A Zoom room the lead opened (evidence): the count runs at the join, and
    // HighLevel cannot be read for a while (upcoming() throws).
    w.knobs.upcomingFails = 40;
    const id = await w.opened(setter, {}, { provider: "zoom" });
    await w.mark(setter, id, "lead_in");
    expect(w.room(id).count_claimed_at ?? null).toBeNull(); // nothing claimed: missing is never zero
    // Twenty minutes in, the setter books the lead's intro with the closer for tomorrow.
    w.clock.now = joinAt + 20 * MIN;
    w.knobs.calls.push({ id: "intro-tomorrow", start: joinAt + DAY, booked_at: w.clock.now, assigned_user_id: "G-setter", kind: "intro" });
    // HighLevel comes back; the sweep's re-ask (each minute, an hour long) runs the count.
    w.knobs.upcomingFails = 0;
    w.clock.now = joinAt + 41 * MIN;
    await w.tick([id]);
    // The count moves tomorrow's intro onto the join's minute and marks it
    // shown: the lead loses tomorrow's intro, and the setter's booking reads
    // as a call that already happened.
    expect(w.moves("intro-tomorrow")).toHaveLength(0);
    expect(w.posts()).toHaveLength(1);
  });

  test("control: a call booked BEFORE the join (the lead's intro for tomorrow) is still the call the join is (moved to now), as D2 asks", async () => {
    const w = setup();
    const joinAt = w.clock.now;
    w.knobs.calls.push({ id: "intro-before", start: joinAt + DAY, booked_at: joinAt - 2 * DAY, assigned_user_id: "G-setter", kind: "intro" });
    const id = await w.opened(setter, {}, { provider: "zoom" });
    await w.mark(setter, id, "lead_in");
    expect(w.moves("intro-before")).toHaveLength(1);
    expect(w.posts()).toHaveLength(0);
  });
});

describe("the call that had started is the one running at the join, not one that started since", () => {
  test("count-confirm-marks-later-call: yesterday's hand-pressed live demo, confirmed this morning, must not mark this morning's Demo 2 (booked during that call, the lead did not come) shown", async () => {
    const w = setup();
    const joinAt = w.clock.now; // Sunday 10:00 Kuwait
    // The closer's live demo; Zoom's join of the lead was not seen (no open,
    // no participant event), so only the closer's press says the lead came.
    const id = await w.opened(closer, { call_kind: "demo" }, { provider: "zoom", leadOpened: false });
    await w.mark(closer, id, "lead_in");
    expect(w.room(id).count_result).toBe("self_reported");
    // Before hanging up, the closer books Demo 2 for Monday 09:00.
    w.clock.now = joinAt + 45 * MIN;
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "demo-2-monday",
        contact_id: LEAD,
        call_type: "demo",
        calendar_id: DEMO2_CAL,
        status: "confirmed",
        start_at: new Date(joinAt + 23 * HOUR).toISOString(),
        end_at: new Date(joinAt + 24 * HOUR).toISOString(),
        booked_at: new Date(w.clock.now).toISOString(),
        assigned_user_id: "G-closer",
      },
    ]);
    w.clock.now = joinAt + 50 * MIN;
    await w.end(closer, id);
    // Monday 09:00 the lead does not come; the closer has not marked it yet.
    // At 09:40 the manager confirms Sunday's join.
    w.clock.now = joinAt + 23 * HOUR + 40 * MIN;
    await w.confirm(id);
    // currentCall reads calls that started between the join minus a call's
    // length and NOW: Monday's Demo 2 (started 40 minutes ago, confirmed) is
    // "the call that had started", so Monday's no-show is marked shown and
    // Sunday's live demo is counted nowhere of its own.
    expect(w.marks.filter(m => m.id === "demo-2-monday" && m.status === "showed")).toHaveLength(0);
    expect(w.posts()).toHaveLength(1); // Sunday's conversation: one Live booking at its own minute
  });
});

describe("a rep's disqualification is never turned into a show by the count", () => {
  test("count-overrides-invalid-mark: the setter disqualified the intro (invalid) while the fallback link was out; the lead then joins the room: the intro must stay invalid (B2B already counts it as held), never become showed", async () => {
    const w = setup();
    const startAt = w.clock.now - 2 * MIN;
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "intro-1",
        contact_id: LEAD,
        call_type: "intro",
        calendar_id: BOOKING_CALENDARS.intro_qualified,
        status: "confirmed",
        start_at: new Date(startAt).toISOString(),
        end_at: new Date(startAt + 30 * MIN).toISOString(),
        assigned_user_id: "G-setter",
      },
    ]);
    // No answer at the intro's time: the setter's fallback room for the intro.
    const id = await w.opened(setter, { purpose: "fallback", trigger: "no_answer", appointment_id: "intro-1" }, { provider: "meet", leadOpened: false });
    expect(w.room(id).appointment_id).toBe("intro-1");
    // The lead calls back by phone; the setter talks to them, finds them not a
    // fit, and marks the intro invalid (disqualified) in the dialer.
    w.clock.now += 3 * MIN;
    const appt = w.db.t("cockpit_sales_appointments").find(a => a.appointment_id === "intro-1") as Row;
    appt.status = "invalid";
    w.db.seed("cockpit_sales_dispositions", [
      { id: fakeUuid(), appointment_id: "intro-1", status: "invalid", marked_by: SETTER, superseded_at: null },
    ]);
    // The lead then opens the link they were sent and joins the room.
    w.clock.now += 2 * MIN;
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    await w.mark(setter, id, "lead_in");
    // appointment_shown reads only "showed": the count marks the invalid intro
    // showed, so B2B's disqualified intro becomes a qualified show
    // (intros_qualified +1, intros_disqualified -1, the close rate's
    // denominator moves). By the B2B rule invalid is already held: nothing to add.
    expect(w.marks.filter(m => m.id === "intro-1" && m.status === "showed")).toHaveLength(0);
    expect(w.posts()).toHaveLength(0);
  });
});

describe("a call the count moved is shown in B2B's numbers, or the count is not done", () => {
  test("moved-new-call-never-shown: the lead's next demo is booked but unconfirmed (status new, 33 of 484 demos in B2B's last 120 days); the count moves it to now and HighLevel refuses the showed write once (429): the demo must still end up shown, never 'moved' yet held nowhere", async () => {
    const w = setup();
    const joinAt = w.clock.now;
    // The lead's demo next week, booked two days ago, still "new" (not confirmed).
    w.knobs.calls.push({ id: "demo-new", start: joinAt + 7 * DAY, booked_at: joinAt - 2 * DAY, assigned_user_id: "G-closer", kind: "demo" });
    const status = new Map<string, string>([["demo-new", "new"]]);
    let refusals = 1;
    w.routes.unshift(async (m, p, body) => {
      if (m !== "PUT" || p !== "/calendars/events/appointments/demo-new") return null as unknown as Row;
      const b = (body ?? {}) as Row;
      if (b.appointmentStatus && !b.startTime && refusals > 0) {
        refusals -= 1;
        throw new GhlError("HighLevel said 429: too many requests", 429);
      }
      if (b.appointmentStatus) status.set("demo-new", String(b.appointmentStatus));
      return { ok: true };
    });
    // The closer's live demo on Zoom; the lead opened the link and joined.
    const id = await w.opened(closer, { call_kind: "demo" }, { provider: "zoom" });
    await w.mark(closer, id, "lead_in");
    expect(w.moves("demo-new")).toHaveLength(1);
    expect(w.room(id).count_result).toBe("moved");
    // The sweep's re-asks run for the next ten minutes.
    for (let i = 0; i < 10; i++) {
      w.clock.now += 1 * MIN;
      await w.tick([id]);
    }
    // markShowed failed once and is never tried again (an audit row only):
    // the demo sits at the join's minute with status "new", which B2B's rule
    // (showed, or confirmed or invalid once past) does not count as held,
    // while the room says the call was counted ("moved"). The live demo is
    // missing from demos_shown, and nobody is told.
    const told = w.db.t("cockpit_sales_alerts").some(a => JSON.stringify(a).includes(id));
    expect(status.get("demo-new") === "showed" || told).toBe(true);
  });
});

describe("That was not the lead never leaves a change the count may have made in place", () => {
  test("undo-of-unclear-count-marks-undone: the count's move of tomorrow's intro timed out (it may have landed); 'That was not the lead' must put the call back (or say so to a person), never just mark the count undone", async () => {
    const w = setup();
    const joinAt = w.clock.now;
    const tomorrow = joinAt + DAY;
    w.knobs.calls.push({ id: "intro-tmrw", start: tomorrow, booked_at: joinAt - 2 * DAY, assigned_user_id: "G-setter", kind: "intro" });
    let outage = true;
    w.routes.unshift(async (m, p, body) => {
      if (!outage || !p.endsWith("/calendars/events/appointments/intro-tmrw")) return null as unknown as Row;
      // HighLevel takes the move but the answer is lost (a timeout), and the read-back fails too.
      if (m === "PUT" && (body as Row)?.startTime) throw new GhlError("HighLevel did not answer in time", 0);
      if (m === "GET") throw new GhlError("HighLevel said 503", 503);
      return null as unknown as Row;
    });
    // Someone in the lead's office opens the link and joins the setter's Zoom room.
    const id = await w.opened(setter, {}, { provider: "zoom" });
    await w.mark(setter, id, "lead_in");
    expect(w.room(id).count_result).toBe("unclear");
    expect(w.moves("intro-tmrw")).toHaveLength(1); // the move went out; its answer was lost
    // Two minutes later the setter sees it was not the lead. HighLevel is back.
    outage = false;
    w.clock.now += 2 * MIN;
    await w.mark(setter, id, "not_lead");
    for (let i = 0; i < 5; i++) {
      w.clock.now += 1 * MIN;
      await w.tick([id]);
    }
    // countUndo has no plan for "unclear" ("nothing"), so undoPlan answers
    // done and the count is written "undone": tomorrow's intro may sit at
    // today's join minute, confirmed and past (a show by B2B's rule), the
    // lead's real intro gone, and the only alert still says "check before
    // anyone books by hand" (nothing about putting the call back).
    const putBack = w.ghlCalls.some(
      c => c.method === "PUT" && c.path === "/calendars/events/appointments/intro-tmrw" && (c.body as Row)?.startTime === new Date(tomorrow).toISOString(),
    );
    const toldToPutBack = w.db
      .t("cockpit_sales_alerts")
      .some(a => JSON.stringify(a).includes(id) && /not the lead|put .*back|take .*back/i.test(JSON.stringify(a)));
    expect(putBack || (w.room(id).count_result !== "undone" && toldToPutBack)).toBe(true);
  });
});
