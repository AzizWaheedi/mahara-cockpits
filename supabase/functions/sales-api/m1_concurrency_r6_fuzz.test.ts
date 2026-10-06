// bun test supabase/functions/sales-api/m1_concurrency_r6_fuzz.test.ts
//
// Milestone 1, video-link round 6, angle: concurrency and idempotency. A
// seeded interleaving search wider than round 1's: beside the room's link,
// in random order and timing,
//   - Send a video link from the setter's dialer in one or two tabs, and the
//     closer's lead page asking for the same lead at the same moment;
//   - the worker's claim and open, worker.ready lost, once or twice, its
//     replay; the worker failing a Meet room; the sweep failing a room still
//     requested at a minute (R1) or creating at two (R2);
//   - two of the minute's ticks at once (an overrun minute beside the next);
//   - I'm in the room, The lead is in, That was not the lead from two tabs;
//   - End, We are on the phone, Cancel, I can't let them in from two tabs
//     and from a manager;
//   - Also send by email from two tabs and a manager;
//   - Use Meet / Try Zoom on a room that failed or whose link was late;
//   - the sweep's R4 closing the room (lead_no_show);
//   - HighLevel refusing a lane, losing an answer (the lead may have it),
//     and a WhatsApp message Meta fails after it went.
// The message service is faked honestly: one row per request id, the
// caller's last check right before HighLevel is asked, and the lead's
// conversation shows exactly what reached her.
//
// Whatever the order: each room's link reaches the lead at most once per
// lane; a message for one room carries that room's own link; nothing reaches
// the lead for a room closed when the cockpit let it go; one room.create,
// at most one room.end and one room.link per lane per room; no press
// answers anything but a sentence; no background job throws; a link that
// reached the lead is on its room's record once the minute's ticks ran.
//
// A failing seed is a finding (the failure names the seed and the order).
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, type LiveIO, uuidFrom } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "stress-m1c6f-setter@stress.invalid";
const CLOSER = "stress-m1c6f-closer@stress.invalid";
const BOSS = "stress-m1c6f-manager@stress.invalid";
const LEAD = "stress-m1c6f-lead";
const SEEDS = Number(process.env.M1C6_SEEDS ?? 200);

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer" };
const boss: Who = { signed_in: true, seat: true, manager: true, email: BOSS, name: "Maha Manager", role: "manager", ghl_user_id: "G-boss" };
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
const LIVE = ["requested", "creating", "open", "host_in", "lead_in"];

