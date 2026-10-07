// bun test supabase/functions/sales-api/m1_concurrency_r3.test.ts
//
// Milestone 1 (the video link when a call fails), round 3, angle:
// concurrency and idempotency on the video-link path, with the pilot's
// settings (m1-scope.md section 3): rooms on, both providers, the three
// lanes on, test_only with the lead on the test list, count_on_join, settle,
// wrap and auto_on_miss off, short_link off, live handover off. The
// WhatsApp gate is locked (connector_off false), so the link goes by email,
// as it will at the pilot's start.
//
// What is new in this round: Zoom's host events delivered out of order
// (a leave read before the join it follows), one Zoom event forwarded by the
// door and replayed by the sweep in the same moment, The lead is in pressed
// before worker.ready and taken back, and the worker's ready, the minute's
// tick and two tabs' I'm in on one room at once.
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
const SETTER = "stress-m1c3-setter@stress.invalid";
const CLOSER = "stress-m1c3-closer@stress.invalid";
const LEAD = "stress-m1c3-lead";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/85012345678?pwd=stress";

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const turn = () => new Promise<void>(r => setTimeout(r, 0));
const turns = async (n: number) => {
  for (let i = 0; i < n; i++) await turn();
};

type Lane = "text" | "template" | "email";

function world(o: { wa?: boolean } = {}) {
  const w = fakeWorld();
  const rows = new Map<string, Row>();
  const delivered: { lane: Lane; requestId: string; at: number; body: string; roomStates: Record<string, string> }[] = [];
  const audits: Row[] = [];
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
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "intro", auto_on_miss: false },
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
  const roomStates = () => Object.fromEntries(w.db.t("cockpit_sales_rooms").map(r => [String(r.code), String(r.state)]));
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
    delivered.push({ lane, requestId, at: w.clock.now, body, roomStates: roomStates() });
    row.state = "sent";
    row.provider_status = lane === "template" ? "delivered" : "sent";
    row.ghl_message_id = `msg-${String(row.id).slice(-6)}`;
    return { message: { ...row } };
  }
  const io: LiveIO = {
    ...w.io,
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
  function workerBeside(o: { ready?: boolean } = {}) {
    let stop = false;
    const done = (async () => {
      for (let i = 0; i < 400 && !stop; i++) {
        await turn();
        const r = w.db.t("cockpit_sales_rooms").find(x => x.state === "requested");
        if (!r) continue;
        const id = String(r.id);
        await claim(id);
        if ((await open(id)) && o.ready !== false) await ready(id);
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
  async function made(who: Who = setter, b: Row = {}, o: { ready?: boolean } = {}): Promise<string> {
    const worker = workerBeside(o);
    const out = await create(who, b);
    await worker.stop();
    return String((out.room as Row).id);
  }
  /** One Zoom event as the door stores it (source zoom, the trimmed payload), not forwarded yet. */
  function zoomStored(id: string, event: string, o: { at: number; participant?: Row }): string {
    const r = room(id);
    const meeting = String(r.provider_meeting_id);
    const evId = fakeUuid();
    w.db.seed("cockpit_sales_room_events", [
      {
        id: evId,
        room_id: id,
        kind: `zoom.${event}`,
        source: "zoom",
        dedupe_key: `zoom:${event}:${meeting}:${o.at}:${evId}`,
        at: new Date(o.at).toISOString(),
        text: `Zoom: ${event}.`,
        detail: {
          event,
          event_ts: o.at,
          payload: {
            object: {
              id: meeting,
              uuid: `uuid-${meeting}`,
              host_id: "Z-closer",
              topic: `Mahara call ${String(r.code)}`,
              ...(o.participant ? { participant: o.participant } : {}),
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
  async function replay(...evIds: string[]) {
    return await rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: evIds } });
  }
  return { ...w, io, rows, delivered, audits, rooms, room, lines, audit, claim, open, ready, tick, drain, workerBeside, create, made, zoomStored, forward, replay };
}

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}
const codeOf = (e: unknown) => (e instanceof ApiRefusal ? String(e.extra?.code ?? "") : `thrown:${String((e as Error)?.message ?? e)}`);

/** The closer's own Zoom user, as Zoom names the host in a participant event (one session). */
const hostIn = (t: number, session = "s1") => ({
  id: "Z-closer",
  user_id: `1677${session.slice(1)}`,
  participant_uuid: `puuid-host-${session}`,
  user_name: "Omar Closer",
  email: CLOSER,
  join_time: new Date(t).toISOString(),
});
const hostOut = (t: number, session = "s1") => ({
  id: "Z-closer",
  user_id: `1677${session.slice(1)}`,
  participant_uuid: `puuid-host-${session}`,
  user_name: "Omar Closer",
  email: CLOSER,
  leave_time: new Date(t).toISOString(),
});

// ---------------------------------------------------------------------------
// Zoom's host events out of order
// ---------------------------------------------------------------------------

describe("m1 concurrency r3: the host's Zoom join read after the leave that followed it", () => {
  test("control: the closer joins at 10:01 and leaves at 10:02, both read in order: the room is back to waiting for the host", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo" });
    await w.drain();
    const t0 = w.clock.now;
    const join = w.zoomStored(id, "meeting.participant_joined", { at: t0 + MIN, participant: hostIn(t0 + MIN) });
    w.clock.now = t0 + MIN + S;
    await w.forward(join, "meeting.participant_joined");
    expect(w.room(id).state).toBe("host_in");
    const leave = w.zoomStored(id, "meeting.participant_left", { at: t0 + 2 * MIN, participant: hostOut(t0 + 2 * MIN) });
    w.clock.now = t0 + 2 * MIN + S;
    await w.forward(leave, "meeting.participant_left");
    await w.drain();
    expect(w.room(id).state).toBe("open");
  });

  test("zoom-host-join-replayed-after-its-leave-reads-host-in: the closer opens the Zoom room at 10:01 and drops out at 10:02; the join's forward failed (a 5xx) and the leave was read at once, so the sweep's replay of the join 20 s later is read last: the room must still say the host is not in", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo" });
    await w.drain();
    const t0 = w.clock.now;
    // 10:01: the join, stored by the door; its forward to sales-api failed.
    const join = w.zoomStored(id, "meeting.participant_joined", { at: t0 + MIN, participant: hostIn(t0 + MIN) });
    // 10:02: the leave, forwarded at once. The room was never read as host_in.
    const leave = w.zoomStored(id, "meeting.participant_left", { at: t0 + 2 * MIN, participant: hostOut(t0 + 2 * MIN) });
    w.clock.now = t0 + 2 * MIN + S;
    await w.forward(leave, "meeting.participant_left");
    expect(w.room(id).state).toBe("open");
    // 10:02:21: the sweep's E1 replays the join (stored, unhandled, 20 s old).
    w.clock.now = t0 + 2 * MIN + 21 * S;
    await w.replay(join);
    await w.drain();
    const r = w.room(id);
    expect({ state: r.state, host_in_at: r.host_in_at ?? null }).toEqual({ state: "open", host_in_at: null });
  });

  test("zoom-host-join-replayed-after-its-leave-reads-host-in (meeting.started): Zoom's meeting.started at 10:01 is read after the host's leave at 10:02: the room must not say the host is in", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo" });
    await w.drain();
    const t0 = w.clock.now;
    const started = w.zoomStored(id, "meeting.started", { at: t0 + MIN });
    const leave = w.zoomStored(id, "meeting.participant_left", { at: t0 + 2 * MIN, participant: hostOut(t0 + 2 * MIN) });
    w.clock.now = t0 + 2 * MIN + S;
    await w.forward(leave, "meeting.participant_left");
    w.clock.now = t0 + 2 * MIN + 21 * S;
    await w.replay(started);
    await w.drain();
    const r = w.room(id);
    expect({ state: r.state, host_in_at: r.host_in_at ?? null }).toEqual({ state: "open", host_in_at: null });
  });

  test("zoom-host-join-replayed-after-its-leave-reads-host-in (the panel): after the out-of-order pair, room.status tells the closer who dropped out that they are in the room (You're in, The lead is in as the primary button), and the sweep's R3 (host not in, open rooms only) can no longer apply", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo" });
    await w.drain();
    const t0 = w.clock.now;
    const join = w.zoomStored(id, "meeting.participant_joined", { at: t0 + MIN, participant: hostIn(t0 + MIN) });
    const leave = w.zoomStored(id, "meeting.participant_left", { at: t0 + 2 * MIN, participant: hostOut(t0 + 2 * MIN) });
    w.clock.now = t0 + 2 * MIN + S;
    await w.forward(leave, "meeting.participant_left");
    w.clock.now = t0 + 2 * MIN + 21 * S;
    await w.replay(join);
    await w.drain();
    // What the panel tells the closer now (room.status): the host step.
    const status = (await w.rooms.actions["room.status"]!(closer, { room_id: id })) as Row;
    const view = status.room as Row;
    expect({ panel_state: view.state, host_in_at: view.host_in_at ?? null }).toEqual({ panel_state: "open", host_in_at: null });
  });
});

// ---------------------------------------------------------------------------
// One Zoom event, forwarded by the door and replayed by the sweep at once
// ---------------------------------------------------------------------------

describe("m1 concurrency r3: one Zoom event read twice in the same moment", () => {
  test("the door's forward and the sweep's replay of the host's join at once: one move, one audit row, one timeline text", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo" });
    await w.drain();
    const t0 = w.clock.now;
    const join = w.zoomStored(id, "meeting.participant_joined", { at: t0 + MIN, participant: hostIn(t0 + MIN) });
    w.clock.now = t0 + MIN + 21 * S;
    const both = await Promise.all([settle(w.forward(join, "meeting.participant_joined")), settle(w.replay(join)), settle(w.forward(join, "meeting.participant_joined"))]);
    await w.drain();
    expect({
      errors: both.filter(b => !b.ok).map(b => codeOf((b as { error: unknown }).error)),
      state: w.room(id).state,
      audit_rows: w.audit("room.event.zoom.meeting.participant_joined", id).length,
      handled: Boolean(w.db.t("cockpit_sales_room_events").find(e => e.id === join)?.handled_at),
    }).toEqual({ errors: [], state: "host_in", audit_rows: 1, handled: true });
  });
});

// ---------------------------------------------------------------------------
// The lead is in, pressed before worker.ready, then taken back
// ---------------------------------------------------------------------------

describe("m1 concurrency r3: The lead is in pressed before the room's ready was read, then taken back", () => {
  test("the link is claimed and goes once, within the next minute's tick, after That was not the lead", async () => {
    const w = world();
    // The worker opens the room; its worker.ready is slow (not told yet).
    const id = await w.made(setter, {}, { ready: false });
    expect(w.room(id).state).toBe("open");
    // The setter presses I'm in, then The lead is in by mistake, as worker.ready is read.
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "host_in" });
    await w.drain();
    // I'm in claimed the link: it goes now.
    const sentAfterHostIn = w.delivered.length;
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.ready(id);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
    await w.drain();
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    expect({ sent_after_host_in: sentAfterHostIn, links: w.delivered.length, state: w.room(id).state }).toEqual({
      sent_after_host_in: 1,
      links: 1,
      state: "host_in",
    });
  });

  test("The lead is in pressed on the open room before I'm in and before worker.ready; worker.ready reads lead_in and claims nothing; That was not the lead: the lead still gets the link within a minute", async () => {
    const w = world();
    const id = await w.made(setter, {}, { ready: false });
    expect(w.room(id).state).toBe("open");
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.ready(id);
    await w.drain();
    expect(w.delivered.length).toBe(0);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
    await w.drain();
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    expect({ links: w.delivered.length, state: w.room(id).state, link_sent: Boolean(w.room(id).link_sent_at) }).toEqual({
      links: 1,
      state: "host_in",
      link_sent: true,
    });
  });
});

// ---------------------------------------------------------------------------
// worker.ready, the tick and two tabs' I'm in on one room at once
// ---------------------------------------------------------------------------

describe("m1 concurrency r3: worker.ready, the tick's claim and I'm in from two tabs at once", () => {
  test("one claim of the link, one email, one I'm in row and line", async () => {
    const w = world();
    const id = await w.made(setter, {}, { ready: false });
    const v = Number(w.room(id).version);
    w.clock.now += 61 * S; // the tick's claim_link is due (opened + 60 s)
    const all = await Promise.all([
      settle(w.ready(id)),
      settle(w.tick(id)),
      settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "host_in" })),
      settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "host_in" })),
    ]);
    await w.drain();
    expect({
      errors: all.filter(b => !b.ok).map(b => codeOf((b as { error: unknown }).error)),
      links: w.delivered.length,
      state: w.room(id).state,
      host_in_rows: w.audit("room.mark.host_in", id).length,
      host_in_lines: w.lines(id, "room.mark.host_in").length,
    }).toEqual({ errors: [], links: 1, state: "host_in", host_in_rows: 1, host_in_lines: 1 });
  });
});
