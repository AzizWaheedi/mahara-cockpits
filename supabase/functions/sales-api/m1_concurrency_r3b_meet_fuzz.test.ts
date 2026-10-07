// bun test supabase/functions/sales-api/m1_concurrency_r3b_meet_fuzz.test.ts
//
// Milestone 1, video-link round 3 (second pass), angle: concurrency and
// idempotency. A seeded interleaving search over a setter's Meet video
// link with the pilot's settings (m1-scope.md section 3; the WhatsApp gate
// locked, so the link goes by email), adding what round 1's fuzz left out:
//   - HighLevel answering each email send with a 429 (certain, passing), or
//     not answering in time (the send may have gone: HighLevel takes it
//     anyway half the time), the lead's conversation showing exactly the
//     emails HighLevel took;
//   - the sweep's timer close (R4, lead_no_show) at a random moment;
//   - presses on the room just closed: I can't let them in (the knock after
//     the close and its replacement), The lead is in (a late join);
//   - That was not the lead, Also send by email from two tabs, End, We are
//     on the phone and Cancel, with the version each tab last read;
//   - the minute's ticks, the clock moving a minute each.
// Whatever the order: each room's link reaches the lead at most once (the
// email lane is its only lane here); nothing reaches the lead for a room
// already closed at the send's last check; one replacement at most per
// room; one room.create and at most one room.end audit row per room; a link
// the lead was sent is on its room (link_sent_at) once the room settles;
// no press answers anything but a sentence; no background job throws.
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
const SETTER = "stress-m1c3bm-setter@stress.invalid";
const LEAD = "stress-m1c3bm-lead";
const SEEDS = Number(process.env.M1C3BM_SEEDS ?? 200);
const LIVE = ["requested", "creating", "open", "host_in", "lead_in"];
const stats = { unclear: 0, throttled: 0, replaced: 0, knock_after_close: 0, swept: 0, sent: 0, second_key: 0 };

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

