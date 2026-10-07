// bun test supabase/functions/sales-api/stress2_concurrency_r6_links.test.ts
//
// Second series, round 6, dimension: concurrency and idempotency. One room's
// link delivered twice, and one hand-added live call read by two rooms at
// once.
//
// 1. A late 131047 on the free text, then the template AND the email.
//    Round 5 (window-shut-131047-never-falls-back-to-template) taught the
//    tick's recheckLink to try the call_link template when Meta refuses the
//    free-text link because the lead's 24 hours ran out. The template goes on
//    its own key, then the email block runs unconditionally: a lead with an
//    email in HighLevel gets the room's link twice more (the WhatsApp
//    template, seen and delivered, and the email), and the timeline says only
//    "so it went by email". In the normal cascade the email follows a
//    template only when nobody saw it (backUpUnseen).
//
// 2. Two rooms of one lead whose counts could not book (count_result failed:
//    the lead's first room and the replacement after "I can't let them in"),
//    both inside the hour after their joins. A person books the live call by
//    hand, as the alert asks. The minute's SQL tick posts both rooms in one
//    body; sales-api's tick starts adoptLiveBooking for each in the
//    background, and both read HighLevel's appointments, both find no other
//    room pointing at the call, and both write it: two rooms booked on one
//    call, two "room.count booked" audit rows, the showed status written
//    twice.
//
// A failing test is a finding for the fix agent. Nothing here reaches
// HighLevel, Zoom, Google or Slack; every lead is invented.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter-r6@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 1. 131047 late: the template, and the email beside it
// ---------------------------------------------------------------------------

