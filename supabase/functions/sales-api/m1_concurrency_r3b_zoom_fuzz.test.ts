// bun test supabase/functions/sales-api/m1_concurrency_r3b_zoom_fuzz.test.ts
//
// Milestone 1, video-link round 3 (second pass), angle: concurrency and
// idempotency, repeated and out-of-order events. A seeded search over a
// closer's Zoom video-link room (manual, demo) with the pilot's settings
// (m1-scope.md section 3). Each seed draws one realistic set of Zoom
// webhooks for the call (the host's laptop and phone sessions, Zoom's start
// and end of the meeting, the lead's knock, join and leave), then:
//   - the reference: every event read once, in Zoom's own order, one after
//     another, at the same moment the run reads them;
//   - the run: the same events read by sales-api at once, in a random order,
//     some twice (the door's forward and the sweep's replay), each request
//     starting after a random number of turns.
// Zoom does not order its webhooks and the door forwards each on its own, so
// the room must end the same both ways (sales-api orders events by their own
// time). Nothing else moves the room (no press, no sweep, no tick).
//
// A failing seed is a finding (the failure names the seed and the order).
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const CLOSER = "stress-m1c3bz-closer@stress.invalid";
const LEAD = "stress-m1c3bz-lead";
const MEETING = "85012345678";
const ZOOM_URL = `https://us06web.zoom.us/j/${MEETING}?pwd=stress`;
const SEEDS = Number(process.env.M1C3BZ_SEEDS ?? 300);
const MODE = (process.env.M1C3BZ_MODE ?? "together") as "together" | "one_by_one";

const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const turn = () => new Promise<void>(r => setTimeout(r, 0));

/** One webhook as Zoom sends it: the event, its own time, the meeting instance, and the participant. */
interface Hook {
  event: string;
  at: number;
  instance: string;
  participant?: Row;
  name: string;
}

const hostP = (t: number, device: string, join: string, leaving = false): Row => ({
  id: "Z-closer",
  user_id: join,
  participant_uuid: `puuid-host-${device}`,
  user_name: "Omar Closer",
  email: CLOSER,
  ...(leaving ? { leave_time: new Date(t).toISOString() } : { join_time: new Date(t).toISOString() }),
});
const leadP = (t: number, join: string, what: "join" | "leave" | "wait"): Row => ({
  id: "",
  user_id: join,
  participant_uuid: "puuid-lead-1",
  user_name: "Huda Ali",
  ...(what === "join" ? { join_time: new Date(t).toISOString() } : what === "leave" ? { leave_time: new Date(t).toISOString() } : { date_time: new Date(t).toISOString() }),
});

/**
 * A realistic call, from the room's open at t0: the closer starts the
 * meeting on the laptop; maybe moves to the phone; the lead maybe knocks and
 * is let in, maybe leaves; maybe the closer drops and starts again (a new
 * instance); maybe the meeting ends.
 */
