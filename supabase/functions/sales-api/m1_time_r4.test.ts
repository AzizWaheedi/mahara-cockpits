// bun test supabase/functions/sales-api/m1_time_r4.test.ts
//
// Milestone 1, video-link round 4, the TIME angle on sales-api's own path:
//  1. "Also send by email" one second either side of link_sent's one-minute
//     "same send" rule: the email's words promise the lead ten minutes from
//     the email, and the room's lead_by (the sweep's R4) is what keeps them;
//  2. the lead's three links an hour (LINK_FLOOD_MAX), one second either side
//     of an earlier room's FIRST send leaving the hour while its later email
//     is still inside it;
//  3. a free text still pending when night begins on the lead's clock: the
//     email backup is held by the night rule, and what the room says.
//
// The pilot settings (m1-scope.md section 3): rooms on, both providers, every
// send channel on, test_only with the lead as the test contact, short_link
// off, count_on_join, settle, wrap and auto_on_miss off, live.enabled off,
// followups.agent off; fallback.scope "intro" as shipped. The WhatsApp gate
// open is the pilot's later state (m1-scope: "until then the link goes by
// email"); it is set where a test needs WhatsApp.
//
// Each test drives sales-api's own actions (room.create, room.send,
// room.end, room.event worker.ready and tick) on testfakes.ts with a clock
// only the test moves; the room worker's handshake is written as the worker
// writes it (contract v2 section 7). A failing test is a finding. Every lead
// is invented (stress-m1t4-...), every seat is ...@stress.invalid.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter-m1t4@stress.invalid";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

/** A Kuwait wall-clock moment (UTC+3) as an instant. */
const kw = (s: string) => Date.parse(`${s}+03:00`);
const iso = (t: number) => new Date(t).toISOString();
const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface WorldOpts {
  country?: string;
  phone?: string;
  /** WhatsApp gate open (the pilot's later state), or shut (today: email only). */
  gate?: boolean;
  /** When the lead last wrote on WhatsApp (the free-text window). */
  inboundAt?: number | null;
  /** What HighLevel says of a free text: its send's answer and a read by id. */
  waStatus?: "delivered" | "pending";
  /** fallback.scope: "intro" as shipped, or "any" where a manager set it (m1-scope section 3). */
  scope?: "intro" | "any";
}

