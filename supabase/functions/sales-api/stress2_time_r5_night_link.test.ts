// bun test supabase/functions/sales-api/stress2_time_r5_night_link.test.ts
//
// TIME stress, second series, round 5: the confirmation call the dialer puts
// up for a lead outside the Gulf, and the video link it sends when the call
// rings out.
//
// The dialer confirms a call booked more than a day ahead "the call centre's
// way" on Kuwait's clock (dialer.ts confirmFrom): from 18:00 the evening
// before a call that starts before noon, otherwise from 09:00 on the day.
// The desk's own confirmation message keeps to the lead's clock since the
// first series (followups.py confirm_from, CONFIRM_HOURS 09:00 to 21:00
// there); the dialer's call does not. With rooms.fallback.scope "intro" (as it
// ships), a missed call to a lead with a booked intro, the confirmation call
// included, offers "Send a video link" (DialerPage offerVideo, VideoLink
// automatic mode sends it by itself after ten seconds). room.create and the
// message service check no clock at all: every other message the cockpit
// sends a lead keeps to 09:00 to 21:00 on the lead's clock (sendrules.ts
// hoursRefusal: "It is night where the lead is.").
//
// A test that fails here is a finding: its message says what the lead gets.
// Everything runs on testfakes.ts; every lead is invented.
import { describe, expect, test } from "bun:test";
import { appointmentWork, type Appt } from "./dialer.ts";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { hoursRefusal, leadZones } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SETTER = "setter-t2r5@stress.invalid";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=stress";

/** A Kuwait wall-clock moment (UTC+3) as an instant. */
const kw = (s: string) => Date.parse(`${s}+03:00`);
const iso = (t: number) => new Date(t).toISOString();

/** The hour on each of the lead's clocks at `t`. */
function leadHours(country: string, t: number): number[] {
  return (leadZones(country) ?? ["Asia/Kuwait"]).map(z =>
    Number(new Intl.DateTimeFormat("en-GB", { timeZone: z, hour: "2-digit", hourCycle: "h23" }).format(t)),
  );
}
/** The cockpit's own rule for a message that is not a first message (a confirmation): 09:00 to 21:00 on every clock of the lead's. */
const daytime = (country: string, t: number) =>
  hoursRefusal({ segment: "confirm", touch: 2, country, now: t, followups: {} }) === null;

const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 1. The dialer's confirmation item, on Kuwait's clock
// ---------------------------------------------------------------------------

function intro(start: number, booked: number, country: string | null = null): Appt {
  // Fix round 5: the dialer reads the lead's country (index.ts candidates), so the item keeps to their clock.
  return { id: "stress-t2r5-appt", type: "intro", start, booked, status: "confirmed", assigned: "G-setter", confirmed: false, last_try: null, country };
}

describe("Monday 12 October: an intro booked on Friday for 17:00 Kuwait, by a lead in New York (10:00 there)", () => {
  const start = kw("2026-10-12T17:00:00");
  const booked = start - 3 * DAY;
  test("setup: the call is at 10:00 in New York, the lead's first clock", () => {
    expect(leadHours("US", start)[0]).toBe(10);
  });
  test("the dialer never puts the confirmation call up while it is night where the lead is", () => {
    // From 09:00 Kuwait (dialer.ts confirmFrom) to 16:00 Kuwait, every quarter hour.
    const offeredAtNight: string[] = [];
    for (let t = kw("2026-10-12T08:00:00"); t < start; t += 15 * MIN) {
      const item = appointmentWork(intro(start, booked, "US"), t, "setter", "G-setter");
      if (item?.kind === "confirm" && !daytime("US", t))
        offeredAtNight.push(`${new Date(t + 3 * HOUR).toISOString().slice(11, 16)} Kuwait (${leadHours("US", t).join("/")}h there)`);
    }
    // Found: "Confirm the intro today at 17:00" from 09:00 Kuwait, which is
    // 02:00 in New York and 23:00 the evening before in Los Angeles, every
    // quarter hour until the lead's morning.
    expect({ first: offeredAtNight[0] ?? null, count: offeredAtNight.length }).toEqual({ first: null, count: 0 });
  });
});

describe("Monday 12 October: an intro booked for 17:20 Kuwait by a lead in Canada (10:20 Halifax, 06:20 Vancouver)", () => {
  test("the dialer's confirmation call does not come up at 09:05 Kuwait (02:05 in Halifax), and does once it is day on every clock of theirs", () => {
    const start = kw("2026-10-12T17:20:00");
    const at = kw("2026-10-12T09:05:00");
    // As found, the item came up here; the original check (daytime("CA", at)) is a fact of the clock, never of the code.
    expect(daytime("CA", at)).toBe(false);
    expect(appointmentWork(intro(start, start - 3 * DAY, "CA"), at, "setter", "G-setter")?.kind ?? null).toBeNull();
    // A Kuwait lead's item still comes up at 09:05 (the control).
    expect(appointmentWork(intro(start, start - 3 * DAY, "KW"), at, "setter", "G-setter")?.kind).toBe("confirm");
    // Canada's day never comes before this call on every clock of theirs
    // (Vancouver's 09:00 is 19:00 Kuwait); a lead in London gets the item
    // in their morning, and it says the hour there.
    expect(appointmentWork(intro(start, start - 3 * DAY, "CA"), kw("2026-10-12T16:30:00"), "setter", "G-setter")).toBeNull();
    const uk = appointmentWork(intro(start, start - 3 * DAY, "GB"), kw("2026-10-12T12:00:00"), "setter", "G-setter");
    expect(uk?.why).toMatch(/\(it is 10:00 there\)$/);
  });
});

