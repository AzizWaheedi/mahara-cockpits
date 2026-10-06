// bun test supabase/functions/sales-api/m1_concurrency_r6.test.ts
//
// Milestone 1 (the video link when a call fails), video-link round 6, angle:
// concurrency and idempotency on the video-link path, with the pilot's
// settings (m1-scope.md section 3): rooms on, both providers, the three
// lanes on, test_only with the lead on the test list, count_on_join, settle,
// wrap and auto_on_miss off, short_link off, live handover off. The
// WhatsApp gate is locked (connector_off false), so the link goes by email,
// as it will at the pilot's start.
//
// What is new in this round: the minute's tick that closes a room for an
// answered call (round 5's closeForPhoneCall) racing the host and the lead
// who are coming into that room; and the presses and the sweep around it.
//
// A failing test is a finding. Nothing here reaches HighLevel, Zoom, Google
// or Slack; every lead and seat is invented (stress-..., @stress.invalid).
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "stress-m1c6-setter@stress.invalid";
const CLOSER = "stress-m1c6-closer@stress.invalid";
const LEAD = "stress-m1c6-lead";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/85012345678?pwd=stress";
const LIVE = ["requested", "creating", "open", "host_in", "lead_in"];

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const turn = () => new Promise<void>(r => setTimeout(r, 0));
const turns = async (n: number) => {
  for (let i = 0; i < n; i++) await turn();
};

type Lane = "text" | "template" | "email";