function world(seed: number) {
  const rnd = prng(seed);
  const wa = rnd() < 0.5;
  // How HighLevel treats each lane on this seed.
  const mode: Record<Lane, "ok" | "refuse" | "lost_went" | "lost_not" | "late_fail"> = {
    text: (["ok", "ok", "refuse", "lost_went", "lost_not", "late_fail"] as const)[Math.floor(rnd() * 6)]!,
    template: (["ok", "ok", "refuse", "lost_went"] as const)[Math.floor(rnd() * 4)]!,
    email: (["ok", "ok", "ok", "refuse", "lost_went", "lost_not"] as const)[Math.floor(rnd() * 6)]!,
  };
  const w = fakeWorld();
  const rows = new Map<string, Row>();
  const delivered: { lane: Lane; requestId: string; body: string; at: number; liveAtCheck: Record<string, string> }[] = [];
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
    {
      key: "whatsapp_guard",
      value: wa
        ? { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 }
        : { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 },
    },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer", active: true },
    { email: BOSS, name: "Maha Manager", role: "manager", ghl_user_id: "G-boss", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true },
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
  ]);
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - HOUR).toISOString() }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW" }]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" };
  /** What HighLevel holds, by its own message id. */
  const ghl = new Map<string, { status: string; error?: string }>();
  w.routes.push((m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    const msg = m === "GET" ? /^\/conversations\/messages\/([^/?]+)$/.exec(p) : null;
    if (msg) {
      const g = ghl.get(decodeURIComponent(msg[1] as string));
      if (g) return { message: { id: msg[1], status: g.status, ...(g.error ? { error: g.error } : {}) } };
    }
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
  const liveRooms = () => Object.fromEntries(w.db.t("cockpit_sales_rooms").map(r => [String(r.id), String(r.state)]));
  /** Which room a link key belongs to (the message service never knows; the test does). */
  const keyRoom = new Map<string, string>();
  async function learnKeys(roomId: string) {
    for (const c of ["whatsapp_text", "whatsapp_template", "email"]) {
      keyRoom.set(await uuidFrom(`mahara-room/link/${roomId}/${c}`), roomId);
      for (let n = 1; n <= 13; n++) keyRoom.set(await uuidFrom(`mahara-room/link/${roomId}/${c}/${n}`), roomId);
    }
  }
  async function send(lane: Lane, requestId: string, contactId: string, channel: "whatsapp" | "email", body: string, extra: Row, beforeSend?: () => Promise<boolean>) {
    await jitter();
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    const atCheck = liveRooms();
    if (beforeSend && !(await beforeSend())) {
      rows.delete(requestId);
      const t = w.db.t("cockpit_sales_messages");
      t.splice(t.indexOf(row), 1);
      throw new ApiRefusal("Not sent: the room closed before the link went.", 409, { code: "stopped", certain: true });
    }
    row.ghl_asked_at = at();
    const m = mode[lane];
    // A refusal for good (a 400 about the lead), the lane's first send only.
    if (m === "refuse") {
      mode[lane] = "ok";
      row.state = "failed";
      row.error = "HighLevel did not send it: 400 the lead's number cannot take this";
      throw new ApiRefusal(String(row.error), 502, { certain: true });
    }
    const ghlId = `msg-${String(row.id).slice(-8)}`;
    const went = m !== "lost_not";
    if (went) {
      delivered.push({ lane, requestId, body, at: w.clock.now, liveAtCheck: beforeSend ? atCheck : liveRooms() });
      ghl.set(ghlId, { status: lane === "email" ? "delivered" : "sent" });
    }
    await jitter(10);
    if (m === "lost_went" || m === "lost_not") {
      row.state = "unclear";
      row.error = "HighLevel did not answer in 25 s";
      // Only the first time on this lane: the next key goes through.
      mode[lane] = "ok";
      throw new ApiRefusal("It may have gone (HighLevel did not answer in 25 s)", 502, { unclear: true });
    }
    row.state = "sent";
    row.provider_status = lane === "template" ? "delivered" : "sent";
    row.ghl_message_id = ghlId;
    if (m === "late_fail") {
      // Meta fails it a minute later (131026).
      const id = ghlId;
      setTimeout(() => ghl.set(id, { status: "failed", error: "131026 message undeliverable" }), 0);
    }
    return { message: { ...row } };
  }
  const deps: RoomDeps = {
    io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({ crm: "written" }),
    sendText: (_who, b, opts) =>
      send(b.channel === "email" ? "email" : "text", b.request_id, b.contact_id, b.channel, b.body, { subject: b.subject ?? null }, opts?.beforeSend),
    sendTemplate: (_who, t) =>
      send(
        "template",
        t.requestId,
        t.contactId,
        "whatsapp",
        `Your Mahara call is ready. Join here: ${t.buttonVariable?.join_code ?? ""}`,
        { template_key: t.key, via: "workflow" },
        t.beforeSend,
      ),
    upcoming: async () => null,
    // The lead's conversation, honestly: what reached her since then.
    sentSince: async (_contactId, since, text, channel) => {
      await jitter();
      const hit = delivered.find(d => d.at >= since && d.body === text && (channel === "email" ? d.lane === "email" : d.lane !== "email"));
      if (!hit) return false;
      const r = rows.get(hit.requestId);
      const id = r?.ghl_message_id ? String(r.ghl_message_id) : null;
      const g = id ? ghl.get(id) : null;
      if (g?.status === "failed") return { id, status: "failed", failed: true, error: g.error ?? "failed" };
      return { id, status: g?.status ?? "sent" };
    },
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  return { ...w, io, rnd, wa, mode, rows, delivered, audits, errors, order, rooms, room, jitter, learnKeys, keyRoom, ghl };
}
type W = ReturnType<typeof world>;

function urlFor(r: Row): string {
  const code = String(r.code).toLowerCase();
  return r.provider === "zoom"
    ? `https://us06web.zoom.us/j/8501${[...code].map(c => c.charCodeAt(0) % 10).join("")}${code.length}?pwd=stress`
    : `https://meet.google.com/m1c-${code}`;
}

/** The worker for every room asked for while it runs: claim, store worker.ready, open, tell sales-api. */
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
      await w.learnKeys(id);
      await w.jitter(6);
      const claimed = await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
        method: "PATCH",
        body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 },
        prefer: "return=representation",
      });
      if (!claimed.length) continue;
      await w.jitter(10);
      // A Meet room the worker cannot make on some seeds (Google's answer).
      if (w.rnd() < 0.12) {
        await w.db.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
          method: "POST",
          body: { room_id: id, kind: "worker.failed", source: "worker", dedupe_key: `worker.failed:${id}`, detail: { worker_run: "run-1" }, text: "Room not made." },
          prefer: "resolution=ignore-duplicates",
        });
        await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=in.(requested,creating)`, {
          method: "PATCH",
          body: { state: "failed", error: "Google did not make the meeting. Try Zoom, or call the lead.", result: "failed", ended_at: w.db.iso(), version: Number(w.room(id).version) + 1 },
        });
        try {
          await w.rooms.desk["room.event"]!(desk, { kind: "worker.failed", room_id: id, payload: { worker_run: "run-1" } });
        } catch (e) {
          if (!(e instanceof ApiRefusal)) w.errors.push(`worker.failed: ${String((e as Error)?.message ?? e)}`);
        }
        continue;
      }
      await w.db.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
        method: "POST",
        body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made." },
        prefer: "resolution=ignore-duplicates",
      });
      const cur = w.room(id);
      const opened = await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
        method: "PATCH",
        body: {
          state: "open",
          join_url: urlFor(cur),
          provider_meeting_id: cur.provider === "zoom" ? `8501${String(cur.code).length}` : `evt-${String(cur.code).toLowerCase()}`,
          opened_at: w.db.iso(),
          host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
          ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
          version: Number(cur.version) + 1,
        },
        prefer: "return=representation",
      });
      if (!opened.length) continue;
      const tell = async () => {
        try {
          await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
        } catch (e) {
          if (!(e instanceof ApiRefusal)) w.errors.push(`worker.ready: ${String((e as Error)?.message ?? e)}`);
        }
      };
      const lost = w.rnd() < 0.25;
      if (!lost) void tell();
      if (w.rnd() < 0.3) void (async () => {
        await w.jitter(30);
        await tell();
      })();
      if (w.rnd() < 0.3) void (async () => {
        await w.jitter(60);
        const ev = w.db.t("cockpit_sales_room_events").find(e => e.dedupe_key === `worker.ready:${id}`) as Row;
        try {
          await w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [String(ev.id)] } });
        } catch (e) {
          if (!(e instanceof ApiRefusal)) w.errors.push(`replay: ${String((e as Error)?.message ?? e)}`);
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

/** The sweep's timers as SQL writes them: R1/R2 fail, R4 expire (guarded on the state). */
async function sweep(w: W, id: string, rule: "R1R2" | "R4") {
  const cur = w.room(id);
  if (rule === "R1R2") {
    if (!["requested", "creating"].includes(String(cur.state))) return;
    await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=in.(requested,creating)`, {
      method: "PATCH",
      body: { state: "failed", result: "failed", error: "The room was not made in time. Try again, or call the lead.", end_reason: "worker_timeout" },
    });
    return;
  }
  if (!["open", "host_in"].includes(String(cur.state))) return;
  await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=in.(open,host_in)`, {
    method: "PATCH",
    body: { state: "expired", end_reason: "lead_no_show", result: cur.result ?? "no_join" },
  });
}

async function ticks(w: W, ids: string[], twice: boolean) {
  const one = () => safe(w, "tick", () => w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: ids } }));
  if (twice) await Promise.all([one(), (async () => {
    await w.jitter(20);
    await one();
  })()]);
  else await one();
}

async function oneRound(w: W, n: number): Promise<void> {
  const tabs = w.rnd() < 0.5 ? 2 : 1;
  const sameId = w.rnd() < 0.5;
  const rid = crypto.randomUUID();
  const ask = { contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: w.rnd() < 0.7 ? "fallback" : "manual", trigger: "no_answer" };
  let done = false;
  const wk = worker(w, () => done);
  const presses: Promise<unknown>[] = [];
  for (let t = 0; t < tabs; t++)
    presses.push(
      (async () => {
        await w.jitter(10);
        return await safe(w, `create${n}.${t}`, () => w.rooms.actions["room.create"]!(setter, { ...ask, request_id: sameId ? rid : crypto.randomUUID() }));
      })(),
    );
  // The closer opens the lead's page and asks for a Zoom demo at the same moment.
  if (w.rnd() < 0.3)
    presses.push(
      (async () => {
        await w.jitter(10);
        return await safe(w, `closer.create${n}`, () =>
          w.rooms.actions["room.create"]!(closer, { contact_id: LEAD, provider: "zoom", call_kind: "demo", purpose: "manual", request_id: crypto.randomUUID() }),
        );
      })(),
    );
  await Promise.all(presses);
  const mine = w.db.t("cockpit_sales_rooms").filter(r => LIVE.includes(String(r.state)) || ["failed"].includes(String(r.state)));
  const last = mine[mine.length - 1];
  if (!last) {
    done = true;
    await wk;
    return;
  }
  const id = String(last.id);
  const host = String(last.host_email) === CLOSER ? closer : setter;
  // Most seeds: the room is made and its link has gone before anyone presses.
  if (w.rnd() < 0.6) {
    for (let i = 0; i < 400 && ["requested", "creating"].includes(String(w.room(id).state)); i++) await turn();
    for (let i = 0; i < 6; i++) {
      await turn();
      await w.flush();
    }
  }
  const seen = [Number(w.room(id).version), Number(w.room(id).version), Number(w.room(id).version)];
  const actors: (() => Promise<void>)[] = [];
  const tab = (i: number, who: Who) => async (f: (v: number) => Promise<unknown>, name: string) => {
    await w.jitter(40);
    const out = (await safe(w, name, () => f(seen[i] as number))) as Row | null;
    const r = out?.room as Row | undefined;
    if (r && String(r.id) === id) seen[i] = Number(r.version);
    void who;
  };
  for (let i = 0; i < 3; i++) {
    const who = i === 2 ? boss : host;
    const t = tab(i, who);
    if (i < 2 && w.rnd() < 0.4) actors.push(() => t(v => w.rooms.actions["room.mark"]!(who, { room_id: id, version: v, what: "host_in" }), `host_in.${i}`));
    if (i < 2 && w.rnd() < 0.25) actors.push(() => t(v => w.rooms.actions["room.mark"]!(who, { room_id: id, version: v, what: "lead_in" }), `lead_in.${i}`));
    if (i < 2 && w.rnd() < 0.15) actors.push(() => t(v => w.rooms.actions["room.mark"]!(who, { room_id: id, version: v, what: "not_lead" }), `not_lead.${i}`));
    if (w.rnd() < 0.4) actors.push(() => t(() => w.rooms.actions["room.send"]!(who, { room_id: id, channel: "email", request_id: crypto.randomUUID() }), `email.${i}`));
    if (w.rnd() < 0.45) {
      const reasons = ["end", "on_phone", "cancel", "admit_blocked", "admit_blocked", "finished"];
      const reason = reasons[Math.floor(w.rnd() * reasons.length)] as string;
      actors.push(() => t(v => w.rooms.actions["room.end"]!(who, { room_id: id, version: v, reason, confirm: w.rnd() < 0.5 }), `${reason}.${i}`));
    }
    // Use Meet / Try Zoom from the panel (a failed room, or a link that was late).
    if (i < 2 && w.rnd() < 0.25)
      actors.push(() =>
        t(v => {
          const r = w.room(id);
          return w.rooms.actions["room.create"]!(who, {
            contact_id: LEAD,
            provider: r.provider === "zoom" ? "meet" : "zoom",
            call_kind: r.call_kind,
            purpose: r.purpose,
            request_id: crypto.randomUUID(),
            replaces: id,
            replaces_version: v,
            ...(r.trigger ? { trigger: r.trigger } : {}),
          });
        }, `use_other.${i}`),
      );
    if (w.rnd() < 0.5)
      actors.push(async () => {
        await w.jitter(30);
        const out = (await safe(w, `status.${i}`, () => w.rooms.actions["room.status"]!(who, { room_id: id }))) as Row | null;
        const r = out?.room as Row | undefined;
        if (r) seen[i] = Number(r.version);
      });
  }
  actors.push(async () => {
    await w.jitter(60);
    w.clock.now += 61 * S;
    await ticks(w, [id], w.rnd() < 0.5);
  });
  if (w.rnd() < 0.25)
    actors.push(async () => {
      await w.jitter(40);
      w.clock.now += 61 * S;
      await safe(w, "sweep.R1R2", () => sweep(w, id, "R1R2"));
    });
  if (w.rnd() < 0.3)
    actors.push(async () => {
      await w.jitter(100);
      await safe(w, "sweep.R4", () => sweep(w, id, "R4"));
    });
  await Promise.all(actors.map(a => a()));
  done = true;
  await wk;
  await w.flush();
}

async function run(seed: number): Promise<{ ok: boolean; detail: Row }> {
  const w = world(seed);
  await oneRound(w, 1);
  if (!w.db.t("cockpit_sales_rooms").some(r => LIVE.includes(String(r.state))) && w.rnd() < 0.5) {
    w.clock.now += 2 * MIN;
    await oneRound(w, 2);
  }
  await w.flush();
  for (let i = 0; i < 4; i++) {
    w.clock.now += MIN + S;
    const all = w.db.t("cockpit_sales_rooms").map(r => String(r.id));
    if (all.length) await ticks(w, all, w.rnd() < 0.5);
    await w.flush();
  }
  const all = w.db.t("cockpit_sales_rooms");
  for (const r of all) await w.learnKeys(String(r.id));
  const why: string[] = [];
  const perRoom: Row[] = [];
  for (const r of all) {
    const rid = String(r.id);
    const url = urlFor(r);
    const mine = w.delivered.filter(d => w.keyRoom.get(d.requestId) === rid);
    const wa = mine.filter(d => d.lane !== "email");
    const em = mine.filter(d => d.lane === "email");
    const wrong = mine.filter(d => d.lane !== "template" && !d.body.includes(url));
    const closedAtSend = mine.filter(d => !LIVE.includes(String(d.liveAtCheck[rid] ?? "")));
    const creates = w.audits.filter(a => a.action === "room.create" && a.entityId === rid).length;
    const ends = w.audits.filter(a => a.action === "room.end" && a.entityId === rid).length;
    const linkRows = (c: string) => w.audits.filter(a => a.action === "room.link" && a.entityId === rid && ((a.after as Row)?.link_channels as string[] | undefined)?.at(-1) === c && !(a.after as Row)?.backup_resumed).length;
    const sends = w.audits.filter(a => a.action === "room.send" && a.entityId === rid).length;
    perRoom.push({ code: r.code, host: r.host_email, provider: r.provider, state: r.state, result: r.result ?? null, link_sent_at: r.link_sent_at ?? null, ch: r.link_channels, wa: wa.length, email: em.length, wrong: wrong.length, closed_at_send: closedAtSend.length, creates, ends, sends });
    if (wa.length > 1 && !(wa.length === 2 && wa.some(d => d.lane === "template") && wa.some(d => d.lane === "text"))) why.push(`${r.code}: ${wa.length} WhatsApp links`);
    if (wa.filter(d => d.lane === "text").length > 1) why.push(`${r.code}: two WhatsApp free texts`);
    if (wa.filter(d => d.lane === "template").length > 1) why.push(`${r.code}: two templates`);
    if (em.length > 1) why.push(`${r.code}: two emails`);
    if (wrong.length) why.push(`${r.code}: a message carried another room's link`);
    if (closedAtSend.length) why.push(`${r.code}: a link let go for a closed room`);
    if (creates > 1) why.push(`${r.code}: room.create audited ${creates} times`);
    if (ends > 1) why.push(`${r.code}: room.end audited ${ends} times`);
    if (sends > 1) why.push(`${r.code}: room.send audited ${sends} times`);
    for (const c of ["whatsapp_text", "whatsapp_template", "email"]) if (linkRows(c) > 1) why.push(`${r.code}: room.link for ${c} audited ${linkRows(c)} times`);
    if (mine.length && !r.link_sent_at) why.push(`${r.code}: a link reached the lead and the room does not say it went`);
  }
  // Never two rooms live at once for the lead (the database's rule; a check of the fakes).
  if (all.filter(r => LIVE.includes(String(r.state))).length > 1) why.push("two live rooms");
  if (w.errors.length) why.push("errors");
  const detail: Row = { seed, wa: w.wa, mode: w.mode, order: w.order.join(" > "), rooms: perRoom, errors: w.errors.slice(0, 4), why };
  return { ok: why.length === 0, detail };
}

