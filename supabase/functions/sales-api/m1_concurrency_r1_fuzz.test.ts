// bun test supabase/functions/sales-api/m1_concurrency_r1_fuzz.test.ts
//
// Milestone 1, round 1, angle: concurrency and idempotency. A seeded
// interleaving search over one lead's video links with the pilot's settings
// (m1-scope.md section 3; the WhatsApp gate open on half the seeds, locked
// on the other half), wider than round 5's link fuzz: beside the room's
// link, in random order and timing,
//   - Send a video link from one or two tabs (one request id, or two);
//   - the worker's claim and open, worker.ready once or twice, its replay;
//   - the minute's ticks;
//   - I'm in the room and The lead is in from two tabs, with the version
//     each tab last read;
//   - End, We are on the phone, Cancel or I can't let them in, from one or
//     two tabs (the replacement's own worker runs too);
//   - Also send by email from one or two tabs;
//   - the sweep's R4 closing the room (lead_no_show), as SQL does it.
// Then, when the first room closed, the setter asks again (a second room).
//
// Whatever the order: each room's link reaches the lead at most once per
// lane; nothing reaches the lead for a room that was already closed when
// the cockpit let it go; one replacement at most per room; one room.create
// and at most one room.end audit row per room; no press answers anything
// but a sentence (never an unhandled error); no background job throws.
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
const HOUR = 60 * MIN;
const SETTER = "stress-m1c1f-setter@stress.invalid";
const LEAD = "stress-m1c1f-lead";
const SEEDS = Number(process.env.M1C1_SEEDS ?? 300);

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
const LIVE = ["requested", "creating", "open", "host_in", "lead_in"];