function world(o: { wa?: boolean; scope?: "intro" | "any" } = {}) {
  const w = fakeWorld();
  const rows = new Map<string, Row>();
  const delivered: { lane: Lane; requestId: string; at: number; body: string }[] = [];
  const audits: Row[] = [];
  /** Runs after HighLevel took a message and before the message service answers (its read-back of the status). */
  const hooks: { afterTook: ((lane: Lane) => Promise<void>) | null } = { afterTook: null };
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
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: o.scope ?? "any", auto_on_miss: false },
      },
    },
    { key: "live", value: { enabled: false, slack: false, standby: true } },
    {
      key: "whatsapp_guard",
      value: o.wa
        ? { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 }
        : { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 },
    },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true },
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
  ]);
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - HOUR).toISOString() }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW" }]);
  // 10:00 in Kuwait: daytime on the lead's clock.
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" };
  w.routes.push((m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    return null as unknown as Row;
  });
  const at = () => new Date(w.clock.now).toISOString();
  async function send(lane: Lane, requestId: string, contactId: string, channel: "whatsapp" | "email", body: string, extra: Row, beforeSend?: () => Promise<boolean>) {
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    if (beforeSend && !(await beforeSend())) {
      rows.delete(requestId);
      w.db.t("cockpit_sales_messages").splice(w.db.t("cockpit_sales_messages").indexOf(row), 1);
      throw new ApiRefusal("Not sent: the room closed before the link went.", 409, { code: "stopped", certain: true });
    }
    row.ghl_asked_at = at();
    delivered.push({ lane, requestId, at: w.clock.now, body });
    if (hooks.afterTook) {
      const h = hooks.afterTook;
      hooks.afterTook = null;
      await h(lane);
    }
    row.state = "sent";
    row.provider_status = lane === "template" ? "delivered" : "sent";
    row.ghl_message_id = `msg-${String(row.id).slice(-6)}`;
    return { message: { ...row } };
  }
  /** Network latency on one kind of write: turns to wait before a room.end timeline line is stored. */
  const lag = { endLine: 0 };
  const io: LiveIO = {
    ...w.io,
    db: async (path, init) => {
      const body = init?.body as Row | undefined;
      if (lag.endLine && init?.method === "POST" && path.startsWith("cockpit_sales_room_events") && String(body?.dedupe_key ?? "").startsWith("room.end:"))
        await turns(lag.endLine);
      return await w.io.db(path, init);
    },
    sleep: async ms => {
      w.clock.now += ms;
      await turn();
    },
  };
  const deps: RoomDeps = {
    io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({ crm: "written" }),
    sendText: (_who, b, opts) =>
      send(b.channel === "email" ? "email" : "text", b.request_id, b.contact_id, b.channel, b.body, { subject: b.subject ?? null }, opts?.beforeSend),
    sendTemplate: (_who, t) =>
      send("template", t.requestId, t.contactId, "whatsapp", `Your Mahara call is ready. Join here: ${t.buttonVariable?.join_code ?? ""}`, {
        template_key: t.key,
        via: "workflow",
      }, t.beforeSend),
    upcoming: async () => null,
    sentSince: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  const lines = (id: string, kind?: string) => w.db.t("cockpit_sales_room_events").filter(e => e.room_id === id && (!kind || e.kind === kind));
  const audit = (action: string, id?: string) => audits.filter(a => a.action === action && (!id || a.entityId === id));

  async function claim(id: string, run = "run-1") {
    await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: run, version: Number(room(id).version) + 1 },
    });
  }
  async function open(id: string, run = "run-1") {
    const r = room(id);
    const url = r.provider === "zoom" ? ZOOM_URL : MEET_URL;
    await w.db.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: run }, text: "Room made." },
      prefer: "resolution=ignore-duplicates",
    });
    const out = await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.${run}`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: url,
        provider_meeting_id: r.provider === "zoom" ? "85012345678" : `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(r.version) + 1,
      },
      prefer: "return=representation",
    });
    return out.length > 0;
  }
  async function ready(id: string, run = "run-1") {
    return await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: run } });
  }
  async function tick(...ids: string[]) {
    return await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: ids } });
  }
  async function drain() {
    for (let i = 0; i < 8; i++) {
      await turns(3);
      await w.flush();
    }
  }
  function workerBeside(wo: { ready?: boolean } = {}) {
    let stop = false;
    const done = (async () => {
      for (let i = 0; i < 400 && !stop; i++) {
        await turn();
        const r = w.db.t("cockpit_sales_rooms").find(x => x.state === "requested");
        if (!r) continue;
        const id = String(r.id);
        await claim(id);
        if ((await open(id)) && wo.ready !== false) await ready(id);
      }
    })();
    return {
      stop: async () => {
        stop = true;
        await done;
      },
    };
  }
  async function create(who: Who, b: Row) {
    return await rooms.actions["room.create"]!(who, {
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
      ...b,
      request_id: (b.request_id as string | undefined) ?? crypto.randomUUID(),
    });
  }
  async function made(who: Who = setter, b: Row = {}, wo: { ready?: boolean } = {}): Promise<string> {
    const worker = workerBeside(wo);
    const out = await create(who, b);
    await worker.stop();
    return String((out.room as Row).id);
  }
  /** One Zoom event as the door stores it (source zoom, the trimmed payload), not forwarded yet. */
  function zoomStored(id: string, event: string, zo: { at: number; participant?: Row }): string {
    const r = room(id);
    const meeting = String(r.provider_meeting_id);
    const evId = fakeUuid();
    w.db.seed("cockpit_sales_room_events", [
      {
        id: evId,
        room_id: id,
        kind: `zoom.${event}`,
        source: "zoom",
        dedupe_key: `zoom:${event}:${meeting}:${zo.at}:${evId}`,
        at: new Date(zo.at).toISOString(),
        text: `Zoom: ${event}.`,
        detail: {
          event,
          event_ts: zo.at,
          payload: {
            object: {
              id: meeting,
              uuid: `uuid-${meeting}`,
              host_id: "Z-closer",
              topic: `Mahara call ${String(r.code)}`,
              ...(zo.participant ? { participant: zo.participant } : {}),
            },
          },
        },
      },
    ]);
    return evId;
  }
  async function forward(evId: string, event: string) {
    return await rooms.desk["room.event"]!(desk, { kind: `zoom.${event}`, event_id: evId });
  }
  /**
   * The dialer's record of a call to the lead (cockpit_sales_attempts), as
   * Maqsam's sync leaves it, saved by the rep (a talk saved as Call back)
   * unless `saved` is false (round 6's fix: only a saved talk closes a room).
   */
  function called(rep: string, startedAt: number, o2: { state?: string; seconds?: number; outcome?: string | null; saved?: boolean } = {}) {
    const saved = o2.saved !== false;
    w.db.seed("cockpit_sales_attempts", [
      {
        id: crypto.randomUUID(),
        contact_id: LEAD,
        rep_email: rep,
        started_at: new Date(startedAt).toISOString(),
        state: saved ? "saved" : "placed",
        call_state: o2.state ?? "completed",
        call_duration_s: o2.seconds ?? 120,
        outcome: o2.outcome === undefined ? (saved ? "callback" : null) : o2.outcome,
      },
    ]);
  }
  /**
   * The SQL sweep's R4 (20261004a) for one room, as cockpit_sales_rooms_sweep
   * decides it: open or host_in with a lead, due = lead_by (or the link + the
   * lead's wait), held by an open or a knock in the last open_grace; past
   * due, closed expired lead_no_show (cockpit_sales_rooms_close: state,
   * end_reason, result no_join).
   */
  function sweepR4(id: string): boolean {
    const r = room(id);
    if (!["open", "host_in"].includes(String(r.state)) || !r.contact_id) return false;
    const t = (v: unknown) => (v ? Date.parse(String(v)) : Number.NaN);
    const lead = Number.isFinite(t(r.lead_by)) ? t(r.lead_by) : t(r.link_sent_at) + 10 * MIN;
    const knock = Number.isFinite(t(r.lead_waiting_at)) ? t(r.lead_waiting_at) + 3 * MIN : Number.NEGATIVE_INFINITY;
    const open = Number.isFinite(t(r.first_open_at)) ? t(r.first_open_at) + 3 * MIN : Number.NEGATIVE_INFINITY;
    const due = Math.max(lead, knock, open);
    if (!(due < w.clock.now)) return false;
    Object.assign(r, { state: "expired", end_reason: "lead_no_show", result: r.result ?? "no_join", ended_at: w.db.iso(), version: Number(r.version) + 1 });
    return true;
  }
  return {
    ...w,
    io,
    rows,
    delivered,
    audits,
    hooks,
    sweepR4,
    lag,
    rooms,
    room,
    lines,
    audit,
    claim,
    open,
    ready,
    tick,
    drain,
    workerBeside,
    create,
    made,
    zoomStored,
    forward,
    called,
  };
}

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}

