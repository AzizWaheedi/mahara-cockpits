// bun test supabase/functions/sales-api/m1_fence.test.ts
//
// Milestone 1 is the video link when a call fails (5 October 2026). What lies
// outside it stays refused or inert on the server while its switch is off,
// whoever calls: a seat (ACTIONS), the desk on the service key
// (DESK_ACTIONS), or the cron door (CRON_ACTIONS, room.event). The settings
// are the pilot's: rooms on for the test contact, Meet and Zoom on, every
// send channel on, count_on_join, settle and wrap off, live.enabled off,
// followups.enabled on (the drafts reps approve) and followups.agent off.
// Against testfakes.ts; no network, every lead invented. The index.ts doors
// themselves are run in m1_fence_router.test.ts.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AGENT_COPY, makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, roomsSetting } from "./roomlogic.ts";
import { LIVE_OFF, makeRooms, ROOMS_COPY, type RoomDeps } from "./rooms.ts";
import { agentOff, agentWorkOff, followupSettingsValue } from "./sendrules.ts";
import { FOLLOWUP_SEGMENTS } from "./lib.ts";
import { fakeUuid, fakeWorld, seedLeadZoomJoin } from "./testfakes.ts";

type Row = Record<string, unknown>;

const MIN = 60_000;
const SETTER = "stress-m1-setter@stress.invalid";
const CLOSER = "stress-m1-closer@stress.invalid";
const LEAD = "stress-m1-lead";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer" };
const boss: Who = { signed_in: true, seat: true, manager: true, email: "stress-m1-boss@stress.invalid", name: "Boss", role: "manager" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk", name: "Sales desk" };

/** The pilot's rooms setting (m1-scope.md). */
const PILOT_ROOMS = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: true,
  test_contacts: [LEAD],
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: true, whatsapp_template: true, email: true },
  count_on_join: false,
  settle: false,
  wrap: false,
};
const PILOT_LIVE = { enabled: false, slack: false, standby: true };
const PILOT_FOLLOWUPS = { enabled: true, agent: false, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18] };
const GATE_OPEN = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 };

function setup(o: { rooms?: Row; live?: Row; followups?: Row } = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  const marks: Row[] = [];
  const sends: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...PILOT_ROOMS, ...(o.rooms ?? {}) } },
    { key: "live", value: { ...PILOT_LIVE, ...(o.live ?? {}) } },
    { key: "followups", value: { ...PILOT_FOLLOWUPS, ...(o.followups ?? {}) } },
    { key: "whatsapp_guard", value: GATE_OPEN },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true },
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
  ]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, at: w.db.iso(), detail: "ready" }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW", assigned_to: "G-setter" }]);
  w.routes.push((m, p) =>
    m === "GET" && p === `/contacts/${LEAD}`
      ? { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@stress.invalid", tags: ["roas-qualified"], country: "KW" } }
      : (null as unknown as Row),
  );
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async (who, id, status, opts) => {
      marks.push({ who: who.email, id, status, ...opts });
      return {};
    },
    sendText: async (who, b) => {
      sends.push({ who: who.email, ...b });
      return { message: { id: fakeUuid(), state: "sent", provider_status: "sent" } };
    },
    sendTemplate: async (who, t) => {
      sends.push({ who: who.email, ...t });
      return { message: { id: fakeUuid(), state: "sent", provider_status: "sent" } };
    },
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const agent = makeFollowupAgent({
    io: w.io,
    audit: async (who, action, _t, id, _b, after) => {
      audits.push({ who: who.email, action, entityId: id, after });
    },
    sendFollowup: async (who, f) => {
      sends.push({ who: who.email, followup: f.id });
      return { followup: { status: "sent" }, message: { state: "sent" } };
    },
    whatsappHealth: async () => ({ paused: false, why: "" }),
  });
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  const bookings = () => w.ghlCalls.filter(c => c.method === "POST" && c.path === "/calendars/events/appointments");
  const writes = () => w.db.calls.filter(c => c.method !== "GET");
  return { ...w, rooms, agent, audits, marks, sends, room, bookings, writes };
}

async function refused(p: Promise<unknown>): Promise<ApiRefusal> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
  throw new Error("expected a refusal");
}

