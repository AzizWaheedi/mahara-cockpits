// bun test supabase/functions/sales-api/stress2_numbers_r2.test.ts
//
// Second series, round 2, numbers and data integrity: every join counted
// once, whichever order the counts and the confirms run in; the count's
// alerts after "That was not the lead"; the join on another rep's running
// intro. HighLevel here is stateful (a PUT of appointmentStatus changes what
// the next GET answers), as in stress2_numbers_count.test.ts.
//
// A test that fails here is a finding. Everything runs on testfakes.ts: no
// HighLevel, no database, no Zoom.
import { describe, expect, test } from "bun:test";
import { BOOKING_CALENDARS } from "./dialer.ts";
import { refuseMark, type Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld, seedLeadZoomJoin } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter@stress.invalid";
const CLOSER = "closer@stress.invalid";
const LEAD = "stress-lead-s2n2-00001";
const MEET_URL = "https://meet.google.com/abc-defg-hij";

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const manager: Who = { signed_in: true, seat: true, manager: true, email: "manager@stress.invalid", name: "Mona Manager", role: "manager" };

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
  const hl = new Map<string, string>();
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON } },
    { key: "live", value: { enabled: false, standby: true } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: CLOSER, name: "Cyrus Closer", role: "closer", ghl_user_id: "G-closer", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.routes.push(async (m, p, body) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: [] };
    const one = /^\/calendars\/events\/appointments\/([^/?]+)$/.exec(p);
    if (one) {
      const id = decodeURIComponent(one[1] as string);
      const a = w.db.t("cockpit_sales_appointments").find(x => x.appointment_id === id);
      if (m === "GET")
        return a
          ? { appointment: { id, appointmentStatus: hl.get(id) ?? a.status, startTime: a.start_at, endTime: a.end_at, assignedUserId: a.assigned_user_id } }
          : (null as unknown as Row);
      if (m === "PUT") {
        const st = (body as Row | undefined)?.appointmentStatus;
        if (typeof st === "string") hl.set(id, st);
        return { ok: true };
      }
    }
    if (m === "POST" && p === "/calendars/events/appointments") return { id: `live-${fakeUuid()}` };
    if (m === "DELETE") return { ok: true };
    return null as unknown as Row;
  });
  async function markAppointment(who: Who, id: string, status: string, opts: Row = {}): Promise<Row> {
    const appt = w.db.t("cockpit_sales_appointments").find(a => a.appointment_id === id);
    if (appt) {
      const no = refuseMark(opts.anyRep ? { ...who, manager: true } : who, appt as never, status, w.clock.now);
      if (no) throw new ApiRefusal(no, 403);
    }
    const current = w.db.t("cockpit_sales_dispositions").find(d => d.appointment_id === id && !d.superseded_at);
    if (current && current.status === status && current.crm !== "failed") return { ...current, repeated: true };
    if (current) current.superseded_at = w.db.iso();
    const made: Row = {
      id: fakeUuid(),
      appointment_id: id,
      status,
      marked_by: who.email,
      note: (opts.note as string | undefined) ?? null,
      superseded_at: null,
      marked_at: w.db.iso(),
      crm: opts.quiet ? "quiet" : "written",
    };
    w.db.t("cockpit_sales_dispositions").push(made);
    hl.set(id, status);
    return { ...made };
  }
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: (who, id, status, opts) => markAppointment(who, id, status, opts as Row),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    // Nothing ahead: the lead's only call is the intro that is running or has run.
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;

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
    hl.set("intro-1", status);
  }

  async function makeRoom(ask: Row, o: { evidence?: boolean } = {}): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      ...ask,
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
        join_url: MEET_URL,
        provider_meeting_id: `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(room(id).version) + 1,
      },
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso() } });
    if (o.evidence !== false) seedLeadZoomJoin(w.db, id);
    return id;
  }
  async function press(id: string, what: "lead_in" | "not_lead" | "host_in") {
    await rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(room(id).version), what });
    await w.flush();
  }
  async function finish(id: string) {
    await rooms.actions["room.end"]!(setter, { room_id: id, version: Number(room(id).version), reason: "finished", confirm: true });
    await w.flush();
  }
  async function confirm(id: string) {
    await rooms.actions["room.count_confirm"]!(manager, { room_id: id });
    await w.flush();
  }
  async function tick(ids: string[]) {
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: ids } });
    await w.flush();
  }
  const alerts = () => w.db.t("cockpit_sales_alerts");
  const openAlert = (key: string) => alerts().some(a => a.dedupe_key === key && !a.resolved_at);
  const posts = () => w.ghlCalls.filter(c => c.method === "POST" && c.path === "/calendars/events/appointments");
  return { ...w, rooms, audits, hl, room, intro, makeRoom, press, finish, confirm, tick, alerts, openAlert, posts, markAppointment };
}

/**
 * The setter's two Meet rooms for one lead, forty minutes apart, inside the
 * count's three hours (rooms.ts SIBLING_JOIN_H): the dialer's room for the
 * intro, then the lead page's after the call dropped. Meet sees no join, so
 * both hand-pressed joins wait for a manager (count_result self_reported).
 */
async function twoMeetRooms() {
  const w = setup();
  const start = w.clock.now - 1 * MIN;
  w.intro("confirmed", start);
  // 14:01 the dialer's room for the intro (the intro is the setter's own).
  const a = await w.makeRoom({ purpose: "fallback", trigger: "no_answer", appointment_id: "intro-1" }, { evidence: false });
  expect(w.room(a).appointment_id).toBe("intro-1");
  await w.press(a, "lead_in");
  expect(w.room(a).count_result).toBe("self_reported");
  await w.finish(a);
  // 14:41 the call dropped; the setter sends a new link from the lead page.
  w.clock.now += 40 * MIN;
  const b = await w.makeRoom({ purpose: "manual" }, { evidence: false });
  await w.press(b, "lead_in");
  expect(w.room(b).count_result).toBe("self_reported");
  return { w, a, b };
}

describe("one conversation, two hand-pressed joins, a manager confirms both", () => {
  test("control: the manager confirms the intro's room first: the intro is marked shown, the second room is already counted", async () => {
    const { w, a, b } = await twoMeetRooms();
    await w.confirm(a);
    await w.confirm(b);
    expect(w.hl.get("intro-1")).toBe("showed");
    expect(w.room(b).count_result).toBe("already_counted");
    expect(w.posts()).toHaveLength(0);
  });

  test("confirm-order-marks-intro-beside-live-booking: the manager confirms the later room first (it books a Live call, the intro's room is only self_reported), then the intro's room: the intro is marked shown beside the Live booking", async () => {
    const { w, a, b } = await twoMeetRooms();
    await w.confirm(b);
    // The later room found no count standing (the intro's room is only
    // self_reported) and booked a Live call for the conversation.
    expect(w.posts()).toHaveLength(1);
    await w.confirm(a);
    // The intro's room plans a mark (countLive returns before it reads the
    // lead's other rooms, and the claim reads siblings only for a move or a
    // booking): the same conversation is counted twice, a Live booking and
    // the intro shown, where the other order counts it once.
    const counts = w.posts().length + (w.hl.get("intro-1") === "showed" ? 1 : 0);
    expect(counts).toBe(1);
  });
});

describe("the count's alerts after That was not the lead", () => {
  test("count-confirm-alert-left-open-after-not-lead: a hand-pressed join waits for a manager; the setter presses That was not the lead a minute later: the manager's alert is still open", async () => {
    const w = setup();
    w.intro("confirmed", w.clock.now - 1 * MIN);
    const id = await w.makeRoom({ purpose: "fallback", trigger: "no_answer", appointment_id: "intro-1" }, { evidence: false });
    await w.press(id, "lead_in");
    const key = `room:${id}:count_confirm`;
    expect(w.openAlert(key)).toBe(true);
    w.clock.now += 1 * MIN;
    await w.press(id, "not_lead");
    await w.tick([id]);
    expect(w.room(id).count_result).toBe("undone");
    // The join was taken back: there is nothing for a manager to count (the
    // panel's confirm now answers "This join is not waiting to be
    // confirmed"), yet the alert still asks a manager to count it.
    let confirmRefused = "";
    await w.rooms.actions["room.count_confirm"]!(manager, { room_id: id }).catch(e => {
      confirmRefused = String((e as Error).message);
    });
    expect(confirmRefused).not.toBe("");
    expect(w.openAlert(key)).toBe(false);
  });
});

describe("a join on another rep's intro that is running now", () => {
  test("current-call-other-rep-counted-nowhere: the closer's intro started five minutes ago; the setter sends a video link from the lead page and the lead joins (Zoom sees them): the join is recorded already_counted, the closer's intro is not marked, and nobody is told", async () => {
    const w = setup();
    // The lead's intro is booked with the closer (G-closer), running now.
    w.intro("confirmed", w.clock.now - 5 * MIN, "G-closer");
    const id = await w.makeRoom({ purpose: "manual" });
    await w.press(id, "lead_in");
    await w.tick([id]);
    // What the count wrote, and what it told anyone.
    const result = w.room(id).count_result ?? null;
    const told = w.alerts().some(a => String(a.dedupe_key ?? "").startsWith(`room:${id}:`) && !a.resolved_at);
    // The same join with the closer's intro booked ahead (upcoming) is
    // "booked_other_rep": failed, and the closer or a manager is told to mark
    // it (count_other_rep_alert). With the intro running now it is
    // "already_counted" though nothing counted it, and nobody is told.
    expect(result === "already_counted" && !told).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A settle that only waits is given up as a failure. sales-api's settle
// releases its event (no finish) while it waits: another room for the call
// is still open, or the intro's start in the cockpit's copy is still ahead
// (the lead moved it later through HighLevel's link, and the copy caught up
// after the sweep posted the settle). cockpit_sales_room_event_lease counts a
// try at every lease of a settle event (20261003d: "A settle (source settle)
// counts the same way"), the sweep picks it again every minute, and the
// sweep's E0 gives it up after ten tries: settled_mark none and the alert
// "the no-show could not be written (sales-api or HighLevel did not
// answer)". The lease below counts tries as the SQL function does.
// ---------------------------------------------------------------------------

describe("a settle that only waits uses up its tries", () => {
  const START = Date.parse("2026-10-08T07:00:00.000Z"); // Thursday 10:00 Kuwait
  const SLEAD = "stress-lead-s2n2-settle1";
  function settleSetup(o: { copyStart: number; sibling?: boolean }) {
    const w = fakeWorld();
    w.clock.now = START + 21 * MIN;
    // The lease as the SQL function takes it: a try counted at every lease of a settle event.
    w.db.rpcs.cockpit_sales_room_event_lease = (a: Row) => {
      const e = w.db
        .t("cockpit_sales_room_events")
        .find(
          x =>
            (!a.p_event_id || x.id === a.p_event_id) &&
            (!a.p_dedupe_key || x.dedupe_key === a.p_dedupe_key) &&
            !x.handled_at &&
            (!x.lease_until || Date.parse(String(x.lease_until)) <= w.clock.now),
        );
      if (!e) return null;
      e.lease_until = new Date(w.clock.now + Number(a.p_seconds ?? 60) * 1000).toISOString();
      e.lease_token = a.p_token ?? null; // 20261004a: the holder's token
      if (["zoom", "slack", "worker", "claim", "settle"].includes(String(e.source))) e.tries = Number(e.tries ?? 0) + 1;
      return String(e.id);
    };
    const marks: Row[] = [];
    w.db.seed("cockpit_sales_settings", [
      { key: "rooms", value: { ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false, providers: { zoom: true, meet: true }, fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" } } },
      { key: "live", value: { enabled: false } },
      { key: "whatsapp_guard", value: {} },
      { key: "messaging", value: { whatsapp: true, email: true } },
    ]);
    w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
    w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "intro-s",
        contact_id: SLEAD,
        call_type: "intro",
        calendar_id: BOOKING_CALENDARS.intro_qualified,
        status: "confirmed",
        start_at: new Date(o.copyStart).toISOString(),
        assigned_user_id: "G-setter",
      },
    ]);
    w.routes.push(async (m, p) => {
      if (m === "GET" && p === `/contacts/${SLEAD}`) return { contact: { id: SLEAD, firstName: "Huda", phone: "+96550000000", tags: ["roas-qualified"] } };
      if (m === "GET" && p === "/calendars/events/appointments/intro-s")
        return { appointment: { id: "intro-s", appointmentStatus: "confirmed", startTime: new Date(o.copyStart).toISOString(), assignedUserId: "G-setter" } };
      if (m === "PUT") return { ok: true };
      return null as unknown as Row;
    });
    const deps: RoomDeps = {
      io: w.io,
      audit: async () => {},
      markAppointment: async (who, id, status) => {
        marks.push({ who: who.email, id, status });
        return { crm: "written" };
      },
      sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
      sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
      upcoming: async () => null,
    };
    const api = makeRooms(deps);
    const a = fakeUuid();
    const base: Row = {
      request_id: fakeUuid(),
      contact_id: SLEAD,
      purpose: "fallback",
      trigger: "no_answer",
      call_kind: "intro",
      provider: "zoom",
      host_email: SETTER,
      made_by: SETTER,
      appointment_id: "intro-s",
      appointment_start_at: new Date(START).toISOString(),
      join_url: "https://us06web.zoom.us/j/81234567890?pwd=abc",
      provider_meeting_id: "81234567890",
      link_channels: ["whatsapp_text"],
    };
    w.db.seed("cockpit_sales_rooms", [
      {
        ...base,
        id: a,
        state: "expired",
        result: "no_join",
        end_reason: "lead_no_show",
        requested_at: new Date(START + 1 * MIN).toISOString(),
        opened_at: new Date(START + 1 * MIN).toISOString(),
        link_sent_at: new Date(START + 1 * MIN + 5 * S).toISOString(),
        host_in_at: new Date(START + 2 * MIN).toISOString(),
        ended_at: new Date(START + 15 * MIN).toISOString(),
        version: 4,
      },
    ]);
    w.db.seed("cockpit_sales_room_events", [
      { room_id: a, kind: "zoom.meeting.started", source: "zoom", dedupe_key: `zoom:meeting.started:${a}`, at: new Date(START + 2 * MIN).toISOString(), handled_at: new Date(START + 2 * MIN).toISOString() },
      // The sweep's S1 posted the settle at 10:21 (the copy then said 10:00, and no other room was open).
      { room_id: a, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${a}`, at: new Date(START + 21 * MIN).toISOString(), tries: 0, text: "Due." },
    ]);
    if (o.sibling) {
      // 10:22: the lead wrote "can we talk now?", and the setter sent a new
      // link from the lead page; the room waits for the lead.
      w.db.seed("cockpit_sales_rooms", [
        {
          ...base,
          id: fakeUuid(),
          request_id: fakeUuid(),
          purpose: "manual",
          appointment_id: null,
          appointment_start_at: null,
          state: "host_in",
          requested_at: new Date(START + 22 * MIN).toISOString(),
          opened_at: new Date(START + 22 * MIN).toISOString(),
          link_sent_at: new Date(START + 22 * MIN + 5 * S).toISOString(),
          host_in_at: new Date(START + 23 * MIN).toISOString(),
          version: 3,
        },
      ]);
    }
    const ev = () => w.db.t("cockpit_sales_room_events").find(e => e.dedupe_key === `sweep.settle:${a}`) as Row;
    /** The sweep's pick each minute and the tick's post: room.event sweep.settle. */
    async function minutes(n: number) {
      for (let i = 0; i < n; i++) {
        w.clock.now += MIN;
        if (ev().handled_at) break;
        await api.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [a] } });
        await w.flush();
      }
    }
    return { ...w, a, ev, minutes, marks };
  }

  test("settle-wait-burns-tries (an open sibling): the second try's room is open for eleven minutes; the first room's settle only waits, yet it has used its ten tries, so the sweep gives it up as 'the no-show could not be written'", async () => {
    const w = settleSetup({ copyStart: START, sibling: true });
    await w.minutes(11);
    const e = w.ev();
    expect(e.handled_at ?? null).toBeNull(); // still waiting, as it should
    expect(w.marks).toHaveLength(0);
    // Ten real tries and the event is unhandled: the sweep's E0 now gives it
    // up (settled_mark none, "the no-show could not be written (sales-api or
    // HighLevel did not answer)"), though nothing failed and the second room
    // may still bring the lead or settle the intro.
    expect(Number(e.tries)).toBeLessThan(10);
  });

  test("settle-wait-burns-tries (the intro moved later): the lead moved the intro to 11:30 after the settle was posted and the copy caught up; the settle says 'not due' every minute until its tries are gone, never 'not for the intro as it is booked now'", async () => {
    const w = settleSetup({ copyStart: START + 90 * MIN });
    await w.minutes(11);
    const e = w.ev();
    expect(w.marks).toHaveLength(0);
    // The room was not for the intro as it is booked now (roomForThisStart):
    // that is a final answer (settled_mark none, no alert). Instead the event
    // is released each minute and its tries run out.
    expect(e.handled_at ? "handled" : `unhandled after ${e.tries} tries`).toBe("handled");
  });
});