/** The closer's own Zoom user joining on one device. */
const hostJoin = (t: number) => ({
  id: "Z-closer",
  user_id: "16001",
  participant_uuid: "puuid-host-laptop",
  user_name: "Omar Closer",
  email: CLOSER,
  join_time: new Date(t).toISOString(),
});
/** The lead in Zoom's waiting room (no join time; the event's own time). */
const leadKnock = (t: number) => ({
  id: "",
  user_id: "16790",
  participant_uuid: "puuid-lead-1",
  user_name: "Huda Ali",
  date_time: new Date(t).toISOString(),
});

// ---------------------------------------------------------------------------
// The minute's tick closes the room for an answered call while the host and
// the lead are coming into it
// ---------------------------------------------------------------------------

describe("m1 concurrency r6: the minute's tick reads an answered call while the host and the lead come into the room", () => {
  test("control: the closer rang the lead after the link, they talked, and nobody came to the room: the tick closes it as moved to the phone", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo" });
    await w.drain();
    expect(w.room(id).link_sent_at).toBeTruthy();
    const t0 = w.clock.now;
    // 10:01 the closer rings the lead again; she answers and they talk two minutes.
    w.called(CLOSER, t0 + MIN, { seconds: 120 });
    w.clock.now = t0 + 4 * MIN;
    await w.tick(id);
    await w.drain();
    expect({ state: w.room(id).state, result: w.room(id).result }).toEqual({ state: "cancelled", result: "moved_to_phone" });
  });

  test("m1-conc-r6-answered-recall-tick-closes-zoom-room-host-in-lead-knocking: the closer rang the lead after the link and they agreed on the phone to move to the Zoom demo (screen share); the call ended at 10:03, the closer joined the Zoom at 10:03:30 and the lead is in the waiting room at 10:03:40; the minute's tick at 10:04 must not close that room as moved to the phone (the worker then ends and deletes the meeting with the lead at its door)", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo" });
    await w.drain();
    expect(w.room(id).link_sent_at).toBeTruthy();
    const t0 = w.clock.now;
    w.called(CLOSER, t0 + MIN, { seconds: 120 });
    // 10:03:30 Zoom: the closer joins the meeting.
    w.clock.now = t0 + 3 * MIN + 30 * S;
    const h = w.zoomStored(id, "meeting.participant_joined", { at: w.clock.now, participant: hostJoin(w.clock.now) });
    await w.forward(h, "meeting.participant_joined");
    // 10:03:40 Zoom: the lead lands in the waiting room.
    w.clock.now = t0 + 3 * MIN + 40 * S;
    const k = w.zoomStored(id, "meeting.participant_joined_waiting_room", { at: w.clock.now, participant: leadKnock(w.clock.now) });
    await w.forward(k, "meeting.participant_joined_waiting_room");
    await w.drain();
    const before = { state: w.room(id).state, knock: Boolean(w.room(id).lead_waiting_at) };
    // 10:04 the minute's tick.
    w.clock.now = t0 + 4 * MIN;
    await w.tick(id);
    await w.drain();
    expect({ before, after: { state: w.room(id).state, result: w.room(id).result ?? null } }).toEqual({
      before: { state: "host_in", knock: true },
      after: { state: "host_in", result: null },
    });
  });

  test("m1-conc-r6-answered-recall-tick-closes-zoom-room-host-in-lead-knocking (Meet): the setter rang the lead after the link, they agreed to talk on video, the setter pressed I'm in the room after the call and waits for her: the minute's tick must not close the room the setter sits in as moved to the phone", async () => {
    const w = world();
    const id = await w.made(setter, { provider: "meet", call_kind: "intro", purpose: "fallback" });
    await w.drain();
    expect(w.room(id).link_sent_at).toBeTruthy();
    const t0 = w.clock.now;
    w.called(SETTER, t0 + MIN, { seconds: 90 });
    // 10:03 the call is over; the setter presses I'm in the room.
    w.clock.now = t0 + 3 * MIN;
    const v = Number(w.room(id).version);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "host_in" });
    expect(w.room(id).state).toBe("host_in");
    // 10:04 the minute's tick, as the lead opens the link.
    w.clock.now = t0 + 4 * MIN;
    await w.tick(id);
    await w.drain();
    const panel = (await w.rooms.actions["room.status"]!(setter, { room_id: id })) as Row;
    expect({ state: w.room(id).state, panel_state: (panel.room as Row).state }).toEqual({ state: "host_in", panel_state: "host_in" });
  });
});