/** An open room of the setter's for the lead, as the worker leaves it. */
function seedOpenRoom(w: ReturnType<typeof setup>, over: Row = {}): string {
  const id = fakeUuid();
  w.db.seed("cockpit_sales_rooms", [
    {
      id,
      request_id: fakeUuid(),
      contact_id: LEAD,
      purpose: "fallback",
      call_kind: "intro",
      provider: "zoom",
      host_email: SETTER,
      made_by: SETTER,
      state: "open",
      join_url: ZOOM_URL,
      provider_meeting_id: "81234567890",
      opened_at: w.db.iso(),
      link_sent_at: w.db.iso(),
      host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
      lead_by: new Date(w.clock.now + 10 * MIN).toISOString(),
      ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
      version: 3,
      ...over,
    },
  ]);
  return id;
}

// ---------------------------------------------------------------------------

describe("the pilot's settings read as the fence says", () => {
  test("settle, wrap and count_on_join ship off and a missing key is off; live.enabled and followups.agent likewise", () => {
    const shipped = roomsSetting(DEFAULT_ROOMS_JSON);
    expect([shipped.settle, shipped.wrap, shipped.count_on_join]).toEqual([false, false, false]);
    const missing = roomsSetting({ enabled: true });
    expect([missing.settle, missing.wrap, missing.count_on_join]).toEqual([false, false, false]);
    expect(roomsSetting({ settle: "true", wrap: 1 }).settle).toBe(false);
    expect(roomsSetting({ settle: true, wrap: true })).toMatchObject({ settle: true, wrap: true });
    // The drafts reps approve keep followups.enabled; the agent's own sends need followups.agent.
    expect(agentOff({ enabled: true })).toBe(false);
    expect(agentWorkOff({ enabled: true })).toBe(true);
    expect(agentWorkOff({ enabled: true, agent: "yes" })).toBe(true);
    expect(agentWorkOff({ enabled: false, agent: true })).toBe(true);
    expect(agentWorkOff({ agent: true })).toBe(false);
    expect(agentWorkOff(null)).toBe(true);
  });

  test("followup.settings keeps followups.agent as it was unless the manager's save sends it", () => {
    const before = { ...PILOT_FOLLOWUPS, agent: true, quiet: { from: 21, to: 9 } };
    const kept = followupSettingsValue(before, { per_run: 10 }, FOLLOWUP_SEGMENTS);
    expect(kept.ok && kept.value.agent).toBe(true);
    const off = followupSettingsValue(before, { agent: false }, FOLLOWUP_SEGMENTS);
    expect(off.ok && off.value.agent).toBe(false);
    const fresh = followupSettingsValue({ enabled: true }, {}, FOLLOWUP_SEGMENTS);
    expect(fresh.ok && fresh.value.agent).toBe(false);
  });
});

describe("Milestone 1 itself works with these settings (the fence leaves it alone)", () => {
  test("a seat sends a video link for its lead: the room is asked for, the worker makes it, and the link goes", async () => {
    const w = setup();
    const out = await w.rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
    });
    const id = String((out.room as Row).id);
    expect(w.room(id).state).toBe("requested");
    // The worker claims and opens it (contract v2 section 7), then tells sales-api.
    const t = w.db.iso();
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, { method: "PATCH", body: { state: "creating", claimed_at: t, worker_run: "run-1", version: Number(w.room(id).version) + 1 } });
    await w.io.db("cockpit_sales_room_events", { method: "POST", body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" } } });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
      method: "PATCH",
      body: { state: "open", join_url: MEET_URL, provider_meeting_id: "evt-1", opened_at: w.db.iso(), version: Number(w.room(id).version) + 1 },
    });
    const ready = await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    expect(ready.handled).toBe(true);
    await w.flush();
    expect(w.room(id).link_sent_at).toBeTruthy();
    expect(w.sends.length).toBeGreaterThan(0);
    // The rep marks the call: in the room, then the lead in. Nothing is booked (count_on_join off).
    const v = Number(w.room(id).version);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "host_in" });
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v + 1, what: "lead_in" });
    await w.flush();
    expect(w.room(id).state).toBe("lead_in");
    expect(w.bookings()).toHaveLength(0);
    expect(w.marks).toHaveLength(0);
  });
});

