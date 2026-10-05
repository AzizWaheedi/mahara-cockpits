// bun test supabase/functions/sales-api/stress2_numbers_r6.test.ts
//
// Second series, round 6, numbers and data integrity:
// 1. one conversation with a lead is one intro in the setter's numbers (the
//    pay estimate's showed intros, the EOD's intro_shows), whichever way it
//    went on (the intro held on the phone, then a video link);
// 2. a manager's video call never takes the setter's intro (its rep, so its
//    show and the deal credit cockpit_sales_setter_deals reads);
// 3. a live call a person adds by hand after a failed count, as the alert
//    asks, is counted whenever they add it, not only in the tick's hour.
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
const LEAD = "stress-lead-s2n6-00001";
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


function setup(o: { seatGhl?: string | null; tags?: string[]; rooms?: Row; asManager?: boolean; upcoming?: RoomDeps["upcoming"] } = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  const hl = new Map<string, string>();
  const ghlId = o.seatGhl === undefined ? "G-setter" : o.seatGhl;
  const seat: Who = o.asManager
    ? { signed_in: true, seat: true, manager: true, email: MANAGER, name: "Mona Manager", role: "manager", ghl_user_id: "G-manager" }
    : { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: ghlId };
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
  w.db.seed("cockpit_sales_room_hosts", [
    { email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true },
    { email: MANAGER, zoom_user_id: "Z-manager", zoom_status: "licensed", google_ok: true },
  ]);
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
    upcoming: o.upcoming ?? (async () => null),
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
// 1. The intro held by phone, then a video link the same morning
// ---------------------------------------------------------------------------

/** The lead's intro with the setter, `minsBefore` minutes before now, as B2B's copy has it. */
function seedIntro(w: ReturnType<typeof setup>, minsBefore: number, status: string) {
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: "intro-1",
      contact_id: LEAD,
      contact_name: "Huda Ali",
      calendar_id: "INTROCAL",
      call_type: "intro",
      start_at: new Date(w.clock.now - minsBefore * MIN).toISOString(),
      end_at: new Date(w.clock.now - minsBefore * MIN + 30 * MIN).toISOString(),
      booked_at: new Date(w.clock.now - 2 * 24 * 60 * MIN).toISOString(),
      status,
      assigned_user_id: "G-setter",
      origin: "b2b",
    },
  ]);
}

/** What NumbersPay.tsx pays and eodCount's intro_shows counts: the setter's intros that day, showed (or confirmed and past, the B2B rule). */
function introsShown(w: ReturnType<typeof setup>): number {
  return w.db
    .t("cockpit_sales_appointments")
    .filter(a => a.contact_id === LEAD && a.call_type === "intro" && a.assigned_user_id === "G-setter")
    .filter(a => {
      const mark = w.db.t("cockpit_sales_dispositions").find(d => d.appointment_id === a.appointment_id && !d.superseded_at);
      const st = String(mark?.status ?? a.status);
      return st === "showed" || (st === "confirmed" && Date.parse(String(a.start_at)) < w.clock.now);
    }).length;
}

