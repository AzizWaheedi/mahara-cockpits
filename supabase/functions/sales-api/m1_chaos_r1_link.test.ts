// bun test supabase/functions/sales-api/m1_chaos_r1_link.test.ts
//
// Milestone 1, video-link round 1, chaos: the room is open and the worker's
// worker.ready reaches sales-api; one database call (PostgREST or a database
// function) on the way to the lead's link fails, has its answer lost after
// it landed, or never answers at all (the function killed, a deploy). The
// cron then runs as it does in production: every minute the sweep replays
// unhandled worker events and posts the room's tick.
//
// What the lead and the rep need, with the pilot's settings (rooms on,
// test_only with the test contact, links by email while the WhatsApp gate is
// shut; or WhatsApp free text inside the window once it opens):
//   - the link reaches the lead once, never twice;
//   - it goes within the sweep's next re-ask (two minutes at most after the
//     room opened), not after the lead's ten minutes have half run out;
//   - the room says what happened: link_sent_at when it went, never a
//     "may have gone" or "not sent" sentence about a link that went.
//
// sales-api's rooms.ts on testfakes.ts; the message service is a fake that
// keeps index.ts's one rule (one request id, one message). Every lead, seat
// and link is invented; nothing reaches HighLevel, Zoom, Google or Slack.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, DbError, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const LEAD = "stress-m1chaos-lead-0001";
const SETTER = "setter-m1chaos@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const MAY_HAVE_GONE = "The send may have gone; read the conversation in HighLevel before writing to the lead again";

type Mode = "ok" | "lost" | "unseen";

