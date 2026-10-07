// bun test supabase/functions/sales-api/stress2_concurrency_r5_link_fuzz.test.ts
//
// Second series, round 5, dimension: concurrency and idempotency. A seeded
// interleaving search over one room's link.
//
// One Meet fallback room for Huda (her WhatsApp window open, an email on
// file, every lane switched on). Beside the worker's open, in random order
// and timing:
//   - worker.ready reaches sales-api once or twice (the worker's own call,
//     the sweep's replay);
//   - the minute's tick (the link's re-ask, the sweep's claim of a link due);
//   - the setter presses "Also send by email" in one or two tabs;
//   - sometimes the setter presses End.
// The message service is modelled as index.ts convoSend and sendTemplate
// behave (the request id's row first, then HighLevel, then the row's state),
// with random latency, a 429 that HighLevel refused outright, and a 5xx
// whose answer was lost after HighLevel sent it. Every database and
// HighLevel call yields a random number of turns first.
//
// Whatever the order: Huda gets at most one WhatsApp link and at most one
// email with it; nothing starts on its way to her after the room ended; and
// a link that reached her is on the room (link_sent_at, its channel) once
// the sweep's minutes have run.
//
// A failing seed is a finding for the fix agent (the failure names the seed
// and the order). Nothing here reaches HighLevel, Zoom, Google or Slack.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { matchSent, type SeenMessage } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter@stress.invalid";
const LEAD = "stress-lead-s2c5-000006";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const SEEDS = Number(process.env.R5_LINK_SEEDS ?? 200);

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
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

type Lane = "text" | "template" | "email";

