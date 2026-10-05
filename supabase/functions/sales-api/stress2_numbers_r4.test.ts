// bun test supabase/functions/sales-api/stress2_numbers_r4.test.ts
//
// Second series, round 4, numbers and data integrity: every join counted
// once (and never zero times), a manager's confirm that survives a blip, the
// stranded count's resume (fix round 3), and the live booking's copy in the
// calendar (fix round 3). HighLevel here is stateful (a PUT of
// appointmentStatus changes what the next GET answers).
//
// A test that fails here is a finding; tests named "control" or "HELD" pass.
// Everything runs on testfakes.ts: no HighLevel, no database, no Zoom.
import { describe, expect, test } from "bun:test";
import { BOOKING_CALENDARS } from "./dialer.ts";
import { refuseMark, type Who } from "./lib.ts";
import { ApiRefusal, DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld, seedLeadZoomJoin } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter@stress.invalid";
const CLOSER = "closer@stress.invalid";
const LEAD = "stress-lead-s2n4-00001";
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

const blip = () => new DbError("database 503: upstream connect error or disconnect/reset before headers", 503);

/**
 * A 20-second database blip that starts the moment the count's claim lands
 * (cockpit_sales_room_count_claim answered): the count's own record of what
 * it is about to change (count.creating, count.marking or count.moving) and
 * the claim's give-back (releaseClaim) both fail, so the claim stands with
 * nothing recorded: fix round 3's "stranded" count.
 */
function blipAfterClaim(w: { db: { rpcs: Record<string, (a: Row) => unknown>; faults: { prefix: string; method?: string; error: Error; times: number }[] } }) {
  const real = w.db.rpcs.cockpit_sales_room_count_claim!;
  let armed = true;
  w.db.rpcs.cockpit_sales_room_count_claim = a => {
    const out = real(a);
    if (armed && (out as Row).code === "claimed") {
      armed = false;
      w.db.faults.push({ prefix: "cockpit_sales_room_events", method: "POST", error: blip(), times: 1 });
      w.db.faults.push({ prefix: "cockpit_sales_rooms", method: "PATCH", error: blip(), times: 1 });
    }
    return out;
  };
}

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
  const bookings: Row[] = [];
  w.routes.push(async (m, p, body) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: bookings.map(b => ({ ...(b.body as Row), id: b.id })) };
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
    if (m === "POST" && p === "/calendars/events/appointments") {
      const id = `live-${fakeUuid()}`;
      bookings.push({ id, body });
      return { id };
    }
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
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;

  function intro(status: string, startMs: number, assigned = "G-setter", id = "intro-1") {
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: id,
        contact_id: LEAD,
        call_type: "intro",
        calendar_id: BOOKING_CALENDARS.intro_qualified,
        status,
        start_at: new Date(startMs).toISOString(),
        end_at: new Date(startMs + 30 * MIN).toISOString(),
        assigned_user_id: assigned,
      },
    ]);
    hl.set(id, status);
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
  async function confirm(id: string): Promise<string | null> {
    try {
      await rooms.actions["room.count_confirm"]!(manager, { room_id: id });
      return null;
    } catch (e) {
      return String((e as Error)?.message ?? e);
    } finally {
      await w.flush();
    }
  }
  async function tick(ids: string[]) {
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: ids } });
    await w.flush();
  }
  /** The cron's minutes: the clock moves and the SQL tick posts the room. */
  async function minutes(ids: string[], n: number) {
    for (let i = 0; i < n; i++) {
      w.clock.now += MIN;
      await tick(ids).catch(() => null);
    }
  }
  const alerts = () => w.db.t("cockpit_sales_alerts");
  const openAlerts = (id: string) => alerts().filter(a => !a.resolved_at && String(a.dedupe_key ?? "").startsWith(`room:${id}:`));
  const posts = () => w.ghlCalls.filter(c => c.method === "POST" && c.path === "/calendars/events/appointments");
  return { ...w, rooms, audits, hl, room, intro, makeRoom, press, confirm, tick, minutes, alerts, openAlerts, posts, bookings };
}

// ---------------------------------------------------------------------------
// 1. A manager's confirm whose count is stranded by a database blip
// ---------------------------------------------------------------------------

