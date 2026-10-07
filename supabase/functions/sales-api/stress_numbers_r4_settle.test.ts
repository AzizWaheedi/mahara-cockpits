// bun test supabase/functions/sales-api/stress_numbers_r4_settle.test.ts
//
// Stress round 4, numbers and data integrity: the settle (D14) writes a
// no-show into HighLevel, a hard number in B2B's show rate, so it is written
// only where nobody has marked the call. B2B reads HighLevel; the cockpit's
// copy (cockpit_sales_appointments) is B2B's own copy mirrored every three
// minutes, so it lags HighLevel. A rep who marks the intro shown in
// HighLevel itself (the closer's HighLevel app, the calendar view) a moment
// before the settle runs has marked it: the timer must read HighLevel's own
// status first (as the count's mark does, rooms.ts countMark) and leave the
// call as the rep left it. Everything runs on testfakes.ts.
import { describe, expect, test } from "bun:test";
import { BOOKING_CALENDARS } from "./dialer.ts";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter@stress.invalid";
const LEAD = "stress-lead-r4-000002";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

function setup(ghlStatus: string) {
  const w = fakeWorld();
  const marks: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: { ...DEFAULT_ROOMS_JSON, settle: true, wrap: true, enabled: true, test_only: false, providers: { zoom: true, meet: true }, fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" } },
    },
    { key: "live", value: { enabled: false } },
    { key: "whatsapp_guard", value: {} },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  const start = w.clock.now; // the intro starts now
  // The cockpit's copy: still "confirmed" (B2B's copy, mirrored every three minutes).
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: "intro-1",
      contact_id: LEAD,
      call_type: "intro",
      calendar_id: BOOKING_CALENDARS.intro_qualified,
      status: "confirmed",
      start_at: new Date(start).toISOString(),
      assigned_user_id: "G-setter",
    },
  ]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact: { id: LEAD, firstName: "Huda", phone: "+96550000000", tags: ["roas-qualified"] } };
    // HighLevel's own record of the intro: what B2B's show rate reads.
    if (m === "GET" && p === "/calendars/events/appointments/intro-1")
      return { appointment: { id: "intro-1", appointmentStatus: ghlStatus, startTime: new Date(start).toISOString(), assignedUserId: "G-setter" } };
    if (m === "PUT" || m === "DELETE") return { ok: true };
    if (m === "POST") return { id: "live-x" };
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async () => {},
    // index.ts markAppointment with onlyIfUnmarked reads the cockpit's own
    // dispositions only (no HighLevel read), as here.
    markAppointment: async (who, id, status) => {
      marks.push({ who: who.email, id, status });
      w.db.t("cockpit_sales_dispositions").push({ id: fakeUuid(), appointment_id: id, status, marked_by: who.email, superseded_at: null, crm: "written" });
      return { crm: "written" };
    },
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const api = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  // A Zoom fallback room for the intro: the setter was in, Zoom reported the
  // meeting, the lead never came to the room (they rang the setter back on
  // the phone instead). R4 closed it at +15 minutes.
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
      provider_meeting_id: "81234567890",
      requested_at: new Date(start + 1 * MIN).toISOString(),
      opened_at: new Date(start + 1 * MIN).toISOString(),
      link_sent_at: new Date(start + 2 * MIN).toISOString(),
      host_in_at: new Date(start + 2 * MIN).toISOString(),
      ended_at: new Date(start + 15 * MIN).toISOString(),
      version: 4,
    },
  ]);
  w.db.seed("cockpit_sales_room_events", [
    {
      room_id: id,
      kind: "zoom.meeting.started",
      source: "zoom",
      dedupe_key: `zoom:meeting.started:${id}`,
      at: new Date(start + 2 * MIN).toISOString(),
      handled_at: new Date(start + 2 * MIN).toISOString(),
    },
  ]);
  async function settle() {
    w.db.insertOne("cockpit_sales_room_events", { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due." }, "ignore", "dedupe_key");
    w.clock.now = start + 21 * MIN;
    await api.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    await w.flush();
  }
  const noshows = () => marks.filter(m => m.status === "noshow");
  return { ...w, id, room, settle, noshows };
}

describe("the settle never writes a no-show over a mark HighLevel already has", () => {
  test("settle-overwrites-highlevel-showed: the setter marked the intro shown in HighLevel at +18 minutes (they talked on the phone); the copy still says confirmed at +21: no no-show", async () => {
    const w = setup("showed");
    await w.settle();
    // settle() reads only the cockpit's dispositions and its lagging copy;
    // markAppointment's onlyIfUnmarked reads the dispositions too. Nothing
    // reads HighLevel, so the timer's no-show replaces the setter's "showed"
    // in HighLevel: a held intro leaves B2B's show rate.
    expect(w.noshows()).toHaveLength(0);
  });

  test("settle-overwrites-highlevel-invalid: the setter disqualified the intro in HighLevel (invalid, a held call by the B2B rule): no no-show", async () => {
    const w = setup("invalid");
    await w.settle();
    expect(w.noshows()).toHaveLength(0);
  });

  test("control: HighLevel still says confirmed: the no-show is written once (the rule is not switched off)", async () => {
    const w = setup("confirmed");
    await w.settle();
    expect(w.noshows()).toHaveLength(1);
    expect(w.room(w.id).settled_mark).toBe("noshow");
  });
});