describe("automatic mode: refused while rooms.fallback.auto_on_miss is off (the rep presses)", () => {
  test("a room asked for with trigger auto is refused before anything is written; with automatic mode on it is made", async () => {
    const w = setup();
    const ask = { contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "fallback", item_kind: "lead" };
    const r = await refused(w.rooms.actions["room.create"]!(setter, { ...ask, request_id: crypto.randomUUID(), trigger: "auto" }));
    expect([r.status, r.extra.code, r.message]).toEqual([409, "disabled", ROOMS_COPY.auto_off]);
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(0);
    const on = setup({ rooms: { fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any", auto_on_miss: true } } });
    const made = await on.rooms.actions["room.create"]!(setter, { ...ask, request_id: crypto.randomUUID(), trigger: "auto" });
    expect((made.room as Row).state).toBe("requested");
  });
});

describe("live handover, standby rooms and offers: refused or inert while live.enabled is off", () => {
  test("I'm available is refused for a seat (nothing written); Away still works", async () => {
    const w = setup();
    const before = w.writes().length;
    const r = await refused(w.rooms.actions["live.availability"]!(closer, { state: "available" }));
    expect([r.status, r.extra.code, r.message]).toEqual([409, "disabled", LIVE_OFF]);
    expect(w.writes().length).toBe(before);
    expect(w.db.t("cockpit_sales_rooms").filter(x => x.purpose === "standby")).toHaveLength(0);
    const away = await w.rooms.actions["live.availability"]!(closer, { state: "away" });
    expect(away.me).toBeTruthy();
  });

  test("Take, Not now, ask and cancel are refused for a seat, and nothing is claimed", async () => {
    const w = setup();
    const liveId = fakeUuid();
    w.db.seed("cockpit_sales_live", [
      { id: liveId, request_id: fakeUuid(), contact_id: LEAD, asked_by: SETTER, kind: "demo", reason: "on_call", state: "offered", offered_to: [CLOSER], offer_until: new Date(w.clock.now + 2 * MIN).toISOString(), version: 1, reoffers: 0 },
    ]);
    for (const [action, body] of [
      ["live.take", { live_id: liveId, request_id: crypto.randomUUID() }],
      ["live.decline", { live_id: liveId, request_id: crypto.randomUUID() }],
      ["live.ask", { request_id: crypto.randomUUID(), contact_id: LEAD, kind: "demo", host: "closer" }],
      ["live.cancel", { request_id: crypto.randomUUID(), live_id: liveId }],
    ] as const) {
      const r = await refused(w.rooms.actions[action]!(closer, body as Row));
      expect([action, r.status, r.extra.code, r.message]).toEqual([action, 409, "disabled", LIVE_OFF]);
    }
    const l = w.db.t("cockpit_sales_live").find(x => x.id === liveId) as Row;
    expect([l.state, l.claimed_by ?? null, ((l.declined_by as unknown[] | null) ?? []).length]).toEqual(["offered", null, 0]);
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(0);
  });

  test("a seat cannot make a standby or handover room straight, even holding a claim", async () => {
    const w = setup();
    const standby = await refused(
      w.rooms.actions["room.create"]!(closer, { request_id: crypto.randomUUID(), contact_id: null, provider: "zoom", call_kind: "demo", purpose: "standby" }),
    );
    expect(standby.status).toBe(400);
    // A claim left in the table from before the switch went off.
    w.db.seed("cockpit_sales_live", [
      { id: fakeUuid(), request_id: fakeUuid(), contact_id: LEAD, asked_by: SETTER, kind: "demo", reason: "on_call", state: "claimed", claimed_by: CLOSER, claimed_at: w.db.iso(), offered_to: [CLOSER], offer_until: w.db.iso(), version: 2, reoffers: 0 },
    ]);
    const handover = await refused(
      w.rooms.actions["room.create"]!(closer, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "zoom", call_kind: "demo", purpose: "handover" }),
    );
    expect([handover.status, handover.extra.code, handover.message]).toEqual([409, "disabled", LIVE_OFF]);
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(0);
  });

  test("the desk's Slack press is refused, and the not-built ticks are inert", async () => {
    const w = setup();
    const r = await refused(w.rooms.desk["live.press"]!(desk, { slack_user_id: "U1", what: "available" }));
    expect([r.status, r.extra.code, r.message]).toEqual([409, "disabled", LIVE_OFF]);
    expect((await w.rooms.desk["thread.tick"]!(desk, {})).handled).toBe(false);
    expect((await w.rooms.desk["reply.seen"]!(desk, {})).handled).toBe(false);
    expect(w.writes()).toHaveLength(0);
  });

  test("a stored handover claim replayed through room.event (the cron door) is closed as it stands: no room, no link", async () => {
    const w = setup();
    const liveId = fakeUuid();
    w.db.seed("cockpit_sales_live", [
      { id: liveId, request_id: fakeUuid(), contact_id: LEAD, asked_by: SETTER, kind: "demo", reason: "on_call", state: "claimed", claim_room: "none", claimed_by: CLOSER, claimed_at: w.db.iso(), offered_to: [CLOSER], offer_until: w.db.iso(), version: 2, reoffers: 0 },
    ]);
    const ev = fakeUuid();
    w.db.seed("cockpit_sales_room_events", [
      { id: ev, room_id: null, kind: "live.claimed", source: "claim", dedupe_key: `live.claimed:${liveId}:0`, detail: { handover_id: liveId, claim_room: "none" }, at: new Date(w.clock.now - MIN).toISOString() },
    ]);
    const out = await w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [ev] } });
    expect(out.handled).toBe(1);
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(0);
    expect(w.sends).toHaveLength(0);
    const stored = w.db.t("cockpit_sales_room_events").find(e => e.id === ev) as Row;
    expect(stored.handled_at).toBeTruthy();
    expect((stored.detail as Row).skipped).toBe("live handover is switched off");
  });

  test("live.status answers for the rooms (Milestone 1's banner) with no offers and no standby", async () => {
    const w = setup();
    w.db.seed("cockpit_sales_live", [
      { id: fakeUuid(), request_id: fakeUuid(), contact_id: LEAD, asked_by: SETTER, kind: "demo", reason: "on_call", state: "offered", offered_to: [CLOSER], offer_until: new Date(w.clock.now + 2 * MIN).toISOString(), version: 1, reoffers: 0 },
    ]);
    const out = await w.rooms.actions["live.status"]!(closer, {});
    expect([out.live_enabled, out.offers, out.standby_on]).toEqual([false, [], false]);
  });
});