// ---------------------------------------------------------------------------
// A manager's late confirm reads the calls as of the join (stress2 fix round
// 1: upcoming(after: join)), so the call "ahead" may have happened since and
// been marked shown by its rep. index.ts upcoming() leaves out cancelled,
// invalid and noshow calls, never one already held (showed).
// ---------------------------------------------------------------------------

describe("a manager confirms Sunday's hand-pressed join on Monday, after Monday's intro was held", () => {
  test("confirm-moves-held-intro-back: Monday 09:00's intro was held and marked shown by the setter; the manager's confirm at 11:00 moves that held intro back to Sunday's join minute", async () => {
    const w = fakeWorld();
    const HOUR = 60 * MIN;
    const sunday = w.clock.now;
    const monday = sunday + 23 * HOUR;
    const hl = new Map<string, { start: number; status: string; rep: string }>();
    hl.set("intro-mon", { start: monday, status: "confirmed", rep: "G-setter" });
    w.db.seed("cockpit_sales_settings", [
      { key: "rooms", value: { ...ROOMS_ON } },
      { key: "live", value: { enabled: false, standby: true } },
      { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
      { key: "messaging", value: { whatsapp: true, email: true } },
    ]);
    w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
    w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "intro-mon",
        contact_id: LEAD,
        call_type: "intro",
        calendar_id: BOOKING_CALENDARS.intro_qualified,
        status: "confirmed",
        start_at: new Date(monday).toISOString(),
        end_at: new Date(monday + 30 * MIN).toISOString(),
        assigned_user_id: "G-setter",
      },
    ]);
    w.routes.push(async (m, p, body) => {
      if (m === "GET" && p === `/contacts/${LEAD}`)
        return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
      const one = /^\/calendars\/events\/appointments\/([^/?]+)$/.exec(p);
      if (one) {
        const id = decodeURIComponent(one[1] as string);
        const a = hl.get(id);
        if (!a) return null as unknown as Row;
        if (m === "GET")
          return { appointment: { id, appointmentStatus: a.status, startTime: new Date(a.start).toISOString(), endTime: new Date(a.start + 30 * MIN).toISOString(), assignedUserId: a.rep } };
        if (m === "PUT") {
          const b = (body ?? {}) as Row;
          if (typeof b.appointmentStatus === "string") a.status = b.appointmentStatus;
          if (typeof b.startTime === "string") a.start = Date.parse(b.startTime);
          if (typeof b.assignedUserId === "string") a.rep = b.assignedUserId;
          return { ok: true };
        }
      }
      if (m === "POST" && p === "/calendars/events/appointments") return { id: `live-${fakeUuid()}` };
      return null as unknown as Row;
    });
    const deps: RoomDeps = {
      io: w.io,
      audit: async () => {},
      markAppointment: async (who, id, status) => {
        const a = hl.get(id);
        if (a) a.status = status;
        return { id: fakeUuid(), status, marked_by: who.email, crm: "written" };
      },
      sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
      sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
      // index.ts upcoming(): HighLevel's calls of the kind, not cancelled,
      // invalid or noshow, starting after `after` (the join, for a late
      // count), booked before the bound.
      upcoming: async (_c, _kind, opts) => {
        const after = typeof opts?.after === "number" ? Math.min(opts.after, w.clock.now) : w.clock.now;
        const ahead = [...hl.entries()]
          .filter(([, a]) => !["cancelled", "invalid", "noshow"].includes(a.status) && a.start > after)
          .sort((x, y) => x[1].start - y[1].start)[0];
        return ahead
          ? { id: ahead[0], start: ahead[1].start, end: ahead[1].start + 30 * MIN, assigned_user_id: ahead[1].rep, status: ahead[1].status, booked_at: sunday - 5 * 24 * HOUR }
          : null;
      },
    };
    const rooms = makeRooms(deps);
    const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
    // Sunday: the setter's Meet room from the lead page; only the press says the lead came.
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
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
        join_url: MEET_URL,
        provider_meeting_id: "evt-sun",
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(room(id).version) + 1,
      },
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso() } });
    await rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(room(id).version), what: "lead_in" });
    await w.flush();
    expect(room(id).count_result).toBe("self_reported");
    // Monday 09:00: the intro is held; the setter marks it shown at 09:35.
    w.clock.now = monday + 35 * MIN;
    (hl.get("intro-mon") as { status: string }).status = "showed";
    // Monday 11:00: the manager reads the alert and confirms Sunday's join.
    w.clock.now = monday + 2 * HOUR;
    await rooms.actions["room.count_confirm"]!(manager, { room_id: id });
    await w.flush();
    const intro = hl.get("intro-mon") as { start: number; status: string };
    // Monday's held intro must stay on Monday: it happened, and its rep marked it.
    expect(new Date(intro.start).toISOString()).toBe(new Date(monday).toISOString());
  });
});