describe("m1 concurrency r6: the minute's tick reads the call the panel asked for", () => {
  test("m1-conc-r6-answered-recall-tick-closes-zoom-room-host-in-lead-knocking (read the link out): the setter's Meet link bounced and the panel said 'The email bounced. Read the link out.'; the setter rang the lead and read it out (answered, 90 s); the lead is typing the link in as the minute's tick lands: the room must stay open for her, never closed as moved to the phone", async () => {
    const w = world();
    const id = await w.made(setter, { provider: "meet", call_kind: "intro", purpose: "fallback" });
    await w.drain();
    expect(w.room(id).link_sent_at).toBeTruthy();
    const t0 = w.clock.now;
    // The panel's instruction after the link could not reach her: read it out.
    await w.db.db(`cockpit_sales_room_events`, {
      method: "POST",
      body: { room_id: id, kind: "link.failed_late", source: "sales-api", dedupe_key: `link.failed_late:${id}:email`, handled_at: w.db.iso(), text: "The email bounced. Read the link out.", detail: { channel: "email" } },
    });
    w.called(SETTER, t0 + MIN, { seconds: 90 });
    w.clock.now = t0 + 3 * MIN;
    await w.tick(id);
    await w.drain();
    expect({ state: w.room(id).state, result: w.room(id).result ?? null }).toEqual({ state: "open", result: null });
  });

  test("m1-conc-r6-recall-voicemail-closes-room-before-outcome-saved: the setter rang the lead again two minutes after the link; it went to voicemail and the setter left a message about the link (Maqsam: completed, 75 s); the dialer's poll writes Maqsam's record as the setter types the note, and the minute's tick lands before the setter saves No answer: the room must not be closed as moved to the phone on a call nobody answered", async () => {
    const w = world();
    const id = await w.made(setter, { provider: "meet", call_kind: "intro", purpose: "fallback" });
    await w.drain();
    expect(w.room(id).link_sent_at).toBeTruthy();
    const t0 = w.clock.now;
    // 10:02 the call; Maqsam's record lands through dial.status at 10:03:15 (completed, 75 s); the outcome is not saved yet.
    w.called(SETTER, t0 + 2 * MIN, { seconds: 75, outcome: null, saved: false });
    w.clock.now = t0 + 3 * MIN + 20 * S;
    await w.tick(id);
    await w.drain();
    const atTick = { state: w.room(id).state, result: w.room(id).result ?? null };
    // 10:03:30 the setter saves No answer.
    const a = w.db.t("cockpit_sales_attempts")[0] as Row;
    a.outcome = "no_answer";
    a.state = "saved";
    expect(atTick).toEqual({ state: "open", result: null });
  });
});