function linkWorld() {
  const w = fakeWorld();
  const jobs: Promise<unknown>[] = [];
  const LEAD = "stress-r6-window-edge";
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
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
      },
    },
    { key: "live", value: { enabled: false } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_wa_templates", [
    { key: "call_link_ar", active: true, workflow_id: "wf-call-link" },
    { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" },
  ]);
  // The lead last wrote 23 h 40 m ago: the window reads open, Meta refuses the free text later.
  w.db.seed("cockpit_sales_inbox", [
    { conversation_id: `c-${LEAD}`, contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - (24 * HOUR - 20 * MIN)).toISOString() },
  ]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" } };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    // Meta's answer after the read-back: 131047, the window shut.
    if (m === "GET" && /^\/conversations\/messages\//.test(p))
      return {
        message: {
          id: "ghl-msg-131047",
          status: "failed",
          direction: "outbound",
          messageType: "TYPE_WHATSAPP",
          meta: { error: "Re-engagement message. Message failed to send because more than 24 hours have passed since the customer last replied to this number. (131047)" },
        },
      };
    return null as unknown as Row;
  });
  const at = () => new Date(w.clock.now).toISOString();
  const rows = new Map<string, Row>();
  /** What reached the lead, lane by lane (a send HighLevel took). */
  const delivered: string[] = [];
  async function send(lane: "text" | "template" | "email", requestId: string, contactId: string, channel: "whatsapp" | "email", body: string, extra: Row) {
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    delivered.push(lane);
    row.ghl_message_id = `msg-${String(row.id).slice(-8)}`;
    row.state = "sent";
    // The free text: HighLevel still says "pending" when the read-back ends.
    // The template: seen in the conversation, delivered.
    row.provider_status = lane === "text" ? "pending" : lane === "template" ? "delivered" : "sent";
    return { message: { ...row } };
  }
  const deps: RoomDeps = {
    io: {
      ...w.io,
      background: p => {
        jobs.push(p.catch(e => w.logs.push(`background: ${String((e as Error)?.message ?? e)}`)));
      },
    },
    audit: async () => {},
    markAppointment: async () => ({ crm: "written" }),
    sendText: (_who, b) => send(b.channel === "email" ? "email" : "text", b.request_id, b.contact_id, b.channel, b.body, {}),
    sendTemplate: (_who, t) =>
      send("template", t.requestId, t.contactId, "whatsapp", `Your Mahara call is ready. Join here: https://call.maharamedia.com/${t.buttonVariable?.join_code ?? ""}`, {
        template_key: t.key,
        via: "workflow",
      }),
    upcoming: async () => null,
    sentSince: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  async function drain(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      await realSleep(1);
      await Promise.race([Promise.allSettled(jobs.slice()), realSleep(40)]);
    }
  }
  async function opened(): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
    });
    const id = String((out.room as Row).id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(room(id).version) + 1 },
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
        join_url: MEET_URL,
        provider_meeting_id: `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(room(id).version) + 1,
      },
    });
    await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await drain();
    return id;
  }
  async function tick(id: string) {
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await drain();
  }
  return { ...w, rooms, room, opened, tick, drain, delivered, LEAD };
}

describe("concurrency r6: Meta's late 131047 on the free-text link, for a lead with an email", () => {
  test("late-131047-template-and-email-both-go: the link reaches the lead once more, never twice", async () => {
    const w = linkWorld();
    const id = await w.opened();
    expect(w.delivered, "the plan chose the free text (the window read open)").toEqual(["text"]);
    // The minute's ticks while the room waits for the lead: the free text reads failed (131047).
    for (let i = 0; i < 3; i++) {
      w.clock.now += 70 * S;
      await w.tick(id);
    }
    const after = w.delivered.slice(1);
    const line = w.db
      .t("cockpit_sales_room_events")
      .filter(e => e.room_id === id && e.kind === "link.failed_late")
      .map(e => String(e.text));
    // The free text failed; the call_link template went and was seen
    // (delivered). One replacement link is the contract ("never two links to
    // one lead"): the email follows a template only when nobody saw it.
    expect(
      { replacements: after, channels: w.room(id).link_channels },
      `after the late failure the lead got ${JSON.stringify(after)} (the timeline says ${JSON.stringify(line)})`,
    ).toEqual({ replacements: ["template"], channels: ["whatsapp_text", "whatsapp_template"] });
  });
});

// ---------------------------------------------------------------------------
// 2. One hand-added live call, two rooms adopting it in one tick
// ---------------------------------------------------------------------------

function adoptWorld(seed = 1) {
  const w = fakeWorld();
  let r = seed >>> 0;
  const rnd = () => {
    r = (r * 1664525 + 1013904223) >>> 0;
    return r / 4294967296;
  };
  const LEAD = "stress-r6-two-rooms";
  const audits: Row[] = [];
  const showed: string[] = [];
  const joined = w.clock.now - 20 * MIN;
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: false,
        count_on_join: true,
        live_calendar_id: "LIVECAL",
        test_calendar_id: "TESTCAL",
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: false, whatsapp_template: false, email: false },
      },
    },
    { key: "live", value: { enabled: false } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  const base = (over: Row): Row => ({
    request_id: fakeUuid(),
    contact_id: LEAD,
    purpose: "fallback",
    trigger: "no_answer",
    call_kind: "intro",
    host_email: SETTER,
    made_by: SETTER,
    state: "ended",
    result: "joined",
    end_reason: "finished",
    requested_at: new Date(joined - 3 * MIN).toISOString(),
    opened_at: new Date(joined - 2 * MIN).toISOString(),
    host_in_at: new Date(joined - 2 * MIN).toISOString(),
    link_sent_at: new Date(joined - 2 * MIN).toISOString(),
    link_channels: ["whatsapp_text"],
    count_claimed_at: new Date(joined + 5 * S).toISOString(),
    count_result: "failed",
    ended_at: new Date(joined + 15 * MIN).toISOString(),
    version: 5,
    ...over,
  });
  // The Meet room the lead knocked on and the Zoom room after "I can't let them in": both joined.
  const a = fakeUuid();
  const b = fakeUuid();
  w.db.seed("cockpit_sales_rooms", [
    base({ id: a, provider: "meet", join_url: MEET_URL, lead_in_at: new Date(joined).toISOString(), lead_in_seen_at: new Date(joined).toISOString() }),
    base({
      id: b,
      provider: "zoom",
      join_url: "https://us06web.zoom.us/j/81234500061?pwd=stress",
      provider_meeting_id: "81234500061",
      lead_in_at: new Date(joined + 90 * S).toISOString(),
      lead_in_seen_at: new Date(joined + 90 * S).toISOString(),
      count_claimed_at: new Date(joined + 95 * S).toISOString(),
    }),
  ]);
  // The live call the setter booked by hand on the live calendar, as the alert asked.
  const LIVE = "live-by-hand-1";
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) {
      // HighLevel's read takes far longer than a database round trip, and
      // varies more (a few hundred milliseconds on the shared location,
      // give or take a hundred; here 15 to 45 round trips).
      await realSleep(30 + Math.floor(rnd() * 60));
      return {
        events: [
          {
            id: LIVE,
            calendarId: "LIVECAL",
            title: "Live · Huda",
            startTime: new Date(joined).toISOString(),
            appointmentStatus: "confirmed",
            assignedUserId: "G-setter",
          },
        ],
      };
    }
    if (m === "PUT" && p === `/calendars/events/appointments/${LIVE}`) {
      showed.push(LIVE);
      return { ok: true };
    }
    if (m === "GET" && p === `/calendars/events/appointments/${LIVE}`)
      return { appointment: { id: LIVE, calendarId: "LIVECAL", appointmentStatus: "showed", startTime: new Date(joined).toISOString() } };
    return null as unknown as Row;
  });
  // Every database call is a round trip (a few milliseconds), as PostgREST's are.
  const io = { ...w.io, db: async (path: string, init?: Parameters<typeof w.io.db>[1]) => {
    await realSleep(2);
    return await w.io.db(path, init);
  } };
  const deps: RoomDeps = {
    io,
    audit: async (_who, action, _t, entityId, before, after) => {
      audits.push({ action, entityId, before, after });
    },
    markAppointment: async () => ({ crm: "written" }),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  return { ...w, rooms, room, a, b, LIVE, audits, showed };
}

describe("concurrency r6: a hand-added live call, two failed counts, one tick", () => {
  test("adopt-live-booking-twins: the call is counted on one room only, whatever HighLevel's latency", async () => {
    const twins: number[] = [];
    let audits = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const w = adoptWorld(seed);
      // The SQL tick posts every final room whose join is in the last hour, in one body.
      await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [w.a, w.b] } });
      await w.flush();
      const pointing = [w.a, w.b].filter(id => w.room(id).count_appointment_id === w.LIVE);
      if (pointing.length > 1) {
        twins.push(seed);
        audits = Math.max(audits, w.audits.filter(x => x.action === "room.count" && (x.after as Row)?.appointment_id === w.LIVE).length);
      }
    }
    expect(
      { seeds_with_two_rooms_on_one_call: twins.length, count_audit_rows: audits },
      `one live call booked by hand: in seeds ${JSON.stringify(twins)} both rooms say they booked it, each with its own room.count audit row`,
    ).toEqual({ seeds_with_two_rooms_on_one_call: 0, count_audit_rows: 0 });
  }, 120_000);

  test("HELD (control): the next minute's tick never adopts the call a second time once a room points at it", async () => {
    const w = adoptWorld();
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [w.a] } });
    await w.flush();
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [w.b] } });
    await w.flush();
    expect([w.a, w.b].filter(id => w.room(id).count_appointment_id === w.LIVE)).toHaveLength(1);
  });
});
