// bun test supabase/functions/sales-api/m1_time_r3.test.ts
//
// Milestone 1, video-link round 3, the TIME angle: whose clock the night rule
// reads for a Kuwait or UAE lead, and a later send of the link against the
// room's host wait (one second either side of host_by). The pilot settings
// (m1-scope.md section 3): rooms on, both providers, every send channel on,
// test_only with the lead as the test contact, short_link off, count_on_join,
// settle, wrap and auto_on_miss off, live.enabled off, followups.agent off;
// fallback.scope "intro" as shipped, or "any" where a manager set it.
//
// Each test drives sales-api's own actions (room.create, room.send, room.event
// worker.ready) on testfakes.ts with a clock only the test moves; the room
// worker's handshake is written as the worker writes it (contract v2 section
// 7) and the SQL sweep's R3 and R4 as cockpit_sales_rooms_sweep (20261004a)
// computes them. A failing test is a finding. Every lead is invented
// (stress-m1t3-...), every seat is ...@stress.invalid.
//
// Production data behind section 1 (read-only, 6 October 2026,
// cockpit_sales_leads): 209 leads with a +971 phone carry country "KW", 36
// carry "US"; 89 leads with a +966 phone carry "US". The dialer only rings
// Gulf numbers (dialer.ts ROUTES: 966, 965, 971, 974, 973), so the phone it
// rang names the lead's clock; the stored country often does not.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON, type RoomRow, roomCtx, roomsSetting, timers } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { hoursRefusal } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter-m1t3@stress.invalid";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

