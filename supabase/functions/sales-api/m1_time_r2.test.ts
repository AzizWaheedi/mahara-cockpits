// bun test supabase/functions/sales-api/m1_time_r2.test.ts
//
// Milestone 1, video-link round 2, the TIME angle: every deadline one second
// either side, the lead's night (Kuwait and UAE), a booked intro near the
// room. The pilot settings (m1-scope.md section 3): rooms on, both providers,
// every send channel on, test_only with the lead as the test contact,
// short_link off, count_on_join, settle, wrap and auto_on_miss off,
// live.enabled off, followups.agent off; fallback.scope "intro" as shipped,
// or "any" where a manager set it (m1-scope.md allows it).
//
// Each test drives sales-api's own actions (room.create, room.mark, room.end,
// room.event worker.ready and tick) on testfakes.ts with a clock only the
// test moves. The SQL sweep's close is written as cockpit_sales_rooms_close
// writes it (state, end_reason, result, the sweep's line). A failing test is
// a finding. Every lead is invented (stress-m1t2-...), every seat is
// ...@stress.invalid.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON, LANE_COPY } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { hoursRefusal, leadZones } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SETTER = "setter-m1t2@stress.invalid";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const APPT = "stress-m1t2-appt";

/** A Kuwait wall-clock moment (UTC+3) as an instant. */
const kw = (s: string) => Date.parse(`${s}+03:00`);
const iso = (t: number) => new Date(t).toISOString();
const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The cockpit's rule for a message that is not a first message: 09:00 to 21:00 on every clock of the lead's. */
const daytime = (country: string, t: number) => hoursRefusal({ segment: "confirm", touch: 2, country, now: t, followups: {} }) === null;
function hourThere(country: string, t: number): string {
  return (leadZones(country) ?? ["Asia/Kuwait"])
    .map(z => new Intl.DateTimeFormat("en-GB", { timeZone: z, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(t))
    .join("/");
}

interface WorldOpts {
  country: string;
  scope?: "intro" | "any";
  /** WhatsApp gate open (the pilot's later state), or shut (today: email only). */
  gate?: boolean;
  /** The lead's booked intro (its start), the setter's own. */
  intro?: number | null;
  /** Another lead's intro, also the setter's own (a booked call near the room). */
  otherIntro?: number | null;
  /** The missed call the link follows. */
  rang?: number | null;
}

function world(now: number, o: WorldOpts) {
  const w = fakeWorld(now);
  const jobs: Promise<unknown>[] = [];
  const LEAD = `stress-m1t2-${o.country.toLowerCase()}-${fakeUuid().slice(-6)}`;
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
  if (o.otherIntro != null)
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: `${APPT}-other`,
        contact_id: `${LEAD}-other`,
        call_type: "intro",
        status: "confirmed",
        start_at: iso(o.otherIntro),
        end_at: iso(o.otherIntro + 30 * MIN),
        booked_at: iso(o.otherIntro - 2 * DAY),
        assigned_user_id: "G-setter",
        calendar_id: "stress-cal",
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
        contact: { id: LEAD, firstName: "Sam", name: "Sam Lee", phone: "+97150000000", email: `${LEAD}@example.invalid`, tags: ["roas-qualified"], country: o.country },
      };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    if (m === "GET" && /^\/conversations\/messages\//.test(p)) return { message: { status: "delivered" } };
    return null as unknown as Row;
  });
  const sent: { channel: string; at: number; body: string; room: string | null }[] = [];
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
      sent.push({ channel: String(b.channel), at: w.clock.now, body: String(b.body ?? ""), room: null });
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
      sent.push({ channel: "whatsapp_template", at: w.clock.now, body: "", room: null });
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
  /** The room worker writes its status row every 25 s while it runs (desk rooms.py STATUS_EVERY). */
  function heartbeat(at: number) {
    for (const r of w.db.t("cockpit_sales_worker_status")) if (r.job === "rooms") r.at = iso(at - 5 * S);
  }
  /** room.end as the panel sends it, with the version the panel showed. */
  async function end(id: string, at: number, version: number, reason: string): Promise<Row> {
    w.clock.now = at;
    heartbeat(at);
    const out = (await rooms.actions["room.end"]!(setter, { room_id: id, version, reason })) as Row;
    await drain();
    return out;
  }
  let meetings = 0;
  /** The room worker (contract v2 section 7): claims, makes the meeting, stores worker.ready, opens the room. */
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
    for (const s of sent) if (s.room === null) s.room = id;
  }
  /** room.create as the dialer's after-miss step (fallback) or the lead page's video menu (manual) sends it. */
  async function create(
    at: number,
    ask: { purpose: "fallback" | "manual"; provider?: "meet" | "zoom"; trigger?: string; attempt?: boolean; extra?: Row },
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
        trigger: ask.trigger ?? (ask.purpose === "manual" ? "manual" : "no_answer"),
        ...(ask.attempt && o.rang != null ? { attempt_id: attempt } : {}),
        ...(ask.purpose === "fallback" && o.intro != null ? { appointment_id: APPT, item_kind: "intro" } : {}),
        ...(ask.purpose === "fallback" && o.intro == null ? { item_kind: "lead" } : {}),
        ...(ask.extra ?? {}),
      });
      return { id: String((out.room as Row).id), refused: null, code: null };
    } catch (e) {
      return { id: null, refused: String((e as Error).message), code: String((e as { code?: unknown }).code ?? "") };
    }
  }
  async function mark(id: string, at: number, what: "host_in" | "lead_in") {
    w.clock.now = at;
    await rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(room(id).version), what });
    await drain();
  }
  /** The SQL sweep's close, as cockpit_sales_rooms_close writes it (R4: the lead did not join by lead_by). */
  async function sweepCloses(id: string, at: number, rule = "lead_no_show") {
    w.clock.now = at;
    const r = room(id);
    const moved = await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=in.(open,host_in)`, {
      method: "PATCH",
      body: { state: "expired", end_reason: rule, result: "no_join", ended_at: iso(at), version: Number(r.version) + 1 },
      prefer: "return=representation",
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: `sweep.${rule}`, source: "sweep", dedupe_key: `sweep:${id}:${rule}`, handled_at: iso(at), text: "Closed: the lead did not join in 10 minutes." },
      prefer: "resolution=ignore-duplicates",
    });
    return moved.length;
  }
  /** The minute's sweep posts the room to room.event kind tick (the cron door). */
  async function tick(id: string, at: number) {
    w.clock.now = at;
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await drain();
  }
  return { ...w, rooms, room, sent, workerOpens, create, mark, end, sweepCloses, tick, drain, LEAD, attempt };
}

// ---------------------------------------------------------------------------
// 1. "I can't let them in" one second after the sweep closed the Meet room
// ---------------------------------------------------------------------------
//
// A Meet room has no knock signal (Meet joins are the rep's press), so R4
// closes it at lead_by to the second's minute, with no open grace. The lead
// opens the Meet link at the end of their ten minutes and asks to join; the
// setter cannot admit them and presses "I can't let them in", which the panel
// holds five seconds behind its Undo (lib/rooms.ts needsUndo). The minute's
// sweep lands inside those five seconds.

describe("Thursday 8 October, a UAE lead (scope any): the Meet link at 19:50:50 Kuwait (20:50:50 Dubai); the lead asks to join at 20:00:45 Kuwait; I can't let them in", () => {
  const press = kw("2026-10-08T19:50:00");
  const opened = kw("2026-10-08T19:50:50");
  const sweep = kw("2026-10-08T20:01:00"); // lead_by 20:00:50 Kuwait; the sweep's next minute closes the room

  async function setup() {
    const w = world(press, { country: "AE", scope: "any", gate: true, rang: press - 50 * S });
    const out = await w.create(press, { purpose: "fallback", attempt: true });
    expect(out.refused).toBeNull();
    const id = String(out.id);
    await w.workerOpens(id, opened);
    await w.mark(id, opened + 20 * S, "host_in");
    return { w, id };
  }

  test("setup: the link went by day on the lead's clock; lead_by is 21:00:50 in Dubai, night", async () => {
    const { w, id } = await setup();
    expect(w.sent.length).toBe(1);
    expect(daytime("AE", opened)).toBe(true);
    expect(hourThere("AE", Date.parse(String(w.room(id).lead_by)))).toBe("21:00:50");
    expect(daytime("AE", sweep)).toBe(false);
  });

  test("control: the press lands at 20:00:59 Kuwait (room still open): the Zoom replacement is made and its 'moved' link goes at night", async () => {
    const { w, id } = await setup();
    const ended = await w.end(id, kw("2026-10-08T20:00:59"), Number(w.room(id).version), "admit_blocked");
    const rep = ended.replacement as Row | undefined;
    expect(Boolean(rep)).toBe(true);
    await w.workerOpens(String(rep?.id), w.clock.now + 6 * S);
    const second = w.sent.filter(s => s.room === String(rep?.id));
    expect(second.length).toBe(1);
    expect(second[0]?.body).toContain("would not let you in");
  });

  test("the same press, landing at 20:01:02 (two seconds after the sweep closed the room), still moves the lead to Zoom or says why not", async () => {
    const { w, id } = await setup();
    const v = Number(w.room(id).version); // the version the panel showed when the setter pressed
    expect(await w.sweepCloses(id, sweep)).toBe(1);
    const ended = await w.end(id, sweep + 2 * S, v, "admit_blocked");
    // Found when it fails: room.end applies `end` to a final room as a
    // no-op (roomlogic applyRoomEvent: isFinal → same), so the answer has
    // neither `replacement` nor `replacement_refusal`. The panel then reads
    // it as "make it yourself" (lib/rooms.ts afterAdmitBlocked → {kind:
    // "make"}) and RoomPanel.tsx retry() sends a fresh room.create: a
    // plain fallback room, not the replacement (next test).
    expect({ replacement: Boolean(ended.replacement), said: Boolean(ended.replacement_refusal) }).toEqual({
      replacement: true,
      said: false,
    });
  });

  test("what the panel then does (RoomPanel.tsx retry → room.create with retryRequest's fields) reaches the lead at the door", async () => {
    const { w, id } = await setup();
    const v = Number(w.room(id).version);
    await w.sweepCloses(id, sweep);
    const ended = await w.end(id, sweep + 2 * S, v, "admit_blocked");
    let refused: string | null = null;
    if (!ended.replacement && !ended.replacement_refusal) {
      // lib/rooms.ts retryRequest(room, firstAsk, "zoom"): the closed room's
      // lead, kind and purpose, its trigger and attempt.
      const r = w.room(id);
      const made = await w.create(sweep + 3 * S, {
        purpose: "fallback",
        provider: "zoom",
        trigger: String(r.trigger),
        attempt: true,
      });
      refused = made.refused;
      if (made.id) await w.workerOpens(made.id, sweep + 9 * S);
    } else if (ended.replacement) {
      // The server's own replacement (round 2's fix): the worker opens it.
      await w.workerOpens(String((ended.replacement as Row).id), sweep + 9 * S);
    }
    const toDoor = w.sent.filter(s => s.at >= sweep);
    // Found when it fails: the fresh room.create is not a replacement (no
    // `replacing`, no night_cleared), so at 21:01 in Dubai it is refused
    // with "It is night where the lead is, so no video link goes now. Call
    // them after 9 in the morning, their time." while the lead is at the
    // Meet's door this minute. Three seconds earlier the server's own
    // replacement went (control above).
    expect({ refused, links_after_close: toDoor.length }).toEqual({ refused: null, links_after_close: 1 });
  });
});

describe("Thursday 8 October, the pilot's own path: the test contact's lead page Meet room (manual) for a UAE lead at 19:50:50 Kuwait; I can't let them in lands after the close", () => {
  const press = kw("2026-10-08T19:50:00");
  const opened = kw("2026-10-08T19:50:50");
  const sweep = kw("2026-10-08T20:01:00");
  test("the lead at the Meet door gets the Zoom link (the server's replacement path sends it at night: night_cleared 'replacing')", async () => {
    const w = world(press, { country: "AE", gate: true });
    const out = await w.create(press, { purpose: "manual" });
    expect(out.refused).toBeNull();
    const id = String(out.id);
    await w.workerOpens(id, opened);
    expect(w.sent.length).toBe(1); // day in Dubai at 20:50:50
    await w.mark(id, opened + 20 * S, "host_in");
    const v = Number(w.room(id).version);
    await w.sweepCloses(id, sweep);
    const ended = await w.end(id, sweep + 2 * S, v, "admit_blocked");
    let line: string | null = null;
    if (!ended.replacement && !ended.replacement_refusal) {
      const made = await w.create(sweep + 3 * S, { purpose: "manual", provider: "zoom" });
      if (made.id) {
        await w.workerOpens(made.id, sweep + 9 * S);
        line = String(w.room(made.id).refusal ?? "") || null;
      } else line = made.refused;
    } else if (ended.replacement) {
      // The server's own replacement (round 2's fix): the worker opens it.
      const rid = String((ended.replacement as Row).id);
      await w.workerOpens(rid, sweep + 9 * S);
      line = String(w.room(rid).refusal ?? "") || null;
    }
    const toDoor = w.sent.filter(s => s.at >= sweep);
    // Found when it fails: the panel's own room.create makes a manual Zoom
    // room, and its link is held by the night rule (nightHolds: not
    // night_cleared, pressed at night): "It is night where the lead is, so
    // no message went. Read the link out if you are speaking with them." The
    // lead is in Meet's "Ask to join", not on the phone.
    expect({ links_after_close: toDoor.length, line }).toEqual({ links_after_close: 1, line: null });
  });
});

describe("Tuesday 6 October, by day: the same press two seconds after the close (Kuwait lead, scope any)", () => {
  const press = kw("2026-10-06T14:00:00");
  const opened = kw("2026-10-06T14:00:50");
  const sweep = kw("2026-10-06T14:11:00");
  test("the lead at the door is told the call moved to Zoom, never the missed-call opening again", async () => {
    const w = world(press, { country: "KW", scope: "any", gate: true, rang: press - 50 * S });
    const out = await w.create(press, { purpose: "fallback", attempt: true });
    const id = String(out.id);
    await w.workerOpens(id, opened);
    await w.mark(id, opened + 20 * S, "host_in");
    const v = Number(w.room(id).version);
    await w.sweepCloses(id, sweep);
    const ended = await w.end(id, sweep + 2 * S, v, "admit_blocked");
    if (!ended.replacement && !ended.replacement_refusal) {
      const r = w.room(id);
      const made = await w.create(sweep + 3 * S, { purpose: "fallback", provider: "zoom", trigger: String(r.trigger), attempt: true });
      if (made.id) await w.workerOpens(made.id, sweep + 9 * S);
    } else if (ended.replacement) {
      // The server's own replacement (round 2's fix): the worker opens it.
      await w.workerOpens(String((ended.replacement as Row).id), sweep + 9 * S);
    }
    const second = w.sent.filter(s => s.at >= sweep);
    // Found when it fails: by day the panel's fresh room goes, but as a new
    // missed-call room: "I tried to call you just now and couldn't get
    // through. If you have 15 minutes, we can talk on video now: ..." to a
    // lead who is at the Meet's door (the closed room stays lead_no_show,
    // no_join: the knock is nowhere on the record).
    expect(second.map(s => (s.body.includes("would not let you in") ? "moved" : s.body.slice(0, 60)))).toEqual(["moved"]);
  });
});

// ---------------------------------------------------------------------------
// 2. A booked intro near the room: the sweep's tick alerts with P2's words
// ---------------------------------------------------------------------------

describe("Monday 12 October: the setter's own intro with another lead at 15:30; a video link to this lead at 15:21 after a missed call", () => {
  const press = kw("2026-10-12T15:21:00");
  test("the tick inside booked_guard says something true for a setter's own room, or nothing (P1 posts nothing to Slack)", async () => {
    const w = world(press, { country: "KW", scope: "any", gate: true, rang: press - 40 * S, otherIntro: kw("2026-10-12T15:30:00") });
    const out = await w.create(press, { purpose: "fallback", attempt: true });
    expect(out.refused).toBeNull();
    const id = String(out.id);
    await w.workerOpens(id, press + 6 * S);
    await w.mark(id, press + 30 * S, "host_in");
    await w.tick(id, kw("2026-10-12T15:22:00"));
    const alerts = w.db.t("cockpit_sales_alerts").filter(a => String(a.kind) === "room_booked_guard");
    // Found when it fails: roomlogic tick() raises the booked_guard alert
    // for any room with a lead within 10 minutes of the host's next booked
    // call, and rooms.ts alertSet words it as P2's closer line: "Room
    // {code}: the host's booked call is near and this room still has a lead
    // in it or waiting. Tell the setter if cover is needed." Here the host
    // IS the setter, waiting on a missed call's link that closes at 15:31.
    // The watchdog posts it to the sales alerts Slack hook in working hours
    // (final_spec_p1.md: "P1 posts nothing to Slack"), one per room per
    // booked call, resolved only three days later (watchdog 2d).
    expect(alerts.map(a => String(a.message)).filter(m => /Tell the setter/.test(m))).toEqual([]);
  });
});

describe("Monday 12 October: the same room near the setter's 15:30 intro closes at 15:31 with nobody in it", () => {
  const press = kw("2026-10-12T15:21:00");
  test("its 'this room still has a lead in it or waiting' alert does not stay open once the room has closed", async () => {
    const w = world(press, { country: "KW", scope: "any", gate: true, rang: press - 40 * S, otherIntro: kw("2026-10-12T15:30:00") });
    const out = await w.create(press, { purpose: "fallback", attempt: true });
    const id = String(out.id);
    await w.workerOpens(id, press + 6 * S);
    await w.mark(id, press + 30 * S, "host_in");
    await w.tick(id, kw("2026-10-12T15:22:00"));
    // Round 2's fix raises none for a setter's own room (the test above); the
    // alert a handover room or an earlier build raised is seeded, so its
    // resolution on close is still read.
    expect(w.db.t("cockpit_sales_alerts").filter(a => String(a.kind) === "room_booked_guard").length).toBe(0);
    w.db.seed("cockpit_sales_alerts", [
      {
        id: fakeUuid(),
        dedupe_key: `room:${id}:booked_guard:${iso(kw("2026-10-12T15:30:00"))}`,
        kind: "room_booked_guard",
        subject: "Room",
        message: "Room: the host's booked call is near and this room still has a lead in it or waiting.",
        raised_at: iso(kw("2026-10-12T15:22:00")),
      },
    ]);
    await w.sweepCloses(id, kw("2026-10-12T15:32:00"));
    // The sweep's T list still posts a closed room for an hour only when a
    // join or an undo is in it; a later tick of the closed room is the most
    // sales-api ever sees of it.
    await w.tick(id, kw("2026-10-12T15:33:00"));
    const open = w.db.t("cockpit_sales_alerts").filter(a => String(a.kind) === "room_booked_guard" && !a.resolved_at);
    // Found when it fails: nothing resolves a room_booked_guard alert
    // (rooms.ts resolveAlerts is never called with it; the watchdog's 2d
    // resolves room:% alerts only three days after they were raised), so the
    // Team page's open alerts and the Slack post keep saying the room "still
    // has a lead in it or waiting" for three days after it closed empty.
    expect(open.length).toBe(0);
  });
});