describe("m1 concurrency r6: Also send by email in the last seconds of the lead's ten minutes, beside the sweep's R4", () => {
  test("control: the email pressed with a minute left: the room waits ten minutes from the email", async () => {
    const w = world({ wa: true });
    const id = await w.made(setter, { provider: "meet", call_kind: "intro", purpose: "fallback" });
    await w.drain();
    const sent = Date.parse(String(w.room(id).link_sent_at));
    w.clock.now = sent + 9 * MIN;
    await w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() });
    await w.drain();
    w.clock.now = sent + 10 * MIN + 30 * S;
    const closed = w.sweepR4(id);
    expect({ closed, state: w.room(id).state }).toEqual({ closed: false, state: "open" });
  });

  test("m1-conc-r6-r4-closes-room-while-also-send-email-reads-back: the panel's countdown says 0:15 left and the setter presses Also send by email; HighLevel takes the email at 9:50 ('I'll wait for you for the next 10 minutes') and the message service reads its status back for 20 s; the sweep's R4 runs at 10:01 on the old lead_by: the room must not be closed as the lead's no-show seconds after a link that promised her ten minutes", async () => {
    const w = world({ wa: true });
    const id = await w.made(setter, { provider: "meet", call_kind: "intro", purpose: "fallback" });
    await w.drain();
    const sent = Date.parse(String(w.room(id).link_sent_at));
    expect(Date.parse(String(w.room(id).lead_by))).toBe(sent + 10 * MIN);
    w.clock.now = sent + 9 * MIN + 45 * S;
    let closedAt: number | null = null;
    w.hooks.afterTook = async () => {
      // 9:50 HighLevel took it; the read-back runs to 10:10, and the sweep's minute lands at 10:01.
      w.clock.now = sent + 10 * MIN + S;
      if (w.sweepR4(id)) closedAt = w.clock.now;
      w.clock.now = sent + 10 * MIN + 10 * S;
    };
    const out = await settle(w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() }));
    await w.drain();
    const email = w.delivered.filter(d => d.lane === "email").at(-1);
    expect({
      press_ok: out.ok,
      email_reached_lead: Boolean(email),
      closed_as_no_show_after_email_s: closedAt !== null && email ? Math.round((closedAt - email.at) / 1000) : null,
      state: w.room(id).state,
    }).toEqual({ press_ok: true, email_reached_lead: true, closed_as_no_show_after_email_s: null, state: "open" });
  });
});