function world(now: number, o: WorldOpts = {}) {
  const w = fakeWorld(now);
  const jobs: Promise<unknown>[] = [];
  const LEAD = `stress-m1t4-${fakeUuid().slice(-8)}`;
  const phone = o.phone ?? "+96550123456";
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: true,
        test_contacts: [LEAD],
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        count_on_join: false,
        settle: false,
        wrap: false,
        short_link: false,
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: o.scope ?? "intro", auto_on_miss: false },
      },
    },
    { key: "live", value: { enabled: false, slack: false } },
    { key: "followups", value: { enabled: true, agent: false } },
    {
      key: "whatsapp_guard",
      value: o.gate
        ? { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 }
        : { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 },
    },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: iso(now - 5 * S) }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, country: o.country ?? "KW", phone, assigned_to: "G-setter" }]);
  const inbound = o.inboundAt === undefined ? now - 2 * HOUR : o.inboundAt;
  if (inbound !== null) w.db.seed("cockpit_sales_inbox", [{ conversation_id: `c-${LEAD}`, contact_id: LEAD, inbound_whatsapp_at: iso(inbound) }]);
  const waStatus = o.waStatus ?? "delivered";
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return {
        contact: { id: LEAD, firstName: "Sam", name: "Sam Lee", phone, email: `${LEAD}@example.invalid`, tags: ["roas-qualified"], country: o.country ?? "KW" },
      };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    if (m === "GET" && /^\/conversations\/messages\//.test(p)) {
      const id = decodeURIComponent(p.split("/").pop() ?? "");
      const row = w.db.t("cockpit_sales_messages").find(r => r.ghl_message_id === id);
      return { message: { id, status: row?.channel === "email" ? "delivered" : waStatus } };
    }
    return null as unknown as Row;
  });
  const sent: { channel: string; at: number; body: string; room?: string }[] = [];
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
      sent.push({ channel: String(b.channel), at: w.clock.now, body: String(b.body ?? "") });
      const wa = b.channel === "whatsapp";
      const row: Row = {
        id: fakeUuid(),
        request_id: b.request_id,
        contact_id: b.contact_id,
        channel: b.channel,
        via: "conversation",
        body: b.body,
        source: "room",
        state: "sent",
        provider_status: wa ? (waStatus === "pending" ? "pending" : "sent") : "sent",
        ghl_message_id: `m-${fakeUuid().slice(-8)}`,
        created_at: iso(w.clock.now),
      };
      w.db.t("cockpit_sales_messages").push(row);
      return { message: { ...row } };
    },
    sendTemplate: async (_who, t) => {
      sent.push({ channel: "whatsapp_template", at: w.clock.now, body: "" });
      const row: Row = {
        id: fakeUuid(),
        request_id: t.requestId,
        contact_id: t.contactId,
        channel: "whatsapp",
        via: "workflow",
        template_key: t.key,
        source: "room",
        state: "delivered",
        provider_status: "delivered",
        created_at: iso(w.clock.now),
      };
      w.db.t("cockpit_sales_messages").push(row);
      return { message: { ...row } };
    },
    upcoming: async () => null,
    sentSince: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  async function drain() {
    for (let i = 0; i < 10; i++) {
      await realSleep(1);
      await Promise.race([Promise.allSettled(jobs.slice()), realSleep(40)]);
    }
  }
  function heartbeat(at: number) {
    for (const r of w.db.t("cockpit_sales_worker_status")) if (r.job === "rooms") r.at = iso(at - 5 * S);
  }
  let meetings = 0;
  /** The room worker (contract v2 section 7): claims, makes the meeting, stores worker.ready, opens the room. */
  async function workerOpens(id: string, at: number) {
    w.clock.now = at;
    heartbeat(at);
    const r = room(id);
    meetings++;
    const mid = `abc-defg-h${meetings}${fakeUuid().slice(-3)}`;
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made in 4.0 s." },
      prefer: "resolution=ignore-duplicates",
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: `https://meet.google.com/${mid}`,
        provider_meeting_id: mid,
        opened_at: w.db.iso(),
        host_by: iso(w.clock.now + 15 * MIN),
        ends_at: iso(w.clock.now + 30 * MIN),
        version: Number(room(id).version) + 1,
      },
    });
    await rooms.desk["room.event"]!(desk, {
      kind: "worker.ready",
      room_id: id,
      payload: { provider: "meet", provider_meeting_id: mid, worker_run: "run-1" },
    });
    await drain();
  }
  /**
   * The lead page's Send a video link (manual, the pilot's own path for the
   * test contact), or the dialer's after a missed call that rang at
   * `rang` (fallback).
   */
  async function create(
    at: number,
    ask: { purpose: "manual" | "fallback"; rang?: number } = { purpose: "manual" },
  ): Promise<{ id: string | null; refused: string | null; code: string | null }> {
    w.clock.now = at;
    heartbeat(at);
    let attempt: string | null = null;
    if (ask.purpose === "fallback" && ask.rang !== undefined) {
      attempt = fakeUuid();
      w.db.seed("cockpit_sales_attempts", [
        {
          id: attempt,
          contact_id: LEAD,
          rep_email: SETTER,
          appointment_id: null,
          item_kind: "lead",
          state: "saved",
          outcome: "no_answer",
          call_state: "no_answer",
          call_duration_s: 0,
          started_at: iso(ask.rang),
          saved_at: iso(ask.rang + 35 * S),
        },
      ]);
    }
    try {
      const out = await rooms.actions["room.create"]!(setter, {
        request_id: crypto.randomUUID(),
        contact_id: LEAD,
        purpose: ask.purpose,
        provider: "meet",
        call_kind: "intro",
        trigger: ask.purpose === "manual" ? "manual" : "no_answer",
        ...(attempt ? { attempt_id: attempt, item_kind: "lead" } : {}),
      });
      return { id: String((out.room as Row).id), refused: null, code: null };
    } catch (e) {
      return { id: null, refused: String((e as Error).message), code: String((e as { extra?: { code?: unknown } }).extra?.code ?? "") };
    }
  }
  async function sendEmail(id: string, at: number): Promise<string | null> {
    w.clock.now = at;
    heartbeat(at);
    try {
      await rooms.actions["room.send"]!(setter, { room_id: id, request_id: crypto.randomUUID(), channel: "email" });
      await drain();
      return null;
    } catch (e) {
      return String((e as Error).message);
    }
  }
  async function end(id: string, at: number) {
    w.clock.now = at;
    await rooms.actions["room.end"]!(setter, { room_id: id, reason: "end", version: Number(room(id).version), request_id: crypto.randomUUID() });
    await drain();
  }
  async function tick(id: string, at: number) {
    w.clock.now = at;
    heartbeat(at);
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await drain();
  }
  return { ...w, rooms, room, sent, workerOpens, create, sendEmail, end, tick, drain, LEAD };
}

