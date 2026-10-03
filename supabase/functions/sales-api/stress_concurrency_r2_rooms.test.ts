// bun test supabase/functions/sales-api/stress_concurrency_r2_rooms.test.ts
//
// Round 2 stress, dimension: concurrency and idempotency at scale. rooms.ts
// and followupAgent.ts on testfakes.ts, where every await is a point another
// request can run in (parallel Edge Function requests interleave there). Each
// test names the race in words: two webhooks for one host delivered at once,
// a Take while the closer hosts another lead, the settle's no-show racing the
// rep's own mark, a Hold racing the paced send, Available and Away from two
// devices, and two hundred presses on one lead's room.
//
// A failing test is a finding for the fix agent; once fixed it stays as a
// regression test. Nothing here reaches HighLevel, Zoom, Google or Slack.
import { describe, expect, test } from "bun:test";
import { makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const LEAD = "stress-r2-lead-000000001";
const OTHER = "stress-r2-lead-000000002";
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
    if (e instanceof ApiRefusal) return { ok: false as const, code: String(e.extra.code ?? ""), message: e.message, status: e.status, crash: null as string | null };
    return { ok: false as const, code: "crash", message: String((e as Error)?.message ?? e), status: 500, crash: String((e as Error)?.stack ?? e) };
  });
}

interface Opts {
  rooms?: Row;
  live?: Row;
  start?: number;
}