describe("counting a join as a booking: inert while rooms.count_on_join is off", () => {
  test("Zoom's join of the lead (the desk's room.event) and the cron door's tick book nothing and mark nothing", async () => {
    const w = setup();
    const id = seedOpenRoom(w, { state: "host_in", host_in_at: new Date(w.clock.now - MIN).toISOString(), version: 4 });
    seedLeadZoomJoin(w.db, id);
    const v = Number(w.room(id).version);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "lead_in" });
    await w.flush();
    expect(w.room(id).state).toBe("lead_in");
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await w.flush();
    expect(w.bookings()).toHaveLength(0);
    expect(w.marks).toHaveLength(0);
    expect(w.room(id).count_claimed_at ?? null).toBeNull();
  });

  test("a manager's count confirm is refused", async () => {
    const w = setup();
    const id = seedOpenRoom(w, { state: "lead_in", lead_in_at: w.db.iso(), count_result: "self_reported", version: 5 });
    const r = await refused(w.rooms.actions["room.count_confirm"]!(boss, { room_id: id }));
    expect([r.status, r.extra.code, r.message]).toEqual([409, "disabled", ROOMS_COPY.count_confirm_off]);
    expect(w.bookings()).toHaveLength(0);
  });
});

describe("settling no-shows automatically: inert while rooms.settle is off", () => {
  function expiredIntroRoom(w: ReturnType<typeof setup>): string {
    const start = w.clock.now - 25 * MIN;
    w.db.seed("cockpit_sales_appointments", [
      { appointment_id: "appt-m1", contact_id: LEAD, call_type: "intro", start_at: new Date(start).toISOString(), status: "confirmed", assigned_user_id: "G-setter" },
    ]);
    const id = seedOpenRoom(w, {
      appointment_id: "appt-m1",
      appointment_start_at: new Date(start).toISOString(),
      requested_at: new Date(start - 2 * MIN).toISOString(),
      link_sent_at: new Date(start - MIN).toISOString(),
      state: "expired",
      result: "no_join",
      ended_at: w.db.iso(),
    });
    w.db.seed("cockpit_sales_room_events", [
      { room_id: id, kind: "zoom.meeting.started", source: "zoom", dedupe_key: `zoom:meeting.started:${id}`, at: new Date(start).toISOString(), handled_at: new Date(start).toISOString() },
      { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}` },
    ]);
    return id;
  }

  test("room.event sweep.settle (the cron door's body, or the desk's) leases nothing, reads no lead and marks nothing", async () => {
    const w = setup();
    const id = expiredIntroRoom(w);
    const before = w.writes().length;
    const out = await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    expect([out.handled, out.off, out.note]).toEqual([0, "settle", ROOMS_COPY.settle_off]);
    expect(out.results).toEqual([{ room_id: id, handled: false, skipped: "settle_off" }]);
    expect(w.marks).toHaveLength(0);
    expect(w.writes().length).toBe(before);
    expect(w.ghlCalls).toHaveLength(0);
    expect(w.room(id).settled_mark ?? null).toBeNull();
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.dedupe_key === `sweep.settle:${id}`) as Row;
    expect([ev.handled_at ?? null, ev.lease_until ?? null]).toEqual([null, null]);
  });

  test("once a manager turns rooms.settle on, the same room is settled (the switch is the only thing that changed)", async () => {
    const w = setup({ rooms: { settle: true } });
    const id = expiredIntroRoom(w);
    const out = await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    expect(out.handled).toBe(1);
    expect(w.marks.map(m => m.status)).toEqual(["noshow"]);
  });
});

describe("rooms for booked calls: refused while rooms.wrap is off", () => {
  test("room.wrap is refused before HighLevel is read or a row written", async () => {
    const w = setup();
    const r = await refused(w.rooms.actions["room.wrap"]!(setter, { appointment_id: "appt-wrap", request_id: crypto.randomUUID() }));
    expect([r.status, r.extra.code, r.message]).toEqual([409, "disabled", ROOMS_COPY.wrap_off]);
    expect(w.ghlCalls).toHaveLength(0);
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(0);
  });
});

describe("the follow-up agent's own sends: refused while followups.agent is off", () => {
  function opener(w: ReturnType<typeof setup>, waveId: string): string {
    const id = fakeUuid();
    w.db.seed("cockpit_sales_followups", [
      { id, contact_id: LEAD, owner_email: SETTER, segment: "reactivate", channel: "whatsapp_template", status: "draft", touch: 1, body: "Hi Huda", created_at: w.db.iso(), context: { wave_id: waveId } },
    ]);
    w.db.seed("cockpit_sales_followup_meta", [
      { followup_id: id, wave_id: waveId, send_after: new Date(w.clock.now - MIN).toISOString(), approved_by: boss.email, held_by: null },
    ]);
    return id;
  }

  test("a manager cannot start or resume a wave or approve a batch; pause and stop still work", async () => {
    const w = setup();
    const start = await refused(w.agent.actions["followup.wave"]!(boss, { request_id: crypto.randomUUID(), op: "start", pool: "never_booked" }));
    expect([start.status, start.message]).toEqual([409, AGENT_COPY.agent_off_screen]);
    expect(w.db.t("cockpit_sales_followup_waves")).toHaveLength(0);
    const waveId = fakeUuid();
    w.db.seed("cockpit_sales_followup_waves", [{ id: waveId, pool: "never_booked", segment: "reactivate", state: "paused", per_day: 40 }]);
    const resume = await refused(w.agent.actions["followup.wave"]!(boss, { op: "resume", wave_id: waveId }));
    expect([resume.status, resume.message]).toEqual([409, AGENT_COPY.agent_off_screen]);
    const id = opener(w, waveId);
    const batch = await refused(w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), ids: [id] }));
    expect([batch.status, batch.message]).toEqual([409, AGENT_COPY.agent_off_screen]);
    const stop = await w.agent.actions["followup.wave"]!(boss, { op: "stop", wave_id: waveId });
    expect((stop.wave as Row).state).toBe("done");
  });

  test("the desk's paced send (followup.send_due) holds every send and sends nothing", async () => {
    const w = setup();
    const waveId = fakeUuid();
    w.db.seed("cockpit_sales_followup_waves", [{ id: waveId, pool: "never_booked", segment: "reactivate", state: "running", per_day: 40 }]);
    const id = opener(w, waveId);
    const r = await refused(w.agent.desk["followup.send_due"]!(desk, { id }));
    expect([r.status, r.message, r.extra.hold_all]).toEqual([409, AGENT_COPY.agent_off, true]);
    expect(w.sends).toHaveLength(0);
  });

  test("no kind is set to send by itself; Approve and Off still save", async () => {
    const w = setup();
    for (const level of ["send_unless_stopped", "sends_by_itself"]) {
      const r = await refused(w.agent.actions["followup.level"]!(boss, { kind_key: "confirm.ar.whatsapp", level }));
      expect([r.status, r.message]).toEqual([409, AGENT_COPY.level_agent_off]);
    }
    expect(w.db.t("cockpit_sales_followup_levels")).toHaveLength(0);
    await w.agent.actions["followup.level"]!(boss, { kind_key: "confirm.ar.whatsapp", level: "off" });
    await w.agent.actions["followup.level"]!(boss, { kind_key: "confirm.ar.whatsapp", level: "approve" });
    expect((w.db.t("cockpit_sales_followup_levels")[0] as Row).level).toBe("approve");
  });

  test("with followups.agent on, the same wave start passes the agent's gate", async () => {
    const w = setup({ followups: { agent: true } });
    const out = await w.agent.actions["followup.wave"]!(boss, { request_id: crypto.randomUUID(), op: "start", pool: "never_booked" });
    expect((out.wave as Row).state).toBe("running");
  });
});

describe("a switch is turned on only by a manager action that writes an audit row", () => {
  const src = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8");

  test("sales-api writes no rooms, live or threads setting at all; followups only through followup.settings (a manager, audited)", () => {
    const files = ["index.ts", "rooms.ts", "followupAgent.ts", "sendrules.ts", "liveio.ts", "dialer.ts", "lib.ts", "roomlogic.ts"];
    const writers: string[] = [];
    for (const f of files) {
      const s = src(f);
      // Every write path to the settings table: saveSettingIf(key...), and a PATCH or POST to cockpit_sales_settings.
      for (const m of s.matchAll(/saveSettingIf\(\s*("[a-z_]+"|key)/g)) writers.push(`${f}:saveSettingIf(${m[1]})`);
      for (const m of s.matchAll(/(?:svc|io\.db)\(\s*["`]cockpit_sales_settings[^"`]*["`]\s*,\s*\{\s*method:\s*"(POST|PATCH)"[\s\S]{0,200}?key:\s*("[a-z_]+"|key)/g))
        writers.push(`${f}:${m[1]}(${m[2]})`);
    }
    for (const w of writers) expect(w).not.toMatch(/"(rooms|live|threads)"/);
    // The generic setting.save takes crm_writes only; the follow-ups setting is written by followup.settings alone.
    const index = src("index.ts");
    expect(index).toMatch(/async function settingSave[\s\S]{0,120}needManager\(who\);[\s\S]{0,120}if \(key !== "crm_writes"\) throw/);
    expect(index).toMatch(/async function followupSettings\(who: Who, b: Row\) \{\s*needManager\(who\);[\s\S]{0,1400}await audit\(who, "followup\.settings"/);
    expect(writers.filter(w => w.includes('"followups"'))).toEqual(['index.ts:saveSettingIf("followups")']);
  });

  test("the database holds it too: 20261004a's settings guard refuses a switch turned on without a manager, and audits every change", () => {
    const sql = readFileSync(new URL("../../migrations/20261004a_live_calls_hardening_2.sql", import.meta.url), "utf8");
    expect(sql).toContain("create trigger cockpit_sales_settings_guard");
    expect(sql).toMatch(/p\.role = 'manager' and p\.active/);
    expect(sql).toContain("'settings.switch'");
    for (const sw of ["rooms.enabled", "rooms.settle", "rooms.wrap", "rooms.count_on_join", "live.enabled", "followups.agent", "threads.enabled"])
      expect(sql).toContain(`'${sw}'`);
  });
});
