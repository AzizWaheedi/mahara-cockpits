// bun test supabase/functions/sales-api/stress2_time_r6_intro_edges.test.ts
//
// TIME stress, second series, round 6: the booked intro's own hour, on the
// lead's clock and one try either side of start + settle.
//
// 1. The night rule (stress2 round 5, rooms.ts createRoom leadAtNight) now
//    refuses every fallback room while it is outside 09:00 to 21:00 on ANY of
//    the lead's clocks, the intro's own call included. The lead chose the
//    intro's hour themselves. The real calendar (read-only, 3 to 5 October
//    2026) holds intros at 21:00 Kuwait and one at 17:20 Kuwait for a lead in
//    Canada (10:20 Toronto, 11:20 Halifax, 07:20 Vancouver).
// 2. A late first try at the intro (rang at 11:19:30 for an 11:00 intro, the
//    dialer's item runs to 11:20) and its video link pressed at 11:21: the
//    room carries the intro (rooms.ts ATTEMPT_CARRIES_MS, judged by the
//    call's own start, stress2 round 5), but the settle (roomlogic.ts
//    roomForThisStart, and the SQL S1's same_call) judges by the room's
//    requested_at. So the room the lead was told was "for your intro call"
//    is never settled, by either side. The SQL half of this is
//    supabase/migrations/tests/stress2_time_r6.py.
//
// A test that fails here is a finding. Everything runs on testfakes.ts;
// every lead is invented.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON, settleWanted, type RoomRow } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { leadZones } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SETTER = "setter-t2r6@stress.invalid";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=stress";
const APPT = "stress-t2r6-appt";

const kw = (s: string) => Date.parse(`${s}+03:00`);
const iso = (t: number) => new Date(t).toISOString();

function hours(country: string, t: number): string {
  return (leadZones(country) ?? ["Asia/Kuwait"])
    .map(z => `${z} ${new Intl.DateTimeFormat("en-GB", { timeZone: z, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t)}`)
    .join(", ");
}

/**
 * A setter's booked intro at `start` for a lead in `country`; the setter's
 * call to it placed at `rang` and saved No answer at `saved`.
 */
function world(start: number, country: string, rang: number, saved: number) {
  const w = fakeWorld(saved);
  const LEAD = `stress-t2r6-${country.toLowerCase()}-${fakeUuid().slice(0, 6)}`;
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: false,
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        // As it ships: a video link for a lead with a booked intro.
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "intro" },
      },
    },
    { key: "live", value: { enabled: false } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: iso(saved - 5 * S) }]);
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: APPT,
      contact_id: LEAD,
      call_type: "intro",
      status: "confirmed",
      start_at: iso(start),
      end_at: iso(start + 30 * MIN),
      booked_at: iso(start - 3 * DAY),
      assigned_user_id: "G-setter",
      calendar_id: "stress-cal",
    },
  ]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, country, assigned_to: "G-setter" }]);
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: `c-${LEAD}`, contact_id: LEAD, inbound_whatsapp_at: iso(start - 5 * HOUR) }]);
  const attempt = fakeUuid();
  w.db.seed("cockpit_sales_attempts", [
    {
      id: attempt,
      contact_id: LEAD,
      rep_email: SETTER,
      appointment_id: APPT,
      item_kind: "intro",
      state: "saved",
      outcome: "no_answer",
      call_state: "no_answer",
      call_duration_s: 0,
      started_at: iso(rang),
      saved_at: iso(saved),
    },
  ]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Sam", name: "Sam Lee", phone: "+96550000000", email: `${LEAD}@example.com`, tags: ["roas-qualified"], country } };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    return null as unknown as Row;
  });
  const marks: Row[] = [];
  const deps: RoomDeps = {
    io: w.io,
    audit: async () => {},
    markAppointment: async (who, id, status) => {
      marks.push({ who: who.email, id, status, at: w.clock.now });
      return { crm: "written" };
    },
    sendText: async (_who, b) => {
      const row: Row = { id: fakeUuid(), request_id: b.request_id, contact_id: b.contact_id, channel: b.channel, body: b.body, state: "sent", ghl_message_id: `m-${fakeUuid().slice(0, 8)}`, created_at: iso(w.clock.now) };
      w.db.t("cockpit_sales_messages").push(row);
      return { message: { ...row } };
    },
    sendTemplate: async (_who, t) => {
      const row: Row = { id: fakeUuid(), request_id: t.requestId, contact_id: t.contactId, channel: "whatsapp", via: "workflow", state: "delivered", provider_status: "delivered", created_at: iso(w.clock.now) };
      w.db.t("cockpit_sales_messages").push(row);
      return { message: { ...row } };
    },
    upcoming: async () => null,
    sentSince: async () => false,
  };
  const rooms = makeRooms(deps);
  async function videoLink(at: number): Promise<{ room: Row | null; refused: string | null }> {
    w.clock.now = at;
    try {
      const out = await rooms.actions["room.create"]!(setter, {
        request_id: crypto.randomUUID(),
        contact_id: LEAD,
        purpose: "fallback",
        provider: "zoom",
        call_kind: "intro",
        trigger: "no_answer",
        attempt_id: attempt,
        appointment_id: APPT,
        item_kind: "intro",
      });
      const id = String((out.room as Row).id);
      return { room: w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row, refused: null };
    } catch (e) {
      return { room: null, refused: String((e as Error).message) };
    }
  }
  return { ...w, rooms, videoLink, marks, LEAD };
}