function setup(o: Opts = {}) {
  const w = fakeWorld(o.start ?? SUN_11);
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
  const contactGate = { held: null as null | ReturnType<typeof gate>, reached: null as null | ReturnType<typeof gate> };
  w.routes.push(async (m, p) => {
    for (const id of [LEAD, OTHER]) {
      if (m === "GET" && p === `/contacts/${id}`) {
        if (contactGate.held) {
          const g = contactGate.held;
          contactGate.held = null;
          contactGate.reached?.open();
          await g.p;
        }
        return { contact: { id, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" } };
      }
    }
    if (m === "PUT" || m === "DELETE") return { ok: true };
    return null as unknown as Row;
  });
  /**
   * index.ts markAppointment as it is: read the current mark, supersede it if
   * the status differs, insert. A timer's mark (onlyIfUnmarked) is refused
   * where a mark stands, unless it is its own same mark again.
   */
  const markCalls: Row[] = [];
  async function markAppointment(who: Who, id: string, status: string, opts: { onlyIfUnmarked?: boolean } = {}): Promise<Row> {
    markCalls.push({ who: who.email, id, status });
    const current = (await w.io.db(`cockpit_sales_dispositions?appointment_id=eq.${id}&superseded_at=is.null&select=*`))[0];
    if (opts.onlyIfUnmarked && current && !(current.status === status && current.marked_by === who.email))
      throw new ApiRefusal("This call was already marked, so the timer left it as it is.", 409, { code: "marked" });
    if (current && current.status === status) return { ...current, repeated: true };
    if (current)
      await w.io.db(`cockpit_sales_dispositions?id=eq.${current.id}`, { method: "PATCH", body: { superseded_at: w.db.iso() } });
    const row = (await w.io.db("cockpit_sales_dispositions", {
      method: "POST",
      body: { id: fakeUuid(), appointment_id: id, status, marked_by: who.email, superseded_at: null, crm: "quiet" },
      prefer: "return=representation",
    }))[0] as Row;
    return row;
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
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: (who, id, status, opts) => markAppointment(who, id, status, opts),
    sendText: async (_who, b) => send("text", b.request_id, { channel: b.channel }),
    sendTemplate: async (_who, t) => send("template", t.requestId, { channel: "whatsapp_template" }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  const liveRooms = () => w.db.t("cockpit_sales_rooms").filter(r => ["requested", "creating", "open", "host_in", "lead_in"].includes(String(r.state)));

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
  const zoom = (eventId: string, event: string) => rooms.desk["room.event"]!(desk, { kind: `zoom.${event}`, event_id: eventId, payload: {} });
  function offer(offeredTo: string[] = [CLOSER], contact = LEAD): string {
    const id = fakeUuid();
    w.db.seed("cockpit_sales_live", [
      { id, request_id: fakeUuid(), contact_id: contact, asked_by: SETTER, kind: "demo", reason: "on_call", state: "offered", offered_to: offeredTo, offer_until: new Date(w.clock.now + 2 * MIN).toISOString() },
    ]);
    return id;
  }
  return { ...w, rooms, audits, delivered, messages, room, liveRooms, workerOpens, openRoom, storeZoom, zoom, offer, contactGate, markAppointment, markCalls };
}

// ---------------------------------------------------------------------------
// Zoom webhooks for one host, delivered at once and out of order
// ---------------------------------------------------------------------------

describe("Zoom's webhooks for one room, delivered at once", () => {
  test("the closer drops and rejoins: the left (earlier) and the join (later) land together and the join is read first; the room still has the host in it", async () => {
    const w = setup();
    const id = await w.openRoom(closer, { provider: "zoom", purpose: "fallback", trigger: "no_answer" });
    const t0 = w.clock.now;
    // The closer joins at t0: host_in.
    const join1 = w.storeZoom(id, "meeting.participant_joined", { id: "Z-closer", user_name: "Sami", join_time: new Date(t0).toISOString() }, t0);
    await w.zoom(join1, "meeting.participant_joined");
    expect(w.room(id).state).toBe("host_in");
    // A network blip at t0 + 60 s: Zoom sends "left" at +60 s and "joined" at +65 s. Two HTTPS
    // deliveries, two door forwards, two room.event runs in parallel; the join's run finishes first.
    w.clock.now = t0 + 70 * S;
    const left = w.storeZoom(id, "meeting.participant_left", { id: "Z-closer", user_name: "Sami", leave_time: new Date(t0 + 60 * S).toISOString() }, t0 + 60 * S);
    const join2 = w.storeZoom(id, "meeting.participant_joined", { id: "Z-closer", user_name: "Sami", join_time: new Date(t0 + 65 * S).toISOString() }, t0 + 65 * S);
    await w.zoom(join2, "meeting.participant_joined");
    await w.zoom(left, "meeting.participant_left");
    await w.flush();
    // The closer is in the meeting (they rejoined at +65 s). A room that says "open" goes to the
    // sweep's R3 at host_by (+120 s from the left) as "the host did not join in time", and the
    // worker ends the Zoom meeting with the closer still in it, before the lead arrives.
    expect(w.room(id).state).toBe("host_in");
  });

  test("the same two webhooks in Zoom's own order give host_in (the control)", async () => {
    const w = setup();
    const id = await w.openRoom(closer, { provider: "zoom", purpose: "fallback", trigger: "no_answer" });
    const t0 = w.clock.now;
    const join1 = w.storeZoom(id, "meeting.participant_joined", { id: "Z-closer", join_time: new Date(t0).toISOString() }, t0);
    await w.zoom(join1, "meeting.participant_joined");
    w.clock.now = t0 + 70 * S;
    const left = w.storeZoom(id, "meeting.participant_left", { id: "Z-closer", leave_time: new Date(t0 + 60 * S).toISOString() }, t0 + 60 * S);
    const join2 = w.storeZoom(id, "meeting.participant_joined", { id: "Z-closer", join_time: new Date(t0 + 65 * S).toISOString() }, t0 + 65 * S);
    await w.zoom(left, "meeting.participant_left");
    await w.zoom(join2, "meeting.participant_joined");
    expect(w.room(id).state).toBe("host_in");
  });

  test("fifty copies of the host's join and fifty of an older left at once: the room ends with the host in it", async () => {
    const w = setup();
    const id = await w.openRoom(closer, { provider: "zoom", purpose: "fallback", trigger: "no_answer" });
    const t0 = w.clock.now;
    await w.zoom(w.storeZoom(id, "meeting.participant_joined", { id: "Z-closer", join_time: new Date(t0).toISOString() }, t0), "meeting.participant_joined");
    w.clock.now = t0 + 70 * S;
    const ids: [string, string][] = [];
    for (let i = 0; i < 50; i++) {
      ids.push([w.storeZoom(id, "meeting.participant_joined", { id: "Z-closer", join_time: new Date(t0 + 65 * S).toISOString() }, t0 + 65 * S), "meeting.participant_joined"]);
      ids.push([w.storeZoom(id, "meeting.participant_left", { id: "Z-closer", leave_time: new Date(t0 + 60 * S).toISOString() }, t0 + 60 * S), "meeting.participant_left"]);
    }
    const outs = await settle(ids.map(([e, k]) => w.zoom(e, k)));
    await w.flush();
    expect(outs.filter(o => !o.ok && o.code === "crash")).toEqual([]);
    expect(w.room(id).state).toBe("host_in");
  });
});

// ---------------------------------------------------------------------------
// The Take while the taker hosts another lead
// ---------------------------------------------------------------------------

describe("a Take from a closer who is already in another lead's room", () => {
  test("offered while Ready, then dialled another lead and opened a room for them, then pressed Take: the setter's room with this lead is not cancelled for a room the closer cannot have", async () => {
    const w = setup({ live: { enabled: true } });
    // The setter's room with the lead on the phone (the lead has the link).
    const setterRoom = await w.openRoom(setter, { purpose: "fallback", trigger: "no_answer" });
    await w.rooms.actions["room.mark"]!(setter, { room_id: setterRoom, version: Number(w.room(setterRoom).version), what: "host_in" });
    const sentBefore = w.delivered.length;
    // The offer went to the closer while they were Ready (offered_to is fixed at the ask).
    const id = w.offer([CLOSER]);
    // Within the two minutes the closer opened a room for another lead from the dialer.
    const otherRoom = fakeUuid();
    w.db.seed("cockpit_sales_rooms", [
      { id: otherRoom, request_id: fakeUuid(), contact_id: OTHER, purpose: "fallback", trigger: "no_answer", call_kind: "intro", provider: "zoom", host_email: CLOSER, made_by: CLOSER, state: "host_in", join_url: ZOOM_URL, opened_at: w.db.iso(), host_in_at: w.db.iso(), version: 3 },
    ]);
    // ...and now presses Take on the banner.
    const [out] = await settle([w.rooms.actions["live.take"]!(closer, { live_id: id, request_id: crypto.randomUUID() })]);
    await w.flush();
    const handoverRooms = w.db.t("cockpit_sales_rooms").filter(r => r.handover_id === id && r.id !== setterRoom);
    // Either the Take is refused before anything moves, or the closer gets a room for this lead.
    // What must never happen: the lead's live room (with the setter in it) cancelled "replaced"
    // while no room replaces it, the closer holding the lead with no room, and the lead's link
    // leading to a closed room.
    const setterStillOpen = ["open", "host_in", "lead_in"].includes(String(w.room(setterRoom).state));
    expect({ refused: !out!.ok, setterStillOpen, handoverRoom: handoverRooms.length > 0 }).not.toEqual({
      refused: false,
      setterStillOpen: false,
      handoverRoom: false,
    });
    expect(setterStillOpen || handoverRooms.length > 0).toBe(true);
    // Nothing new went to the lead for a room that does not exist.
    expect(w.delivered.length).toBe(sentBefore);
  });
});

// ---------------------------------------------------------------------------
// The settle's no-show and the rep's own mark
// ---------------------------------------------------------------------------

describe("the timer's no-show and the rep's mark at the same moment", () => {
  function settleSetup() {
    const w = setup({ rooms: { short_link: true } });
    const start = w.clock.now - 21 * MIN; // the intro started 21 minutes ago
    w.db.seed("cockpit_sales_appointments", [
      { appointment_id: "intro-1", contact_id: LEAD, call_type: "intro", calendar_id: "cal-intro", status: "confirmed", start_at: new Date(start).toISOString(), assigned_user_id: "G-setter" },
    ]);
    const id = fakeUuid();
    // The setter's fallback room for the booked intro: a short link never opened, closed by R4.
    w.db.seed("cockpit_sales_rooms", [
      {
        id,
        request_id: fakeUuid(),
        contact_id: LEAD,
        purpose: "fallback",
        trigger: "no_answer",
        call_kind: "intro",
        provider: "meet",
        host_email: SETTER,
        made_by: SETTER,
        appointment_id: "intro-1",
        appointment_start_at: new Date(start).toISOString(),
        state: "expired",
        result: "no_join",
        end_reason: "lead_no_show",
        join_url: MEET_URL,
        requested_at: new Date(start + 1 * MIN).toISOString(),
        opened_at: new Date(start + 1 * MIN).toISOString(),
        link_sent_at: new Date(start + 2 * MIN).toISOString(),
        ended_at: new Date(start + 15 * MIN).toISOString(),
        version: 4,
      },
    ]);
    w.db.insertOne("cockpit_sales_room_events", { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due to be settled." }, "ignore", "dedupe_key");
    const current = () => w.db.t("cockpit_sales_dispositions").filter(d => d.appointment_id === "intro-1" && !d.superseded_at);
    return { ...w, id, current };
  }

  // The markAppointment fake is index.ts markAppointment as it is (read the current mark, supersede it
  // when the status differs, insert). A fix that adds a guard there (a mark only where none stands)
  // adds the same guard to the fake.
  test("the setter reached the lead by phone and marks the intro showed while the sweep's settle runs: the rep's mark stands", async () => {
    const w = settleSetup();
    const held = gate();
    const reached = gate();
    w.contactGate.held = held;
    w.contactGate.reached = reached;
    // The settle reads the intro's marks (none yet) and the contact (HighLevel, slow).
    const run = w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [w.id] } });
    await reached.p;
    // Meanwhile the setter marks the intro showed from the dialer (they talked on the phone).
    await w.markAppointment(setter, "intro-1", "showed");
    held.open();
    await settle([run]);
    await w.flush();
    // A no-show is a hard number in the B2B show rate. The timer may only mark an intro nobody
    // marked: a person's mark that landed while the timer ran is never superseded by the timer.
    expect(w.current().map(d => `${d.status} by ${d.marked_by}`)).toEqual([`showed by ${SETTER}`]);
  });

  test("the settle posted again while the first is still writing (its 30 s lease ran out in a slow HighLevel): one no-show and one settle record", async () => {
    const w = settleSetup();
    const held = gate();
    const reached = gate();
    w.contactGate.held = held;
    w.contactGate.reached = reached;
    const first = w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [w.id] } });
    await reached.p;
    // HighLevel is slow: the lease (30 s) runs out and the next minute's sweep posts the room again
    // (the S1 rule re-posts a settle event whose lease has passed).
    w.clock.now += 61 * S;
    const second = w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [w.id] } });
    await settle([second]);
    held.open();
    await settle([first]);
    await w.flush();
    expect(w.current().map(d => d.status)).toEqual(["noshow"]);
    const r = w.room(w.id);
    // The room's record agrees with HighLevel: the timer wrote a no-show, so settled_mark is noshow,
    // and the audit log holds one settle for it.
    expect(r.settled_mark).toBe("noshow");
    expect(w.audits.filter(a => a.action === "room.settle")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Available and Away from two devices
// ---------------------------------------------------------------------------

describe("I'm available on the laptop and Away on the phone at once", () => {
  test("Away pressed while Available is still making the standby room: the seat ends Away and no standby room is left behind", async () => {
    const w = setup({ live: { enabled: true } });
    const real = w.io.db;
    const inInsert = gate();
    const release = gate();
    let held = false;
    w.io.db = async (path, init) => {
      const body = (init?.body ?? null) as Row | null;
      if (!held && init?.method === "POST" && path.startsWith("cockpit_sales_rooms") && body && body.purpose === "standby") {
        held = true;
        inInsert.open();
        await release.p;
      }
      return real(path, init);
    };
    const available = w.rooms.actions["live.availability"]!(closer, { state: "available" });
    await inInsert.p;
    const away = await w.rooms.actions["live.availability"]!(closer, { state: "away" });
    expect((away.me as Row).state).toBe("away");
    release.open();
    await settle([available]);
    await w.flush();
    const a = w.db.t("cockpit_sales_availability").find(r => r.email === CLOSER) as Row;
    const standby = w.liveRooms().filter(r => r.purpose === "standby" && r.host_email === CLOSER);
    // The last press was Away: the seat is Away, and a standby room asked for by the earlier press
    // is not left waiting (the worker would make a Zoom meeting for a closer who is not there,
    // and live.status shows it as the seat's room).
    expect({ state: a.state, standby: standby.length }).toEqual({ state: "away", standby: 0 });
  });
});

// ---------------------------------------------------------------------------
// Two hundred presses on one lead's room
// ---------------------------------------------------------------------------

describe("two hundred presses on one lead's room at once", () => {
  test("I'm in, The lead is in, End, Also send by email and status from four tabs, fifty each: no crash, one state, one email, one audit per move", async () => {
    const w = setup();
    const id = await w.openRoom(setter, { purpose: "fallback", trigger: "no_answer" });
    const v = Number(w.room(id).version);
    const presses: Promise<Row>[] = [];
    for (let i = 0; i < 40; i++) {
      presses.push(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "host_in" }));
      presses.push(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "lead_in" }));
      presses.push(w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "on_phone" }));
      presses.push(w.rooms.actions["room.send"]!(setter, { room_id: id, request_id: crypto.randomUUID(), channel: "email" }));
      presses.push(w.rooms.actions["room.status"]!(setter, { room_id: id }));
    }
    const outs = await settle(presses);
    await w.flush();
    expect(outs.filter(o => !o.ok && o.code === "crash").map(o => (o.ok ? "" : o.message))).toEqual([]);
    const r = w.room(id);
    const moves = w.audits.filter(a => a.entityId === id && /^room\.(mark|end)/.test(String(a.action)));
    // Every state change is one version and one audit row.
    expect(Number(r.version) - v).toBe(moves.length);
    expect(w.delivered.filter(m => m.channel === "email").length).toBeLessThanOrEqual(1);
    expect(w.liveRooms().filter(x => x.contact_id === LEAD).length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// A rep's Hold and the paced send of a backlog opener
// ---------------------------------------------------------------------------

// The sendFollowup fake is index.ts sendFollowup's claim as it is (status=eq.draft only). A fix that
// moves the hold check into that claim adds it to the fake as well.
describe("Hold pressed while the desk's paced send is under way", () => {
  test("the rep holds an approved opener while send_due checks it: the opener is not sent", async () => {
    const w = fakeWorld(SUN_11);
    const rep: Who = { signed_in: true, seat: true, manager: false, email: SETTER };
    const sends: Row[] = [];
    w.db.seed("cockpit_sales_settings", [
      { key: "whatsapp_guard", value: GUARD_OPEN },
      { key: "followups", value: { enabled: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18], stop_pause_days: 30 } },
      { key: "messaging", value: { whatsapp: true } },
    ]);
    w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, country: "KW", assigned_to: "G-setter" }]);
    const id = fakeUuid();
    w.db.seed("cockpit_sales_followups", [
      { id, contact_id: LEAD, owner_email: SETTER, segment: "reactivate", channel: "whatsapp_template", status: "draft", touch: 1, body: "Hi", created_at: w.db.iso() },
    ]);
    w.db.seed("cockpit_sales_followup_meta", [
      { followup_id: id, send_after: new Date(SUN_11 - 5 * S).toISOString(), approved_by: "boss@stress.invalid", approved_at: new Date(SUN_11 - MIN).toISOString(), held_by: null },
    ]);
    let agent!: ReturnType<typeof makeFollowupAgent>;
    agent = makeFollowupAgent({
      io: w.io,
      audit: async () => {},
      sendFollowup: async (who, f) => {
        // index.ts sendFollowup claims the draft on status=draft only.
        const claimed = await w.io.db(`cockpit_sales_followups?id=eq.${f.id}&status=eq.draft`, {
          method: "PATCH",
          body: { status: "sending" },
          prefer: "return=representation",
        });
        if (!claimed.length) throw new ApiRefusal("Someone else has just dealt with this draft.", 409);
        sends.push({ who: who.email, id: f.id });
        return { followup: { status: "sent" }, message: { state: "sent" } };
      },
      // The WhatsApp health read sits between send_due's read of the hold and the send:
      // the rep's Hold lands here ("I'm calling them myself").
      whatsappHealth: async () => {
        await agent.actions["followup.hold"]!(rep, { id, on: true, reason: "Calling them myself." });
        return { paused: false, why: "" };
      },
    });
    await settle([agent.desk["followup.send_due"]!(desk, { id })]);
    const meta = w.db.t("cockpit_sales_followup_meta").find(m => m.followup_id === id) as Row;
    expect(meta.held_by).toBe(SETTER);
    expect(sends).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The worker's events and the tick, many at once
// ---------------------------------------------------------------------------

describe("worker events and ticks delivered many times at once", () => {
  test("worker.failed five times at once while the worker's own fail write lands in the middle: handled once, no crash, the room failed", async () => {
    const w = setup();
    const out = await w.rooms.actions["room.create"]!(setter, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    const id = String((out.room as Row).id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, { method: "PATCH", body: { state: "creating", worker_run: "run-1", version: 2 } });
    w.db.insertOne("cockpit_sales_room_events", { room_id: id, kind: "worker.failed", source: "worker", dedupe_key: `worker.failed:${id}`, text: "Google did not make the Meet link." }, "ignore", "dedupe_key");
    const presses = Array.from({ length: 5 }, () => w.rooms.desk["room.event"]!(desk, { kind: "worker.failed", room_id: id, payload: { worker_run: "run-1" } }));
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=in.(requested,creating)`, {
      method: "PATCH",
      body: { state: "failed", error: "Google did not make the Meet link. Try Zoom.", result: "failed", ended_at: w.db.iso(), version: 3 },
    });
    const outs = await settle(presses);
    // The sweep replays whatever was released, once more.
    w.clock.now += 21 * S;
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.dedupe_key === `worker.failed:${id}`) as Row;
    if (!ev.handled_at) await w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [ev.id] } });
    expect(outs.filter(o => !o.ok && o.code === "crash")).toEqual([]);
    expect(w.room(id).state).toBe("failed");
    expect(Boolean((w.db.t("cockpit_sales_room_events").find(e => e.dedupe_key === `worker.failed:${id}`) as Row).handled_at)).toBe(true);
  });

  test("fifty ticks at once on a room whose worker.ready was lost (the link was due and never claimed): the link is claimed once and goes once", async () => {
    const w = setup();
    const out = await w.rooms.actions["room.create"]!(setter, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    const id = String((out.room as Row).id);
    await w.workerOpens(id, MEET_URL);
    // worker.ready never reached sales-api, and the sweep gave it up.
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.dedupe_key === `worker.ready:${id}`) as Row;
    ev.handled_at = w.db.iso();
    ev.detail = { gave_up: true };
    w.clock.now += 2 * MIN;
    const outs = await settle(Array.from({ length: 50 }, () => w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } })));
    await w.flush();
    expect(outs.filter(o => !o.ok)).toEqual([]);
    expect(w.delivered.filter(m => m.channel === "whatsapp" || m.channel === "whatsapp_template" || m.channel === "email")).toHaveLength(1);
    expect(w.audits.filter(a => a.action === "room.link.claim")).toHaveLength(1);
  });
});