describe("m1 concurrency r6 fuzz: two seats, a manager, the worker, the sweep, two ticks and HighLevel's answers", () => {
  test(`m1 r6 fuzz: ${SEEDS} seeded interleavings with the pilot's settings`, async () => {
    const bad: Row[] = [];
    const kinds = new Map<string, number>();
    const only = process.env.M1C6_SEED ? process.env.M1C6_SEED.split(",").map(Number) : null;
    for (let s = 1; s <= SEEDS; s++) {
      if (only && !only.includes(s)) continue;
      const out = await run(s);
      if (process.env.M1C6_SHOW) console.log(JSON.stringify(out.detail));
      if (!out.ok) {
        bad.push(out.detail);
        for (const k of out.detail.why as string[]) {
          const key = k.replace(/^[A-Z0-9]+: /, "");
          kinds.set(key, (kinds.get(key) ?? 0) + 1);
        }
      }
    }
    if (bad.length && process.env.M1C6_DEBUG) console.log(JSON.stringify(bad.slice(0, Number(process.env.M1C6_DEBUG) || 3), null, 1));
    expect({ failing_seeds: bad.length, kinds: Object.fromEntries(kinds), first: bad[0] ?? null }).toEqual({ failing_seeds: 0, kinds: {}, first: null });
  }, 900_000);
});