// ---------------------------------------------------------------------------
// 1. The intro's own video link, at the hour the lead booked
// ---------------------------------------------------------------------------

describe("Thursday 8 October, 21:00 Kuwait: the intro a Kuwait lead booked for 21:00 rings out; Send a video link at 21:00:50", () => {
  const start = kw("2026-10-08T21:00:00");
  test("the lead gets the intro's video link (they chose 21:00 themselves), never 'call them after 9 in the morning'", async () => {
    const w = world(start, "KW", start + 5 * S, start + 40 * S);
    const out = await w.videoLink(start + 50 * S);
    // Found: refused with LANE_COPY.lead_night, "It is night where the lead
    // is, so no video link goes now. Call them after 9 in the morning, their
    // time.", for the intro the lead booked at 21:00 and the setter is
    // ringing now. No room, so no settle and no video fallback either.
    expect({ refused: out.refused, carried: out.room?.appointment_id ?? null }).toEqual({ refused: null, carried: APPT });
  });
  test("control: the same intro at 20:30 gets its room", async () => {
    const s = kw("2026-10-08T20:30:00");
    const w = world(s, "KW", s + 5 * S, s + 40 * S);
    const out = await w.videoLink(s + 50 * S);
    expect(out.refused).toBeNull();
  });
});

describe("Monday 12 October, 17:20 Kuwait: the intro a lead in Canada booked (10:20 Toronto) rings out; Send a video link at 17:21", () => {
  const start = kw("2026-10-12T17:20:00");
  test("setup: it is morning on the lead's east-coast clock and 07:20 in Vancouver", () => {
    expect(hours("CA", start)).toBe("America/Halifax 11:20, America/Vancouver 07:20");
  });
  test("the lead gets the video link for the intro they booked at this hour", async () => {
    const w = world(start, "CA", start + 10 * S, start + 45 * S);
    const out = await w.videoLink(start + MIN);
    // Found: refused "It is night where the lead is ... Call them after 9 in
    // the morning, their time." because Vancouver (the country's second
    // zone) is at 07:20: the booked intro has no video fallback at all.
    expect(out.refused).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. A late first try: the room carries the intro, and nothing ever settles it
// ---------------------------------------------------------------------------

describe("Thursday 8 October: the 11:00 intro's only try rings at 11:19:30 (saved No answer 11:20:10); video link at 11:21", () => {
  const start = kw("2026-10-08T11:00:00");
  test("setup: the room carries the intro (judged by the call it follows, inside the intro's window)", async () => {
    const w = world(start, "KW", kw("2026-10-08T11:19:30"), kw("2026-10-08T11:20:10"));
    const out = await w.videoLink(kw("2026-10-08T11:21:00"));
    expect(out.refused).toBeNull();
    expect({ carried: out.room?.appointment_id ?? null, stored: out.room?.appointment_start_at ?? null }).toEqual({
      carried: APPT,
      stored: iso(start),
    });
  });

  test("once it closes with nobody in it (no open, Zoom reported the host, the link went), sales-api's settle takes it as the intro's room", async () => {
    const w = world(start, "KW", kw("2026-10-08T11:19:30"), kw("2026-10-08T11:20:10"));
    const out = await w.videoLink(kw("2026-10-08T11:21:00"));
    const room = {
      ...(out.room as Row),
      state: "expired",
      result: "no_join",
      end_reason: "lead_no_show",
      join_url: ZOOM_URL,
      provider_meeting_id: "81234567890",
      opened_at: iso(kw("2026-10-08T11:21:20")),
      link_sent_at: iso(kw("2026-10-08T11:21:25")),
      link_channels: ["whatsapp_text"],
      host_in_at: iso(kw("2026-10-08T11:21:40")),
      ended_at: iso(kw("2026-10-08T11:32:00")),
    } as unknown as RoomRow;
    const waits = DEFAULT_ROOMS_JSON.waits_s as unknown as Parameters<typeof settleWanted>[4];
    // Found: false. roomForThisStart reads requested_at (11:21:00, a minute
    // past start + settle), while createRoom judged the same room by the
    // call it followed (11:19:30). The SQL S1 reads requested_at too (its
    // same_call), so it posts no settle and raises no "mark this intro"
    // alert: the intro stays confirmed after start, which B2B's rule reads as
    // shown, and the lead never gets the no-show sequence.
    const facts = { zoom_unclear: false, zoom_reported: true };
    // Control: the same room asked for at 11:19:50 is the intro's room to the settle.
    const early = { ...room, requested_at: iso(kw("2026-10-08T11:19:50")) } as RoomRow;
    expect(settleWanted(early, iso(start), false, kw("2026-10-08T11:40:00"), waits, facts)).toBe(true);
    expect(settleWanted(room, iso(start), false, kw("2026-10-08T11:40:00"), waits, facts)).toBe(true);
  });
});
