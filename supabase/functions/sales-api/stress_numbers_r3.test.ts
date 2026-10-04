// bun test supabase/functions/sales-api/stress_numbers_r3.test.ts
//
// Stress round 3, numbers and data integrity: the live count (rooms.ts
// runCount, standingCount, countMark) and the settle (D14), attacked where
// rounds 1 and 2 left them. One conversation is one shown call, counted on
// the day it happened; a count that may stand is never read as none
// ("missing is never zero"); a room made for a confirmation call the day
// before is no evidence about the intro itself, either way; and a taken-back
// join never leaves the real one uncounted.
//
// Each test states the behaviour the specs ask for (D2, D14, D25, the B2B
// show rule: showed, or confirmed once past, counts as shown). A test that
// fails here is a finding, kept as a regression test for its fix.
// Everything runs on testfakes.ts: no HighLevel, no database, no Zoom.
import { describe, expect, test } from "bun:test";
import { BOOKING_CALENDARS } from "./dialer.ts";
import { FOLLOWUP_SEGMENTS, type Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { followupSettingsValue } from "./sendrules.ts";
import { fakeUuid, fakeWorld, seedLeadZoomJoin } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter@stress.invalid";
const CLOSER = "closer@stress.invalid";
const LEAD = "stress-lead-r3-000001";
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

function setup(start?: number) {
  const w = fakeWorld(start);
  const audits: Row[] = [];
  const marks: Row[] = [];
  const knobs = {
    upcoming: null as { id: string; start: number; assigned_user_id?: string } | null,
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
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true },
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
  ]);
  let n = 0;
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: [] };
    if (m === "GET" && p.startsWith("/calendars/events/appointments/")) {
      const id = p.split("/").at(-1) as string;
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
    upcoming: async () => {
      const u = knobs.upcoming;
      return u ? { end: u.start + 30 * MIN, assigned_user_id: "G-setter", status: "confirmed", ...u } : u;
    },
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;

  /** A room the worker opened; the lead's short link opened (evidence from the lead). */
  async function opened(who: Who, b: Row = {}, o: { provider?: "meet" | "zoom" } = {}): Promise<string> {
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
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(room(id).version) + 1,
      },
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    seedLeadZoomJoin(w.db, id); // the only evidence that upgrades a hand press (final review)
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
  function intro(status: string, startMs: number, assigned = "G-setter") {
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "intro-1",
        contact_id: LEAD,
        call_type: "intro",
        calendar_id: BOOKING_CALENDARS.intro_qualified,
        status,
        start_at: new Date(startMs).toISOString(),
        end_at: new Date(startMs + 30 * MIN).toISOString(),
        assigned_user_id: assigned,
      },
    ]);
  }
  const posts = () => w.ghlCalls.filter(c => c.method === "POST" && c.path === "/calendars/events/appointments");
  const deletes = () => w.ghlCalls.filter(c => c.method === "DELETE");
  return { ...w, rooms, audits, marks, knobs, room, opened, mark, end, tick, intro, posts, deletes };
}

// ---------------------------------------------------------------------------

