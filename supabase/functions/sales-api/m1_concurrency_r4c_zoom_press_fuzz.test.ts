// bun test supabase/functions/sales-api/m1_concurrency_r4c_zoom_press_fuzz.test.ts
//
// Milestone 1 (the video link when a call fails), video-link round 4 (third
// pass), angle: concurrency and idempotency. A seeded search over a closer's
// Zoom video link (manual, demo) with the pilot's settings (m1-scope.md
// section 3: rooms on, both providers, the three lanes on, test_only with the
// lead on the test list, count_on_join, settle, wrap and auto_on_miss off,
// short_link off, live handover off; the WhatsApp gate locked, so the link
// goes by email). What round 3b's Zoom fuzz left out: the closer's own
// presses from two tabs (I'm in, The lead is in, That was not the lead,
// Still on it, End, We are on the phone, Cancel, Also send by email), each
// with the version that tab last read, landing among Zoom's webhooks (late,
// out of order, some read twice) and the minute's ticks.
//
// Whatever the order, Zoom's own word stands: a lead Zoom saw join before the
// room closed is on the room (lead_in_at, result joined), a room the lead never
// joined never reads joined, a room whose meeting Zoom ended with the lead in
// it is closed; one room.end audit row; one email; no press answers anything
// but a sentence; no background job throws.
//
// A failing seed is a finding (the failure names the seed and the order).
// Nothing reaches HighLevel, Zoom, Google or Slack: every lead and seat is
// invented (stress-..., @stress.invalid).
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const CLOSER = "stress-m1c4c-closer@stress.invalid";
const LEAD = "stress-m1c4c-lead";
const MEETING = "85012349999";
const ZOOM_URL = `https://us06web.zoom.us/j/${MEETING}?pwd=stress`;
const SEEDS = Number(process.env.M1C4C_SEEDS ?? 150);
const FINAL = ["ended", "expired", "failed", "cancelled"];

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

/** A realistic call from the room's open at t0 (round 3b's draw, with the lead's join early enough to meet the presses). */
function drawCall(rnd: () => number, t0: number): Hook[] {
  const out: Hook[] = [];
  const inst = "inst-1";
  let t = t0 + Math.floor(20 + rnd() * 90) * S;
  out.push({ event: "meeting.started", at: t, instance: inst, name: "start" });
  out.push({ event: "meeting.participant_joined", at: t, instance: inst, participant: hostP(t, "laptop", "100"), name: "host.in" });
  const leadComes = rnd() < 0.75;
  const knocks = leadComes && rnd() < 0.7;
  const ends = rnd() < 0.6;
  if (knocks) {
    t += Math.floor(10 + rnd() * 120) * S;
    out.push({ event: "meeting.participant_joined_waiting_room", at: t, instance: inst, participant: leadP(t, "200", "wait"), name: "lead.knock" });
  }
  if (leadComes) {
    t += Math.floor(5 + rnd() * 90) * S;
    out.push({ event: "meeting.participant_joined", at: t, instance: inst, participant: leadP(t, "201", "join"), name: "lead.in" });
  }
  if (ends) {
    t += Math.floor(60 + rnd() * 600) * S;
    if (leadComes && rnd() < 0.5) out.push({ event: "meeting.participant_left", at: t, instance: inst, participant: leadP(t, "201", "leave"), name: "lead.out" });
    t += Math.floor(1 + rnd() * 10) * S;
    out.push({ event: "meeting.participant_left", at: t, instance: inst, participant: hostP(t, "laptop", "100", true), name: "host.out" });
    const endAt = t + Math.floor(1 + rnd() * 3) * S;
    out.push({ event: "meeting.ended", at: endAt, instance: inst, name: "end" });
  }
  return out;
}

function world(seed: number) {
  const w = fakeWorld();
  const rnd = prng(seed * 7919 + 13);
  const audits: Row[] = [];
  const errors: string[] = [];
  const emails: { requestId: string; at: number; state: string }[] = [];
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
    if (m === "GET" && p.startsWith("/conversations/search")) return { conversations: [] };
    return null as unknown as Row;
  });
  const sent = new Map<string, Row>();
  async function send(requestId: string, contactId: string, channel: string, body: string, beforeSend?: () => Promise<boolean>) {
    const again = sent.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: w.db.iso() };
    sent.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    for (let k = Math.floor(rnd() * 4); k > 0; k--) await turn();
    if (beforeSend && !(await beforeSend())) {
      sent.delete(requestId);
      w.db.t("cockpit_sales_messages").splice(w.db.t("cockpit_sales_messages").indexOf(row), 1);
      throw new ApiRefusal("Not sent: the room closed before the link went.", 409, { code: "stopped", certain: true });
    }
    row.ghl_asked_at = w.db.iso();
    const room = w.db.t("cockpit_sales_rooms").find(r => String(body).includes(String(r.join_url ?? "-")));
    emails.push({ requestId, at: w.clock.now, state: String(room?.state ?? "?") });
    Object.assign(row, { state: "sent", provider_status: "sent", ghl_message_id: `msg-${requestId.slice(-6)}` });
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
    sendText: (_who, b, opts) => send(b.request_id, b.contact_id, b.channel, b.body, opts?.beforeSend),
    sendTemplate: (_who, t) => send(t.requestId, t.contactId, "whatsapp", `Join: ${t.buttonVariable?.join_code ?? ""}`, t.beforeSend),
    upcoming: async () => null,
    sentSince: async () => null,
  };
  const rooms = makeRooms(deps);
  return { ...w, io, rooms, audits, errors, emails, rnd };
}
type W = ReturnType<typeof world>;

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
  const when = p ? String(p.join_time ?? p.leave_time ?? p.date_time ?? h.at) : "";
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

