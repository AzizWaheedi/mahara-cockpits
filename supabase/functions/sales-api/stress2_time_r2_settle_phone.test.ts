// bun test supabase/functions/sales-api/stress2_time_r2_settle_phone.test.ts
//
// TIME stress, second series, round 2: the settle's deadline (the intro's
// start + waits_s.settle, 20 minutes) falls while the setter is holding the
// intro by phone.
//
// Thursday 8 October 2026, the setter's 10:00 intro. 10:00 rings out; the
// dialer's video link at 10:00:30 (a Zoom fallback room carrying the intro,
// inside its window). The setter joins, the link goes, the lead never opens
// it; R4 closes the room at 10:11 (lead_by 10:10:45). The lead is out of the
// queue while the room holds them (rooms.held), and the intro comes back to
// the top of the dialer at 10:11 (its window runs to 10:20). 10:12 the
// setter rings again and the lead answers: the intro is under way on the
// phone, the attempt is placed and answered (cockpit_sales_attempts).
//
// At 10:21 the sweep's S1 posts sweep.settle (start + settle passed, the
// room closed empty, Zoom reported the host, the link went and was never
// opened: evidence) and sales-api writes a no-show on the intro, in
// HighLevel, nine minutes into the intro the lead is attending. Nothing in
// settleFacts or S1 reads the setter's call to the lead after the room.
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
const LEAD = "stress-time2r2-lead-000002";
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
/** Thursday 8 October 2026, 10:00 Kuwait. */
const START = Date.parse("2026-10-08T07:00:00.000Z");

function setup() {
  const w = fakeWorld(START);
  const marks: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: { ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false, providers: { zoom: true, meet: true }, fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" } },
    },
    { key: "live", value: { enabled: false } },
    { key: "whatsapp_guard", value: {} },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: "intro-phone",
      contact_id: LEAD,
      call_type: "intro",
      calendar_id: BOOKING_CALENDARS.intro_qualified,
      status: "confirmed",
      start_at: new Date(START).toISOString(),
      assigned_user_id: "G-setter",
    },
  ]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact: { id: LEAD, firstName: "Huda", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async () => {},
    markAppointment: async (who, id, status) => {
      marks.push({ who: who.email, id, status, at: w.clock.now });
      w.db.t("cockpit_sales_dispositions").push({ id: fakeUuid(), appointment_id: id, status, marked_by: who.email, superseded_at: null, crm: "written" });
      return { crm: "written" };
    },
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const api = makeRooms(deps);
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
      appointment_id: "intro-phone",
      appointment_start_at: new Date(START).toISOString(),
      state: "expired",
      result: "no_join",
      end_reason: "lead_no_show",
      join_url: "https://us06web.zoom.us/j/81234567890?pwd=abc",
      provider_meeting_id: "81234567890",
      requested_at: new Date(START + 30 * S).toISOString(),
      opened_at: new Date(START + 40 * S).toISOString(),
      link_sent_at: new Date(START + 45 * S).toISOString(),
      link_channels: ["whatsapp_text"],
      host_in_at: new Date(START + 60 * S).toISOString(),
      lead_by: new Date(START + 10 * MIN + 45 * S).toISOString(),
      ended_at: new Date(START + 11 * MIN).toISOString(),
      version: 5,
    },
  ]);
  w.db.seed("cockpit_sales_room_events", [
    {
      room_id: id,
      kind: "zoom.meeting.started",
      source: "zoom",
      dedupe_key: `zoom:meeting.started:${id}`,
      at: new Date(START + 60 * S).toISOString(),
      handled_at: new Date(START + 61 * S).toISOString(),
    },
  ]);
  // 10:12 the setter's dialer rings the intro again and the lead answers:
  // the call is placed and answered, still going at 10:21.
  w.db.seed("cockpit_sales_attempts", [
    {
      id: fakeUuid(),
      contact_id: LEAD,
      rep_email: SETTER,
      item_kind: "intro",
      appointment_id: "intro-phone",
      state: "placed",
      call_state: "answered",
      started_at: new Date(START + 12 * MIN).toISOString(),
    },
  ]);
  async function settle(at: number) {
    w.db.insertOne(
      "cockpit_sales_room_events",
      { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due." },
      "ignore",
      "dedupe_key",
    );
    w.clock.now = at;
    await api.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    await w.flush();
  }
  return { ...w, id, marks, settle };
}

describe("the settle comes due at 10:20 while the setter holds the 10:00 intro on the phone (answered at 10:12)", () => {
  test("no no-show is written on the intro the lead is attending", async () => {
    const w = setup();
    await w.settle(START + 21 * MIN);
    // Found: the intro is marked a no-show in HighLevel at 10:21, nine
    // minutes into the call the lead answered. B2B's show rate reads it, the
    // dialer drops the call from the setter's item once the mirror has it,
    // and the desk's no_show follow-up may be drafted to a lead on the phone.
    expect(w.marks.filter(m => m.status === "noshow")).toEqual([]);
  });
});