function drawCall(rnd: () => number, t0: number): Hook[] {
  const out: Hook[] = [];
  let inst = "inst-1";
  let t = t0 + Math.floor(20 + rnd() * 60) * S;
  out.push({ event: "meeting.started", at: t, instance: inst, name: "start" });
  out.push({ event: "meeting.participant_joined", at: t, instance: inst, participant: hostP(t, "laptop", "100"), name: "host.laptop.in" });
  let hostDevice = "laptop";
  let hostJoin = "100";
  const leadComes = rnd() < 0.7;
  const knocks = leadComes && rnd() < 0.8;
  const switchDevice = rnd() < 0.4;
  const restart = rnd() < 0.3;
  const leadLeaves = leadComes && rnd() < 0.4;
  const ends = rnd() < 0.6;
  let leadIn = false;
  // The lead knocks a little after the host is in, and is let in a little after.
  if (knocks) {
    t += Math.floor(10 + rnd() * 120) * S;
    out.push({ event: "meeting.participant_joined_waiting_room", at: t, instance: inst, participant: leadP(t, "200", "wait"), name: "lead.knock" });
  }
  if (switchDevice) {
    // The phone joins, then the laptop leaves a moment later (Zoom's "move to phone").
    t += Math.floor(5 + rnd() * 60) * S;
    out.push({ event: "meeting.participant_joined", at: t, instance: inst, participant: hostP(t, "phone", "101"), name: "host.phone.in" });
    const off = t + Math.floor(1 + rnd() * 4) * S;
    out.push({ event: "meeting.participant_left", at: off, instance: inst, participant: hostP(off, "laptop", "100", true), name: "host.laptop.out" });
    t = off;
    hostDevice = "phone";
    hostJoin = "101";
  }
  if (leadComes) {
    t += Math.floor(5 + rnd() * 60) * S;
    out.push({ event: "meeting.participant_joined", at: t, instance: inst, participant: leadP(t, "201", "join"), name: "lead.in" });
    leadIn = true;
  }
  if (restart && !leadIn) {
    // The closer's only device drops; Zoom ends the empty meeting; the closer starts it again.
    t += Math.floor(10 + rnd() * 60) * S;
    out.push({ event: "meeting.participant_left", at: t, instance: inst, participant: hostP(t, hostDevice, hostJoin, true), name: `host.${hostDevice}.drop` });
    const endAt = t + Math.floor(1 + rnd() * 5) * S;
    out.push({ event: "meeting.ended", at: endAt, instance: inst, name: "end.empty" });
    inst = "inst-2";
    t = endAt + Math.floor(5 + rnd() * 40) * S;
    out.push({ event: "meeting.started", at: t, instance: inst, name: "restart" });
    out.push({ event: "meeting.participant_joined", at: t, instance: inst, participant: hostP(t, "laptop", "102"), name: "host.laptop.back" });
    hostDevice = "laptop";
    hostJoin = "102";
  }
  if (leadLeaves) {
    t += Math.floor(30 + rnd() * 300) * S;
    out.push({ event: "meeting.participant_left", at: t, instance: inst, participant: leadP(t, "201", "leave"), name: "lead.out" });
  }
  if (ends) {
    t += Math.floor(10 + rnd() * 120) * S;
    out.push({ event: "meeting.participant_left", at: t, instance: inst, participant: hostP(t, hostDevice, hostJoin, true), name: `host.${hostDevice}.out` });
    const endAt = t + Math.floor(1 + rnd() * 3) * S;
    out.push({ event: "meeting.ended", at: endAt, instance: inst, name: "end" });
  }
  return out;
}

function world() {
  const w = fakeWorld();
  const audits: Row[] = [];
  const errors: string[] = [];
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
    { key: "whatsapp_guard", value: { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW" }]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" };
  w.routes.push((m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    return null as unknown as Row;
  });
  const sent = new Map<string, Row>();
  async function send(requestId: string, contactId: string, channel: string, body: string) {
    const again = sent.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sent", provider_status: "sent", created_at: w.db.iso(), ghl_asked_at: w.db.iso(), ghl_message_id: `msg-${requestId.slice(-6)}` };
    sent.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
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
    sendText: (_who, b) => send(b.request_id, b.contact_id, b.channel, b.body),
    sendTemplate: (_who, t) => send(t.requestId, t.contactId, "whatsapp", `Join: ${t.buttonVariable?.join_code ?? ""}`),
    upcoming: async () => null,
    sentSince: async () => null,
  };
  const rooms = makeRooms(deps);
  return { ...w, io, rooms, audits, errors };
}
type W = ReturnType<typeof world>;

/** The room as the worker opens it (state open, the Zoom meeting) and its link sent, at t0. */
async function openRoom(w: W): Promise<string> {
  let stop = false;
  const worker = (async () => {
    for (let i = 0; i < 400 && !stop; i++) {
      await turn();
      const r = w.db.t("cockpit_sales_rooms").find(x => x.state === "requested");
      if (!r) continue;
      const id = String(r.id);
      await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
        method: "PATCH",
        body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 },
      });
      await w.db.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
        method: "POST",
        body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made." },
        prefer: "resolution=ignore-duplicates",
      });
      const cur = w.db.t("cockpit_sales_rooms").find(x => x.id === id) as Row;
      await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
        method: "PATCH",
        body: {
          state: "open",
          join_url: ZOOM_URL,
          provider_meeting_id: MEETING,
          opened_at: w.db.iso(),
          host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
          ends_at: new Date(w.clock.now + 60 * MIN).toISOString(),
          version: Number(cur.version) + 1,
        },
      });
      await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    }
  })();
  const out = await w.rooms.actions["room.create"]!(closer, { contact_id: LEAD, provider: "zoom", call_kind: "demo", purpose: "manual", request_id: crypto.randomUUID() });
  stop = true;
  await worker;
  for (let i = 0; i < 6; i++) {
    await turn();
    await w.flush();
  }
  return String((out.room as Row).id);
}

