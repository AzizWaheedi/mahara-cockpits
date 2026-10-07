// bun test supabase/functions/sales-api/stress_concurrency_r3_rooms.test.ts
//
// Round 3 stress, dimension: concurrency and idempotency at scale. rooms.ts
// on testfakes.ts, where every await is a point another request can run in
// (parallel Edge Function requests interleave there). Each test names the
// race in words:
//   - a Take whose room is still being made when the closer's own room for
//     another lead lands (the take_host_busy check is a read, then a write
//     two seconds later: the slot it checked can be taken in between);
//   - the same room.create request id from two tabs (or a network retry)
//     landing while the first press is still writing its audit row;
//   - two hundred presses with one request id at once;
//   - five different Zoom joins of the lead at once, with ticks and status
//     reads beside them.
//
// A failing test is a finding for the fix agent; once fixed it stays as a
// regression test. Nothing here reaches HighLevel, Zoom, Google or Slack.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps, seatRequestId } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const LEAD = "stress-r3-lead-000000001";
const OTHER = "stress-r3-lead-000000002";
const CLOSER = "closer@stress.invalid";
const SETTER = "setter@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";
// Sunday 4 October 2026, 11:00 in Kuwait: inside live.hours and the first-message hours.
const SUN_11 = Date.parse("2026-10-04T08:00:00Z");

const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer" };
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const ROOMS_ON = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: false,
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: true, whatsapp_template: true, email: true },
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
};
const GUARD_OPEN = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 };
const LIVE_STATES = ["requested", "creating", "open", "host_in", "lead_in"];

function gate() {
  let open!: () => void;
  const p = new Promise<void>(r => (open = r));
  return { p, open };
}

async function settle<T>(ps: Promise<T>[]) {
  const out = await Promise.allSettled(ps);
  return out.map(o => {
    if (o.status === "fulfilled") return { ok: true as const, value: o.value as Row };
    const e = o.reason;
    if (e instanceof ApiRefusal) return { ok: false as const, code: String(e.extra.code ?? ""), message: e.message, status: e.status };
    return { ok: false as const, code: "crash", message: String((e as Error)?.stack ?? e), status: 500 };
  });
}

interface Opts {
  rooms?: Row;
  live?: Row;
}