describe("the intro held on the phone, then a video link from the lead page", () => {
  test("control: the intro started 15 minutes before the join (still running): the join is that intro, nothing is booked beside it", async () => {
    const w = setup();
    seedIntro(w, 15, "confirmed");
    const b = await w.makeRoom({ purpose: "manual" });
    await w.press(b, "lead_in");
    await w.minutes([b], 3);
    expect({ live_bookings: w.posts().length, intros_shown: introsShown(w) }).toEqual({ live_bookings: 0, intros_shown: 1 });
  });

  test("held-intro-then-video-books-second-intro: the setter held the 09:20 intro on the phone (marked showed); at 10:00 the lead asks to see the portal, the setter sends a video link from the lead page and the lead joins: the count books 'Live · Huda' with the setter and marks it shown, so the setter's showed intros (the pay estimate's $10 each, the EOD's intro_shows) count this one lead's one intro twice", async () => {
    const w = setup();
    seedIntro(w, 40, "showed");
    const b = await w.makeRoom({ purpose: "manual" });
    await w.press(b, "lead_in");
    await w.minutes([b], 3);
    expect(
      { live_bookings: w.posts().length, intros_shown: introsShown(w) },
      `count_result=${String(w.room(b).count_result)}; copy rows: ${JSON.stringify(w.db.t("cockpit_sales_appointments").filter(a => a.contact_id === LEAD).map(a => [a.appointment_id, a.calendar_id, a.status]))}`,
    ).toEqual({ live_bookings: 0, intros_shown: 1 });
  });

  test("held-intro-then-video-books-second-intro (not marked yet): the 09:20 intro was held on the phone and is still confirmed (a show by the B2B rule); the video join at 10:00 books a second intro beside it", async () => {
    const w = setup();
    seedIntro(w, 40, "confirmed");
    const b = await w.makeRoom({ purpose: "manual" });
    await w.press(b, "lead_in");
    await w.minutes([b], 3);
    expect(
      { live_bookings: w.posts().length, intros_shown: introsShown(w) },
      `count_result=${String(w.room(b).count_result)}`,
    ).toEqual({ live_bookings: 0, intros_shown: 1 });
  });
});

// ---------------------------------------------------------------------------
// 2. A manager's video call with a lead whose intro is the setter's
// ---------------------------------------------------------------------------

describe("a manager talks to the setter's lead on video before the lead's intro", () => {
  const tomorrow = Date.parse("2026-10-05T07:00:00Z");
  function withIntroTomorrow(asManager: boolean) {
    const w = setup({
      asManager,
      upcoming: async () => ({ id: "intro-2", start: tomorrow, end: tomorrow + 30 * MIN, assigned_user_id: "G-setter", status: "confirmed", booked_at: Date.parse("2026-10-02T07:00:00Z") }),
    });
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "intro-2",
        contact_id: LEAD,
        contact_name: "Huda Ali",
        calendar_id: "INTROCAL",
        call_type: "intro",
        start_at: new Date(tomorrow).toISOString(),
        end_at: new Date(tomorrow + 30 * MIN).toISOString(),
        booked_at: "2026-10-02T07:00:00.000Z",
        status: "confirmed",
        assigned_user_id: "G-setter",
        origin: "b2b",
      },
    ]);
    return w;
  }

  test("control: the setter's own room: the setter's intro moves to now and stays the setter's", async () => {
    const w = withIntroTomorrow(false);
    const b = await w.makeRoom({ purpose: "manual" });
    await w.press(b, "lead_in");
    const put = w.ghlCalls.find(c => c.method === "PUT" && c.path === "/calendars/events/appointments/intro-2" && (c.body as Row)?.startTime);
    expect(w.room(b).count_result).toBe("moved");
    expect((put?.body as Row)?.assignedUserId).toBe("G-setter");
  });

  test("manager-room-move-reassigns-setters-intro: the manager sends a video link from the lead page and the lead joins: the count moves the setter's intro to now and assigns it to the manager, so the setter's showed intros (pay estimate, EOD) lose it and cockpit_sales_setter_deals credits the lead's deal to the manager's HighLevel user instead of the setter", async () => {
    const w = withIntroTomorrow(true);
    const b = await w.makeRoom({ purpose: "manual" });
    await w.press(b, "lead_in");
    const put = w.ghlCalls.find(c => c.method === "PUT" && c.path === "/calendars/events/appointments/intro-2" && (c.body as Row)?.startTime);
    expect(
      { moved_to: (put?.body as Row | undefined)?.assignedUserId ?? "not moved" },
      `count_result=${String(w.room(b).count_result)}`,
    ).toEqual({ moved_to: "G-setter" });
  });
});

// ---------------------------------------------------------------------------
// 3. The live call a person adds by hand after the tick's hour
// ---------------------------------------------------------------------------