function world(o: { gate?: boolean; inboundAgoMs?: number } = {}) {
  const w = fakeWorld(Date.parse("2026-10-05T08:00:00Z")); // 11:00 Kuwait, a Monday
  const audits: Row[] = [];
  const delivered: { lane: string; requestId: string; at: number; body: string }[] = [];
  const modes: Record<"text" | "template" | "email", Mode[]> = { text: [], template: [], email: [] };
  const open = new Set<Promise<unknown>>();
  const dead = new Set<Promise<unknown>>();
  let around: ((path: string, init: Row, real: () => Promise<Row[]>) => Promise<Row[]>) | null = null;
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
        short_link: false,
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "intro", auto_on_miss: false },
      },
    },
    { key: "live", value: { enabled: false, slack: false } },
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
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: new Date(w.clock.now - 5 * S).toISOString() }]);
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - (o.inboundAgoMs ?? HOUR)).toISOString() }]);
  w.db.seed("cockpit_sales_wa_templates", [
    { key: "call_link_ar", active: true, workflow_id: "wf-call-link" },
    { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" },
  ]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: [], country: "KW" };
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: [] };
    return null as unknown as Row;
  });

  const io: LiveIO = {
    ...w.io,
    db: (path, init = {}) => (around ? around(path, init as Row, () => w.io.db(path, init)) : w.io.db(path, init)),
    rpc: (fn, args) =>
      around
        ? around(`rpc/${fn}`, { method: "POST", body: args }, async () => [{ __rpc: await w.io.rpc(fn, args) }]).then(r => (r[0] as Row).__rpc)
        : w.io.rpc(fn, args),
    background: p => {
      const q: Promise<unknown> = p.catch(e => w.logs.push(`background: ${String((e as Error)?.message ?? e)}`)).finally(() => open.delete(q));
      open.add(q);
    },
  };
  async function drain(): Promise<void> {
    for (let i = 0; i < 12; i++) {
      const left = [...open].filter(j => !dead.has(j));
      if (!left.length) return;
      await Promise.race([Promise.allSettled(left), realSleep(30)]);
    }
    for (const j of open) dead.add(j);
  }
  const at = () => new Date(w.clock.now).toISOString();
  const msgRows = new Map<string, Row>();
  async function send(lane: "text" | "template" | "email", requestId: string, channel: "whatsapp" | "email", body: string, extra: Row) {
    const again = msgRows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, channel, body, state: "sending", created_at: at(), ghl_asked_at: at(), ...extra };
    msgRows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    const mode = modes[lane].shift() ?? "ok";
    if (mode === "lost") {
      delivered.push({ lane, requestId, at: w.clock.now, body });
      row.state = "unclear";
      throw new ApiRefusal(`${MAY_HAVE_GONE} (HighLevel did not answer: no answer within 25 s)`, 502, { unclear: true });
    }
    if (mode === "unseen") {
      row.state = "sent";
      row.provider_status = "enrolled";
      return { message: { ...row } };
    }
    delivered.push({ lane, requestId, at: w.clock.now, body });
    row.state = "sent";
    row.provider_status = lane === "template" ? "delivered" : "sent";
    return { message: { ...row } };
  }
  const deps: RoomDeps = {
    io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => {
      throw new Error("no mark in Milestone 1's link path");
    },
    sendText: (_who, b) => send(b.channel === "email" ? "email" : "text", b.request_id, b.channel, b.body, { contact_id: b.contact_id, source: "room" }),
    sendTemplate: (_who, t) =>
      send("template", t.requestId, "whatsapp", `Your Mahara call is ready. Join here: ${t.buttonVariable?.join_code ?? ""}`, {
        template_key: t.key,
        via: "workflow",
        contact_id: t.contactId,
        source: "room",
      }),
    upcoming: async () => null,
    // The conversation shows what reached the lead (index.ts whatsappSentSince),
    // on WhatsApp or, asked for the email lane, by email.
    sentSince: async (_c, _since, text, channel) => {
      if (!text) return null;
      const hit = delivered.find(d => (channel === "email" ? d.lane === "email" : d.lane !== "email") && d.body === text);
      return hit ? { id: `ghl-${hit.requestId.slice(0, 8)}`, status: "delivered" } : false;
    },
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;

  async function workerOpens(id: string) {
    const r = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made." },
      prefer: "resolution=ignore-duplicates",
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: MEET_URL,
        provider_meeting_id: `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(room(id).version) + 1,
      },
    });
  }
  async function make(): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
    });
    return String((out.room as Row).id);
  }
  const readyEvent = (id: string) => rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
  const tick = (id: string) => rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
  async function replay(): Promise<void> {
    const ids = w.db
      .t("cockpit_sales_room_events")
      .filter(
        e =>
          !e.handled_at &&
          ["worker", "zoom", "claim"].includes(String(e.source)) &&
          (!e.lease_until || Date.parse(String(e.lease_until)) <= w.clock.now) &&
          Date.parse(String(e.at ?? e.created_at ?? w.db.iso())) <= w.clock.now - 20 * S,
      )
      .map(e => String(e.id));
    if (ids.length) await rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: ids } }).catch(() => null);
  }
  async function minute(id: string): Promise<void> {
    w.clock.now += MIN;
    await replay();
    await drain();
    await tick(id).catch(() => null);
    await drain();
  }
  const setAround = (f: typeof around) => {
    around = f;
  };
  return { ...w, io, rooms, audits, delivered, modes, room, workerOpens, make, readyEvent, tick, replay, minute, drain, setAround };
}

async function settle<T>(p: Promise<T>): Promise<void> {
  try {
    await p;
  } catch {
    /* the event's answer failed: the cron's re-asks are under test */
  }
}

/** One fault at the k-th database call: fail (nothing landed), lost (landed, answer gone), kill (never answers). */
function faultAt(w: ReturnType<typeof world>, k: number, mode: "fail" | "lost" | "kill") {
  let n = 0;
  const seen: string[] = [];
  w.setAround(async (path, init, real) => {
    const mine = n++;
    seen.push(`${String(init.method ?? "GET")} ${path.slice(0, 100)}`);
    if (mine !== k) return await real();
    if (mode === "fail") throw new DbError("database: no answer within 8 s", 0);
    if (mode === "kill") return await new Promise<Row[]>(() => {});
    await real();
    throw new DbError("database: no answer within 8 s", 0);
  });
  return { calls: () => n, seen };
}

/** Two faults: the first run's k-th call, then the j-th call after it (a second blip while the cron recovers). */
function twoFaults(w: ReturnType<typeof world>, k: number, first: "fail" | "lost" | "kill", j: number, second: "fail" | "lost") {
  let n = 0;
  const seen: string[] = [];
  w.setAround(async (path, init, real) => {
    const mine = n++;
    seen.push(`${String(init.method ?? "GET")} ${path.slice(0, 100)}`);
    const mode = mine === k ? first : mine === k + 1 + j ? second : null;
    if (!mode) return await real();
    if (mode === "fail") throw new DbError("database: no answer within 8 s", 0);
    if (mode === "kill") return await new Promise<Row[]>(() => {});
    await real();
    throw new DbError("database: no answer within 8 s", 0);
  });
  return { calls: () => n, seen };
}

interface Outcome {
  k: number;
  mode: string;
  call: string;
  deliveries: number;
  minute: number | null;
  sent: boolean;
  refusal: string;
}

async function journey(k: number | null, mode: "fail" | "lost" | "kill", gate: boolean, inboundAgoMs = HOUR): Promise<Outcome & { calls: number }> {
  const w = world({ gate, inboundAgoMs });
  const id = await w.make();
  await w.workerOpens(id);
  const opened = w.clock.now;
  let n = 0;
  const plan = k === null ? null : faultAt(w, k, mode);
  if (k === null)
    w.setAround(async (_p, _i, real) => {
      n++;
      return await real();
    });
  await Promise.race([settle(w.readyEvent(id)), realSleep(40)]);
  await w.drain();
  w.setAround(null);
  for (let i = 0; i < 10; i++) await w.minute(id);
  const r = w.room(id);
  const first = w.delivered[0];
  return {
    k: k ?? -1,
    mode,
    call: plan?.seen[k ?? 0] ?? "",
    calls: k === null ? n : (plan?.calls() ?? 0),
    deliveries: w.delivered.length,
    minute: first ? Math.round((first.at - opened) / MIN) : null,
    sent: Boolean(r.link_sent_at),
    refusal: String(r.refusal ?? ""),
  };
}

async function journey2(
  k: number,
  first: "fail" | "lost" | "kill",
  j: number,
  second: "fail" | "lost",
  gate: boolean,
): Promise<Outcome & { calls: number }> {
  const w = world({ gate });
  const id = await w.make();
  await w.workerOpens(id);
  const opened = w.clock.now;
  const plan = twoFaults(w, k, first, j, second);
  await Promise.race([settle(w.readyEvent(id)), realSleep(40)]);
  await w.drain();
  for (let i = 0; i < 10; i++) await w.minute(id);
  w.setAround(null);
  const r = w.room(id);
  const firstSent = w.delivered[0];
  return {
    k,
    mode: `${first}+${second}@${j}`,
    call: `${plan.seen[k] ?? ""} / ${plan.seen[k + 1 + j] ?? ""}`,
    calls: plan.calls(),
    deliveries: w.delivered.length,
    minute: firstSent ? Math.round((firstSent.at - opened) / MIN) : null,
    sent: Boolean(r.link_sent_at),
    refusal: String(r.refusal ?? ""),
  };
}

function judge(o: Outcome): string | null {
  const why: string[] = [];
  if (o.deliveries > 1) why.push(`${o.deliveries} links to the lead`);
  if (o.deliveries === 1 && !o.sent) why.push(`the link went and the room says "${o.refusal || "nothing"}"`);
  if (o.deliveries === 0 && o.sent) why.push("the room says the link went and nothing went");
  if (o.deliveries === 0 && !o.refusal) why.push("no link and no sentence after ten minutes");
  if (o.minute !== null && o.minute > 2) why.push(`the link went ${o.minute} minutes after the room opened`);
  return why.length ? `${o.mode}@${o.k} (${o.call}): ${why.join("; ")}` : null;
}

describe("m1 chaos r1: the video link with one database call failed, lost or killed at every step", () => {
  for (const [gate, ago, name] of [
    [false, HOUR, "WhatsApp gate shut (email, as production is today)"],
    [true, HOUR, "WhatsApp gate open, inside the window (free text)"],
    [true, 3 * 24 * HOUR, "WhatsApp gate open, window shut (email: the call_link template needs the short link, off in the pilot)"],
  ] as const) {
    test(`${name}: once, within two minutes, and said right`, async () => {
      const clean = await journey(null, "fail", gate, ago);
      expect(clean.deliveries).toBe(1);
      expect(clean.minute).toBe(0);
      const bad: string[] = [];
      for (const mode of ["fail", "lost", "kill"] as const) {
        for (let k = 0; k < clean.calls + 2; k++) {
          const o = await journey(k, mode, gate, ago);
          const b = judge(o);
          if (b) bad.push(b);
        }
      }
      expect(bad).toEqual([]);
    }, 600_000);
  }
});

// About 25 minutes (a dead run is waited for in real time): M1_CHAOS_DEEP=1 bun test ... runs it.
describe.skipIf(!process.env.M1_CHAOS_DEEP)("m1 chaos r1: the video link with two blips (one in the first run, one while the cron recovers)", () => {
  for (const gate of [false, true]) {
    test(`${gate ? "free text" : "email"}: once at most, said right, and never left unsaid`, async () => {
      const clean = await journey(null, "fail", gate);
      const bad: string[] = [];
      for (const first of ["fail", "lost", "kill"] as const) {
        for (let k = 0; k < clean.calls; k++) {
          for (const second of ["fail", "lost"] as const) {
            for (let j = 0; j < 40; j++) {
              const o = await journey2(k, first, j, second, gate);
              const why: string[] = [];
              if (o.deliveries > 1) why.push(`${o.deliveries} links to the lead`);
              if (o.deliveries === 1 && !o.sent) why.push(`the link went and the room says "${o.refusal || "nothing"}"`);
              if (o.deliveries === 0 && o.sent) why.push("the room says the link went and nothing went");
              if (o.deliveries === 0 && !o.refusal) why.push("no link and no sentence after ten minutes");
              if (o.minute !== null && o.minute > 4) why.push(`the link went ${o.minute} minutes after the room opened`);
              if (why.length) bad.push(`${first}@${k}+${second}@${j} (${o.call}): ${why.join("; ")}`);
            }
          }
        }
      }
      expect(bad.slice(0, 40)).toEqual([]);
    }, 3_600_000);
  }
});