/** The door's stored row for one webhook (source zoom, its own dedupe key). */
function store(w: W, roomId: string, h: Hook): string {
  const p = h.participant;
  const who = p ? String(p.participant_uuid ?? p.user_id ?? "") : "";
  const when = p ? String(p.join_time ?? p.leave_time ?? h.at) : "";
  const key = p ? `zoom:${h.event}:${h.instance}:${who}:${when}` : `zoom:${h.event}:${h.instance}`;
  const have = w.db.t("cockpit_sales_room_events").find(e => e.dedupe_key === key);
  if (have) return String(have.id);
  const id = fakeUuid();
  w.db.seed("cockpit_sales_room_events", [
    {
      id,
      room_id: roomId,
      kind: `zoom.${h.event}`,
      source: "zoom",
      dedupe_key: key,
      at: new Date(h.at).toISOString(),
      text: `Zoom: ${h.event}.`,
      detail: {
        event: h.event,
        event_ts: h.at,
        payload: { object: { id: MEETING, uuid: h.instance, host_id: "Z-closer", topic: "Mahara call", ...(p ? { participant: p } : {}) } },
      },
    },
  ]);
  return id;
}

async function forward(w: W, evId: string, h: Hook, name: string) {
  try {
    await w.rooms.desk["room.event"]!(desk, { kind: `zoom.${h.event}`, event_id: evId });
  } catch (e) {
    if (!(e instanceof ApiRefusal)) w.errors.push(`${name}: ${String((e as Error)?.message ?? e)}`);
  }
}

/** The sweep's replay of whatever is left unhandled (its E1), until nothing is. */
async function replayLeft(w: W) {
  for (let i = 0; i < 4; i++) {
    const left = w.db.t("cockpit_sales_room_events").filter(e => e.source === "zoom" && !e.handled_at).map(e => String(e.id));
    if (!left.length) return;
    for (const e of w.db.t("cockpit_sales_room_events")) if (e.source === "zoom" && !e.handled_at) e.lease_until = null;
    try {
      await w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: left } });
    } catch (e) {
      if (!(e instanceof ApiRefusal)) w.errors.push(`replay: ${String((e as Error)?.message ?? e)}`);
    }
    await w.flush();
  }
}

function outcome(w: W, id: string): Row {
  const r = w.db.t("cockpit_sales_rooms").find(x => x.id === id) as Row;
  const t = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
  return {
    state: r.state,
    result: r.result ?? null,
    end_reason: r.end_reason ?? null,
    lead_in_at: t(r.lead_in_at),
    host_in: ["host_in", "lead_in"].includes(String(r.state)) || null,
    knock_stands: Boolean(r.lead_waiting_at) && !(r.lead_in_at && Date.parse(String(r.lead_waiting_at)) <= Date.parse(String(r.lead_in_at))),
  };
}