// ---------------------------------------------------------------------------
// The count when the lead's contact cannot be read: runCount answers
// "skipped" ("the sweep's re-ask comes back for it") and says nothing, unlike
// a lead's calls that cannot be read (count_unread_alert after two minutes).
// The re-ask stops an hour after the join (REASK_WINDOW_S), and the SQL tick
// stops posting a final room an hour after its join, so a join HighLevel's
// contact read missed for that hour is never counted and nobody is told.
// ---------------------------------------------------------------------------

describe("the count when HighLevel cannot read the lead's contact", () => {
  test("count-contact-unread-gives-up-silently: the lead joins (Zoom sees them, the room's own intro is running); HighLevel answers 503 on the contact for the next hour: the join is never counted and no alert says so", async () => {
    const w = setup();
    w.intro("confirmed", w.clock.now - 2 * MIN);
    const id = await w.makeRoom({ purpose: "fallback", trigger: "no_answer", appointment_id: "intro-1" });
    // HighLevel's contact read fails from the join on (an outage).
    let down = true;
    w.routes.unshift(async (m, p) => {
      if (down && m === "GET" && p === `/contacts/${LEAD}`) throw Object.assign(new Error("HighLevel said 503"), { status: 503 });
      return null as unknown as Row;
    });
    await w.press(id, "lead_in");
    // The sweep's tick every minute for the hour the re-ask runs (and a minute past it).
    for (let i = 0; i < 62; i++) {
      w.clock.now += MIN;
      await w.tick([id]);
    }
    down = false;
    const counted = Boolean(w.room(id).count_claimed_at);
    const told = w.alerts().some(a => String(a.dedupe_key ?? "").startsWith(`room:${id}:`) && !a.resolved_at);
    // Missing is never zero: either the join is counted, or a person is told it was not.
    expect(counted || told).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// "That was not the lead" lands while the count's move is out at HighLevel,
// and the move's answer is lost. countResult takes back what a count made
// when its result write misses (F7), but only for a result that names the
// call (count_appointment_id): an unclear move writes none, so nothing moves
// the lead's intro back, and the room says undone.
// ---------------------------------------------------------------------------

describe("That was not the lead during a move whose answer is lost", () => {
  test("not-lead-during-unclear-move-leaves-intro-moved: a colleague joins the lead-page room (Zoom reads them as the lead); the count moves tomorrow's intro to now, HighLevel's answer times out and the read-back fails; the setter pressed That was not the lead meanwhile: tomorrow's intro must be put back", async () => {
    const w = fakeWorld();
    const HOUR = 60 * MIN;
    const tomorrow = w.clock.now + 24 * HOUR;
    const appt = { start: tomorrow, status: "confirmed", rep: "G-setter" };
    let readBackFails = false;
    let pressNotLead: (() => Promise<void>) | null = null;
    w.db.seed("cockpit_sales_settings", [
      { key: "rooms", value: { ...ROOMS_ON } },
      { key: "live", value: { enabled: false, standby: true } },
      { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
      { key: "messaging", value: { whatsapp: true, email: true } },
    ]);
    w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
    w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
    w.routes.push(async (m, p, body) => {
      if (m === "GET" && p === `/contacts/${LEAD}`)
        return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
      if (p === "/calendars/events/appointments/intro-tmr") {
        if (m === "GET") {
          if (readBackFails) throw Object.assign(new Error("HighLevel said 503"), { status: 503 });
          return { appointment: { id: "intro-tmr", appointmentStatus: appt.status, startTime: new Date(appt.start).toISOString(), assignedUserId: appt.rep } };
        }
        if (m === "PUT") {
          const b = (body ?? {}) as Row;
          if (typeof b.startTime === "string" && Date.parse(b.startTime) < tomorrow - HOUR && pressNotLead) {
            // HighLevel moves the call, the setter presses That was not the
            // lead while it is out, and HighLevel's answer is lost.
            appt.start = Date.parse(b.startTime);
            const press = pressNotLead;
            pressNotLead = null;
            await press();
            readBackFails = true;
            throw Object.assign(new Error("HighLevel timed out"), { status: 504 });
          }
          if (typeof b.startTime === "string") appt.start = Date.parse(b.startTime);
          if (typeof b.appointmentStatus === "string") appt.status = b.appointmentStatus;
          return { ok: true };
        }
      }
      if (m === "GET" && p === `/contacts/${LEAD}/appointments`) throw Object.assign(new Error("HighLevel said 503"), { status: 503 });
      return null as unknown as Row;
    });
    const deps: RoomDeps = {
      io: w.io,
      audit: async () => {},
      markAppointment: async (who, id, status) => ({ id: fakeUuid(), status, marked_by: who.email, crm: "written" }),
      sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
      sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
      upcoming: async () => ({ id: "intro-tmr", start: tomorrow, end: tomorrow + 30 * MIN, assigned_user_id: "G-setter", status: "confirmed", booked_at: w.clock.now - 48 * HOUR }),
    };
    const rooms = makeRooms(deps);
    const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "intro",
      purpose: "manual",
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
        join_url: "https://us06web.zoom.us/j/81234567001?pwd=x",
        provider_meeting_id: "81234567001",
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        host_in_at: w.db.iso(),
        version: Number(room(id).version) + 1,
      },
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso() } });
    seedLeadZoomJoin(w.db, id, { name: "Sam from the office" });
    pressNotLead = async () => {
      w.clock.now += 10 * S;
      await rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(room(id).version), what: "not_lead" });
    };
    await rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(room(id).version), what: "lead_in" });
    await w.flush();
    // The sweep's re-asks for the next ten minutes; HighLevel answers again.
    readBackFails = false;
    for (let i = 0; i < 10; i++) {
      w.clock.now += MIN;
      await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
      await w.flush();
    }
    if (process.env.S2N2_DEBUG) console.log(JSON.stringify({ result: room(id).count_result, appt_id: room(id).count_appointment_id, alerts: w.db.t("cockpit_sales_alerts").map(a => [a.dedupe_key, a.message, a.resolved_at ?? null]) }));
    expect(room(id).count_undo_at ?? null).not.toBeNull();
    // The lead's real intro is tomorrow: nothing may leave it at the colleague's join.
    expect(new Date(appt.start).toISOString()).toBe(new Date(tomorrow).toISOString());
  });
});
