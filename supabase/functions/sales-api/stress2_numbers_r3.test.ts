// bun test supabase/functions/sales-api/stress2_numbers_r3.test.ts
//
// Second series, round 3, numbers and data integrity: where a live intro the
// count books is counted. Every lead and figure is invented.
//
// D2 (final_consistency.md): "Book and mark shown, quietly, the minute a
// tagged lead joins ... Live calls then count in the $60 and 25% gates on
// evidence." D25: keep "Live ·" calls out of the 60% and 75% show targets,
// "on their own line". The count books a new live call on
// rooms.live_calendar_id, which no mirror reads (sales-mirror copies B2B's
// calls and the follow_up and callback calendars only), and writes nothing
// else in the cockpit. The setter's own numbers read the cockpit's calendar
// copy (cockpit_sales_calendar, over cockpit_sales_appointments):
// - the pay estimate (NumbersPay.tsx SetterEstimateView): intros assigned to
//   the setter, status showed, $10 each (per_intro_qualified);
// - the EOD prefill (index.ts eodCount): intros_scheduled, intro_shows and
//   intros_booked, the same rows.
// A failure here is a finding. Everything runs on testfakes.ts.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld, seedLeadZoomJoin } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter@stress.invalid";
const LEAD = "stress-lead-s2n3-000001";
const ZOOM_URL = "https://us06web.zoom.us/j/81234500099?pwd=stress";

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
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
  const hl = new Map<string, Row>();
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
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: [...hl.values()] };
    if (m === "POST" && p === "/calendars/events/appointments") {
      const id = `live-${fakeUuid()}`;
      hl.set(id, { id, ...(body as Row) });
      return { id };
    }
    const one = /^\/calendars\/events\/appointments\/([^/?]+)$/.exec(p);
    if (one && m === "PUT") {
      const id = decodeURIComponent(one[1] as string);
      hl.set(id, { ...(hl.get(id) ?? { id }), ...(body as Row) });
      return { ok: true };
    }
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async () => {},
    markAppointment: async () => ({ crm: "quiet" }),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  return { ...w, rooms, room, hl };
}

/** The lead page's Video call to a new lead who never booked: the setter's Zoom room, the lead joins (Zoom sees them). */
async function liveIntro(w: ReturnType<typeof setup>): Promise<string> {
  const out = await w.rooms.actions["room.create"]!(setter, {
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    provider: "zoom",
    call_kind: "intro",
    purpose: "manual",
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
      join_url: ZOOM_URL,
      provider_meeting_id: "81234500099",
      opened_at: w.db.iso(),
      host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
      ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
      version: Number(w.room(id).version) + 1,
    },
  });
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso() } });
  seedLeadZoomJoin(w.db, id);
  await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
  await w.flush();
  await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
  await w.flush();
  return id;
}

// ---------------------------------------------------------------------------
// The undo of a MOVE after the rep marked the moved call. undoPlan
// "move_back" keeps a person's mark made after the count's claim (stress2,
// round 1, undo-overwrites-later-rep-mark: written for the count's MARK of
// the call the lead came to). On a move, that mark was made on the call as
// the count had put it (at the join, today), and the undo moves the call
// back to tomorrow: the mark then sits on a call that has not happened.
// ---------------------------------------------------------------------------

const HOUR = 60 * MIN;

function setupMove() {
  const w = fakeWorld();
  /** HighLevel's appointments, stateful: what a PUT writes, the next GET reads. */
  const hl = new Map<string, Row>();
  const calls: { id: string; booked_at: number }[] = [];
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
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: [...hl.values()] };
    const one = /^\/calendars\/events\/appointments\/([^/?]+)$/.exec(p);
    if (one) {
      const id = decodeURIComponent(one[1] as string);
      if (m === "GET") return hl.has(id) ? { appointment: { ...hl.get(id) } } : (null as unknown as Row);
      if (m === "PUT") {
        hl.set(id, { ...(hl.get(id) ?? { id }), ...(body as Row) });
        return { ok: true };
      }
    }
    if (m === "POST" && p === "/calendars/events/appointments") return { id: `live-${fakeUuid()}` };
    if (m === "DELETE") return { ok: true };
    return null as unknown as Row;
  });
  /** index.ts markAppointment as it writes: the cockpit's disposition, then HighLevel's status. */
  async function markAppointment(who: Who, id: string, status: string, opts: Row = {}): Promise<Row> {
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
    hl.set(id, { ...(hl.get(id) ?? { id }), appointmentStatus: status });
    return { ...made };
  }
  const deps: RoomDeps = {
    io: w.io,
    audit: async () => {},
    markAppointment: (who, id, status, opts) => markAppointment(who, id, status, opts as Row),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    // index.ts upcoming(): the lead's next call of the kind after the reference time, booked before the bound.
    upcoming: async (_c, _kind, opts) => {
      const after = opts?.after ?? w.clock.now;
      const bound = opts?.booked_before ?? null;
      const ahead = calls
        .map(c => ({ ...c, a: hl.get(c.id) as Row }))
        .filter(c => Date.parse(String(c.a.startTime)) > after && (bound === null || c.booked_at < bound))
        .sort((x, y) => Date.parse(String(x.a.startTime)) - Date.parse(String(y.a.startTime)))[0];
      return ahead
        ? {
            id: ahead.id,
            start: Date.parse(String(ahead.a.startTime)),
            end: Date.parse(String(ahead.a.endTime)),
            assigned_user_id: String(ahead.a.assignedUserId),
            status: String(ahead.a.appointmentStatus),
            booked_at: ahead.booked_at,
          }
        : null;
    },
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  return { ...w, rooms, room, hl, calls, markAppointment };
}