/** A Kuwait wall-clock moment (UTC+3) as an instant. */
const kw = (s: string) => Date.parse(`${s}+03:00`);
const iso = (t: number) => new Date(t).toISOString();
const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The hour on a zone's clock. */
const hourIn = (zone: string, t: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
/** The cockpit's rule for a message that is not a first message, on one zone: 09:00 to 21:00. */
const dayIn = (zone: string, t: number) => {
  const h = Number(hourIn(zone, t).slice(0, 2));
  return h >= 9 && h < 21;
};

interface WorldOpts {
  /** The country HighLevel's contact carries (what the night rule reads first). */
  country: string;
  /** The lead's phone, the number the dialer rang. */
  phone: string;
  /** The cockpit's own lead row's country (the night rule's fallback); defaults to `country`. */
  leadCountry?: string;
  scope?: "intro" | "any";
  /** WhatsApp gate open (the pilot's later state), or shut (today: email only). */
  gate?: boolean;
  /** The missed call the link follows. */
  rang?: number | null;
}

function world(now: number, o: WorldOpts) {
  const w = fakeWorld(now);
  const jobs: Promise<unknown>[] = [];
  const LEAD = `stress-m1t3-${fakeUuid().slice(-8)}`;
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
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, country: o.leadCountry ?? o.country, phone: o.phone, assigned_to: "G-setter" }]);
  // The lead wrote on WhatsApp two hours ago: the free-text window is open.
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: `c-${LEAD}`, contact_id: LEAD, inbound_whatsapp_at: iso(now - 2 * HOUR) }]);
  const attempt = fakeUuid();
  if (o.rang != null)
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
        started_at: iso(o.rang),
        saved_at: iso(o.rang + 35 * S),
      },
    ]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return {
        contact: { id: LEAD, firstName: "Sam", name: "Sam Lee", phone: o.phone, email: `${LEAD}@example.invalid`, tags: ["roas-qualified"], country: o.country },
      };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    if (m === "GET" && /^\/conversations\/messages\//.test(p)) return { message: { status: "delivered" } };
    return null as unknown as Row;
  });
  const sent: { channel: string; at: number; body: string }[] = [];
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
      const row: Row = {
        id: fakeUuid(),
        request_id: b.request_id,
        contact_id: b.contact_id,
        channel: b.channel,
        body: b.body,
        source: "room",
        state: "sent",
        provider_status: "sent",
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
  function heartbeat(at: number) {
    for (const r of w.db.t("cockpit_sales_worker_status")) if (r.job === "rooms") r.at = iso(at - 5 * S);
  }
  let meetings = 0;
  /**
   * The room worker (contract v2 section 7): claims, makes the meeting, stores
   * worker.ready, opens the room. host_by and ends_at as the 20261004a guard
   * trigger stamps them on the move to open: at least now + fallback_host
   * (900 s) and now + the call's length.
   */
  async function workerOpens(id: string, at: number) {
    w.clock.now = at;
    heartbeat(at);
    const r = room(id);
    const zoom = r.provider === "zoom";
    meetings++;
    const mid = zoom ? `8123456789${meetings}` : `abc-defg-hi${meetings}`;
    const url = zoom ? `https://us06web.zoom.us/j/${mid}?pwd=stress${meetings}` : `https://meet.google.com/${mid}`;
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
        join_url: url,
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
      payload: { provider: zoom ? "zoom" : "meet", provider_meeting_id: mid, worker_run: "run-1" },
    });
    await drain();
  }
  async function create(
    at: number,
    ask: { purpose: "fallback" | "manual"; provider?: "meet" | "zoom" },
  ): Promise<{ id: string | null; refused: string | null; code: string | null }> {
    w.clock.now = at;
    heartbeat(at);
    try {
      const out = await rooms.actions["room.create"]!(setter, {
        request_id: crypto.randomUUID(),
        contact_id: LEAD,
        purpose: ask.purpose,
        provider: ask.provider ?? "meet",
        call_kind: "intro",
        trigger: ask.purpose === "manual" ? "manual" : "no_answer",
        ...(ask.purpose === "fallback" && o.rang != null ? { attempt_id: attempt, item_kind: "lead" } : {}),
      });
      return { id: String((out.room as Row).id), refused: null, code: null };
    } catch (e) {
      // The refusal's code rides on ApiRefusal's extra (index.ts answers it as the body's code).
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
  return { ...w, rooms, room, sent, workerOpens, create, sendEmail, drain, LEAD, attempt };
}

/**
 * The SQL sweep's R3 (host not in) and R4 (lead not in) for one open room
 * with a lead, as cockpit_sales_rooms_sweep (20261004a) computes them: which
 * rule closes it first, and when. (No open, no knock: short_link is off in the
 * pilot, and Meet sends no knock.)
 */
function sqlCloses(r: Row): { rule: "host_not_in" | "lead_no_show"; at: number } {
  const t = (v: unknown) => (v ? Date.parse(String(v)) : Number.NaN);
  const r3 = t(r.host_by);
  const r4 = Number.isFinite(t(r.lead_by)) ? t(r.lead_by) : t(r.link_sent_at) + 10 * MIN;
  if (r.state === "open" && r3 <= r4) return { rule: "host_not_in", at: r3 };
  return { rule: "lead_no_show", at: r4 };
}

// ---------------------------------------------------------------------------
// 1. Whose clock: a UAE number whose stored country says KW, a Gulf number
//    whose stored country says US.
// ---------------------------------------------------------------------------

describe("setup: what the night rule reads for each lead", () => {
  test("a +971 lead read by country 'AE' is at night at 20:30 Kuwait (21:30 Dubai); read by 'KW' it is day", () => {
    const t = kw("2026-10-07T20:30:00");
    expect(hourIn("Asia/Dubai", t)).toBe("21:30");
    expect(hoursRefusal({ segment: "confirm", touch: 2, country: "AE", now: t, followups: {} })).not.toBeNull();
    expect(hoursRefusal({ segment: "confirm", touch: 2, country: "KW", now: t, followups: {} })).toBeNull();
  });
  test("a +966 lead read by country 'US' is at night at 14:00 Kuwait (14:00 Riyadh, 07:00 New York, 04:00 Los Angeles)", () => {
    const t = kw("2026-10-07T14:00:00");
    expect(dayIn("Asia/Riyadh", t)).toBe(true);
    expect(hoursRefusal({ segment: "confirm", touch: 2, country: "US", now: t, followups: {} })).not.toBeNull();
  });
});

describe("Wednesday 7 October, 20:30 Kuwait: a UAE lead (+971 50 ...) whose HighLevel country says AE; Send a video link from the lead page", () => {
  test("control: the Meet room is made and no message goes at 21:30 in Dubai (the night rule's read-out sentence)", async () => {
    const press = kw("2026-10-07T20:30:00");
    const w = world(press, { country: "AE", phone: "+971501234567", gate: true });
    const out = await w.create(press, { purpose: "manual" });
    expect(out.refused).toBeNull();
    await w.workerOpens(String(out.id), press + 6 * S);
    expect(w.sent.length).toBe(0);
    expect(String(w.room(String(out.id)).refusal ?? "")).toContain("It is night where the lead is");
  });
});

describe("Wednesday 7 October, 20:30 Kuwait: a UAE lead (+971 50 ...) whose HighLevel country says KW (209 such leads in production)", () => {
  const press = kw("2026-10-07T20:30:00");

  test("the lead page's video link (manual, the pilot's own path) sends nothing at 21:30 on the lead's clock", async () => {
    const w = world(press, { country: "KW", phone: "+971501234567", gate: true });
    const out = await w.create(press, { purpose: "manual" });
    expect(out.refused).toBeNull();
    await w.workerOpens(String(out.id), press + 6 * S);
    // Found when it fails: rooms.ts leadAtNight reads only the stored country
    // (HighLevel's, then the cockpit's lead row), never the number the link
    // goes to, so a +971 lead stored as KW is read on Kuwait's clock: at
    // 20:30 Kuwait it is 21:30 in Dubai and the WhatsApp link goes.
    const atNight = w.sent.filter(s => !dayIn("Asia/Dubai", s.at)).map(s => `${s.channel} at ${hourIn("Asia/Dubai", s.at)} Dubai`);
    expect(atNight).toEqual([]);
  });

  test("the pilot today (WhatsApp gate shut): the email goes at 21:30 in Dubai", async () => {
    const w = world(press, { country: "KW", phone: "+971501234567", gate: false });
    const out = await w.create(press, { purpose: "manual" });
    await w.workerOpens(String(out.id), press + 6 * S);
    const atNight = w.sent.filter(s => !dayIn("Asia/Dubai", s.at)).map(s => `${s.channel} at ${hourIn("Asia/Dubai", s.at)} Dubai`);
    expect(atNight).toEqual([]);
  });

  test("a missed call's video link (fallback, scope any) is refused at night on the lead's clock, as for a lead stored AE", async () => {
    const w = world(press, { country: "KW", phone: "+971501234567", gate: true, scope: "any", rang: press - 40 * S });
    const out = await w.create(press, { purpose: "fallback" });
    if (out.id) await w.workerOpens(out.id, press + 6 * S);
    // Found when it fails: room.create's night check passes (Kuwait 20:30 is
    // day) and the missed-call link "I tried to call you just now ... I'll
    // be there for the next 10 minutes" reaches the Dubai lead at 21:30.
    expect({ code: out.code, sent: w.sent.length }).toEqual({ code: "lead_night", sent: 0 });
  });

  test("control: the same lead at 19:30 Kuwait (20:30 Dubai) gets the link", async () => {
    const t = kw("2026-10-07T19:30:00");
    const w = world(t, { country: "KW", phone: "+971501234567", gate: true, scope: "any", rang: t - 40 * S });
    const out = await w.create(t, { purpose: "fallback" });
    expect(out.refused).toBeNull();
    await w.workerOpens(String(out.id), t + 6 * S);
    expect(w.sent.length).toBe(1);
  });
});

describe("Wednesday 7 October, 14:00 Kuwait: a Saudi lead (+966 5 ...) whose stored country says US (89 such leads in production)", () => {
  const press = kw("2026-10-07T14:00:00");

  test("a missed call's video link at 14:00 in Riyadh is not refused as night", async () => {
    const w = world(press, { country: "US", phone: "+966501234567", gate: true, scope: "any", rang: press - 40 * S });
    const out = await w.create(press, { purpose: "fallback" });
    // Found when it fails: the US zones (New York and Los Angeles) make every
    // Kuwait working hour "night" (04:00 to 08:00 in Los Angeles at
    // 14:00-18:00 Kuwait), so the setter is told "It is night where the
    // lead is, so no video link goes now. Call them after 9 in the morning,
    // their time." at 14:00 in Riyadh, and the link would go only from
    // 19:00 Kuwait (09:00 in Los Angeles) until 04:00 Kuwait.
    expect({ refused: out.refused }).toEqual({ refused: null });
  });

  test("the lead page's link (manual) at 14:00 in Riyadh goes, never 'It is night where the lead is'", async () => {
    const w = world(press, { country: "US", phone: "+966501234567", gate: true });
    const out = await w.create(press, { purpose: "manual" });
    expect(out.refused).toBeNull();
    await w.workerOpens(String(out.id), press + 6 * S);
    expect({ sent: w.sent.length, refusal: w.room(String(out.id)).refusal ?? null }).toEqual({ sent: 1, refusal: null });
  });

  test("and the same stored US country lets a missed call's link reach the Riyadh lead at 01:30 their time (22:30 New York, 15:30 Los Angeles)", async () => {
    const late = kw("2026-10-08T01:30:00");
    const w = world(late, { country: "US", phone: "+966501234567", gate: true, scope: "any", rang: late - 40 * S });
    const out = await w.create(late, { purpose: "fallback" });
    if (out.id) await w.workerOpens(out.id, late + 6 * S);
    const atNight = w.sent.filter(s => !dayIn("Asia/Riyadh", s.at)).map(s => `${s.channel} at ${hourIn("Asia/Riyadh", s.at)} Riyadh`);
    expect(atNight).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. A later send of the link promises ten more minutes; the room's host wait
//    (host_by, the sweep's R3) does not move with it.
// ---------------------------------------------------------------------------

describe("Tuesday 6 October, by day: a missed call's Meet room (scope any) whose link went on WhatsApp at 14:00:06; the setter is in the Meet but has not pressed I'm in", () => {
  const press = kw("2026-10-06T14:00:00");
  const opened = press + 6 * S;

  async function setup() {
    const w = world(press, { country: "KW", phone: "+96550123456", gate: true, scope: "any", rang: press - 40 * S });
    const out = await w.create(press, { purpose: "fallback" });
    expect(out.refused).toBeNull();
    const id = String(out.id);
    await w.workerOpens(id, opened);
    expect(w.sent.map(s => s.channel)).toEqual(["whatsapp"]);
    return { w, id };
  }

  test("control: with no later send, R4 (the lead's ten minutes) closes the room before R3 (the host's fifteen)", async () => {
    const { w, id } = await setup();
    const r = w.room(id);
    expect(sqlCloses(r).rule).toBe("lead_no_show");
    expect(sqlCloses(r).at).toBe(Date.parse(String(r.link_sent_at)) + 10 * MIN);
  });

  test("Also send by email at 14:09:06: the email's 'I'll be there for the next 10 minutes' is kept until 14:19:06, not cut at 14:15:06", async () => {
    const { w, id } = await setup();
    const later = opened + 9 * MIN;
    expect(await w.sendEmail(id, later)).toBeNull();
    const email = w.sent.find(s => s.channel === "email");
    expect(email?.body ?? "").toContain("next 10 minutes");
    const r = w.room(id);
    // The later send moved the lead's ten minutes (stress2 round 5, late-link-email) ...
    expect(r.lead_by).toBe(iso(later + 10 * MIN));
    // ... but the room's own deadline, as the SQL sweep reads it and as
    // roomlogic timers() lists it, is still host_by = opened + 15 minutes.
    const ctx = roomCtx(roomsSetting(w.db.t("cockpit_sales_settings").find(s => s.key === "rooms")?.value));
    const first = timers(r as unknown as RoomRow, ctx).sort((a, b) => a.at - b.at)[0];
    const close = sqlCloses(r);
    // Found when it fails: link_sent for a later channel patches lead_by
    // and last_link_at only (roomlogic.ts applyRoomEvent link_sent), so the
    // sweep's R3 closes the open room at 14:15:06, "Closed: the host did not
    // join in time.", six minutes into the ten the email just promised; the
    // panel's countdown (min of lead_by and host_by) drops to 6:00 the moment
    // the email goes. Meet links cannot be stopped, so a lead who opens the
    // email at 14:16 finds a Meet the panel has told the setter is closed.
    expect({ rule: close.rule, closes: new Date(close.at).toISOString(), timer: first?.reason }).toEqual({
      rule: "lead_no_show",
      closes: iso(later + 10 * MIN),
      timer: "lead_by",
    });
  });

  test("one second either side: the email at 14:05:05 (lead_by 14:15:05, one second before host_by) keeps its ten minutes; at 14:05:07 it does not", async () => {
    const before = await setup();
    await before.w.sendEmail(before.id, opened + 5 * MIN - S);
    expect(sqlCloses(before.w.room(before.id)).rule).toBe("lead_no_show");
    const after = await setup();
    await after.w.sendEmail(after.id, opened + 5 * MIN + S);
    const r = after.w.room(after.id);
    const close = sqlCloses(r);
    expect({ rule: close.rule, promised_until: r.lead_by }).toEqual({ rule: "lead_no_show", promised_until: iso(opened + 15 * MIN + S) });
  });
});