describe("a room for a confirmation call is not the intro itself", () => {
  test("confirm-call-room-marks-future-intro-shown: the setter's confirmation call for tomorrow's intro is missed, the lead joins the fallback room today; tomorrow's intro must not be counted as shown now", async () => {
    const w = setup();
    // The dialer's confirm item carries tomorrow's intro (DialerPage: kind
    // confirm and an intro appointment pass appointmentId to the fallback room).
    const tomorrow = w.clock.now + 20 * HOUR;
    w.intro("confirmed", tomorrow);
    const id = await w.opened(setter, { purpose: "fallback", trigger: "no_answer", appointment_id: "intro-1" });
    // Fixed (round 3): a room asked for 20 hours before the intro is not the
    // intro's room, so it does not carry it (createRoom's intro window).
    expect(w.room(id).appointment_id ?? null).toBeNull();
    await w.mark(setter, id, "lead_in");
    // countLive's mark path has no time check: tomorrow's intro is marked
    // "showed" today and stays on tomorrow's calendar as a show. B2B counts it
    // in tomorrow's window whatever happens tomorrow, and the settle can never
    // write tomorrow's no-show (the call is marked). Counted on the day it
    // happened means: moved to now (as the upcoming path does), or left alone.
    const showed = w.marks.filter(m => m.id === "intro-1" && m.status === "showed");
    const movedToNow = w.ghlCalls.some(
      c =>
        c.method === "PUT" &&
        c.path === "/calendars/events/appointments/intro-1" &&
        Math.abs(Date.parse(String((c.body as Row).startTime ?? "")) - w.clock.now) < 5 * MIN,
    );
    expect(showed.length === 0 || movedToNow).toBe(true);
  });

  test("confirm-call-room-settles-future-intro: yesterday's empty confirmation room (Zoom reported the host, no lead) writes a no-show on today's intro at start + 20 minutes", async () => {
    const w = setup();
    const created = w.clock.now;
    const start = created + 20 * HOUR; // the intro is tomorrow morning
    w.intro("confirmed", start);
    // The setter's confirmation call yesterday was missed; the fallback room
    // (Zoom, the setter's own) carried the intro's id and start. The lead
    // never came to it; the setter waited in it; R4 closed it.
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
        host_email: SETTER,
        made_by: SETTER,
        appointment_id: "intro-1",
        appointment_start_at: new Date(start).toISOString(),
        state: "expired",
        result: "no_join",
        end_reason: "lead_no_show",
        join_url: ZOOM_URL,
        provider_meeting_id: MEETING,
        requested_at: new Date(created).toISOString(),
        opened_at: new Date(created + 1 * MIN).toISOString(),
        link_sent_at: new Date(created + 1 * MIN).toISOString(),
        host_in_at: new Date(created + 2 * MIN).toISOString(),
        ended_at: new Date(created + 15 * MIN).toISOString(),
        version: 5,
      },
    ]);
    // Zoom reported that meeting: its start and the host's join, both read.
    for (const [kind, role] of [["zoom.meeting.started", null], ["zoom.meeting.participant_joined", "host"]] as const)
      w.db.seed("cockpit_sales_room_events", [
        {
          id: fakeUuid(),
          room_id: id,
          kind,
          source: "zoom",
          dedupe_key: `zoom:${kind}:${id}`,
          at: new Date(created + 2 * MIN).toISOString(),
          handled_at: new Date(created + 2 * MIN).toISOString(),
          detail: role ? { role } : {},
        },
      ]);
    // Today: the intro happens by phone at its time (no room), and the setter
    // has not marked it by start + 20 (they mark at the end of the call).
    w.db.insertOne("cockpit_sales_room_events", { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due to be settled." }, "ignore", "dedupe_key");
    w.clock.now = start + 21 * MIN;
    await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    await w.flush();
    // roomForThisStart compares only the stored start: a room made 20 hours
    // before the intro is "for this start". Nobody coming to yesterday's
    // confirmation room says nothing about today's intro; a no-show here
    // removes a show B2B would have counted (confirmed and past).
    expect(w.marks.filter(m => m.status === "noshow")).toHaveLength(0);
  });

  test("control: the same Zoom room made at the intro's own time still settles as a no-show (the rule is not switched off)", async () => {
    const w = setup();
    const start = w.clock.now;
    w.intro("confirmed", start);
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
        host_email: SETTER,
        made_by: SETTER,
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
        host_in_at: new Date(start + 2 * MIN).toISOString(),
        ended_at: new Date(start + 15 * MIN).toISOString(),
        version: 5,
      },
    ]);
    for (const [kind, role] of [["zoom.meeting.started", null], ["zoom.meeting.participant_joined", "host"]] as const)
      w.db.seed("cockpit_sales_room_events", [
        {
          id: fakeUuid(),
          room_id: id,
          kind,
          source: "zoom",
          dedupe_key: `zoom:${kind}:${id}`,
          at: new Date(start + 2 * MIN).toISOString(),
          handled_at: new Date(start + 2 * MIN).toISOString(),
          detail: role ? { role } : {},
        },
      ]);
    w.db.insertOne("cockpit_sales_room_events", { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due to be settled." }, "ignore", "dedupe_key");
    w.clock.now = start + 21 * MIN;
    await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    await w.flush();
    expect(w.marks.filter(m => m.status === "noshow")).toHaveLength(1);
  });
});