describe("a manager confirms a hand-pressed join and the database blips under the count", () => {
  test("control: no blip: the confirmed join is booked once as a live call", async () => {
    const w = setup();
    const b = await w.makeRoom({ purpose: "manual" }, { evidence: false });
    await w.press(b, "lead_in");
    expect(w.room(b).count_result).toBe("self_reported");
    expect(await w.confirm(b)).toBeNull();
    expect(w.posts()).toHaveLength(1);
    expect(w.room(b).count_result).toBe("booked");
  });

  test("control (Zoom evidence): a count stranded by the same blip is taken up again and books once", async () => {
    const w = setup();
    const b = await w.makeRoom({ purpose: "manual" });
    // The blip lands on the count's own record (count.creating) and on the
    // claim's give-back: the claim stands with nothing recorded.
    blipAfterClaim(w);
    // The Zoom join counts at once (lead_in pressed after Zoom saw the lead).
    await w.press(b, "lead_in");
    const r = w.room(b);
    expect(r.count_claimed_at).toBeTruthy();
    expect(r.count_result ?? null).toBeNull();
    await w.minutes([b], 6);
    expect(w.posts()).toHaveLength(1);
    expect(w.room(b).count_result).toBe("booked");
  });

  test("confirm-stranded-resume-drops-confirm: the confirm's count claims, its record and the give-back hit a 20-second database blip; the minute's resume runs without the confirm, plans self_reported and stops: the join is never booked, the confirm alert is answered, and a second confirm is told nothing waits", async () => {
    const w = setup();
    const b = await w.makeRoom({ purpose: "manual" }, { evidence: false });
    await w.press(b, "lead_in");
    expect(w.room(b).count_result).toBe("self_reported");
    expect(w.openAlerts(b).some(a => String(a.dedupe_key).endsWith(":count_confirm"))).toBe(true);
    blipAfterClaim(w);
    const first = await w.confirm(b);
    const stranded = w.room(b);
    // The claim stands with nothing recorded: a stranded count (fix round 3's resume path).
    expect({ claimed: Boolean(stranded.count_claimed_at), result: stranded.count_result ?? null }).toEqual({ claimed: true, result: null });
    // An hour of the cron's ticks: count_stuck's resume at claim + 120 s, every minute.
    await w.minutes([b], 70);
    const again = await w.confirm(b);
    const r = w.room(b);
    const booked = w.posts().length;
    const told = w.openAlerts(b).map(a => `${String(a.dedupe_key)}: ${String(a.message ?? "")}`);
    expect(
      { booked_once_or_a_person_told: booked === 1 || told.length > 0 },
      `first confirm: ${String(first)}; second confirm: ${String(again)}; count_result=${String(r.count_result)} claimed=${String(r.count_claimed_at)} bookings=${booked}; open alerts: ${told.join(" | ") || "none"}`,
    ).toEqual({ booked_once_or_a_person_told: true });
  });
});

// ---------------------------------------------------------------------------
// 2. The live booking's copy in the calendar (fix round 3, copyLiveBooking)
// ---------------------------------------------------------------------------

describe("the live booking's row in the cockpit's calendar copy (the setter's pay and EOD read it)", () => {
  const copyOf = (w: ReturnType<typeof setup>) =>
    w.db.t("cockpit_sales_appointments").filter(a => String(a.calendar_id) === "LIVECAL" && a.contact_id === LEAD);

  test("control: the count books a live intro: one row in the copy, status showed, the setter's", async () => {
    const w = setup();
    const b = await w.makeRoom({ purpose: "manual" });
    await w.press(b, "lead_in");
    expect(w.room(b).count_result).toBe("booked");
    const rows = copyOf(w);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("showed");
    expect(rows[0]?.assigned_user_id).toBe("G-setter");
  });

  test("live-copy-lost-on-blip: the live intro is booked and marked shown in HighLevel; the one write of its copy row hits a database blip: no retry and no alert, so the setter's pay estimate and EOD never count the intro", async () => {
    const w = setup();
    const b = await w.makeRoom({ purpose: "manual" });
    w.db.faults.push({ prefix: "cockpit_sales_appointments?on_conflict", method: "POST", error: blip(), times: 1 });
    await w.press(b, "lead_in");
    expect(w.room(b).count_result).toBe("booked");
    expect(w.posts()).toHaveLength(1);
    // The cron's minutes: whatever re-asks there are, they run.
    await w.minutes([b], 70);
    const rows = copyOf(w);
    const told = w.openAlerts(b).map(a => `${String(a.dedupe_key)}: ${String(a.message ?? "")}`);
    expect(
      { copied_or_a_person_told: rows.length === 1 || told.length > 0 },
      `copy rows=${rows.length}; open alerts: ${told.join(" | ") || "none"}; logs: ${w.logs.filter(l => /copied/.test(l)).join(" | ")}`,
    ).toEqual({ copied_or_a_person_told: true });
  });
});

