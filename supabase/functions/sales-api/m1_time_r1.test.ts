// bun test supabase/functions/sales-api/m1_time_r1.test.ts
//
// Milestone 1, video-link round 1, the TIME angle: the video link after a
// missed call, with the pilot settings (m1-scope.md section 3): rooms on,
// both providers, every send channel on, test_only with the lead as the test
// contact, short_link off, count_on_join, settle, wrap and auto_on_miss off,
// live.enabled off, followups.agent off, fallback.scope "intro" as shipped.
//
// Each test drives sales-api's own room.create, the worker's handshake as
// the worker writes it (contract v2 section 7) and room.event worker.ready,
// on testfakes.ts with a clock only the test moves. A test that fails here
// is a finding. Every lead is invented (stress-m1t-...), every seat is
// ...@stress.invalid.
import { describe, expect, test } from "bun:test";
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
const SETTER = "setter-m1t@stress.invalid";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const APPT = "stress-m1t-appt";

/** A Kuwait wall-clock moment (UTC+3) as an instant. */
const kw = (s: string) => Date.parse(`${s}+03:00`);
const iso = (t: number) => new Date(t).toISOString();
const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The cockpit's own rule for a message that is not a first message: 09:00 to 21:00 on every clock of the lead's. */
const daytime = (country: string, t: number) => hoursRefusal({ segment: "confirm", touch: 2, country, now: t, followups: {} }) === null;
function hourThere(country: string, t: number): string {
  return (leadZones(country) ?? ["Asia/Kuwait"])
    .map(z => new Intl.DateTimeFormat("en-GB", { timeZone: z, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(t))
    .join("/");
}

interface WorldOpts {
  country: string;
  /** The lead's booked intro (its start), or none. */
  intro?: number | null;
  /** The missed call the link follows. */
  rang?: number | null;
  /** WhatsApp gate open (the pilot's later state), or shut (today: email only). */
  gate?: boolean;
  scope?: "intro" | "any";
  /** HighLevel answers the free text "pending" and, read again later, "failed" (a late Meta failure). */
  lateFail?: boolean;
  /** The lead's booked demo (its start, 45 minutes), the setter's own. */
  demo?: number | null;
}

function world(now: number, o: WorldOpts) {
  const w = fakeWorld(now);
  const jobs: Promise<unknown>[] = [];
  const LEAD = `stress-m1t-${o.country.toLowerCase()}-${fakeUuid().slice(-6)}`;
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
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "basic", google_ok: true }]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: iso(now - 5 * S) }]);
  w.db.seed("cockpit_sales_wa_templates", [
    { key: "call_link_ar", active: true, workflow_id: "wf-call-link" },
    { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" },
  ]);
  if (o.intro != null)
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: APPT,
        contact_id: LEAD,
        call_type: "intro",
        status: "confirmed",
        start_at: iso(o.intro),
        end_at: iso(o.intro + 30 * MIN),
        booked_at: iso(o.intro - 3 * DAY),
        assigned_user_id: "G-setter",
        calendar_id: "stress-cal",
      },
    ]);
  if (o.demo != null)
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: `${APPT}-demo`,
        contact_id: LEAD,
        call_type: "demo",
        status: "confirmed",
        start_at: iso(o.demo),
        end_at: iso(o.demo + 45 * MIN),
        booked_at: iso(o.demo - 2 * DAY),
        assigned_user_id: "G-setter",
        calendar_id: "stress-demo-cal",
      },
    ]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, country: o.country, assigned_to: "G-setter" }]);
  // The lead wrote on WhatsApp two hours ago: the free-text window is open.
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: `c-${LEAD}`, contact_id: LEAD, inbound_whatsapp_at: iso(now - 2 * HOUR) }]);
  const attempt = fakeUuid();
  if (o.rang != null)
    w.db.seed("cockpit_sales_attempts", [
      {
        id: attempt,
        contact_id: LEAD,
        rep_email: SETTER,
        appointment_id: o.intro != null ? APPT : null,
        item_kind: o.intro != null ? "intro" : "lead",
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
        contact: { id: LEAD, firstName: "Sam", name: "Sam Lee", phone: "+96550000000", email: `${LEAD}@example.invalid`, tags: ["roas-qualified"], country: o.country },
      };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    if (m === "GET" && /^\/conversations\/messages\//.test(p))
      return { message: { status: o.lateFail ? "failed" : "delivered", meta: { error: "131026 Message undeliverable" } } };
    return null as unknown as Row;
  });
  const sent: { channel: string; at: number; body?: string }[] = [];
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
      sent.push({ channel: String(b.channel), at: w.clock.now, body: b.body });
      const row: Row = {
        id: fakeUuid(),
        request_id: b.request_id,
        contact_id: b.contact_id,
        channel: b.channel,
        body: b.body,
        source: "room",
        state: "sent",
        provider_status: o.lateFail && b.channel === "whatsapp" ? "pending" : "sent",
        ghl_message_id: `m-${fakeUuid().slice(-8)}`,
        created_at: iso(w.clock.now),
      };
      w.db.t("cockpit_sales_messages").push(row);
      return { message: { ...row } };
    },
    sendTemplate: async (_who, t) => {
      sent.push({ channel: "whatsapp_template", at: w.clock.now });
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
  /** The room worker (contract v2 section 7): claims, makes the Meet, stores worker.ready, opens the room. */
  async function workerOpens(id: string, at: number) {
    w.clock.now = at;
    const r = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made on Meet in 4.0 s." },
      prefer: "resolution=ignore-duplicates",
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: MEET_URL,
        provider_meeting_id: "abc-defg-hij",
        opened_at: w.db.iso(),
        host_by: iso(w.clock.now + 15 * MIN),
        ends_at: iso(w.clock.now + 30 * MIN),
        version: Number(room(id).version) + 1,
      },
    });
    await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { provider: "meet", provider_meeting_id: "abc-defg-hij", worker_run: "run-1" } });
    await drain();
  }
  /** Send a video link after the missed call (the dialer's after-miss step), pressed at `at`. */
  async function videoLink(at: number): Promise<{ id: string | null; refused: string | null }> {
    w.clock.now = at;
    try {
      const out = await rooms.actions["room.create"]!(setter, {
        request_id: crypto.randomUUID(),
        contact_id: LEAD,
        purpose: "fallback",
        provider: "meet",
        call_kind: "intro",
        trigger: "no_answer",
        attempt_id: o.rang != null ? attempt : null,
        appointment_id: o.intro != null ? APPT : null,
        item_kind: o.intro != null ? "intro" : "lead",
      });
      return { id: String((out.room as Row).id), refused: null };
    } catch (e) {
      return { id: null, refused: String((e as Error).message) };
    }
  }
  async function status(id: string): Promise<Row> {
    return (await rooms.actions["room.status"]!(setter, { room_id: id })) as Row;
  }
  /** The minute's sweep posts the room to room.event kind tick (the cron door). */
  async function tick(id: string, at: number) {
    w.clock.now = at;
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await drain();
  }
  /** The lead page's video menu: a manual room. */
  async function manualRoom(at: number, provider: "meet" | "zoom" = "meet"): Promise<{ id: string | null; refused: string | null }> {
    w.clock.now = at;
    try {
      const out = await rooms.actions["room.create"]!(setter, { request_id: crypto.randomUUID(), contact_id: LEAD, purpose: "manual", provider, call_kind: "intro", trigger: "manual" });
      return { id: String((out.room as Row).id), refused: null };
    } catch (e) {
      return { id: null, refused: String((e as Error).message) };
    }
  }
  return { ...w, rooms, room, sent, videoLink, workerOpens, status, tick, manualRoom, LEAD };
}