function world(seed: number) {
  const rnd = prng(seed);
  const wa = rnd() < 0.5;
  const w = fakeWorld();
  const rows = new Map<string, Row>();
  const delivered: { lane: Lane; body: string; at: number; liveRooms: Record<string, string> }[] = [];
  const audits: Row[] = [];
  const errors: string[] = [];
  const order: string[] = [];
  const appt = "stress-m1c1f-intro";
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
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "basic", google_ok: true }]);
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - HOUR).toISOString() }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW" }]);
  // Her booked intro, two minutes ahead and the setter's own: the missed call's room carries it.
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: appt,
      contact_id: LEAD,
      call_type: "intro",
      status: "confirmed",
      start_at: new Date(w.clock.now + 2 * MIN).toISOString(),
      end_at: new Date(w.clock.now + 32 * MIN).toISOString(),
      assigned_user_id: "G-setter",
      calendar_id: "cal-intro",
    },
  ]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" };
  w.routes.push((m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
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
      // M1C1_INNER=0 also makes a read's answer arrive at once, so a room
      // read open by the last check is still open when the send goes.
      if (process.env.M1C1_INNER !== "0") await jitter();
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
  const liveRooms = () =>
    Object.fromEntries(w.db.t("cockpit_sales_rooms").map(r => [String(r.join_url ?? r.code), String(r.state)]));
  async function send(
    lane: Lane,
    requestId: string,
    contactId: string,
    channel: "whatsapp" | "email",
    body: string,
    extra: Row,
    beforeSend?: () => Promise<boolean>,
  ) {
    // The message service's own reads before HighLevel is asked (its earlier
    // try, the switches, the ceilings, HighLevel's contact, the slot):
    // M1C1_INNER=0 takes them away, so only rooms.ts's own checks are judged.
    if (process.env.M1C1_INNER !== "0") await jitter();
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    // The slot: the row is written first (one per request id).
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    // index.ts convoSend and sendTemplate: the caller's last check runs after
    // those reads and the slot, right before the row is stamped and
    // HighLevel is asked (m1 round 1, link-sent-after-end-inside-message-
    // service). Stopped: the unstamped row is given up (voidUnsent).
    // The rooms as they stood when that last check began: a close that lands
    // while the check's own answer is on its way is the one race no check
    // can close, so a send is judged against the rooms at its last check.
    const atCheck = liveRooms();
    if (beforeSend && !(await beforeSend())) {
      rows.delete(requestId);
      const t = w.db.t("cockpit_sales_messages");
      t.splice(t.indexOf(row), 1);
      throw new ApiRefusal("Not sent: the room closed before the link went.", 409, { code: "stopped", certain: true });
    }
    // The cockpit's last check is behind it: HighLevel takes it now.
    delivered.push({ lane, body, at: w.clock.now, liveRooms: beforeSend ? atCheck : liveRooms() });
    await jitter(20);
    row.state = "sent";
    row.provider_status = lane === "template" ? "delivered" : "sent";
    row.ghl_message_id = `msg-${String(row.id).slice(-6)}`;
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
    sentSince: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  return { ...w, io, rnd, wa, rows, delivered, audits, errors, order, rooms, room, appt, jitter };
}
type W = ReturnType<typeof world>;

/** The worker for every room asked for while it runs: claim, store worker.ready, open, tell sales-api (sometimes twice). */
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
      await w.jitter(10);
      await w.db.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
        method: "POST",
        body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made." },
        prefer: "resolution=ignore-duplicates",
      });
      const cur = w.room(id);
      const code = String(cur.code).toLowerCase();
      const url = cur.provider === "zoom" ? `https://us06web.zoom.us/j/8501${code.length}${[...code].map(c => c.charCodeAt(0) % 10).join("")}?pwd=stress` : `https://meet.google.com/m1c-${code}`;
      const opened = await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
        method: "PATCH",
        body: {
          state: "open",
          join_url: url,
          provider_meeting_id: `evt-${code}`,
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
      void tell();
      if (w.rnd() < 0.4) void (async () => {
        await w.jitter(30);
        await tell();
      })();
      if (w.rnd() < 0.4) void (async () => {
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

/** The sweep's R4 as SQL does it: open or host_in, with a lead, closed expired lead_no_show (guarded on the state). */
async function sweepR4(w: W, id: string) {
  const cur = w.room(id);
  if (!["open", "host_in"].includes(String(cur.state))) return;
  await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=in.(open,host_in)`, {
    method: "PATCH",
    body: { state: "expired", end_reason: "lead_no_show", result: cur.result ?? "no_join" },
  });
}

async function oneRoom(w: W, second: boolean): Promise<string | null> {
  const tabs = w.rnd() < 0.5 ? 2 : 1;
  const sameId = w.rnd() < 0.5;
  const rid = crypto.randomUUID();
  const ask = {
    contact_id: LEAD,
    provider: "meet",
    call_kind: "intro",
    purpose: w.rnd() < 0.7 ? "fallback" : "manual",
    trigger: "no_answer",
    appointment_id: w.appt,
    item_kind: "intro",
  };
  let done = false;
  const wk = worker(w, () => done);
  const presses: Promise<unknown>[] = [];
  for (let t = 0; t < tabs; t++)
    presses.push(
      (async () => {
        await w.jitter(10);
        return await safe(w, `create${second ? "2" : ""}.${t}`, () =>
          w.rooms.actions["room.create"]!(setter, { ...ask, request_id: sameId ? rid : crypto.randomUUID() }),
        );
      })(),
    );
  await Promise.all(presses);
  const mine = w.db.t("cockpit_sales_rooms").filter(r => String(r.made_by) === SETTER && LIVE.includes(String(r.state)));
  const id = mine.length ? String(mine[mine.length - 1]!.id) : null;
  if (!id) {
    done = true;
    await wk;
    return null;
  }
  // The panel's last read, per tab.
  const seen = [Number(w.room(id).version), Number(w.room(id).version)];
  const actors: (() => Promise<void>)[] = [];
  const tab = (i: number) => async (f: (v: number) => Promise<unknown>, name: string) => {
    await w.jitter(40);
    const out = (await safe(w, name, () => f(seen[i] as number))) as Row | null;
    const r = out?.room as Row | undefined;
    if (r && String(r.id) === id) seen[i] = Number(r.version);
  };
  for (let i = 0; i < 2; i++) {
    const t = tab(i);
    if (w.rnd() < 0.5) actors.push(() => t(v => w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "host_in" }), `host_in.${i}`));
    if (w.rnd() < 0.3) actors.push(() => t(v => w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "lead_in" }), `lead_in.${i}`));
    if (w.rnd() < 0.4)
      actors.push(() => t(() => w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() }), `email.${i}`));
    if (w.rnd() < 0.5) {
      const reasons = ["end", "on_phone", "cancel", "admit_blocked", "admit_blocked"];
      const reason = reasons[Math.floor(w.rnd() * reasons.length)] as string;
      actors.push(() => t(v => w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason, confirm: w.rnd() < 0.5 }), `${reason}.${i}`));
    }
    // A tab that read the room again between presses.
    if (w.rnd() < 0.5)
      actors.push(async () => {
        await w.jitter(30);
        const out = (await safe(w, `status.${i}`, () => w.rooms.actions["room.status"]!(setter, { room_id: id }))) as Row | null;
        const r = out?.room as Row | undefined;
        if (r) seen[i] = Number(r.version);
      });
  }
  actors.push(async () => {
    await w.jitter(80);
    w.clock.now += 61 * S;
    await safe(w, "tick", () => w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } }));
  });
  if (w.rnd() < 0.3)
    actors.push(async () => {
      await w.jitter(100);
      await safe(w, "sweep.R4", () => sweepR4(w, id));
    });
  await Promise.all(actors.map(a => a()));
  done = true;
  await wk;
  await w.flush();
  for (let i = 0; i < 3; i++) {
    w.clock.now += MIN + S;
    const live = w.db.t("cockpit_sales_rooms").filter(r => LIVE.includes(String(r.state))).map(r => String(r.id));
    if (live.length) await safe(w, "tick", () => w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: live } }));
    await w.flush();
  }
  return id;
}

async function run(seed: number): Promise<{ ok: boolean; detail: Row }> {
  const w = world(seed);
  await oneRoom(w, false);
  // The first room closed: the setter asks again (the lead still has not picked up).
  if (!w.db.t("cockpit_sales_rooms").some(r => LIVE.includes(String(r.state))) && w.rnd() < 0.5) {
    w.clock.now += 2 * MIN;
    await oneRoom(w, true);
  }
  await w.flush();
  const all = w.db.t("cockpit_sales_rooms");
  const why: string[] = [];
  const perRoom: Row[] = [];
  for (const r of all) {
    const url = String(r.join_url ?? "");
    const mine = url ? w.delivered.filter(d => d.body.includes(url)) : [];
    const wa = mine.filter(d => d.lane !== "email");
    const em = mine.filter(d => d.lane === "email");
    const closedAtSend = mine.filter(d => !LIVE.includes(String(d.liveRooms[url] ?? "")));
    const creates = w.audits.filter(a => a.action === "room.create" && a.entityId === r.id).length;
    const ends = w.audits.filter(a => a.action === "room.end" && a.entityId === r.id).length;
    const replacements = all.filter(x => x.id !== r.id && x.request_id && r.result === "admit_blocked" && String(x.made_by) === SETTER && Date.parse(String(x.requested_at)) >= Date.parse(String(r.ended_at ?? r.requested_at)) - 5 * S).length;
    perRoom.push({ code: r.code, state: r.state, result: r.result ?? null, wa: wa.length, email: em.length, closed_at_send: closedAtSend.length, creates, ends });
    if (wa.length > 1) why.push(`${r.code}: two WhatsApp links`);
    if (em.length > 1) why.push(`${r.code}: two emails`);
    if (closedAtSend.length) why.push(`${r.code}: a link let go for a closed room`);
    if (creates > 1) why.push(`${r.code}: room.create audited ${creates} times`);
    if (ends > 1) why.push(`${r.code}: room.end audited ${ends} times`);
    if (replacements > 1) why.push(`${r.code}: ${replacements} rooms after I can't let them in`);
  }
  if (w.errors.length) why.push("errors");
  const detail: Row = { seed, wa: w.wa, order: w.order.join(" > "), rooms: perRoom, errors: w.errors.slice(0, 4), why };
  return { ok: why.length === 0, detail };
}

describe("m1 concurrency r1 fuzz: one lead's video links, every press from two tabs, the worker, the sweep", () => {
  test(`m1 fuzz: ${SEEDS} seeded interleavings with the pilot's settings`, async () => {
    const bad: Row[] = [];
    const kinds = new Map<string, number>();
    const only = process.env.M1C1_SEED ? process.env.M1C1_SEED.split(",").map(Number) : null;
    for (let s = 1; s <= SEEDS; s++) {
      if (only && !only.includes(s)) continue;
      const out = await run(s);
      if (!out.ok) {
        bad.push(out.detail);
        for (const k of out.detail.why as string[]) {
          const key = k.replace(/^[A-Z0-9]+: /, "");
          kinds.set(key, (kinds.get(key) ?? 0) + 1);
        }
      }
    }
    if (bad.length && process.env.M1C1_DEBUG) console.log(JSON.stringify(bad.slice(0, 5), null, 1));
    expect({ failing_seeds: bad.length, kinds: Object.fromEntries(kinds), first: bad[0] ?? null }).toEqual({ failing_seeds: 0, kinds: {}, first: null });
  }, 900_000);
});