// ---------------------------------------------------------------------------
// 1. "Also send by email" one second either side of the one-minute rule.
// ---------------------------------------------------------------------------

describe("Tuesday 6 October, by day, WhatsApp gate open, scope any: a missed call's Meet link goes on WhatsApp at 14:00:06; the setter presses Also send by email", () => {
  const press = kw("2026-10-06T14:00:00");
  const opened = press + 6 * S;

  async function setup() {
    const w = world(press, { gate: true, scope: "any" });
    const out = await w.create(press, { purpose: "fallback", rang: press - 40 * S });
    expect(out.refused).toBeNull();
    const id = String(out.id);
    await w.workerOpens(id, opened);
    expect(w.sent.map(s => s.channel)).toEqual(["whatsapp"]);
    expect(w.room(id).lead_by).toBe(iso(opened + 10 * MIN));
    return { w, id };
  }

  test("control: the email at 14:01:06 (60 s after the WhatsApp) moves lead_by to its own send + 10 minutes", async () => {
    const { w, id } = await setup();
    const at = opened + 60 * S;
    expect(await w.sendEmail(id, at)).toBeNull();
    const email = w.sent.find(s => s.channel === "email");
    expect(email?.body ?? "").toContain("I'll be there for the next 10 minutes");
    expect(w.room(id).lead_by).toBe(iso(at + 10 * MIN));
  });

  test("the email at 14:01:05 (59 s after) says \"I'll be there for the next 10 minutes\": the room waits those ten minutes", async () => {
    const { w, id } = await setup();
    const at = opened + 59 * S;
    expect(await w.sendEmail(id, at)).toBeNull();
    expect(w.sent.map(s => s.channel)).toEqual(["whatsapp", "email"]);
    expect(w.sent[1]?.body ?? "").toContain("I'll be there for the next 10 minutes");
    // Found when it fails: roomlogic.ts link_sent for a later channel
    // returns same(room) when t - first < 60 s, so lead_by (the sweep's R4)
    // stays at the WhatsApp's send + 10 minutes, 14:10:06: the email that
    // went at 14:01:05 promising "the next 10 minutes" gets 9 minutes 1
    // second, where one second later the same press gets the full ten;
    // last_link_at is never written, so R4's open-grace cap and the panel's
    // countdown count from the WhatsApp as well.
    expect({ lead_by: w.room(id).lead_by, last_link_at: w.room(id).last_link_at ?? null }).toEqual({
      lead_by: iso(at + 10 * MIN),
      last_link_at: iso(at),
    });
  });
});

// ---------------------------------------------------------------------------
// 2. The lead's three links an hour, one second either side of an earlier
//    room's first send leaving the hour.
// ---------------------------------------------------------------------------