function world(seed: number) {
  const rnd = prng(seed);
  const w = fakeWorld();
  const rows = new Map<string, Row>();
  /** Every email HighLevel took (the lead has it), with the rooms as they stood at the send's last check. */
  const delivered: { requestId: string; body: string; at: number; roomsAtCheck: Record<string, string> }[] = [];
  const audits: Row[] = [];
  const errors: string[] = [];
  const order: string[] = [];
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
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any", auto_on_miss: false },
      },
    },
    { key: "live", value: { enabled: false, slack: false, standby: true } },
    { key: "whatsapp_guard", value: { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW" }]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" };
  w.routes.push((m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    if (m === "GET" && p.startsWith("/conversations/messages/")) return { message: { id: p.split("/").pop(), status: "delivered" } };
    return null as unknown as Row;
  });
  const jitter = async (max = 4) => {
    const n = Math.floor(rnd() * max);
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
    background: p => {
      w.io.background(
        p.catch(e => {
          errors.push(`background: ${String((e as Error)?.message ?? e)}`);
        }),
      );
    },
  };
  const at = () => new Date(w.clock.now).toISOString();
  const roomsNow = () => Object.fromEntries(w.db.t("cockpit_sales_rooms").map(r => [String(r.join_url ?? r.code), String(r.state)]));
  async function send(requestId: string, contactId: string, channel: "whatsapp" | "email", body: string, extra: Row, beforeSend?: () => Promise<boolean>) {
    await jitter();
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    const atCheck = roomsNow();
    if (beforeSend && !(await beforeSend())) {
      rows.delete(requestId);
      const t = w.db.t("cockpit_sales_messages");
      t.splice(t.indexOf(row), 1);
      throw new ApiRefusal("Not sent: the room closed before the link went.", 409, { code: "stopped", certain: true });
    }
    row.ghl_asked_at = at();
    const r = rnd();
    if (r < 0.15) {
      // HighLevel's 429: certainly not sent.
      Object.assign(row, { state: "failed", error: "HighLevel said 429: Too many requests" });
      throw new ApiRefusal("HighLevel did not send it: HighLevel said 429: Too many requests", 502, { certain: true });
    }
    if (r < 0.3) {
      // No answer in time: HighLevel takes it anyway half the time.
      const took = rnd() < 0.5;
      if (took) delivered.push({ requestId, body, at: w.clock.now, roomsAtCheck: atCheck });
      Object.assign(row, { state: "unclear", error: "HighLevel did not answer within 25 s" });
      await jitter(10);
      throw new ApiRefusal("It may have gone (HighLevel did not answer within 25 s)", 502, { unclear: true });
    }
    delivered.push({ requestId, body, at: w.clock.now, roomsAtCheck: atCheck });
    await jitter(15);
    Object.assign(row, { state: "sent", provider_status: "sent", ghl_message_id: `msg-${String(row.id).slice(-6)}` });
    return { message: { ...row } };
  }
  const deps: RoomDeps = {
    io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({ crm: "written" }),
    sendText: (_who, b, opts) => send(b.request_id, b.contact_id, b.channel, b.body, { subject: b.subject ?? null }, opts?.beforeSend),
    sendTemplate: (_who, t) => send(t.requestId, t.contactId, "whatsapp", `Join here: ${t.buttonVariable?.join_code ?? ""}`, { template_key: t.key, via: "workflow" }, t.beforeSend),
    upcoming: async () => null,
    // The lead's conversation shows exactly what HighLevel took.
    sentSince: async (_contactId, since, text) => {
      const hit = delivered.find(d => d.at >= since && d.body === text);
      return hit ? { id: `msg-${hit.requestId.slice(-6)}`, status: "delivered" } : false;
    },
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  return { ...w, io, rnd, rows, delivered, audits, errors, order, rooms, room, jitter };
}
type W = ReturnType<typeof world>;

function worker(w: W, stopAfter: () => boolean) {
  const seen = new Set<string>();
  return (async () => {
    for (let i = 0; i < 3000; i++) {
      await turn();
      const r = w.db.t("cockpit_sales_rooms").find(x => x.state === "requested" && !seen.has(String(x.id)));
      if (!r) {
        if (stopAfter()) return;
        continue;
      }
      const id = String(r.id);
      seen.add(id);
      await w.jitter(6);
      const claimed = await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
        method: "PATCH",
        body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 },
        prefer: "return=representation",
      });
      if (!claimed.length) continue;
      await w.db.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
        method: "POST",
        body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made." },
        prefer: "resolution=ignore-duplicates",
      });
      const cur = w.room(id);
      const code = String(cur.code).toLowerCase();
      const url = cur.provider === "zoom" ? `https://us06web.zoom.us/j/8501${[...code].map(c => c.charCodeAt(0) % 10).join("")}?pwd=stress` : `https://meet.google.com/m1c-${code}`;
      const opened = await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
        method: "PATCH",
        body: {
          state: "open",
          join_url: url,
          provider_meeting_id: cur.provider === "zoom" ? `8501${code.length}` : `evt-${code}`,
          opened_at: w.db.iso(),
          host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
          ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
          version: Number(cur.version) + 1,
        },
        prefer: "return=representation",
      });
      if (!opened.length) continue;
      void (async () => {
        try {
          await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
        } catch (e) {
          if (!(e instanceof ApiRefusal)) w.errors.push(`worker.ready: ${String((e as Error)?.message ?? e)}`);
        }
      })();
    }
  })();
}

async function safe(w: W, name: string, f: () => Promise<unknown>): Promise<unknown> {
  try {
    const out = await f();
    w.order.push(name);
    return out;
  } catch (e) {
    if (e instanceof ApiRefusal) w.order.push(`${name}!${String(e.extra?.code ?? e.status)}`);
    else {
      w.order.push(`${name}!!`);
      w.errors.push(`${name}: ${String((e as Error)?.message ?? e)}`);
    }
    return null;
  }
}