// ---------------------------------------------------------------------------
// 1. The intro the lead booked at 21:00 their time: the room is made, the
//    link is not sent
// ---------------------------------------------------------------------------

describe("Thursday 8 October, 21:00 Kuwait: a Kuwait lead's own intro at 21:00 rings out; Send a video link at 21:00:50", () => {
  const start = kw("2026-10-08T21:00:00");
  test("room.create makes the room for the intro (the booked-intro exception to the night rule)", async () => {
    const w = world(start + 50 * S, { country: "KW", intro: start, rang: start + 5 * S, gate: true });
    const out = await w.videoLink(start + 50 * S);
    expect(out.refused).toBeNull();
    expect(w.room(String(out.id)).appointment_id).toBe(APPT);
  });
  test("the link the room was made for reaches the lead (WhatsApp or email), never a room with no message", async () => {
    const w = world(start + 50 * S, { country: "KW", intro: start, rang: start + 5 * S, gate: true });
    const out = await w.videoLink(start + 50 * S);
    expect(out.refused).toBeNull();
    const id = String(out.id);
    // The Meet is made about 6 seconds after the press's 15-second wait.
    await w.workerOpens(id, w.clock.now + 6 * S);
    const r = w.room(id);
    const line = String(((await w.status(id)).room as Row)?.refusal ?? r.refusal ?? "");
    // Found when it fails: room.create allowed the room at 21:00:50 for the
    // lead's own 21:00 intro, but the link send checks the night again with
    // no exception (rooms.ts sendLink, leadAtNight for every purpose but
    // handover) and writes "It is night where the lead is, so no message
    // went. Read the link out if you are speaking with them." The call did
    // not connect, so there is nobody to read it out to: the lead who booked
    // 21:00 never gets the link, and the setter's room waits 10 minutes empty.
    expect({ state: r.state, sent: w.sent.map(s => s.channel), link_sent_at: r.link_sent_at ?? null, refusal: line || null }).toEqual({
      state: "open",
      sent: [expect.any(String)],
      link_sent_at: expect.any(String),
      refusal: null,
    });
  });
  test("the same with the WhatsApp gate shut (the pilot today): the email goes", async () => {
    const w = world(start + 50 * S, { country: "KW", intro: start, rang: start + 5 * S, gate: false });
    const out = await w.videoLink(start + 50 * S);
    expect(out.refused).toBeNull();
    await w.workerOpens(String(out.id), w.clock.now + 6 * S);
    expect(w.sent.map(s => s.channel)).toEqual(["email"]);
  });
});