function setup(o: Opts = {}) {
  const w = fakeWorld(SUN_11);
  const audits: Row[] = [];
  const delivered: Row[] = [];
  const messages = new Map<string, Row>();
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON, ...(o.rooms ?? {}) } },
    { key: "live", value: { enabled: false, standby: true, ...(o.live ?? {}) } },
    { key: "whatsapp_guard", value: GUARD_OPEN },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true },
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
    { email: SETTER, zoom_user_id: null, zoom_status: "pending", google_ok: true },
  ]);
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - 3_600_000).toISOString() }]);

  /**
   * HighLevel's contact read, counted per lead: `holdRead(lead, n)` holds the
   * n-th read of that lead's contact until the test opens the gate, and says
   * when that read has been reached.
   */
  const reads = new Map<string, number>();
  const holds = new Map<string, { n: number; held: ReturnType<typeof gate>; reached: ReturnType<typeof gate> }>();
  function holdRead(lead: string, n: number) {
    const h = { n, held: gate(), reached: gate() };
    holds.set(lead, h);
    return h;
  }
  w.routes.push(async (m, p) => {
    for (const id of [LEAD, OTHER]) {
      if (m === "GET" && p === `/contacts/${id}`) {
        const k = (reads.get(id) ?? 0) + 1;
        reads.set(id, k);
        const h = holds.get(id);
        if (h && h.n === k) {
          h.reached.open();
          await h.held.p;
        }
        return { contact: { id, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" } };
      }
    }
    if (m === "PUT" || m === "DELETE") return { ok: true };
    return null as unknown as Row;
  });

  /** The audit writer; `holdAudit(action)` holds the first row of that action until the test opens it. */
  let auditHold: { action: string; held: ReturnType<typeof gate>; reached: ReturnType<typeof gate> } | null = null;
  function holdAudit(action: string) {
    auditHold = { action, held: gate(), reached: gate() };
    return auditHold;
  }
  async function send(kind: string, requestId: string, b: Row): Promise<{ message: Row; repeated?: boolean }> {
    const already = messages.get(requestId);
    if (already) return { message: { ...already }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, state: "sent", provider_status: "sent", kind, created_at: w.db.iso(), ...b };
    messages.set(requestId, row);
    delivered.push({ ...row });
    return { message: { ...row } };
  }
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      if (auditHold && auditHold.action === action) {
        const h = auditHold;
        auditHold = null;
        h.reached.open();
        await h.held.p;
      }
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({ id: fakeUuid() }),
    sendText: async (_who, b) => send("text", b.request_id, { channel: b.channel }),
    sendTemplate: async (_who, t) => send("template", t.requestId, { channel: "whatsapp_template" }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  const liveRooms = () => w.db.t("cockpit_sales_rooms").filter(r => LIVE_STATES.includes(String(r.state)));

  /** The room worker's two writes (claim, then open) and its stored worker.ready, as desk/rooms.py makes them. */
  async function workerOpens(id: string, url: string) {
    const r = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" } },
      prefer: "resolution=ignore-duplicates",
    });
    const cur = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: url,
        provider_meeting_id: url === ZOOM_URL ? "81234567890" : `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(cur.version) + 1,
      },
    });
  }
  async function openRoom(who: Who, b: Row = {}): Promise<string> {
    const out = await rooms.actions["room.create"]!(who, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
      ...b,
    });
    const id = String((out.room as Row).id);
    await workerOpens(id, b.provider === "zoom" ? ZOOM_URL : MEET_URL);
    await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.flush();
    return id;
  }
  function offer(offeredTo: string[] = [CLOSER], contact = LEAD): string {
    const id = fakeUuid();
    w.db.seed("cockpit_sales_live", [
      { id, request_id: fakeUuid(), contact_id: contact, asked_by: SETTER, kind: "demo", reason: "on_call", state: "offered", offered_to: offeredTo, offer_until: new Date(w.clock.now + 2 * MIN).toISOString() },
    ]);
    return id;
  }
  /** A Zoom webhook as the door stores it (the door then forwards its id). */
  function storeZoom(roomId: string, event: string, participant: Row | null, at: number): string {
    const id = fakeUuid();
    w.db.seed("cockpit_sales_room_events", [
      {
        id,
        room_id: roomId,
        kind: `zoom.${event}`,
        source: "zoom",
        dedupe_key: `zoom:${event}:${id}`,
        at: new Date(at).toISOString(),
        detail: { event, event_ts: at, payload: { object: { id: "81234567890", host_id: "Z-closer", topic: "Mahara call", ...(participant ? { participant } : {}) } } },
      },
    ]);
    return id;
  }
  return { ...w, rooms, audits, delivered, room, liveRooms, workerOpens, openRoom, offer, storeZoom, holdRead, holdAudit, reads };
}

// ---------------------------------------------------------------------------
// The Take's host check and a room the closer opens while the Take's room is made
// ---------------------------------------------------------------------------

describe("a Take whose room is still being made when the closer opens a room for another lead", () => {
  test("the closer's room for another lead lands between the claim and the handover's room: the setter's room with this lead is never cancelled for a room the closer cannot have", async () => {
    const w = setup({ live: { enabled: true } });
    // The setter's room with the lead on the phone (the lead already has its link).
    const setterRoom = await w.openRoom(setter, { purpose: "fallback", trigger: "no_answer" });
    await w.rooms.actions["room.mark"]!(setter, { room_id: setterRoom, version: Number(w.room(setterRoom).version), what: "host_in" });
    const sentBefore = w.delivered.length;
    // The offer went to the closer while they were Ready; they have no standby room (no
    // Google, a standby that failed, or live.standby off): the claim adopts nothing.
    const id = w.offer([CLOSER]);
    // Fixed (round 3): the claim reserves the closer's room for this lead in
    // its own transaction (20261003d). sales-api then finishes that room
    // (room.create's audit row): that write is held here, right after the
    // claim committed, where the old code was still to make the room.
    const h = w.holdAudit("room.create");
    const take = settle([w.rooms.actions["live.take"]!(closer, { live_id: id, request_id: crypto.randomUUID() })]);
    await h.reached.p;
    // The claim has gone through: the setter's room is already cancelled "replaced".
    const cancelledByClaim = w.room(setterRoom).state === "cancelled";
    // Meanwhile, on the dialer tab, the closer presses Video link for another lead
    // (a no-answer fallback). The closer's one room is already the handover's:
    // this one is refused ("You already have a room open"), never the other way round.
    const [other] = await settle([
      w.rooms.actions["room.create"]!(closer, {
        request_id: crypto.randomUUID(),
        contact_id: OTHER,
        provider: "zoom",
        call_kind: "intro",
        purpose: "fallback",
        trigger: "no_answer",
      }),
    ]);
    h.held.open();
    const [out] = await take;
    await w.flush();
    const handoverRooms = w.db.t("cockpit_sales_rooms").filter(r => r.handover_id === id && r.id !== setterRoom);
    const setterStillOpen = LIVE_STATES.includes(String(w.room(setterRoom).state));
    const l = w.db.t("cockpit_sales_live").find(x => x.id === id) as Row;
    // What must never happen: the lead's live room with the setter in it cancelled
    // "replaced" while no room replaces it, the closer holding the lead with no room,
    // and the lead's link leading to a closed room.
    expect(other!.ok ? "made" : other!.code).toBe("host_has_room");
    expect({
      cancelledByClaim,
      otherRoomMade: other!.ok,
      setterStillOpen,
      handoverRoom: handoverRooms.length > 0,
      takeAnswer: out!.ok ? (out!.value.room ? "room" : String(out!.value.line ?? "no room")) : out!.message,
      handoverHeldWithoutRoom: ["claimed", "room_ready"].includes(String(l.state)) && !l.room_id,
    }).toEqual({
      cancelledByClaim: true,
      otherRoomMade: false,
      setterStillOpen: false,
      handoverRoom: true,
      takeAnswer: "room",
      handoverHeldWithoutRoom: false,
    });
    expect(w.delivered.length).toBeGreaterThanOrEqual(sentBefore);
  });
});

// ---------------------------------------------------------------------------
// The same request id while the first press is still writing
// ---------------------------------------------------------------------------

describe("the same room.create request id from two tabs while the first is still writing", () => {
  test("twenty twins land while the first press writes its audit row: one room and one room.create audit row", async () => {
    const w = setup();
    const requestId = crypto.randomUUID();
    const body = { request_id: requestId, contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" };
    // The first press inserts its room, then writes its audit row (an HTTP
    // insert of 30 to 100 ms in production): held here.
    const h = w.holdAudit("room.create");
    const first = settle([w.rooms.actions["room.create"]!(setter, body)]);
    await h.reached.p;
    // The double press, a second tab with the same request id, or the browser's
    // own retry of a request whose answer was slow, lands now.
    const twins = await settle(Array.from({ length: 20 }, () => w.rooms.actions["room.create"]!(setter, { ...body })));
    h.held.open();
    const [one] = await first;
    await w.flush();
    const all = [one!, ...twins];
    expect(all.filter(o => !o.ok).map(o => (o.ok ? "" : o.message))).toEqual([]);
    const ids = new Set(all.map(o => (o.ok ? String((o.value.room as Row).id) : "")));
    expect(ids.size).toBe(1);
    const roomId = [...ids][0]!;
    const stored = await seatRequestId(setter, requestId);
    expect(w.db.t("cockpit_sales_rooms").filter(r => r.request_id === stored).length).toBe(1);
    // Every write leaves one audit row: one room made is one room.create row, not one per press.
    expect(w.audits.filter(a => a.action === "room.create" && a.entityId === roomId).length).toBe(1);
  });

  test("two hundred presses with one request id at once (no press slowed): one room, one audit row, every answer that room", async () => {
    const w = setup();
    const requestId = crypto.randomUUID();
    const body = { request_id: requestId, contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" };
    const outs = await settle(Array.from({ length: 200 }, () => w.rooms.actions["room.create"]!(setter, { ...body })));
    await w.flush();
    expect(outs.filter(o => !o.ok).map(o => (o.ok ? "" : `${o.code}: ${o.message}`))).toEqual([]);
    const ids = new Set(outs.map(o => (o.ok ? String((o.value.room as Row).id) : "")));
    expect(ids.size).toBe(1);
    const roomId = [...ids][0]!;
    expect(w.liveRooms().filter(r => r.contact_id === LEAD).length).toBe(1);
    expect(w.audits.filter(a => a.action === "room.create" && a.entityId === roomId).length).toBe(1);
    expect(w.db.t("cockpit_sales_room_events").filter(e => e.dedupe_key === `room.asked:${roomId}`).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Five different Zoom joins of the lead, with ticks and status reads beside them
// ---------------------------------------------------------------------------

describe("the lead's Zoom joins delivered at once under five event ids", () => {
  test("five joins (a rejoin, Zoom's own re-sends), forty ticks and forty status reads at once: the room moves to lead_in once, one audit for the move, every event handled", async () => {
    const w = setup({ rooms: { count_on_join: false } });
    const id = await w.openRoom(closer, { provider: "zoom", purpose: "fallback", trigger: "no_answer" });
    // The closer is in.
    const hostJoin = w.storeZoom(id, "meeting.participant_joined", { user_id: "1", id: "Z-closer", user_name: "Sami Closer", email: CLOSER, join_time: new Date(w.clock.now).toISOString() }, w.clock.now);
    await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: hostJoin, payload: {} });
    await w.flush();
    expect(w.room(id).state).toBe("host_in");
    const v = Number(w.room(id).version);
    w.clock.now += 30 * S;
    const joins = Array.from({ length: 5 }, (_, i) =>
      w.storeZoom(id, "meeting.participant_joined", { user_id: String(100 + i), id: "", user_name: "Huda", email: "", join_time: new Date(w.clock.now + i * 100).toISOString() }, w.clock.now + i * 100),
    );
    const presses: Promise<Row>[] = [];
    for (const j of joins) presses.push(w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: j, payload: {} }));
    for (let i = 0; i < 40; i++) {
      presses.push(w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } }));
      presses.push(w.rooms.actions["room.status"]!(closer, { room_id: id }));
    }
    const outs = await settle(presses);
    await w.flush();
    expect(outs.filter(o => !o.ok && o.code === "crash").map(o => (o.ok ? "" : o.message))).toEqual([]);
    const r = w.room(id);
    expect(r.state).toBe("lead_in");
    expect(Number(r.version) - v).toBe(1);
    const moves = w.audits.filter(a => a.entityId === id && String(a.action).startsWith("room.event.zoom") && (a.after as Row)?.state === "lead_in");
    expect(moves.length).toBe(1);
    // Every join is handled or left for the sweep's replay (never lost while held).
    const left = w.db.t("cockpit_sales_room_events").filter(e => joins.includes(String(e.id)) && !e.handled_at && !e.lease_until);
    expect(left.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// "That was not the lead", then Zoom's second event for that same join
// ---------------------------------------------------------------------------

describe("Zoom's second event for a join a rep took back with That was not the lead", () => {
  /**
   * A stranger joins the closer's Zoom room, the closer presses That was not
   * the lead, then Zoom's second event for that same join arrives.
   * `dbGuard`: the row as 20261003a's guard (production until 20261003d is
   * applied) leaves it after the press: lead_in back to host_in with
   * lead_in_at left as it was set lead_in_at to null. 20261003d's guard keeps
   * it (fix round 3; testfakes.ts models d), and roomlogic bounds the
   * re-delivered join by count_undo_at when it is gone, so both hold.
   */
  async function strangerAgain(dbGuard: boolean) {
    const w = setup();
    const id = await w.openRoom(closer, { provider: "zoom", purpose: "fallback", trigger: "no_answer" });
    const hostJoin = w.storeZoom(id, "meeting.participant_joined", { user_id: "1", id: "Z-closer", user_name: "Sami Closer", email: CLOSER, join_time: new Date(w.clock.now).toISOString() }, w.clock.now);
    await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: hostJoin, payload: {} });
    w.clock.now += 20 * S;
    // Someone who is not the lead comes in (a colleague on a phone, a wrong number's owner).
    const joinAt = w.clock.now;
    const stranger = { user_id: "77", id: "", participant_uuid: "P-77", user_name: "iPhone", email: "", join_time: new Date(joinAt).toISOString() };
    const e1 = w.storeZoom(id, "meeting.participant_joined", stranger, joinAt);
    await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: e1, payload: {} });
    await w.flush();
    expect(w.room(id).state).toBe("lead_in");
    w.clock.now += 40 * S;
    // The closer sees it is not the lead and presses That was not the lead.
    await w.rooms.actions["room.mark"]!(closer, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
    await w.flush();
    expect(w.room(id).state).toBe("host_in");
    if (dbGuard) w.room(id).lead_in_at = null;
    w.clock.now += 5 * S;
    // Zoom's second event for that same join (jbh_joined beside joined, or the
    // same event replayed by the sweep after its first handling lost its answer).
    const e2 = w.storeZoom(id, "meeting.participant_jbh_joined", stranger, joinAt);
    await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_jbh_joined", event_id: e2, payload: {} });
    await w.flush();
    return { w, id };
  }

  test("control, the row as testfakes.ts keeps it (lead_in_at kept): the second event is not a new join", async () => {
    const { w, id } = await strangerAgain(false);
    expect(w.room(id).state).toBe("host_in");
  });

  test("the row as the database keeps it (lead_in_at cleared by the guard): the second event is not a new join either, and the room never ends 'joined'", async () => {
    const { w, id } = await strangerAgain(true);
    const r = w.room(id);
    // roomlogic's own rule ("the join that was taken back, delivered again by Zoom,
    // is not a new join") must hold on the database's row too.
    expect({ state: r.state, lead_in_at: r.lead_in_at ?? null }).toEqual({ state: "host_in", lead_in_at: null });
    const out = await w.rooms.actions["room.end"]!(closer, { room_id: id, version: Number(w.room(id).version), reason: "finished", confirm: true });
    expect((out.room as Row).result).not.toBe("joined");
  });
});