async function run(seed: number, mode: "together" | "one_by_one" = MODE): Promise<{ ok: boolean; detail: Row }> {
  const rnd = prng(seed);
  // The reference: each webhook read once, in Zoom's order, as each arrives.
  const ref = world();
  const refId = await openRoom(ref);
  const t0 = ref.clock.now;
  const hooks = drawCall(rnd, t0);
  const last = Math.max(...hooks.map(h => h.at));
  const sorted = [...hooks].sort((a, b) => a.at - b.at);
  // Both runs read at the same moment (after the call), so only the order differs.
  ref.clock.now = last + 10 * S;
  for (const h of sorted) {
    await forward(ref, store(ref, refId, h), h, h.name);
    await ref.flush();
  }
  await replayLeft(ref);
  // The run: every webhook stored by the door, then read at once, in a random
  // order, some twice, each read starting after a random number of turns.
  const w = world();
  const id = await openRoom(w);
  const shift = w.clock.now - t0;
  const moved = hooks.map(h => ({ ...h, at: h.at + shift, participant: h.participant ? JSON.parse(JSON.stringify(h.participant).replace(/"(\d{4}-\d{2}-\d{2}T[^"]+)"/g, (_m, iso) => `"${new Date(Date.parse(iso) + shift).toISOString()}"`)) : undefined }));
  w.clock.now = last + shift + 10 * S;
  const order = moved.map((h, i) => ({ h, i, k: rnd() })).sort((a, b) => a.k - b.k);
  // M1C3BZ_HOSTFIRST: the closer's first join read before anything else (the
  // replay-order finding left out), to look for any other divergence.
  if (process.env.M1C3BZ_HOSTFIRST) {
    const first = order.findIndex(o => o.h.name === "host.laptop.in");
    if (first > 0) order.unshift(...order.splice(first, 1));
  }
  const reads: (() => Promise<void>)[] = [];
  const names: string[] = [];
  for (const { h } of order) {
    const evId = store(w, id, h);
    const times = rnd() < 0.25 ? 2 : 1;
    for (let n = 0; n < times; n++) {
      const wait = Math.floor(rnd() * 12);
      names.push(`${h.name}${n ? "(again)" : ""}+${wait}`);
      reads.push(async () => {
        if (mode === "together") for (let k = 0; k < wait; k++) await turn();
        await forward(w, evId, h, h.name);
      });
    }
  }
  // "together": every read at once; "one_by_one": the same random order, each
  // read finished before the next starts (out of order, never at once).
  if (mode === "together" && process.env.M1C3BZ_HOSTFIRST) {
    await (reads.shift() as () => Promise<void>)();
    await w.flush();
  }
  if (mode === "together") await Promise.all(reads.map(r => r()));
  else
    for (const r of reads) {
      await r();
      await w.flush();
    }
  await w.flush();
  await replayLeft(w);
  const a = outcome(ref, refId);
  const b = outcome(w, id);
  // The reference's lead join time, moved by the shift, for the comparison.
  const aCmp = { ...a, lead_in_at: a.lead_in_at ? new Date(Date.parse(String(a.lead_in_at)) + shift).toISOString() : null };
  const why: string[] = [];
  if (JSON.stringify(aCmp) !== JSON.stringify(b)) why.push("differs");
  // Whether the room's host_in_at is the moment a write landed (the
  // database's stamp, after every event's own time), not a Zoom time.
  const hostAt = Date.parse(String((w.db.t("cockpit_sales_rooms").find(x => x.id === id) as Row).host_in_at ?? ""));
  const stamped = Number.isFinite(hostAt) && hostAt > last + shift;
  if (ref.errors.length || w.errors.length || w.logs.some(l => l.startsWith("background:"))) why.push("errors");
  const ends = w.audits.filter(x => x.action === "room.end" && x.entityId === id).length;
  if (ends > 1) why.push("two room.end rows");
  return {
    ok: why.length === 0,
    detail: { seed, mode, why, pair: `${String(aCmp.state)}/${String(aCmp.result)} -> ${String(b.state)}/${String(b.result)}${stamped ? " (host_in_at stamped at the write)" : ""}`, call: sorted.map(h => `${h.name}@${Math.round((h.at - t0) / 1000)}s`).join(" "), reads: names.join(" "), reference: aCmp, concurrent: b, errors: [...ref.errors, ...w.errors].slice(0, 3) },
  };
}

describe("m1 concurrency r3b zoom fuzz: one closer's Zoom room, Zoom's webhooks read at once and out of order", () => {
  test(`m1 zoom fuzz: ${SEEDS} seeded calls, each read in order and then all at once`, async () => {
    const bad: Row[] = [];
    const only = process.env.M1C3BZ_SEED ? process.env.M1C3BZ_SEED.split(",").map(Number) : null;
    for (let s = 1; s <= SEEDS; s++) {
      if (only && !only.includes(s)) continue;
      const out = await run(s);
      if (!out.ok) bad.push(out.detail);
    }
    if (bad.length && process.env.M1C3BZ_DEBUG) {
      const pairs = new Map<string, number[]>();
      for (const b of bad) pairs.set(String(b.pair), [...(pairs.get(String(b.pair)) ?? []), Number(b.seed)]);
      console.log(JSON.stringify(Object.fromEntries([...pairs].map(([k, v]) => [k, v.slice(0, 12)])), null, 1));
      if (process.env.M1C3BZ_DEBUG === "full") console.log(JSON.stringify(bad.slice(0, 6), null, 1));
    }
    expect({ failing_seeds: bad.length, first: bad[0] ?? null }).toEqual({ failing_seeds: 0, first: null });
  }, 900_000);
});