// ---------------------------------------------------------------------------
// 2. The video link after the confirmation call rang out
// ---------------------------------------------------------------------------

function world(now: number, country: string) {
  const w = fakeWorld(now);
  const jobs: Promise<unknown>[] = [];
  const LEAD = `stress-t2r5-night-${country.toLowerCase()}`;
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: false,
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        short_link: true,
        // As it ships: a video link only for a lead with a booked intro.
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "intro" },
      },
    },
    { key: "live", value: { enabled: false } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: iso(now - 5 * S) }]);
  w.db.seed("cockpit_sales_wa_templates", [
    { key: "call_link_ar", active: true, workflow_id: "wf-call-link" },
    { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" },
  ]);
  const start = kw("2026-10-12T17:00:00");
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: "stress-t2r5-appt",
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
  // The lead wrote on WhatsApp yesterday afternoon (their time): the free-text window is open.
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: `c-${LEAD}`, contact_id: LEAD, inbound_whatsapp_at: iso(now - 14 * HOUR) }]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Sam", name: "Sam Lee", phone: "+12125550100", email: `${LEAD}@example.com`, tags: ["roas-qualified"], country } };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    return null as unknown as Row;
  });
  const sent: { channel: string; at: number }[] = [];
  const deps: RoomDeps = {
    io: {
      ...w.io,
      background: p => {
        jobs.push(p.catch(e => w.logs.push(`background: ${String((e as Error)?.message ?? e)}`)));
      },
    },
    audit: async () => {},
    markAppointment: async () => ({ crm: "written" }),
    sendText: async (_who, b) => {
      sent.push({ channel: String(b.channel), at: w.clock.now });
      const row: Row = { id: fakeUuid(), request_id: b.request_id, contact_id: b.contact_id, channel: b.channel, body: b.body, state: "sent", ghl_message_id: `m-${fakeUuid().slice(0, 8)}`, created_at: iso(w.clock.now) };
      w.db.t("cockpit_sales_messages").push(row);
      return { message: { ...row } };
    },
    sendTemplate: async (_who, t) => {
      sent.push({ channel: "whatsapp_template", at: w.clock.now });
      const row: Row = { id: fakeUuid(), request_id: t.requestId, contact_id: t.contactId, channel: "whatsapp", via: "workflow", template_key: t.key, state: "delivered", provider_status: "delivered", created_at: iso(w.clock.now) };
      w.db.t("cockpit_sales_messages").push(row);
      return { message: { ...row } };
    },
    upcoming: async () => null,
    sentSince: async () => false,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  async function drain() {
    for (let i = 0; i < 10; i++) {
      await realSleep(1);
      await Promise.race([Promise.allSettled(jobs.slice()), realSleep(40)]);
    }
  }
  /** The room worker: claims, makes the meeting, stores worker.ready, opens the room (contract v2 section 7). */
  async function workerOpens(id: string) {
    const r = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made." },
      prefer: "resolution=ignore-duplicates",
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: ZOOM_URL,
        provider_meeting_id: "81234567890",
        opened_at: w.db.iso(),
        host_by: iso(w.clock.now + 15 * MIN),
        ends_at: iso(w.clock.now + 30 * MIN),
        version: Number(room(id).version) + 1,
      },
    });
  }
  async function confirmationLink(): Promise<{ id: string | null; refused: string | null }> {
    let out: Row;
    try {
      out = await rooms.actions["room.create"]!(setter, {
        request_id: crypto.randomUUID(),
        contact_id: LEAD,
        purpose: "fallback",
        provider: "zoom",
        call_kind: "intro",
        trigger: "no_answer",
        appointment_id: "stress-t2r5-appt",
        item_kind: "confirm",
      });
    } catch (e) {
      return { id: null, refused: String((e as Error).message) };
    }
    const id = String((out.room as Row).id);
    await workerOpens(id);
    await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await drain();
    return { id, refused: null };
  }
  return { ...w, rooms, room, sent, confirmationLink, LEAD };
}

describe("Monday 09:05 Kuwait: the setter's confirmation call to the New York lead rings out (02:05 there); Send a video link", () => {
  const at = kw("2026-10-12T09:05:00");
  test("setup: it is 02:05 in New York and 23:05 on Sunday in Los Angeles", () => {
    expect(leadHours("US", at)).toEqual([2, 23]);
  });
  test("no WhatsApp or email goes to the lead while it is night where they are", async () => {
    const w = world(at, "US");
    const out = await w.confirmationLink();
    const atNight = w.sent.filter(s => !daytime("US", s.at)).map(s => `${s.channel} at ${leadHours("US", s.at).join("/")}h their time`);
    // Found: the link's WhatsApp ("I tried to call you just now and couldn't
    // get through. If you have 15 minutes, we can talk on video now ... I'll
    // be there for the next 10 minutes.") goes at 02:05 New York time, with
    // no word to the setter that it is night there. Every other cockpit
    // message to a lead is refused then ("It is night where the lead is.").
    expect({ refused: out.refused, atNight }).toEqual({ refused: expect.any(String), atNight: [] });
  });
  test("control: the same press for a lead in Kuwait at 09:05 sends the link", async () => {
    const w = world(at, "KW");
    const out = await w.confirmationLink();
    expect(out.refused).toBeNull();
    expect(w.sent.length).toBeGreaterThan(0);
  });
});