describe("one conversation is one shown call", () => {
  test("live-booking-beside-started-intro: the lead's intro started five minutes ago (confirmed, unmarked); the setter sends a link from the lead page and the lead joins: no Live booking on top of the intro", async () => {
    const w = setup();
    // The intro's start has passed, so upcoming() (start > now) no longer
    // sees it, and a lead-page room carries no appointment id (LeadPage:
    // purpose manual). The intro stays confirmed and past: a show for B2B.
    w.intro("confirmed", w.clock.now - 5 * MIN);
    const id = await w.opened(setter);
    await w.mark(setter, id, "lead_in");
    // countLive books "Live · Huda" beside it: one conversation, two shows
    // (the intro in B2B's rate, the Live call on its own line, D25).
    expect(w.posts()).toHaveLength(0);
  });

  test("standing-count-ignores-in-flight-claim: the first room's count claimed and never finished (the function stopped mid-booking); a second room the same day must not book again", async () => {
    const w = setup();
    // Room A: the lead joined ten minutes ago; its count claimed, posted the
    // booking to HighLevel, and the isolate died before countResult wrote
    // (the orphan case of contract v2 section 16). The claim stands with no
    // result and no appointment id: the booking may exist.
    const a = fakeUuid();
    w.db.seed("cockpit_sales_rooms", [
      {
        id: a,
        request_id: fakeUuid(),
        contact_id: LEAD,
        purpose: "manual",
        trigger: "manual",
        call_kind: "intro",
        provider: "meet",
        host_email: SETTER,
        made_by: SETTER,
        state: "ended",
        result: "joined",
        join_url: MEET_URL,
        requested_at: new Date(w.clock.now - 20 * MIN).toISOString(),
        opened_at: new Date(w.clock.now - 19 * MIN).toISOString(),
        link_sent_at: new Date(w.clock.now - 18 * MIN).toISOString(),
        first_open_at: new Date(w.clock.now - 15 * MIN).toISOString(),
        lead_in_at: new Date(w.clock.now - 10 * MIN).toISOString(),
        ended_at: new Date(w.clock.now - 3 * MIN).toISOString(),
        count_claimed_at: new Date(w.clock.now - 10 * MIN).toISOString(),
        version: 6,
      },
    ]);
    const b = await w.opened(setter);
    await w.mark(setter, b, "lead_in");
    // standingCount reads unclear, booked, moved and a mark as standing, but
    // not a claim still in flight: "missing is never zero" says a booking
    // that may exist is not "none". Two "Live ·" bookings for one conversation.
    expect(w.posts()).toHaveLength(0);
  });

  test("standing-count-day-boundary: the lead joins at 23:55 Kuwait time, the call drops, and they join a new room at 00:03: one conversation, one Live booking", async () => {
    const w = setup(Date.parse("2026-10-04T20:55:00Z")); // 23:55 in Kuwait
    const a = await w.opened(setter);
    await w.mark(setter, a, "lead_in");
    expect(w.posts()).toHaveLength(1);
    w.clock.now += 5 * MIN;
    await w.end(setter, a);
    w.clock.now += 3 * MIN; // 00:03 the next day in Kuwait
    const b = await w.opened(setter);
    await w.mark(setter, b, "lead_in");
    // standingCount looks only at joins since Kuwait midnight of now.
    expect(w.posts()).toHaveLength(1);
  });

  test("standing-count-day-boundary (count_confirm): a manager confirms yesterday's hand-pressed join the next morning; the lead's Zoom join an hour after it was already booked: no second Live booking", async () => {
    const w = setup();
    const day1 = w.clock.now; // Sunday 10:00 Kuwait
    const base = {
      request_id: "",
      contact_id: LEAD,
      purpose: "manual",
      trigger: "manual",
      call_kind: "intro",
      host_email: SETTER,
      made_by: SETTER,
      state: "ended",
      result: "joined",
      version: 6,
    };
    // Room A: the setter pressed "The lead is in" (Meet, no open seen): self_reported, a manager decides.
    const a = fakeUuid();
    // Room B, twenty minutes later: the lead joined on Zoom, counted and booked.
    const b = fakeUuid();
    w.db.seed("cockpit_sales_rooms", [
      {
        ...base,
        id: a,
        request_id: fakeUuid(),
        provider: "meet",
        join_url: MEET_URL,
        requested_at: new Date(day1 - 5 * MIN).toISOString(),
        opened_at: new Date(day1 - 4 * MIN).toISOString(),
        lead_in_at: new Date(day1).toISOString(),
        ended_at: new Date(day1 + 10 * MIN).toISOString(),
        count_claimed_at: new Date(day1).toISOString(),
        count_result: "self_reported",
      },
      {
        ...base,
        id: b,
        request_id: fakeUuid(),
        provider: "zoom",
        join_url: ZOOM_URL,
        requested_at: new Date(day1 + 15 * MIN).toISOString(),
        opened_at: new Date(day1 + 16 * MIN).toISOString(),
        link_sent_at: new Date(day1 + 17 * MIN).toISOString(),
        first_open_at: new Date(day1 + 18 * MIN).toISOString(),
        lead_in_at: new Date(day1 + 20 * MIN).toISOString(),
        ended_at: new Date(day1 + 45 * MIN).toISOString(),
        count_claimed_at: new Date(day1 + 20 * MIN).toISOString(),
        count_result: "booked",
        count_appointment_id: "live-appt-B",
      },
    ]);
    // Monday 09:00: the manager reads the alert and confirms room A.
    w.clock.now = day1 + 23 * HOUR;
    const manager: Who = { signed_in: true, seat: true, manager: true, email: "manager@stress.invalid", name: "Mona Manager", role: "manager" };
    await w.rooms.actions["room.count_confirm"]!(manager, { room_id: a });
    await w.flush();
    // standingCount reads only joins since today's Kuwait midnight, so
    // yesterday's room B (booked) is invisible: the same conversation is
    // booked a second time, "Live ·" at 10:00 beside B's at 10:20.
    expect(w.posts()).toHaveLength(0);
  });

  test("undo-of-sibling-leaves-real-join-uncounted: room A's join is taken back after the lead really joined room B; B's join must still be counted once", async () => {
    const w = setup();
    // Room A: someone opens the link and joins (the lead's colleague); the
    // count books. The setter ends A and sends a fresh link (room B).
    const a = await w.opened(setter);
    await w.mark(setter, a, "lead_in");
    expect(w.room(a).count_result).toBe("booked");
    w.clock.now += 1 * MIN;
    await w.end(setter, a);
    w.clock.now += 1 * MIN;
    const b = await w.opened(setter);
    await w.mark(setter, b, "lead_in");
    // B is the real lead: the count says already_counted (A's booking stands).
    expect(w.room(b).count_result).toBe("already_counted");
    // Within A's five minutes, the setter says A's join was not the lead.
    w.clock.now += 1 * MIN;
    await w.mark(setter, a, "not_lead");
    expect(w.deletes().length).toBeGreaterThan(0); // A's booking is taken back
    // The sweep's re-asks run for a while.
    for (let i = 0; i < 5; i++) {
      w.clock.now += 1 * MIN;
      await w.tick([a, b]);
    }
    // The lead's one real join (in B) is now counted nowhere: B was settled
    // as already_counted and is never claimable again; A was undone.
    const standing = [a, b].filter(id => ["booked", "moved"].includes(String(w.room(id).count_result)) && !w.room(id).count_undo_at);
    expect(standing).toHaveLength(1);
  });

  test("count-move-takes-another-reps-call: the closer's intro room moves the lead's intro booked with the setter to now and gives it to the closer (the mark path refuses the same case)", async () => {
    const w = setup();
    // The lead's next intro is tomorrow, booked with the setter.
    w.knobs.upcoming = { id: "intro-next", start: w.clock.now + 24 * HOUR, assigned_user_id: "G-setter" };
    const id = await w.opened(closer, {}, { provider: "zoom" });
    await w.mark(closer, id, "lead_in");
    const moved = w.ghlCalls.find(c => c.method === "PUT" && c.path === "/calendars/events/appointments/intro-next" && (c.body as Row).startTime) as
      | { body: Row }
      | undefined;
    // hostMayMark refuses to mark another rep's intro (count_result failed,
    // "the intro is booked with another rep"). The move path writes the same
    // show into the same rep's numbers' calendar, and reassigns the call.
    expect(moved?.body.assignedUserId === "G-closer").toBe(false);
    // Fixed (round 3): neither moved nor counted here, and a person is told which call to mark.
    expect(moved).toBeUndefined();
    expect(w.db.t("cockpit_sales_alerts").filter(a => String(a.dedupe_key).endsWith(":count_other_rep"))).toHaveLength(1);
  });
});

describe("the holdout salt keeps the two experiments apart (C36)", () => {
  test("waves-salt-may-equal-threads: a settings save that sets followups.waves.salt to 'threads' is refused", () => {
    const before = { waves: { per_day: 40, holdout_share: 0.1, batch_gap_s: 45, salt: "waves" } };
    const out = followupSettingsValue(before, { waves: { salt: "threads" } }, FOLLOWUP_SEGMENTS as unknown as string[]);
    // With the demo chat's salt, sha256('threads:'||contact_id) holds back the
    // same leads in both experiments: they nest, and neither measures alone.
    expect(out.ok).toBe(false);
  });
});