describe("Monday 12 October, 20:20 Kuwait: a UAE lead's own intro at 20:20 Kuwait (21:20 in Dubai) rings out; video link at 20:21", () => {
  const start = kw("2026-10-12T20:20:00");
  test("setup: it is after 21:00 in Dubai", () => {
    expect(daytime("AE", start)).toBe(false);
    expect(hourThere("AE", start)).toBe("21:20:00");
  });
  test("the room is made and its link goes to the lead who booked this hour", async () => {
    const w = world(start + MIN, { country: "AE", intro: start, rang: start + 10 * S, gate: true });
    const out = await w.videoLink(start + MIN);
    expect(out.refused).toBeNull();
    await w.workerOpens(String(out.id), w.clock.now + 5 * S);
    expect({ sent: w.sent.length, link_sent_at: w.room(String(out.id)).link_sent_at ?? null }).toEqual({ sent: 1, link_sent_at: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// 2. One second either side of 21:00: the press is day, the send is night
// ---------------------------------------------------------------------------

describe("Thursday 8 October: a manager's scope 'any' pilot; a missed call to a Kuwait lead, Send a video link at 20:59:44", () => {
  const press = kw("2026-10-08T20:59:44");
  test("setup: the press is day on the lead's clock, the worker's open at 21:00:05 is night", () => {
    expect(daytime("KW", press)).toBe(true);
    expect(daytime("KW", kw("2026-10-08T21:00:05"))).toBe(false);
  });
  test("a room made by a press the night rule allowed is not left open with no link and nobody to read it to", async () => {
    const w = world(press, { country: "KW", rang: press - 50 * S, gate: true, scope: "any" });
    const out = await w.videoLink(press);
    expect(out.refused).toBeNull();
    const id = String(out.id);
    await w.workerOpens(id, kw("2026-10-08T21:00:05"));
    const r = w.room(id);
    const st = (await w.status(id)).room as Row;
    // Found when it fails: room.create checked the clock at 20:59:44 and
    // made the room; the link went to send at 21:00:05 and the night check
    // there stopped it ("Read the link out if you are speaking with them").
    // The call did not connect, so the setter holds an open room the lead
    // was never told about, and the lead is held out of the dialer's queue
    // until it closes (dial.queue holds a lead whose room is open).
    expect({
      outcome: w.sent.length ? "link sent" : r.state === "open" || r.state === "host_in" ? "room open, no link" : `room ${r.state}`,
      refusal: st?.refusal ?? r.refusal ?? null,
    }).toEqual({ outcome: "link sent", refusal: null });
  });
  test("the rep's own 'Also send by email' on that open room at 21:01 is refused with 'Call them after 9 in the morning'", async () => {
    const w = world(press, { country: "KW", rang: press - 50 * S, gate: true, scope: "any" });
    const out = await w.videoLink(press);
    const id = String(out.id);
    await w.workerOpens(id, kw("2026-10-08T21:00:05"));
    w.clock.now = kw("2026-10-08T21:01:00");
    const said = await w.rooms.actions["room.send"]!(setter, { room_id: id, request_id: crypto.randomUUID(), channel: "email" }).then(
      () => null,
      e => String((e as Error).message),
    );
    // Recorded, not a separate finding: the same root as the test above
    // (the press was day, every send after it is night).
    expect(said).toBe("It is night where the lead is, so no video link goes now. Call them after 9 in the morning, their time.");
  });
  test("control: pressed at 20:58:30, opened at 20:58:50: the link goes", async () => {
    const w = world(kw("2026-10-08T20:58:30"), { country: "KW", rang: kw("2026-10-08T20:57:40"), gate: true, scope: "any" });
    const out = await w.videoLink(kw("2026-10-08T20:58:30"));
    await w.workerOpens(String(out.id), kw("2026-10-08T20:58:50"));
    expect(w.sent.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. "I can't let them in" a minute after 21:00: the lead is asking to join
//    the Meet now, the Zoom replacement is made, its link never goes
// ---------------------------------------------------------------------------

describe("Thursday 8 October: the 21:00 intro's call rings out at 20:57:10; the Meet link goes at 20:58:20; the lead asks to join at 21:00 and the setter cannot let them in", () => {
  const start = kw("2026-10-08T21:00:00");
  test("the Zoom replacement's link reaches the lead who is at the Meet's door right now", async () => {
    const w = world(kw("2026-10-08T20:58:00"), { country: "KW", intro: start, rang: kw("2026-10-08T20:57:10"), gate: true });
    const out = await w.videoLink(kw("2026-10-08T20:58:00"));
    expect(out.refused).toBeNull();
    const id = String(out.id);
    await w.workerOpens(id, kw("2026-10-08T20:58:20"));
    expect(w.sent.length).toBe(1); // the Meet link went at 20:58:20, day on the lead's clock
    w.clock.now = kw("2026-10-08T20:58:40");
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "host_in" });
    // 21:00:30: the lead is in Meet's "Ask to join"; the setter presses I can't let them in.
    w.clock.now = kw("2026-10-08T21:00:30");
    const ended = (await w.rooms.actions["room.end"]!(setter, { room_id: id, version: Number(w.room(id).version), reason: "admit_blocked" })) as Row;
    const rep = (ended.replacement as Row | undefined) ?? null;
    expect({ refusal: ended.replacement_refusal ?? null, made: Boolean(rep) }).toEqual({ refusal: null, made: true });
    const rid = String(rep?.id);
    await w.workerOpens(rid, w.clock.now + 4 * S);
    const r = w.room(rid);
    // Found when it fails: room.end made the Zoom replacement (createRoom's
    // `replacing` skips the night rule: "the lead is at the door this
    // minute"), but its link goes through sendLink, whose night check spares
    // only handover rooms. The lead who just asked to join the Meet gets no
    // Zoom link, and the setter is told to read it out to a lead who is not
    // on the phone.
    expect({ sent_after_21: w.sent.filter(s => s.at >= start).map(s => s.channel), refusal: r.refusal ?? null }).toEqual({
      sent_after_21: [expect.any(String)],
      refusal: null,
    });
  });
});

// ---------------------------------------------------------------------------
// 4. A late WhatsApp failure read after 21:00: the backup email at night
// ---------------------------------------------------------------------------

describe("Thursday 8 October: the video link goes on WhatsApp at 20:58:20 (day); Meta fails it late; the minute's tick reads the failure at 21:01:30", () => {
  test("setup: the free text went by day", async () => {
    const w = world(kw("2026-10-08T20:58:00"), { country: "KW", rang: kw("2026-10-08T20:57:10"), gate: true, scope: "any", lateFail: true });
    const out = await w.videoLink(kw("2026-10-08T20:58:00"));
    await w.workerOpens(String(out.id), kw("2026-10-08T20:58:20"));
    expect(w.sent.map(s => s.channel)).toEqual(["whatsapp"]);
  });
  test("no message reaches the lead after 21:00 on their clock (sendLink's own rule: no message goes at night, even when night came while the link waited)", async () => {
    const w = world(kw("2026-10-08T20:58:00"), { country: "KW", rang: kw("2026-10-08T20:57:10"), gate: true, scope: "any", lateFail: true });
    const out = await w.videoLink(kw("2026-10-08T20:58:00"));
    const id = String(out.id);
    await w.workerOpens(id, kw("2026-10-08T20:58:20"));
    await w.tick(id, kw("2026-10-08T21:01:30"));
    const atNight = w.sent.filter(s => !daytime("KW", s.at)).map(s => `${s.channel} at ${hourThere("KW", s.at)}`);
    // Found when it fails: recheckLink (the late failure's fallback) emails
    // the link at 21:01:30 with no night check, while every first send of a
    // link (sendLink) and "Also send by email" (room.send) refuse after
    // 21:00 on the lead's clock. For a UAE lead the same email goes up to
    // 15 minutes after a link sent at 20:58 Dubai time.
    expect(atNight).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. The booked demo one second either side of its start
// ---------------------------------------------------------------------------

describe("Tuesday 6 October: the lead's demo is booked at 15:00 (45 minutes, its own Zoom link in HighLevel); a room from the lead page's video menu", () => {
  const demo = kw("2026-10-06T15:00:00");
  test("at 14:59:59 it is refused: 'This lead has a booked demo. Its Zoom link comes from HighLevel, so no new room is made. Call them, or send the demo's own Zoom link from HighLevel.'", async () => {
    const w = world(demo - S, { country: "KW", demo, gate: true });
    const out = await w.manualRoom(demo - S);
    expect(out.refused).toBe("This lead has a booked demo. Its Zoom link comes from HighLevel, so no new room is made. Call them, or send the demo's own Zoom link from HighLevel.");
  });
  test("at 15:00:01, inside the demo's own 45 minutes, it is refused the same way: no second link goes to a lead whose demo is on now", async () => {
    const w = world(demo + S, { country: "KW", demo, gate: true });
    const out = await w.manualRoom(demo + S);
    if (out.id) await w.workerOpens(out.id, w.clock.now + 5 * S);
    // Found when it fails: rooms.ts createRoom reads the booked demo as
    // start_at > now, so at the demo's start the check lets go: from 15:00:01
    // to 15:45 the room is made and its link ("your call with ... is ready
    // now. Join here: ...") goes to the lead, beside the demo's own Zoom
    // link in their calendar invite, in the very minutes they may be
    // waiting in that one.
    expect({ refused: out.refused, sent: w.sent.map(s => s.channel) }).toEqual({
      refused: "This lead has a booked demo. Its Zoom link comes from HighLevel, so no new room is made. Call them, or send the demo's own Zoom link from HighLevel.",
      sent: [],
    });
  });
});