describe("the live booking's copy when HighLevel did not take its showed status", () => {
  test("live-copy-never-follows-highlevel: HighLevel refuses the live booking's showed status twice; the copy is written confirmed and a person is told to mark it shown in HighLevel; they do: the copy (no mirror reads the live calendar) stays confirmed, so the setter's pay estimate (showed intros only) never counts it", async () => {
    const w = setup();
    let refused = 0;
    w.routes.unshift(async (m, p) => {
      if (m === "PUT" && /^\/calendars\/events\/appointments\/live-/.test(p) && refused < 2) {
        refused++;
        throw Object.assign(new Error("HighLevel said 422: the appointment could not be updated"), { status: 422 });
      }
      return null as unknown as Row;
    });
    const b = await w.makeRoom({ purpose: "manual" });
    await w.press(b, "lead_in");
    expect(w.room(b).count_result).toBe("booked");
    expect(refused).toBe(2);
    const told = w.openAlerts(b).map(a => String(a.message ?? ""));
    expect(told.some(t => /Mark it shown in HighLevel/.test(t))).toBe(true);
    // The person marks it shown in HighLevel, as the alert asks.
    const live = String(w.room(b).count_appointment_id);
    w.hl.set(live, "showed");
    await w.minutes([b], 70);
    const copy = w.db.t("cockpit_sales_appointments").find(a => a.appointment_id === live);
    // NumbersPay.tsx SetterEstimateView: intros with status "showed" are the qualified ones paid for.
    const paid = w.db
      .t("cockpit_sales_appointments")
      .filter(a => a.contact_id === LEAD && a.call_type === "intro" && a.assigned_user_id === "G-setter" && a.status === "showed").length;
    expect({ paid_intros: paid }, `copy status: ${String(copy?.status)}; HighLevel: ${String(w.hl.get(live))}`).toEqual({ paid_intros: 1 });
  });
});

// ---------------------------------------------------------------------------
// 3. A closer's video link from the lead page is counted as an intro
// ---------------------------------------------------------------------------

describe("a closer's video call from the lead page, after the lead's demo", () => {
  const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Cyrus Closer", role: "closer", ghl_user_id: "G-closer" };

  test("closer-live-call-copied-as-intro-takes-setter-credit: the lead had the setter's intro and the closer's demo; the closer sends a video link from the lead page (LeadPage.tsx sends call_kind intro for every seat) and the lead joins: the live call lands in the calendar copy as an INTRO assigned to the closer, which cockpit_sales_setter_deals reads as the lead's latest intro (the deal's setter credit), and the desk's pools as a held intro after the demo", async () => {
    const w = setup();
    w.db.seed("cockpit_sales_room_hosts", [{ email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true }]);
    // The setter's intro (held) two days ago, the closer's demo (held) yesterday.
    w.intro("showed", w.clock.now - 2 * 24 * 60 * MIN, "G-setter", "intro-setter");
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "demo-closer",
        contact_id: LEAD,
        call_type: "demo",
        calendar_id: BOOKING_CALENDARS.demo,
        status: "showed",
        start_at: new Date(w.clock.now - 24 * 60 * MIN).toISOString(),
        end_at: new Date(w.clock.now - 23 * 60 * MIN).toISOString(),
        assigned_user_id: "G-closer",
      },
    ]);
    // LeadPage.tsx's VideoPicker: purpose manual, callKind "intro", whoever the seat is.
    const out = await w.rooms.actions["room.create"]!(closer, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "intro",
      purpose: "manual",
      trigger: "manual",
    });
    const id = String((out.room as Row).id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(w.room(id).version) + 1 },
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: MEET_URL,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 60 * MIN).toISOString(),
        link_sent_at: w.db.iso(),
        version: Number(w.room(id).version) + 1,
      },
    });
    seedLeadZoomJoin(w.db, id);
    await w.rooms.actions["room.mark"]!(closer, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.flush();
    expect(w.room(id).count_result).toBe("booked");
    // cockpit_sales_setter_deals' credit for a deal with the setter left blank
    // (both deals since 24 September): the lead's latest intro before the
    // deal, any calendar (20260927a_sales_setter_pay.sql).
    const intros = w.db
      .t("cockpit_sales_appointments")
      .filter(a => a.contact_id === LEAD && a.call_type === "intro")
      .sort((a, b) => Date.parse(String(b.start_at)) - Date.parse(String(a.start_at)));
    const latest = intros[0];
    expect(
      { latest_intro_assigned_to: latest?.assigned_user_id ?? null },
      `the lead's intros in the copy, newest first: ${intros.map(a => `${String(a.appointment_id)} (${String(a.calendar_id)}, ${String(a.assigned_user_id)}, ${String(a.status)})`).join("; ")}`,
    ).toEqual({ latest_intro_assigned_to: "G-setter" });
  });
});