function world(seed: number) {
  const rnd = prng(seed);
  const w = fakeWorld();
  const rows = new Map<string, Row>();
  const delivered: { lane: Lane; requestId: string; at: number; started: number }[] = [];
  const convo: (SeenMessage & { at: string })[] = [];
  const audits: Row[] = [];
  const order: string[] = [];
  let endedAt: number | null = null;
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: false,
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        short_link: true,
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
      },
    },
    { key: "live", value: { enabled: false } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: null, zoom_status: "pending", google_ok: true }]);
  // Her WhatsApp window: open (she wrote an hour ago), or closed (the template lane), at random.
  const inboundAgo = rnd() < 0.5 ? HOUR : 30 * HOUR;
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - inboundAgo).toISOString() }]);
  w.db.seed("cockpit_sales_wa_templates", [
    { key: "call_link_ar", active: true, workflow_id: "wf-call-link" },
    { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" },
  ]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" };
  w.routes.push((m, p) => (m === "GET" && p === `/contacts/${LEAD}` ? { contact } : (null as unknown as Row)));
  const jitter = async () => {
    const n = Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) await turn();
  };
  const io: LiveIO = {
    ...w.io,
    db: async (path, init) => {
      await jitter();
      const out = await w.io.db(path, init);
      await jitter();
      return out;
    },
    rpc: async (fn, args) => {
      await jitter();
      return await w.io.rpc(fn, args);
    },
    ghl: async (m, p, b, v) => {
      await jitter();
      return await w.io.ghl(m, p, b, v);
    },
    sleep: async ms => {
      w.clock.now += ms;
      await turn();
    },
  };
  const at = () => new Date(w.clock.now).toISOString();
  async function send(lane: Lane, requestId: string, channel: "whatsapp" | "email", body: string, extra: Row): Promise<{ message: Row; repeated?: boolean }> {
    // When the cockpit asked for this send (its last check already made).
    const started = w.clock.now;
    await jitter();
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, channel, body, state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    // HighLevel's own time.
    const n = Math.floor(rnd() * 30);
    for (let i = 0; i < n; i++) await turn();
    const r = rnd();
    if (r < 0.12) {
      row.state = "failed";
      row.error = "HighLevel said 429: Too many requests";
      throw new ApiRefusal("HighLevel did not send it: HighLevel said 429: Too many requests", 502, { certain: true });
    }
    delivered.push({ lane, requestId, at: w.clock.now, started });
    // The lead's conversation shows every send HighLevel took, emails too
    // (index.ts sentSince reads the email lane since m1 round 1).
    convo.push({ id: fakeUuid(), direction: "outbound", channel, body, at: at(), status: "delivered" });
    if (r < 0.2) {
      // HighLevel sent it; its answer was lost (a 504): the row stays unclear.
      row.state = "unclear";
      throw new ApiRefusal("HighLevel did not answer in time.", 504, { unclear: true });
    }
    row.state = "sent";
    row.provider_status = lane === "template" ? "delivered" : "sent";
    return { message: { ...row } };
  }
  const deps: RoomDeps = {
    io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({}),
    sendText: (_who, b) => send(b.channel === "email" ? "email" : "text", b.request_id, b.channel, b.body, { contact_id: b.contact_id }),
    sendTemplate: async (_who, t) =>
      await send("template", t.requestId, "whatsapp", `Your Mahara call is ready. Join here: https://call.maharamedia.com/${t.buttonVariable?.join_code ?? ""}`, {
        template_key: t.key,
        via: "workflow",
        contact_id: t.contactId,
      }),
    upcoming: async () => null,
    sentSince: async (_contactId, since, text, channel) => Boolean(matchSent(convo, since, text, { channel: channel ?? "whatsapp" })),
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  return {
    ...w,
    rnd,
    rooms,
    room,
    rows,
    delivered,
    audits,
    order,
    markEnded: () => {
      endedAt ??= w.clock.now;
    },
    endedAt: () => endedAt,
  };
}
type W = ReturnType<typeof world>;

async function run(seed: number): Promise<{ ok: boolean; detail: Row }> {
  const w = world(seed);
  const out = await w.rooms.actions["room.create"]!(setter, {
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    provider: "meet",
    call_kind: "intro",
    purpose: "fallback",
  });
  const id = String((out.room as Row).id);
  // The worker: claim, store worker.ready, open.
  await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
    method: "PATCH",
    body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(w.room(id).version) + 1 },
  });
  await w.db.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
    method: "POST",
    body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made." },
    prefer: "resolution=ignore-duplicates",
  });
  await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
    method: "PATCH",
    body: {
      state: "open",
      join_url: MEET_URL,
      provider_meeting_id: `evt-${id.slice(-4)}`,
      opened_at: w.db.iso(),
      host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
      ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
      version: Number(w.room(id).version) + 1,
    },
  });
  const readyEv = () => String((w.db.t("cockpit_sales_room_events").find(e => e.dedupe_key === `worker.ready:${id}`) as Row).id);
  const wait = async (max: number) => {
    const n = Math.floor(w.rnd() * max);
    for (let i = 0; i < n; i++) await turn();
  };
  const safe = async (name: string, f: () => Promise<unknown>) => {
    try {
      await f();
      w.order.push(name);
    } catch (e) {
      w.order.push(`${name}!${String((e as { code?: unknown })?.code ?? "")}`);
    }
  };
  const emailId = crypto.randomUUID();
  const actors: (() => Promise<void>)[] = [
    async () => {
      await wait(5);
      await safe("ready", () => w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } }));
    },
    async () => {
      await wait(60);
      await safe("replay", () => w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [readyEv()] } }));
    },
    async () => {
      await wait(80);
      w.clock.now += 61 * S;
      await safe("tick", () => w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } }));
    },
  ];
  const tabs = Math.floor(w.rnd() * 3);
  for (let t = 0; t < tabs; t++) {
    const same = w.rnd() < 0.5;
    actors.push(async () => {
      await wait(120);
      await safe(`email${t}`, () => w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: same ? emailId : crypto.randomUUID() }));
    });
  }
  if (w.rnd() < 0.3)
    actors.push(async () => {
      await wait(150);
      const v = Number(w.room(id).version);
      await safe("end", async () => {
        await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "cancel" });
        if (["ended", "cancelled"].includes(String(w.room(id).state))) w.markEnded();
      });
    });
  await Promise.all(actors.map(a => a()));
  await w.flush();
  for (let i = 0; i < 4; i++) {
    w.clock.now += MIN + S;
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } }).catch(() => null);
    await w.flush();
  }
  const r = w.room(id);
  const ended = ["ended", "cancelled", "expired"].includes(String(r.state));
  // When the room's end landed in the database (a send already asked for before it may still go).
  const endedAtMs = ended ? Date.parse(String(r.ended_at)) : null;
  const wa = w.delivered.filter(d => d.lane !== "email");
  const em = w.delivered.filter(d => d.lane === "email");
  const channels = Array.isArray(r.link_channels) ? (r.link_channels as string[]) : [];
  // A send whose answer was lost is "may have gone" by design (the room says
  // so and a person checks); only a link the cockpit knows went must be on the room.
  const mayHaveGone = /may have gone/i.test(String(r.refusal ?? ""));
  const known = w.delivered.filter(d => String(w.rows.get(d.requestId)?.state ?? "") !== "unclear");
  const unrecorded =
    !ended && !mayHaveGone && known.length > 0 &&
    (!r.link_sent_at || known.some(d => !channels.includes(d.lane === "text" ? "whatsapp_text" : d.lane === "template" ? "whatsapp_template" : "email")));
  const afterEnd = endedAtMs === null ? [] : w.delivered.filter(d => d.started > endedAtMs);
  const detail: Row = {
    seed,
    order: w.order.join(" > "),
    state: r.state,
    whatsapp_links: wa.map(d => d.lane),
    emails: em.length,
    link_channels: channels,
    link_sent: Boolean(r.link_sent_at),
    refusal: r.refusal ?? null,
    sent_after_end: afterEnd.map(d => d.lane),
    errors: w.logs.filter(l => l.startsWith("background:")).slice(0, 3),
  };
  const ok = wa.length <= 1 && em.length <= 1 && !unrecorded && afterEnd.length === 0 && (detail.errors as string[]).length === 0;
  if (!ok) detail.why = [wa.length > 1 && "two WhatsApp links", em.length > 1 && "two emails", unrecorded && "a link that went is not on the room", afterEnd.length && "sent after the room ended", (detail.errors as string[]).length && "errors"].filter(Boolean);
  return { ok, detail };
}

describe("one room's link: worker.ready, its replay, the tick, Also send by email and End, in every order", () => {
  test(`link fuzz: ${SEEDS} seeded interleavings; one WhatsApp link and one email at most, nothing after End, every link that went recorded`, async () => {
    const bad: Row[] = [];
    const kinds = new Map<string, number>();
    const only = process.env.R5_LINK_SEED ? [Number(process.env.R5_LINK_SEED)] : null;
    for (let s = 1; s <= SEEDS; s++) {
      if (only && !only.includes(s)) continue;
      const out = await run(s);
      if (!out.ok) {
        bad.push(out.detail);
        const k = String((out.detail.why as string[]).join("+"));
        kinds.set(k, (kinds.get(k) ?? 0) + 1);
      }
    }
    if (bad.length && process.env.R5_DEBUG) console.log(JSON.stringify(bad.slice(0, 6), null, 1));
    expect({ failing_seeds: bad.length, kinds: Object.fromEntries(kinds), first: bad[0] ?? null }).toEqual({ failing_seeds: 0, kinds: {}, first: null });
  }, 900_000);
});
