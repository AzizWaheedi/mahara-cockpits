// bun test supabase/functions/sales-api/stress2_numbers_r5.test.ts
//
// Second series, round 5, numbers and data integrity: a join is counted
// once and never zero times without a word, the live booking's copy check
// (syncLiveCopy, fix round 4) on a test booking, and the copy check while
// "That was not the lead" is still being carried out.
//
// A test that fails here is a finding; tests named "control" pass.
// Everything runs on testfakes.ts: no HighLevel, no database, no Zoom.
import { describe, expect, test } from "bun:test";
import { refuseMark, type Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld, seedLeadZoomJoin } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter@stress.invalid";
const MANAGER = "manager@stress.invalid";
const LEAD = "stress-lead-s2n5-00001";
const MEET_URL = "https://meet.google.com/abc-defg-hij";

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


function setup(o: { seatGhl?: string | null; tags?: string[]; rooms?: Row } = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  const hl = new Map<string, string>();
  const ghlId = o.seatGhl === undefined ? "G-setter" : o.seatGhl;
  const seat: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: ghlId };
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON, ...(o.rooms ?? {}) } },
    { key: "live", value: { enabled: false, standby: true } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: ghlId, active: true },
    { email: MANAGER, name: "Mona Manager", role: "manager", ghl_user_id: "G-manager", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  const bookings: Row[] = [];
  /** HighLevel unreadable for GETs of one appointment while this is set. */
  const hlDown = { on: false };
  w.routes.push(async (m, p, body) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return {
        contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: o.tags ?? ["roas-qualified"], country: "KW" },
      };
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`)
      return { events: bookings.filter(b => !b.deleted).map(b => ({ ...(b.body as Row), id: b.id })) };
    const one = /^\/calendars\/events\/appointments\/([^/?]+)$/.exec(p);
    if (one) {
      const id = decodeURIComponent(one[1] as string);
      const live = bookings.find(b => b.id === id);
      if (m === "GET" && live) {
        if (hlDown.on) throw Object.assign(new Error("HighLevel said 503: upstream"), { status: 503 });
        if (live.deleted) throw Object.assign(new Error("HighLevel said 404: not found"), { status: 404 });
        const b = live.body as Row;
        return { appointment: { id, calendarId: b.calendarId, startTime: b.startTime, endTime: b.endTime, title: b.title, assignedUserId: b.assignedUserId, appointmentStatus: hl.get(id) ?? b.appointmentStatus } };
      }
      const a = w.db.t("cockpit_sales_appointments").find(x => x.appointment_id === id);
      if (m === "GET")
        return a
          ? { appointment: { id, appointmentStatus: hl.get(id) ?? a.status, startTime: a.start_at, endTime: a.end_at, assignedUserId: a.assigned_user_id, calendarId: a.calendar_id } }
          : (null as unknown as Row);
      if (m === "PUT") {
        const st = (body as Row | undefined)?.appointmentStatus;
        if (typeof st === "string") hl.set(id, st);
        return { ok: true };
      }
    }
    if (m === "POST" && p === "/calendars/events/appointments") {
      const id = `live-${fakeUuid()}`;
      bookings.push({ id, body });
      return { id };
    }
    const del = /^\/calendars\/events\/([^/?]+)$/.exec(p);
    if (m === "DELETE" && del) {
      const b = bookings.find(x => x.id === decodeURIComponent(del[1] as string));
      if (b) b.deleted = true;
      return { ok: true };
    }
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
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;

  async function makeRoom(ask: Row, opt: { evidence?: boolean } = {}): Promise<string> {
    const out = await rooms.actions["room.create"]!(seat, {
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
    if (opt.evidence !== false) seedLeadZoomJoin(w.db, id);
    return id;
  }
  async function press(id: string, what: "lead_in" | "not_lead" | "host_in") {
    await rooms.actions["room.mark"]!(seat, { room_id: id, version: Number(room(id).version), what });
    await w.flush();
  }
  async function tick(ids: string[]) {
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: ids } });
    await w.flush();
  }
  async function minutes(ids: string[], n: number) {
    for (let i = 0; i < n; i++) {
      w.clock.now += MIN;
      await tick(ids).catch(() => null);
    }
  }
  const alerts = () => w.db.t("cockpit_sales_alerts");
  const openAlerts = (id: string) => alerts().filter(a => !a.resolved_at && String(a.dedupe_key ?? "").startsWith(`room:${id}:`));
  const posts = () => w.ghlCalls.filter(c => c.method === "POST" && c.path === "/calendars/events/appointments");
  return { ...w, rooms, audits, hl, hlDown, room, makeRoom, press, tick, minutes, alerts, openAlerts, posts, bookings, seat };
}

const told = (w: ReturnType<typeof setup>, id: string) => w.openAlerts(id).map(a => `${String(a.dedupe_key)}: ${String(a.message ?? "")}`);

// ---------------------------------------------------------------------------
// 1. A join on a seat with no HighLevel user (one of three manager seats in
//    production) is never booked, and the cause reaches nobody
// ---------------------------------------------------------------------------

describe("the lead joins a room whose host has no HighLevel user", () => {
  test("control: the seat has its HighLevel user: the join is booked once as a live call", async () => {
    const w = setup();
    const b = await w.makeRoom({ purpose: "manual" });
    await w.press(b, "lead_in");
    expect(w.room(b).count_result).toBe("booked");
    expect(w.posts()).toHaveLength(1);
  });

  test("seat-without-highlevel-user-join-never-counted-cause-unsaid: the seat has no HighLevel user (room.create never asks for one); a tagged lead joins the lead page's video room (Zoom sees them) and talks: the count writes failed (host_not_in_highlevel) with no alert; the panel's only line is the generic 'Not counted in HighLevel: mark the lead's call there shown, or add this one', so every join of this seat is counted nowhere and nobody learns why", async () => {
    const w = setup({ seatGhl: null });
    const b = await w.makeRoom({ purpose: "manual" });
    await w.press(b, "lead_in");
    await w.minutes([b], 70);
    const r = w.room(b);
    const counted = w.audits.filter(a => a.action === "room.count").map(a => JSON.stringify(a.after));
    expect(
      { booked: w.posts().length, a_person_told: told(w, b).length > 0 },
      `count_result=${String(r.count_result)}; audit rows: ${counted.join(" | ")}; open alerts: ${told(w, b).join(" | ") || "none"}`,
    ).toEqual({ booked: 0, a_person_told: true });
  });
});

// ---------------------------------------------------------------------------
// 2. The copy check on a test contact's live booking
// ---------------------------------------------------------------------------

describe("the tick's copy check on a test contact's live booking (never copied: it is on the test calendar)", () => {
  test("control: HighLevel answers: a test booking is left out of the copy and nobody is told anything", async () => {
    const w = setup({ rooms: { test_contacts: [LEAD] } });
    const b = await w.makeRoom({ purpose: "manual" });
    await w.press(b, "lead_in");
    expect(w.room(b).count_result).toBe("booked");
    expect((w.posts()[0]?.body as Row).calendarId).toBe("TESTCAL");
    await w.minutes([b], 5);
    expect(w.db.t("cockpit_sales_appointments").filter(a => a.contact_id === LEAD)).toHaveLength(0);
    expect(told(w, b)).toEqual([]);
  });

  test("test-booking-copy-check-raises-live-copy-alert: the test contact's live booking is on the test calendar; HighLevel cannot be read for two minutes after the join: the tick tells a person 'the live call is in HighLevel but not in the cockpit's calendar yet, so the setter's pay estimate and the EOD do not count it', and once HighLevel answers the alert is never answered (the check returns at the test calendar first)", async () => {
    const w = setup({ rooms: { test_contacts: [LEAD] } });
    const b = await w.makeRoom({ purpose: "manual" });
    await w.press(b, "lead_in");
    expect(w.room(b).count_result).toBe("booked");
    w.hlDown.on = true;
    await w.minutes([b], 2);
    w.hlDown.on = false;
    await w.minutes([b], 68);
    expect(told(w, b), "a test booking is never copied, so nobody is asked to look for its copy").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. The live booking a person adds by hand after the count's booking failed
// ---------------------------------------------------------------------------

describe("the count's live booking is refused and a person adds it by hand, as the alert asks", () => {
  test("hand-booked-live-call-after-failed-count-counted-nowhere: HighLevel refuses the count's live booking for good (count_result failed); the alert says 'Add the call on the live calendar and mark it shown'; the setter does, in HighLevel: the cockpit's calendar copy never gets the call (no mirror reads the live calendar, the tick copies only count_result booked), so the setter's pay estimate and EOD never count the intro the lead had", async () => {
    const w = setup();
    let refused = 0;
    w.routes.unshift(async (m, p) => {
      if (m === "POST" && p === "/calendars/events/appointments" && refused === 0) {
        refused++;
        throw Object.assign(new Error("HighLevel said 422: The slot you have selected is no longer available"), { status: 422 });
      }
      return null as unknown as Row;
    });
    const b = await w.makeRoom({ purpose: "manual" });
    await w.press(b, "lead_in");
    expect(w.room(b).count_result).toBe("failed");
    const ask = told(w, b).find(t => /Add the call on the live calendar and mark it shown/.test(t));
    expect(ask, `open alerts: ${told(w, b).join(" | ") || "none"}`).toBeTruthy();
    // The setter adds it in HighLevel, as asked: the live calendar, now, shown, theirs.
    const start = new Date(Date.parse(String(w.room(b).lead_in_at))).toISOString();
    w.bookings.push({
      id: "by-hand-1",
      body: { calendarId: "LIVECAL", contactId: LEAD, startTime: start, endTime: new Date(Date.parse(start) + 15 * MIN).toISOString(), title: "Live · Huda Ali", appointmentStatus: "showed", assignedUserId: "G-setter" },
    });
    await w.minutes([b], 70);
    // NumbersPay.tsx: the setter's intros with status showed in cockpit_sales_calendar (the copy).
    const paid = w.db
      .t("cockpit_sales_appointments")
      .filter(a => a.contact_id === LEAD && a.call_type === "intro" && a.assigned_user_id === "G-setter" && a.status === "showed").length;
    expect(
      { paid_intros: paid },
      `count_result=${String(w.room(b).count_result)}; copy rows for the lead: ${w.db.t("cockpit_sales_appointments").filter(a => a.contact_id === LEAD).length}; open alerts: ${told(w, b).join(" | ") || "none"}`,
    ).toEqual({ paid_intros: 1 });
  });
});
