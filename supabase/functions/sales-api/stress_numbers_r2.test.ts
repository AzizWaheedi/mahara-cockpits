// bun test supabase/functions/sales-api/stress_numbers_r2.test.ts
//
// Stress round 2, numbers and data integrity: the live count (rooms.ts
// runCount, countMark, standingCount) and its undo, attacked where round 1
// left them. One conversation is one shown call, whatever room it happens
// in; a booking that may exist is never treated as none ("missing is never
// zero"); a team member joining is never the lead; and the undo puts back
// the status HighLevel really had, so B2B's show rate (showed, or confirmed
// once past, counts as shown) is never inflated by a taken-back join.
//
// Each test states the behaviour the specs ask for (D2, D25, C34, S7, the
// B2B show rule). A test that fails here is a finding, kept as a regression
// test for its fix. Everything runs on testfakes.ts: no HighLevel, no
// database, no Zoom.
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
const SETTER = "setter@stress.invalid";
const CLOSER = "closer@stress.invalid";
const MANAGER = "manager@stress.invalid";
const LEAD = "stress-lead-r2-000001";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";
const MEETING = "81234567890";

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer" };
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

function setup() {
  const w = fakeWorld();
  const audits: Row[] = [];
  const marks: Row[] = [];
  const knobs = {
    upcoming: null as { id: string; start: number } | null,
    /** HighLevel's answer per call, by a test; undefined means "fine". */
    ghl: (_m: string, _p: string, _b: unknown): Row | Error | undefined => undefined,
  };
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON } },
    { key: "live", value: { enabled: false, standby: true } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  // Three seats; only the two who host rooms have a room_hosts row. The
  // manager is a seat who joins a rep's room to listen in (S7: a team member,
  // never the lead).
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true },
    { email: MANAGER, name: "Mona Manager", role: "manager", ghl_user_id: "G-manager", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: SETTER, zoom_user_id: null, zoom_status: "pending", google_ok: true },
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
  ]);
  let n = 0;
  w.routes.push(async (m, p, body) => {
    const scripted = knobs.ghl(m, p, body);
    if (scripted instanceof Error) throw scripted;
    if (scripted) return scripted;
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: [] };
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
      marks.push({ who: who.email, id, status });
      // As index.ts markAppointment: a new disposition row, the earlier one
      // superseded. It does NOT touch the cockpit's appointments mirror: that
      // copy only changes when sales-mirror reads HighLevel again (every 3 min).
      const current = w.db.t("cockpit_sales_dispositions").find(d => d.appointment_id === id && !d.superseded_at);
      if (current && current.status === status) return { ...current, repeated: true };
      if (current) current.superseded_at = w.db.iso();
      const made = { id: fakeUuid(), appointment_id: id, status, marked_by: who.email, superseded_at: null };
      w.db.t("cockpit_sales_dispositions").push(made);
      return { ...made };
    },
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => {
      const u = knobs.upcoming;
      // The setter's own call (round 3: another rep's call ahead is never moved to the host).
      return u ? { end: u.start + 30 * MIN, assigned_user_id: "G-setter", status: "confirmed", ...u } : u;
    },
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;

  /** A room the worker opened, the lead's short link opened (evidence from the lead). */
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
    const r = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 },
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: provider === "zoom" ? ZOOM_URL : MEET_URL,
        provider_meeting_id: provider === "zoom" ? MEETING : `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(room(id).version) + 1,
      },
    });
    if (o.leadOpened !== false)
      await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
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
  /** A Zoom webhook the door stored, then forwarded to room.event. */
  async function zoomJoin(id: string, participant: Row) {
    const eid = fakeUuid();
    w.db.seed("cockpit_sales_room_events", [
      {
        id: eid,
        room_id: id,
        kind: "zoom.meeting.participant_joined",
        source: "zoom",
        dedupe_key: `zoom:join:${eid}`,
        detail: {
          event: "meeting.participant_joined",
          event_ts: w.clock.now,
          payload: { object: { id: MEETING, host_id: "Z-closer", participant: { join_time: new Date(w.clock.now).toISOString(), ...participant } } },
        },
      },
    ]);
    await rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: eid, payload: {} });
    await w.flush();
  }
  function bookedIntro(status: string, startMs = w.clock.now - 5 * MIN) {
    w.db.seed("cockpit_sales_appointments", [
      { appointment_id: "intro-1", contact_id: LEAD, call_type: "intro", calendar_id: BOOKING_CALENDARS.intro_qualified, status, start_at: new Date(startMs).toISOString(), assigned_user_id: "G-setter" },
    ]);
  }
  const posts = () => w.ghlCalls.filter(c => c.method === "POST" && c.path === "/calendars/events/appointments");
  const introStatuses = () =>
    w.ghlCalls.filter(c => c.method === "PUT" && c.path === "/calendars/events/appointments/intro-1").map(c => (c.body as Row).appointmentStatus);
  return { ...w, rooms, audits, marks, knobs, room, opened, mark, end, zoomJoin, bookedIntro, posts, introStatuses };
}

// ---------------------------------------------------------------------------

describe("one conversation is one shown call, whatever room it happens in", () => {
  test("standing-count-misses-mark: the lead joined the fallback room for their booked intro (marked shown), the call dropped, the setter sent a new link: no Live booking on top", async () => {
    const w = setup();
    w.bookedIntro("confirmed");
    // Room A: the fallback room for today's booked intro. The lead joins; the
    // count marks the intro shown (count_result stays null, count_appointment_id set).
    const a = await w.opened(setter, { purpose: "fallback", trigger: "no_answer", appointment_id: "intro-1" });
    await w.mark(setter, a, "lead_in");
    expect(w.marks.map(m => m.status)).toEqual(["showed"]);
    expect(w.room(a).count_appointment_id).toBe("intro-1");
    // The Meet call drops ten minutes in; the setter ends that room and sends a new link.
    w.clock.now += 10 * MIN;
    await w.end(setter, a);
    w.clock.now += 2 * MIN;
    const b = await w.opened(setter);
    await w.mark(setter, b, "lead_in");
    // The same conversation, already counted as the intro shown: a "Live ·"
    // booking marked shown now counts it a second time (standingCount reads
    // only count_result booked or moved, and a mark leaves count_result null).
    expect(w.posts()).toHaveLength(0);
  });

  test("standing-count-ignores-unclear: the first room's booking may have been made (answer lost); a second room the same day must not book again", async () => {
    const w = setup();
    // HighLevel makes the booking, but its answer is lost (504), and the
    // lead's appointment list does not show it yet: the first count is "unclear".
    let first = true;
    w.knobs.ghl = (m, p) => {
      if (m === "POST" && p === "/calendars/events/appointments" && first) {
        first = false;
        return new GhlError("HighLevel said 504: gateway timeout", 504);
      }
      return undefined;
    };
    const a = await w.opened(setter);
    await w.mark(setter, a, "lead_in");
    expect(w.room(a).count_result).toBe("unclear");
    w.clock.now += 10 * MIN;
    await w.end(setter, a);
    w.clock.now += 2 * MIN;
    const b = await w.opened(setter);
    await w.mark(setter, b, "lead_in");
    // "Missing is never zero": a booking that may stand is not "no booking".
    // A second POST makes two "Live ·" bookings for one conversation when the first landed.
    expect(w.posts()).toHaveLength(1);
  });
});

describe("a team member who joins is never the lead (S7)", () => {
  test("staff-not-in-room-hosts-counted-as-lead: a manager seat (no room_hosts row) joins the closer's Zoom fallback room: no join, no showed mark on the booked intro", async () => {
    const w = setup();
    w.bookedIntro("confirmed");
    const id = await w.opened(closer, { purpose: "fallback", trigger: "no_answer", appointment_id: "intro-1" }, { provider: "zoom", leadOpened: false });
    w.clock.now += 1 * MIN;
    // The manager, signed in to Mahara's Zoom account, drops in to listen
    // before the lead comes. Their seat has no room_hosts row yet: the host
    // check (every 10 minutes) has not run since go-live, or it was down when
    // the seat was added (room_hosts is empty in production today).
    await w.zoomJoin(id, { id: "Z-manager", participant_user_id: "Z-manager", user_name: "Mona Manager", email: MANAGER });
    // The worker counts every seat as the team (contract S7: room hosts AND
    // cockpit_sales_people); the join handler (rooms.ts staffCtx) counts only
    // room_hosts. A manager's join is read as the lead's: lead_in, then the
    // booked intro is marked shown in HighLevel. The real lead never comes,
    // and B2B's show rate gains a show that did not happen.
    expect(w.room(id).lead_in_at ?? null).toBeNull();
    expect(w.marks.filter(m => m.status === "showed")).toHaveLength(0);
  });
});

describe("the undo puts back the status HighLevel really had", () => {
  test("undo-restores-stale-mirror-status: the rep marked the intro a no-show a minute ago (the mirror still says confirmed); joined, then 'That was not the lead': never back to confirmed", async () => {
    const w = setup();
    // The mirror (sales-mirror, every 3 min) still shows the intro confirmed;
    // the rep's own no-show mark, a minute old, is in dispositions and in HighLevel.
    w.bookedIntro("confirmed");
    w.db.t("cockpit_sales_dispositions").push({ id: "rep-noshow", appointment_id: "intro-1", status: "noshow", marked_by: SETTER, superseded_at: null });
    const id = await w.opened(setter, { purpose: "fallback", trigger: "no_answer", appointment_id: "intro-1" });
    await w.mark(setter, id, "lead_in");
    expect(w.marks.map(m => m.status)).toEqual(["showed"]);
    await w.mark(setter, id, "not_lead");
    // countMark records prior_status = mirror status ?? disposition status, so
    // the stale "confirmed" wins over the newer no-show, and the undo writes
    // confirmed into HighLevel: a past, confirmed intro is a show by the B2B rule.
    expect(w.introStatuses()).not.toContain("confirmed");
  });
});

describe("a no-show is written only on evidence (missing is never zero)", () => {
  test("settle-zoom-silence-read-as-no-show: Zoom reported nothing at all for the room (not even the host), and it is settled as a no-show", async () => {
    const w = setup();
    const start = w.clock.now;
    w.bookedIntro("confirmed", start);
    // A Zoom fallback room for the booked intro, closed by the sweep's R4 at
    // lead_by. Zoom's webhooks never reached the door for it (the event
    // subscription was switched off by Zoom after failures, or the door's
    // secret changed): not one Zoom event is stored, not even the meeting's
    // start or the host's join. The setter pressed "I'm in" by hand (the
    // panel offers it after 30 s with no Zoom event), talked to the lead for
    // five minutes, and never pressed "The lead is in". The short link is
    // off, so no open is recorded either.
    const id = fakeUuid();
    w.db.seed("cockpit_sales_rooms", [
      {
        id,
        request_id: fakeUuid(),
        contact_id: LEAD,
        purpose: "fallback",
        trigger: "no_answer",
        call_kind: "intro",
        provider: "zoom",
        host_email: CLOSER,
        made_by: CLOSER,
        appointment_id: "intro-1",
        appointment_start_at: new Date(start).toISOString(),
        state: "expired",
        result: "no_join",
        end_reason: "lead_no_show",
        join_url: ZOOM_URL,
        provider_meeting_id: MEETING,
        requested_at: new Date(start + 1 * MIN).toISOString(),
        opened_at: new Date(start + 1 * MIN).toISOString(),
        link_sent_at: new Date(start + 2 * MIN).toISOString(),
        host_in_at: new Date(start + 3 * MIN).toISOString(),
        ended_at: new Date(start + 15 * MIN).toISOString(),
        version: 5,
      },
    ]);
    w.db.insertOne("cockpit_sales_room_events", { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due to be settled." }, "ignore", "dedupe_key");
    w.clock.now = start + 21 * MIN;
    await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    await w.flush();
    // "A Zoom room whose join events were all read" holds vacuously when Zoom
    // sent none: the host's own join was never reported either, so the
    // silence says nothing about the lead. A no-show here is a guess written
    // into HighLevel, and B2B's show rate loses a show that may have happened.
    expect(w.marks.filter(m => m.status === "noshow")).toHaveLength(0);
  });
});

describe("an undo that cannot read what it changed never says it is undone", () => {
  test("undo-unreadable-record-marks-undone: the count moved tomorrow's intro to now; at 'That was not the lead' its record cannot be read for a moment: the call must not stay moved and shown under 'undone'", async () => {
    const w = setup();
    const tomorrow = w.clock.now + 24 * 60 * MIN;
    w.knobs.upcoming = { id: "booked-tomorrow", start: tomorrow };
    const id = await w.opened(setter);
    await w.mark(setter, id, "lead_in");
    expect(w.room(id).count_result).toBe("moved");
    // The read of the count's own record (count.moving) times out once.
    w.db.faults.push({
      prefix: `cockpit_sales_room_events?room_id=eq.${id}&kind=in.(count.moving`,
      method: "GET",
      error: new Error("database answered 503: the read timed out"),
      times: 1,
    });
    await w.mark(setter, id, "not_lead");
    // A tick later (the sweep re-asks an undo that never landed).
    w.clock.now += 1 * MIN;
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await w.flush();
    const movedBack = w.ghlCalls.some(
      c => c.method === "PUT" && c.path === "/calendars/events/appointments/booked-tomorrow" && (c.body as Row).startTime === new Date(tomorrow).toISOString(),
    );
    // countBefore turns the failed read into "no record", countUndo answers
    // moved_from_unknown, undoPlan treats that as done, and the room says
    // "undone": the lead's real intro stays moved to today and marked shown
    // (B2B counts it), and nothing will ever move it back.
    expect(movedBack || w.room(id).count_result !== "undone").toBe(true);
    expect(movedBack).toBe(true);
  });
});

describe("a join pressed by hand is never counted as zero for good", () => {
  test("self-reported-join-has-no-confirm-path: a Meet room with the short link off (no open can be seen): the lead joins, the setter presses 'The lead is in'; the join must reach a manager who can count it", async () => {
    const w = setup();
    // rooms.short_link is false until the CNAME (C23): the lead gets the Meet
    // link itself, so the door never sees an open, and Meet sends no join
    // signal. The setter's default provider is Meet.
    const id = await w.opened(setter, {}, { leadOpened: false });
    await w.mark(setter, id, "lead_in");
    expect(w.room(id).count_result).toBe("self_reported");
    expect(w.posts()).toHaveLength(0);
    // The panel says "Not booked yet: a manager confirms a join marked by
    // hand." No action lets a manager confirm it (rooms.ts actions), and no
    // alert tells one that a join waits: the count can never be claimed again
    // (countClaimable), so this real join stays uncounted for good.
    const confirmAction = Object.keys(w.rooms.actions).some(k => /confirm|count/i.test(k));
    const told = w.db.t("cockpit_sales_alerts").some(a => JSON.stringify(a).includes(id));
    expect(confirmAction || told).toBe(true);
  });
});