describe("That was not the lead, after the count moved tomorrow's intro and the setter marked it", () => {
  test("move-undo-leaves-rep-mark-on-future-intro: the intro goes back to tomorrow 10:00 and must not stay a no-show (the dialer never brings up a call marked no-show, so nobody rings the lead tomorrow)", async () => {
    const w = setupMove();
    const tomorrow = w.clock.now + 20 * HOUR;
    // Huda booked tomorrow's intro with the setter two days ago.
    w.hl.set("intro-1", {
      id: "intro-1",
      calendarId: "dsqmJ393Dwl9fDSbIVOI",
      startTime: new Date(tomorrow).toISOString(),
      endTime: new Date(tomorrow + 30 * MIN).toISOString(),
      assignedUserId: "G-setter",
      appointmentStatus: "confirmed",
    });
    w.calls.push({ id: "intro-1", booked_at: w.clock.now - 48 * HOUR });
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "intro-1",
        contact_id: LEAD,
        call_type: "intro",
        calendar_id: "dsqmJ393Dwl9fDSbIVOI",
        status: "confirmed",
        start_at: new Date(tomorrow).toISOString(),
        end_at: new Date(tomorrow + 30 * MIN).toISOString(),
        assigned_user_id: "G-setter",
        booked_at: new Date(w.clock.now - 48 * HOUR).toISOString(),
      },
    ]);
    // Today the setter's lead-page room: someone joins (Zoom sees a guest);
    // the count moves tomorrow's intro to the join and marks it shown.
    const id = await liveIntro(w as unknown as ReturnType<typeof setup>);
    expect(w.room(id).count_result).toBe("moved");
    expect(Date.parse(String(w.hl.get("intro-1")?.startTime))).toBeLessThan(w.clock.now + MIN);
    // The mirror catches up (the call at the join, showed); the setter, who
    // sees it was her colleague, marks the call a no-show in the dialer, then
    // presses That was not the lead (inside its five minutes).
    const copy = w.db.t("cockpit_sales_appointments")[0]!;
    copy.start_at = String(w.hl.get("intro-1")?.startTime);
    copy.status = "showed";
    w.clock.now += MIN;
    await w.markAppointment(setter, "intro-1", "noshow", { note: "It was a colleague, not the lead." });
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
    await w.flush();
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await w.flush();
    const a = w.hl.get("intro-1")!;
    expect(Date.parse(String(a.startTime))).toBe(tomorrow);
    expect({ tomorrow_intro_status_in_highlevel: a.appointmentStatus }).toEqual({ tomorrow_intro_status_in_highlevel: "confirmed" });
  });
});

describe("a live intro the count booked, in the setter's own numbers", () => {
  test("live-intro-missing-from-setter-pay-and-eod: the count books 'Live · Huda' with the setter and marks it shown; the setter's intros shown that day (the pay estimate's $10 each, the EOD's intro_shows) must include it", async () => {
    const w = setup();
    const id = await liveIntro(w);
    const r = w.room(id);
    // Sanity: the count booked a live intro, assigned to the setter, and marked it shown in HighLevel.
    expect(r.count_result).toBe("booked");
    const live = w.hl.get(String(r.count_appointment_id));
    expect(live?.assignedUserId).toBe("G-setter");
    expect(live?.appointmentStatus).toBe("showed");
    // What NumbersPay.tsx and eodCount read: the calendar copy's intros with
    // the setter as the rep, marked showed (here the copy's own rows, as the
    // view cockpit_sales_calendar shows them with no disposition).
    const shownIntros = w.db
      .t("cockpit_sales_appointments")
      .filter(a => a.call_type === "intro" && a.assigned_user_id === "G-setter" && a.status === "showed");
    expect({ intros_shown_for_pay_and_eod: shownIntros.length }).toEqual({ intros_shown_for_pay_and_eod: 1 });
  });
});