describe("Tuesday 6 October, WhatsApp gate open: three lead-page rooms for one lead inside the hour, each with Also send by email", () => {
  // Room A: WhatsApp at 14:00:06, its email at 14:05:00 (both reached the lead).
  // Room B: WhatsApp at 14:30:06 (its email refused by the cap: three links).
  // Room C: its link goes when the worker opens it (the cap is read at the
  // send), one second either side of 15:00:06, when A's WhatsApp leaves the
  // hour while A's email at 14:05 is still inside it; C's own Also send by
  // email follows 70 s later.
  async function run(cOpen: number) {
    const start = kw("2026-10-06T14:00:00");
    const w = world(start, { gate: true });
    const a = await w.create(start);
    const A = String(a.id);
    await w.workerOpens(A, start + 6 * S);
    expect(await w.sendEmail(A, kw("2026-10-06T14:05:00"))).toBeNull();
    await w.end(A, kw("2026-10-06T14:06:00"));
    const b = await w.create(kw("2026-10-06T14:30:00"));
    const B = String(b.id);
    await w.workerOpens(B, kw("2026-10-06T14:30:06"));
    const bEmail = await w.sendEmail(B, kw("2026-10-06T14:31:00"));
    await w.end(B, kw("2026-10-06T14:32:00"));
    const c = await w.create(cOpen - 6 * S);
    expect(c.refused).toBeNull();
    const C = String(c.id);
    await w.workerOpens(C, cOpen);
    const cEmail = await w.sendEmail(C, cOpen + 70 * S);
    return { w, bEmail, cEmail, C, last: cOpen + 70 * S };
  }
  const hhmmss = (t: number) => new Date(t + 3 * HOUR).toISOString().slice(11, 19);

  test("setup: room B's email is refused by the cap (A's two links and B's WhatsApp are three)", async () => {
    const { bEmail } = await run(kw("2026-10-06T15:00:05"));
    expect(bEmail ?? "").toContain("three call links this hour");
  });

  test("control: room C's link at 15:00:05 (A's first send still in the hour) is held by the cap; nothing past three in any hour", async () => {
    const { w, last } = await run(kw("2026-10-06T15:00:05"));
    const inHour = w.sent.filter(s => s.at > last - HOUR && s.at <= last).map(s => `${s.channel} at ${hhmmss(s.at)}`);
    expect(inHour.length).toBeLessThanOrEqual(3);
  });

  test("room C's link at 15:00:07: no more than three call links reach the lead in any hour", async () => {
    const { w, last } = await run(kw("2026-10-06T15:00:07"));
    const inHour = w.sent.filter(s => s.at > last - HOUR && s.at <= last).map(s => `${s.channel} at ${hhmmss(s.at)}`);
    // Found when it fails: rooms.ts leadLinksThisHour counts each room by
    // link_sent_at (its FIRST send) with all its channels, never by when
    // each channel went (last_link_at): at 15:00:07 room A (WhatsApp
    // 14:00:06, email 14:05:00) drops out whole although its email is still
    // inside the hour, so C's WhatsApp and C's email both pass the cap and
    // the lead gets four call links between 14:05:00 and 15:01:17.
    expect(inHour).toEqual(inHour.slice(0, 3));
  });
});

// ---------------------------------------------------------------------------
// 3. A free text still pending when night begins on the lead's clock.
// ---------------------------------------------------------------------------

describe("Thursday 8 October, WhatsApp gate open: the lead page's Meet link goes on WhatsApp at 20:58:56 Kuwait; HighLevel still calls it pending at 21:00:30", () => {
  const press = kw("2026-10-08T20:58:50");
  const opened = press + 6 * S;

  test("setup: the free text went by day and HighLevel holds it", async () => {
    const w = world(press, { gate: true, waStatus: "pending" });
    const out = await w.create(press);
    await w.workerOpens(String(out.id), opened);
    expect(w.sent.map(s => s.channel)).toEqual(["whatsapp"]);
  });

  test("the tick at 21:00:30 holds the email backup at night and says why: night, never 'no email could go'", async () => {
    const w = world(press, { gate: true, waStatus: "pending" });
    const out = await w.create(press);
    const id = String(out.id);
    await w.workerOpens(id, opened);
    await w.tick(id, kw("2026-10-08T21:00:30"));
    expect(w.sent.map(s => s.channel)).toEqual(["whatsapp"]);
    const lines = w.db
      .t("cockpit_sales_room_events")
      .filter(e => e.room_id === id && e.kind === "link.unconfirmed")
      .map(e => String(e.text));
    // Found when it fails: rooms.ts pendingBackup holds the email with
    // nightHolds (a later send at night) and then writes
    // link_pending_no_email, "WhatsApp has not taken the link yet and no
    // email could go. Read the link out.", the words for a lead with no
    // email address. The lead has one; the setter, told no email could
    // go, presses Also send by email and is refused with the night
    // sentence instead. A late WhatsApp failure at the same minute says
    // "It is night where the lead is, so nothing else went."
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/night/i);
  });
});