type Press = "host_in" | "lead_in" | "not_lead" | "still_on" | "end" | "on_phone" | "cancel" | "send";

interface Act {
  at: number;
  name: string;
  run: () => Promise<void>;
}

async function run(seed: number): Promise<{ ok: boolean; detail: Row }> {
  const rnd = prng(seed);
  const w = world(seed);
  const id = await openRoom(w);
  const t0 = w.clock.now;
  const hooks = drawCall(rnd, t0);
  const seen = [Number((w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row).version), 0];
  seen[1] = seen[0] as number;
  const pressed: { press: Press; tab: number; at: number; out: string }[] = [];
  const acts: Act[] = [];
  const room = () => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  const safe = async (name: string, f: () => Promise<unknown>): Promise<Row | null> => {
    try {
      return (await f()) as Row;
    } catch (e) {
      if (!(e instanceof ApiRefusal)) w.errors.push(`${name}: ${String((e as Error)?.message ?? e)}`);
      return null;
    }
  };
  // Zoom's webhooks: each read a little after it happened (the door's
  // forward), some much later (the sweep's replay), a quarter read twice.
  for (const h of hooks) {
    const reads = rnd() < 0.25 ? 2 : 1;
    for (let n = 0; n < reads; n++) {
      const lag = rnd() < 0.15 ? Math.floor(25 + rnd() * 60) * S : Math.floor(rnd() * 6) * S;
      acts.push({
        at: h.at + lag,
        name: `${h.name}${n ? "(again)" : ""}`,
        run: async () => {
          const ev = store(w, id, h);
          await safe(h.name, () => w.rooms.desk["room.event"]!(desk, { kind: `zoom.${h.event}`, event_id: ev }));
        },
      });
    }
  }
  // The closer's presses, from two tabs, each with the version its tab last read.
  const menu: Press[] = ["host_in", "lead_in", "not_lead", "still_on", "end", "on_phone", "cancel", "send"];
  const n = 1 + Math.floor(rnd() * 5);
  const lastHook = Math.max(...hooks.map(h => h.at));
  for (let i = 0; i < n; i++) {
    const press = menu[Math.floor(rnd() * menu.length)] as Press;
    const tab = rnd() < 0.5 ? 0 : 1;
    const at = t0 + Math.floor(rnd() * Math.max(60, (lastHook - t0) / S + 60)) * S;
    const confirm = rnd() < 0.6;
    acts.push({
      at,
      name: `${press}.${tab}`,
      run: async () => {
        const v = seen[tab] as number;
        let out: Row | null = null;
        if (press === "send") out = await safe(press, () => w.rooms.actions["room.send"]!(closer, { room_id: id, channel: "email", request_id: crypto.randomUUID() }));
        else if (press === "end" || press === "on_phone" || press === "cancel")
          out = await safe(press, () => w.rooms.actions["room.end"]!(closer, { room_id: id, version: v, reason: press, ...(confirm ? { confirm: true } : {}) }));
        else out = await safe(press, () => w.rooms.actions["room.mark"]!(closer, { room_id: id, version: v, what: press }));
        const r = out?.room as Row | undefined;
        if (r && String(r.id) === id) seen[tab] = Number(r.version);
        pressed.push({ press, tab, at, out: out ? "ok" : "refused" });
      },
    });
  }
  // Each tab reads the room now and then (room.status).
  for (let tab = 0; tab < 2; tab++)
    for (let k = 0; k < 3; k++)
      acts.push({
        at: t0 + Math.floor(rnd() * Math.max(60, (lastHook - t0) / S + 60)) * S,
        name: `status.${tab}`,
        run: async () => {
          const out = await safe("status", () => w.rooms.actions["room.status"]!(closer, { room_id: id }));
          const r = out?.room as Row | undefined;
          if (r) seen[tab] = Number(r.version);
        },
      });
  // The minute's ticks.
  for (let t = t0 + MIN; t <= lastHook + 3 * MIN; t += MIN)
    acts.push({ at: t, name: "tick", run: async () => void (await safe("tick", () => w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } }))) });
  acts.sort((a, b) => a.at - b.at);
  // Actions within the same three seconds run at once, each after a few turns.
  const order: string[] = [];
  for (let i = 0; i < acts.length; ) {
    const start = (acts[i] as Act).at;
    const group: Act[] = [];
    while (i < acts.length && (acts[i] as Act).at - start <= 3 * S) group.push(acts[i++] as Act);
    if (w.clock.now < start) w.clock.now = start;
    order.push(group.map(a => a.name).join("|"));
    await Promise.all(
      group.map(async a => {
        for (let k = Math.floor(rnd() * 8); k > 0; k--) await turn();
        await a.run();
      }),
    );
    await w.flush();
  }
  // What is left unhandled is replayed (the sweep's E1), then the ticks.
  for (let k = 0; k < 3; k++) {
    const left = w.db.t("cockpit_sales_room_events").filter(e => e.source === "zoom" && !e.handled_at).map(e => String(e.id));
    if (!left.length) break;
    for (const e of w.db.t("cockpit_sales_room_events")) if (e.source === "zoom" && !e.handled_at) e.lease_until = null;
    w.clock.now += 25 * S;
    await safe("replay", () => w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: left } }));
    await w.flush();
  }
  await w.flush();

  const r = room();
  const why: string[] = [];
  const t = (v: unknown) => (v ? Date.parse(String(v)) : null);
  const leadJoin = hooks.find(h => h.name === "lead.in");
  const endHook = hooks.find(h => h.name === "end");
  const notLead = pressed.some(p => p.press === "not_lead" && p.out === "ok");
  const markedIn = pressed.some(p => p.press === "lead_in" && p.out === "ok");
  const closedAt = FINAL.includes(String(r.state)) ? t(r.ended_at) : null;
  if (w.errors.length || w.logs.some(l => l.startsWith("background:"))) why.push("errors");
  const ends = w.audits.filter(a => a.action === "room.end" && a.entityId === id && !(a.metadata as Row | undefined)?.after_close).length;
  if (ends > 1) why.push(`room.end audited ${ends} times`);
  if (w.emails.length > 1) why.push(`${w.emails.length} emails`);
  // Zoom saw the lead in before the room closed: the room keeps the join.
  if (leadJoin && !notLead && (closedAt === null || leadJoin.at <= closedAt)) {
    if (!r.lead_in_at) why.push("zoom's lead join before the close is not on the room");
    else if (closedAt !== null && r.result !== "joined") why.push(`zoom's lead join before the close, result ${String(r.result)}`);
  }
  // Nobody came: never joined.
  if (!leadJoin && !markedIn && r.result === "joined") why.push("joined with no join");
  // Zoom ended the meeting the lead was in: the room is closed.
  if (leadJoin && endHook && !notLead && !FINAL.includes(String(r.state))) why.push(`zoom ended the meeting with the lead in it, room still ${String(r.state)}`);
  const detail: Row = {
    seed,
    why,
    room: { state: r.state, result: r.result ?? null, end_reason: r.end_reason ?? null, lead_in_at: r.lead_in_at ?? null, ended_at: r.ended_at ?? null, version: r.version },
    call: hooks.map(h => `${h.name}@${Math.round((h.at - t0) / 1000)}s`).join(" "),
    presses: pressed.map(p => `${p.press}.${p.tab}@${Math.round((p.at - t0) / 1000)}s:${p.out}`).join(" "),
    order: order.map(o => o).join(" > "),
    errors: [...w.errors, ...w.logs.filter(l => l.startsWith("background:"))].slice(0, 4),
  };
  return { ok: why.length === 0, detail };
}

describe("m1 concurrency r4c zoom press fuzz: a closer's Zoom room, Zoom's webhooks and the closer's presses from two tabs at once", () => {
  test(`m1 zoom press fuzz: ${SEEDS} seeded calls with the pilot's settings`, async () => {
    const bad: Row[] = [];
    const kinds = new Map<string, number>();
    const only = process.env.M1C4C_SEED ? process.env.M1C4C_SEED.split(",").map(Number) : null;
    const from = Number(process.env.M1C4C_FROM ?? 1);
    for (let s = from; s < from + SEEDS; s++) {
      if (only && !only.includes(s)) continue;
      const out = await run(s);
      if (process.env.M1C4C_SHOW) console.log(JSON.stringify(out.detail));
      if (!out.ok) {
        bad.push(out.detail);
        for (const k of out.detail.why as string[]) kinds.set(k, (kinds.get(k) ?? 0) + 1);
      }
    }
    if (bad.length && process.env.M1C4C_DEBUG) console.log(JSON.stringify(bad.slice(0, 6), null, 1));
    expect({ failing_seeds: bad.length, kinds: Object.fromEntries(kinds), first: bad[0] ?? null }).toEqual({ failing_seeds: 0, kinds: {}, first: null });
  }, 1_800_000);
});