describe("m1 concurrency r6: End room through sales-api and the worker's close of the Zoom meeting", () => {
  test("m1-conc-r6-press-end-deletes-host-link-so-worker-never-closes-zoom-meeting (sales-api's half): the closer presses End room on the open Zoom room; the room's host link must stay until the worker has closed the meeting (the worker finds finished rooms to close only by their host link: hermes/sales-desk tests/test_m1_concurrency_r6.py)", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo" });
    await w.drain();
    // The worker stored the host link when it made the meeting.
    w.db.seed("cockpit_sales_room_secrets", [{ room_id: id, start_url: "https://us06web.zoom.us/s/85012345678?zak=stress", expires_at: null }]);
    const v = Number(w.room(id).version);
    await w.rooms.actions["room.end"]!(closer, { room_id: id, version: v, reason: "end" });
    await w.drain();
    expect({
      state: w.room(id).state,
      host_link_kept_for_the_worker: w.db.t("cockpit_sales_room_secrets").some(s => s.room_id === id),
    }).toEqual({ state: "ended", host_link_kept_for_the_worker: true });
  });
});

describe("m1 concurrency r6: End room and Try Meet from two tabs on a Zoom room still being made", () => {
  async function makingLate() {
    const w = world();
    // The closer's Zoom room: the worker claimed it and has not opened it yet (the panel: making_late, End room and Try Meet).
    const out = await w.create(closer, { provider: "zoom", call_kind: "demo" });
    const id = String((out.room as Row).id);
    await w.claim(id);
    w.clock.now += 40 * S;
    return { w, id };
  }

  test("control: End room lands and its line is stored before Try Meet reads the room: Try Meet is refused and nothing is made", async () => {
    const { w, id } = await makingLate();
    const v = Number(w.room(id).version);
    await w.rooms.actions["room.end"]!(closer, { room_id: id, version: v, reason: "end" });
    const worker = w.workerBeside();
    const meet = await settle(
      w.rooms.actions["room.create"]!(closer, { contact_id: LEAD, provider: "meet", call_kind: "demo", purpose: "manual", request_id: crypto.randomUUID(), replaces: id, replaces_version: v }),
    );
    await worker.stop();
    await w.drain();
    expect({ refused: !meet.ok, new_rooms: w.db.t("cockpit_sales_rooms").filter(r => r.id !== id).length, links: w.delivered.length }).toEqual({ refused: true, new_rooms: 0, links: 0 });
  });

  test("m1-conc-r6-end-on-making-room-read-as-try-other-twin-sends-link: the closer's Zoom room is late being made; the lead page's tab presses End room (no video call after all) as the dialer's tab presses Try Meet; End's cancel lands first and its timeline line is a moment behind (the database answering slowly): Try Meet reads the cancelled room with no line yet as another Try Meet press's and makes a Meet room whose link goes to the lead", async () => {
    const { w, id } = await makingLate();
    const v = Number(w.room(id).version);
    w.lag.endLine = 40;
    const worker = w.workerBeside();
    const [end, meet] = await Promise.all([
      settle(w.rooms.actions["room.end"]!(closer, { room_id: id, version: v, reason: "end" })),
      (async () => {
        await turns(2);
        return await settle(
          w.rooms.actions["room.create"]!(closer, { contact_id: LEAD, provider: "meet", call_kind: "demo", purpose: "manual", request_id: crypto.randomUUID(), replaces: id, replaces_version: v }),
        );
      })(),
    ]);
    await worker.stop();
    await w.drain();
    const fresh = w.db.t("cockpit_sales_rooms").filter(r => r.id !== id);
    expect({
      end_ok: end.ok,
      zoom: `${w.room(id).state}:${w.room(id).result}`,
      try_meet_refused: !meet.ok,
      new_rooms: fresh.map(r => `${r.provider}:${r.state}`),
      links_to_lead: w.delivered.length,
    }).toEqual({ end_ok: true, zoom: "cancelled:cancelled", try_meet_refused: true, new_rooms: [], links_to_lead: 0 });
  });
});