/** The sweep's R4 as SQL does it: open or host_in, with a lead, closed expired lead_no_show, result no_join. */
async function sweepR4(w: W, id: string) {
  const cur = w.room(id);
  if (!["open", "host_in"].includes(String(cur.state))) return;
  await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=in.(open,host_in)`, {
    method: "PATCH",
    body: { state: "expired", end_reason: "lead_no_show", result: "no_join", ended_at: w.db.iso() },
  });
}

async function run(seed: number): Promise<{ ok: boolean; detail: Row }> {
  const w = world(seed);
  let done = false;
  const wk = worker(w, () => done);
  const purpose = w.rnd() < 0.5 ? "fallback" : "manual";
  const ask = { contact_id: LEAD, provider: "meet", call_kind: "intro", purpose, trigger: "no_answer" };
  const out = (await safe(w, "create", () => w.rooms.actions["room.create"]!(setter, { ...ask, request_id: crypto.randomUUID() }))) as Row | null;
  const id = out?.room ? String((out.room as Row).id) : null;
  if (id) {
    const seen = [Number(w.room(id).version), Number(w.room(id).version)];
    const tab = (i: number) => async (f: (v: number) => Promise<unknown>, name: string, wait = 40) => {
      await w.jitter(wait);
      const o = (await safe(w, name, () => f(seen[i] as number))) as Row | null;
      const r = o?.room as Row | undefined;
      if (r && String(r.id) === id) seen[i] = Number(r.version);
    };
    const actors: (() => Promise<void>)[] = [];
    for (let i = 0; i < 2; i++) {
      const t = tab(i);
      if (w.rnd() < 0.5) actors.push(() => t(v => w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "host_in" }), `host_in.${i}`));
      if (w.rnd() < 0.3) actors.push(() => t(v => w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "lead_in" }), `lead_in.${i}`, 120));
      if (w.rnd() < 0.2) actors.push(() => t(v => w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "not_lead" }), `not_lead.${i}`, 160));
      if (w.rnd() < 0.5) actors.push(() => t(() => w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() }), `email.${i}`, 80));
      if (w.rnd() < 0.5) {
        const reasons = ["end", "on_phone", "cancel", "admit_blocked", "admit_blocked", "admit_blocked"];
        const reason = reasons[Math.floor(w.rnd() * reasons.length)] as string;
        actors.push(() => t(v => w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason, confirm: w.rnd() < 0.5 }), `${reason}.${i}`, 160));
      }
    }
    // The minute's ticks, each a minute on.
    const ticks = 1 + Math.floor(w.rnd() * 3);
    for (let k = 0; k < ticks; k++)
      actors.push(async () => {
        await w.jitter(60 + k * 60);
        w.clock.now += 61 * S;
        const live = w.db.t("cockpit_sales_rooms").filter(r => LIVE.includes(String(r.state))).map(r => String(r.id));
        if (live.length) await safe(w, `tick${k}`, () => w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: live } }));
      });
    if (w.rnd() < 0.5)
      actors.push(async () => {
        await w.jitter(150);
        await safe(w, "sweep.R4", () => sweepR4(w, id));
      });
    await Promise.all(actors.map(a => a()));
  }
  done = true;
  await wk;
  await w.flush();
  // The room settles: the minute's ticks for a few minutes (each one a
  // minute and a half on, so a send not in the conversation after a send's
  // budget is read as not sent and tried again).
  for (let i = 0; i < 4; i++) {
    w.clock.now += 91 * S;
    const all = w.db.t("cockpit_sales_rooms").map(r => String(r.id));
    if (all.length) await safe(w, "tick.end", () => w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: all } }));
    await w.flush();
  }
  const why: string[] = [];
  const perRoom: Row[] = [];
  for (const r of w.db.t("cockpit_sales_rooms")) {
    const url = String(r.join_url ?? "");
    const mine = url ? w.delivered.filter(d => d.body.includes(url)) : [];
    const closedAtSend = mine.filter(d => !LIVE.includes(String(d.roomsAtCheck[url] ?? "")));
    const creates = w.audits.filter(a => a.action === "room.create" && a.entityId === r.id).length;
    const ends = w.audits.filter(a => a.action === "room.end" && a.entityId === r.id).length;
    const replacements = w.db.t("cockpit_sales_rooms").filter(x => x.id !== r.id && r.result === "admit_blocked" && Date.parse(String(x.requested_at)) >= Date.parse(String(r.ended_at ?? r.requested_at)) - 5 * S).length;
    perRoom.push({ code: r.code, state: r.state, result: r.result ?? null, emails: mine.length, link_sent_at: Boolean(r.link_sent_at), refusal: r.refusal ?? null, creates, ends });
    if (mine.length > 1) why.push(`${String(r.code)}: ${mine.length} emails with the link`);
    if (closedAtSend.length) why.push(`${String(r.code)}: a link let go for a closed room`);
    if (creates > 1) why.push(`${String(r.code)}: room.create audited ${creates} times`);
    if (ends > 1) why.push(`${String(r.code)}: room.end audited ${ends} times`);
    if (replacements > 1) why.push(`${String(r.code)}: ${replacements} rooms after I can't let them in`);
    if (mine.length && !r.link_sent_at) why.push(`${String(r.code)}: the lead has its link and the room says it never went`);
  }
  if (w.errors.length) why.push("errors");
  if (process.env.M1C3BM_STATS) {
    const msgs = w.db.t("cockpit_sales_messages");
    stats.unclear += msgs.some(m => m.error && /did not answer/.test(String(m.error))) ? 1 : 0;
    stats.throttled += msgs.some(m => /429/.test(String(m.error ?? ""))) ? 1 : 0;
    stats.replaced += w.db.t("cockpit_sales_rooms").length > 1 ? 1 : 0;
    stats.knock_after_close += w.audits.some(a => a.action === "room.end" && (a.metadata as Row | undefined)?.after_close) ? 1 : 0;
    stats.swept += w.order.includes("sweep.R4") ? 1 : 0;
    stats.sent += w.db.t("cockpit_sales_rooms").some(r => r.link_sent_at) ? 1 : 0;
    stats.second_key += msgs.some(m => w.rows.size > 1 && m.state === "sent") && msgs.length > 1 ? 1 : 0;
  }
  return { ok: why.length === 0, detail: { seed, order: w.order.join(" > "), rooms: perRoom, errors: w.errors.slice(0, 4), why } };
}