describe("the count's live booking is refused, and a person adds it by hand when they read the alert", () => {
  /**
   * The SQL sweep's T rule (20261004a, cockpit_sales_rooms_sweep): a final
   * room is posted to room.event's tick only while its lead_in_at (or
   * count_undo_at) is in the last hour. These minutes tick the room only
   * while that rule would.
   */
  async function sqlMinutes(w: ReturnType<typeof setup>, id: string, n: number) {
    for (let i = 0; i < n; i++) {
      w.clock.now += MIN;
      const r = w.room(id);
      const joined = Date.parse(String(r.lead_in_at ?? ""));
      const undo = Date.parse(String(r.count_undo_at ?? ""));
      const final = ["ended", "expired", "failed", "cancelled"].includes(String(r.state));
      // Fix round 6: a count that could not book, its alert open, is posted
      // every ten minutes for three days after the first hour.
      const alertOpen = w
        .alerts()
        .some(a => !a.resolved_at && [`room:${id}:count_failed`, `room:${id}:count_unclear`].includes(String(a.dedupe_key)));
      const later =
        ["failed", "unclear"].includes(String(r.count_result)) &&
        alertOpen &&
        joined <= w.clock.now - 60 * MIN &&
        joined > w.clock.now - 3 * 24 * 60 * MIN &&
        new Date(w.clock.now).getUTCMinutes() % 10 === 0;
      const due = !final || joined > w.clock.now - 60 * MIN || undo > w.clock.now - 60 * MIN || later;
      if (due) await w.tick([id]).catch(() => null);
    }
  }
  function refuseFirstBooking(w: ReturnType<typeof setup>) {
    let refused = 0;
    w.routes.unshift(async (m, p) => {
      if (m === "POST" && p === "/calendars/events/appointments" && refused === 0) {
        refused++;
        throw Object.assign(new Error("HighLevel said 422: The slot you have selected is no longer available"), { status: 422 });
      }
      return null as unknown as Row;
    });
  }
  function handBook(w: ReturnType<typeof setup>, id: string) {
    const start = new Date(Date.parse(String(w.room(id).lead_in_at))).toISOString();
    w.bookings.push({
      id: "by-hand-2",
      body: { calendarId: "LIVECAL", contactId: LEAD, startTime: start, endTime: new Date(Date.parse(start) + 15 * MIN).toISOString(), title: "Live · Huda Ali", appointmentStatus: "showed", assignedUserId: "G-setter" },
    });
  }
  const paid = (w: ReturnType<typeof setup>) =>
    w.db.t("cockpit_sales_appointments").filter(a => a.contact_id === LEAD && a.call_type === "intro" && a.assigned_user_id === "G-setter" && a.status === "showed").length;

  test("control (round 5's fix): the person adds it 20 minutes after the join: found, copied, counted once", async () => {
    const w = setup();
    refuseFirstBooking(w);
    const b = await w.makeRoom({ purpose: "manual" });
    await w.press(b, "lead_in");
    expect(w.room(b).count_result).toBe("failed");
    // The room ends when the call does (the sweep's own close).
    Object.assign(w.room(b), { state: "ended", result: "joined", ended_at: new Date(w.clock.now + 15 * MIN).toISOString() });
    await sqlMinutes(w, b, 20);
    handBook(w, b);
    await sqlMinutes(w, b, 60);
    expect({ paid_intros: paid(w) }).toEqual({ paid_intros: 1 });
  });

  test("hand-booked-live-call-after-the-hour-never-copied: the person reads 'Add the call on the live calendar and mark it shown' and does it 75 minutes after the join (the alert names no deadline): the sweep stopped ticking the room at the hour, so the booking is never adopted or copied; the setter's pay estimate and EOD never count the intro and the alert stays open", async () => {
    const w = setup();
    refuseFirstBooking(w);
    const b = await w.makeRoom({ purpose: "manual" });
    await w.press(b, "lead_in");
    expect(w.room(b).count_result).toBe("failed");
    Object.assign(w.room(b), { state: "ended", result: "joined", ended_at: new Date(w.clock.now + 15 * MIN).toISOString() });
    await sqlMinutes(w, b, 75);
    handBook(w, b);
    await sqlMinutes(w, b, 60);
    expect(
      { paid_intros: paid(w) },
      `count_result=${String(w.room(b).count_result)}; open alerts: ${told(w, b).join(" | ") || "none"}`,
    ).toEqual({ paid_intros: 1 });
  });
});