describe("m1 concurrency r3b meet fuzz: a setter's Meet link with HighLevel's 429s and timeouts, the timer's close and presses after it", () => {
  test(`m1 meet fuzz: ${SEEDS} seeded interleavings with the pilot's settings`, async () => {
    const bad: Row[] = [];
    const kinds = new Map<string, number[]>();
    const only = process.env.M1C3BM_SEED ? process.env.M1C3BM_SEED.split(",").map(Number) : null;
    // Extra seeds past SEEDS (M1C3BM_PINNED). A seed's run also depends on
    // the ids the fakes handed out before it, so a seed found in a wide run
    // (1,200 seeds found 447: an email HighLevel took with its answer lost,
    // never recorded once We are on the phone closed the room) is pinned by
    // its own deterministic test: m1_concurrency_r3b_unclear.test.ts.
    const pinned = (process.env.M1C3BM_PINNED ?? "").split(",").filter(Boolean).map(Number);
    const seeds = [...Array.from({ length: SEEDS }, (_, i) => i + 1), ...pinned.filter(p => p > SEEDS)];
    for (const s of seeds) {
      if (only && !only.includes(s)) continue;
      const out = await run(s);
      if (!out.ok) {
        bad.push(out.detail);
        for (const k of out.detail.why as string[]) {
          const key = k.replace(/^[A-Z0-9]+: /, "");
          kinds.set(key, [...(kinds.get(key) ?? []), s]);
        }
      }
    }
    if (process.env.M1C3BM_STATS) console.log(JSON.stringify(stats));
    if (bad.length && process.env.M1C3BM_DEBUG) {
      console.log(JSON.stringify(Object.fromEntries([...kinds].map(([k, v]) => [k, v.slice(0, 12)])), null, 1));
      if (process.env.M1C3BM_DEBUG === "full") console.log(JSON.stringify(bad.slice(0, 4), null, 1));
    }
    expect({ failing_seeds: bad.length, kinds: Object.fromEntries([...kinds].map(([k, v]) => [k, v.length])), first: bad[0] ?? null }).toEqual({
      failing_seeds: 0,
      kinds: {},
      first: null,
    });
  }, 900_000);
});
