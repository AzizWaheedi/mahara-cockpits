// bun test supabase/functions/sales-api/stress_concurrency_rooms.test.ts
//
// Round 1 stress, dimension: concurrency and idempotency. rooms.ts on
// testfakes.ts, where every await is a point another request can run in,
// the way parallel Edge Function requests interleave. The message service
// here is modelled on index.ts convoSend and sendTemplate as they are: the
// message row is written first under its request id (a twin of an unfinished
// send gets that row back, state "sending"), then HighLevel is called.
//
// Each test states the behaviour the contract or the CEO's bar asks for
// ("a double press sends the same request_id", "two closers taking one
// offer", "room.event delivered 5 times at once", "link send and cancel
// racing"). A failing test is a finding; it is left in the repo for the fix
// agent and stays as a regression test once fixed.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, ROOM_COPY } from "./roomlogic.ts";
import { makeRooms, type RoomDeps, seatRequestId } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const LEAD = "VjPfR4Cc1Y0OFvaqeor5";
const CLOSER = "closer@maharamedia.com";
const SETTER = "setter@maharamedia.com";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";

const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer" };
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const closerN = (i: number): Who => ({ signed_in: true, seat: true, manager: false, email: `closer${i}@maharamedia.com`, name: `Closer ${i}`, role: "closer", ghl_user_id: `G-c${i}` });

const ROOMS_ON = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: true, whatsapp_template: true, email: true },
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
};
const GUARD_OPEN = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 };

/** A promise the test opens when it chooses: the moment a step is held. */
function gate() {
  let open!: () => void;
  const p = new Promise<void>(r => (open = r));
  return { p, open };
}

interface Opts {
  rooms?: Row;
  live?: Row;
}

function setup(o: Opts = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  // The message table as convoSend keeps it: request_id -> row, written before HighLevel is called.
  const messages = new Map<string, Row>();
  // What reached HighLevel's send endpoint: one entry per real message to the lead.
  const delivered: Row[] = [];
  const hooks = {
    /** Runs inside the send, after the row is written and before HighLevel answers. */
    beforeSend: null as null | ((b: Row) => Promise<void>),
    /** HighLevel's answer to a send: a state, or an Error. */
    sendResult: (_b: Row): Row | Error => ({ state: "sent", provider_status: "sent" }),
  };
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON, ...(o.rooms ?? {}) } },
    { key: "live", value: { enabled: false, standby: true, ...(o.live ?? {}) } },
    { key: "whatsapp_guard", value: GUARD_OPEN },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  const people: Row[] = [
    { email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true },
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
  ];
  const hosts: Row[] = [
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
    { email: SETTER, zoom_user_id: null, zoom_status: "pending", google_ok: true },
  ];
  for (let i = 0; i < 60; i++) {
    people.push({ email: `closer${i}@maharamedia.com`, name: `Closer ${i}`, role: "closer", ghl_user_id: `G-c${i}`, active: true });
    hosts.push({ email: `closer${i}@maharamedia.com`, zoom_user_id: `Z-c${i}`, zoom_status: "licensed", google_ok: true });
  }
  w.db.seed("cockpit_sales_people", people);
  w.db.seed("cockpit_sales_room_hosts", hosts);
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - 3_600_000).toISOString() }]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["cockpit-test"], country: "KW" };
  const contactGate = { held: null as null | ReturnType<typeof gate>, reached: null as null | ReturnType<typeof gate> };
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) {
      if (contactGate.held) {
        const g = contactGate.held;
        contactGate.held = null;
        contactGate.reached?.open();
        await g.p;
      }
      return { contact };
    }
    return null as unknown as Row;
  });
  const bookings: Row[] = [];
  w.routes.push((m, p, body) => {
    if (m === "POST" && p === "/calendars/events/appointments") {
      const id = `bk-${bookings.length + 1}`;
      bookings.push({ id, ...(body as Row) });
      return { id };
    }
    if (m === "PUT" || m === "DELETE") return { ok: true };
    return null as unknown as Row;
  });

  /** convoSend / sendTemplate as index.ts has them: written first, a twin returns the row as it is now. */
  async function send(kind: "text" | "template", requestId: string, b: Row): Promise<{ message: Row; repeated?: boolean }> {
    const already = messages.get(requestId);
    if (already) return { message: { ...already }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, state: "sending", kind, ...b };
    messages.set(requestId, row);
    if (hooks.beforeSend) await hooks.beforeSend(row);
    const r = hooks.sendResult(row);
    if (r instanceof Error) {
      row.state = "failed";
      row.error = r.message;
      throw new ApiRefusal(`HighLevel did not send it: ${r.message}`, 502);
    }
    Object.assign(row, r);
    if (row.state !== "failed") delivered.push({ ...row });
    return { message: { ...row } };
  }

  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({}),
    sendText: async (_who, b) => send("text", b.request_id, { channel: b.channel, body: b.body }),
    sendTemplate: async (_who, t) => send("template", t.requestId, { channel: "whatsapp_template", key: t.key }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  const events = (id?: string) => w.db.t("cockpit_sales_room_events").filter(e => !id || e.room_id === id);

  /** The worker: claim, store worker.ready, open the room as lc-worker does (contract v2 section 7). */
  async function workerOpens(id: string, url = MEET_URL) {
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
  async function make(who: Who = setter, b: Row = {}): Promise<Row> {
    const out = await rooms.actions["room.create"]!(who, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
      ...b,
    });
    return out.room as Row;
  }
  /** A room the worker opened and whose worker.ready went through (the link claimed). */
  async function openRoom(who: Who = setter, b: Row = {}): Promise<string> {
    const id = String((await make(who, b)).id);
    await workerOpens(id, (b.provider as string) === "zoom" ? ZOOM_URL : MEET_URL);
    return id;
  }
  function offer(offeredTo: string[] = [CLOSER]): string {
    const id = fakeUuid();
    w.db.seed("cockpit_sales_live", [
      { id, request_id: fakeUuid(), contact_id: LEAD, asked_by: SETTER, kind: "demo", reason: "on_call", state: "offered", offered_to: offeredTo, offer_until: new Date(w.clock.now + 2 * MIN).toISOString() },
    ]);
    return id;
  }
  return { ...w, rooms, audits, messages, delivered, hooks, contactGate, bookings, room, events, workerOpens, make, openRoom, offer };
}

/** Each press's outcome: the answer, or the refusal's code and sentence (anything else is a crash). */
async function settle<T>(ps: Promise<T>[]): Promise<({ ok: true; value: T } | { ok: false; code: string; message: string; status: number; crash?: string })[]> {
  const out = await Promise.allSettled(ps);
  return out.map(o => {
    if (o.status === "fulfilled") return { ok: true as const, value: o.value };
    const e = o.reason;
    if (e instanceof ApiRefusal) return { ok: false as const, code: String(e.extra.code ?? ""), message: e.message, status: e.status };
    return { ok: false as const, code: "crash", message: String((e as Error)?.message ?? e), status: 500, crash: String((e as Error)?.stack ?? e) };
  });
}

// ---------------------------------------------------------------------------

describe("live.take: one offer, many presses", () => {
  test("fifty closers press Take on one offer at once: one claim, one room, one link; every other press hears it was taken", async () => {
    const w = setup({ live: { enabled: true } });
    const takers = Array.from({ length: 50 }, (_, i) => closerN(i));
    const id = w.offer(takers.map(t => String(t.email)));
    const outs = await settle(takers.map(t => w.rooms.actions["live.take"]!(t, { live_id: id, request_id: crypto.randomUUID() })));
    await w.flush();
    const won = outs.filter(o => o.ok);
    expect(won).toHaveLength(1);
    expect(outs.filter(o => !o.ok).map(o => (o.ok ? "" : o.message))).toEqual(Array(49).fill(ROOM_COPY.refusals.taken));
    const l = w.db.t("cockpit_sales_live")[0] as Row;
    expect(l.state).toBe("claimed");
    expect(w.db.t("cockpit_sales_rooms").filter(r => r.handover_id === id)).toHaveLength(1);
    expect(w.db.t("cockpit_sales_room_events").filter(e => e.kind === "live.claimed")).toHaveLength(1);
    expect(w.audits.filter(a => a.action === "live.take")).toHaveLength(1);
  });

  test("the same closer's Take arriving twice at once (two tabs, or the retry of a press whose answer was slow) answers the closer's room both times, never 'Someone else took this lead.'", async () => {
    const w = setup({ live: { enabled: true } });
    const id = w.offer([CLOSER]);
    const request_id = crypto.randomUUID();
    const outs = await settle(Array.from({ length: 20 }, () => w.rooms.actions["live.take"]!(closer, { live_id: id, request_id })));
    await w.flush();
    // The closer holds the lead: the database says so.
    expect((w.db.t("cockpit_sales_live")[0] as Row).claimed_by).toBe(CLOSER);
    // ...so no press of theirs may say someone else took it (the UI would drop the offer as "lost").
    const lies = outs.filter(o => !o.ok && o.message === ROOM_COPY.refusals.taken);
    expect(lies.length).toBe(0);
    expect(outs.every(o => o.ok)).toBe(true);
    expect(w.db.t("cockpit_sales_rooms").filter(r => r.handover_id === id)).toHaveLength(1);
  });

  test("Take, its retry and the sweep's replay of live.claimed at once (the take crashed after the claim): one room", async () => {
    const w = setup({ live: { enabled: true } });
    const id = w.offer([CLOSER]);
    // The first take fails right after the claim (a database blip on its first
    // read of the room the claim reserved; before 20261003d, on the room's
    // insert): the claim stands, live.claimed is released for the replay.
    w.db.faults.push({ prefix: "cockpit_sales_rooms?request_id", method: "GET", error: new Error("database: no answer within 8 s"), times: 1 });
    await settle([w.rooms.actions["live.take"]!(closer, { live_id: id, request_id: crypto.randomUUID() })]);
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.kind === "live.claimed") as Row;
    expect(ev.handled_at ?? null).toBeNull();
    w.clock.now += 61 * S;
    const outs = await settle([
      ...Array.from({ length: 10 }, () => w.rooms.actions["live.take"]!(closer, { live_id: id, request_id: crypto.randomUUID() })),
      ...Array.from({ length: 10 }, () => w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [ev.id] } })),
    ]);
    await w.flush();
    expect(outs.filter(o => !o.ok && o.code === "crash")).toHaveLength(0);
    expect(w.db.t("cockpit_sales_rooms").filter(r => r.handover_id === id)).toHaveLength(1);
    expect((w.db.t("cockpit_sales_live")[0] as Row).room_id).toBeTruthy();
  });

  test("Not now from twelve closers at once: every one is recorded, none is told 'This changed a moment ago.'", async () => {
    const w = setup({ live: { enabled: true } });
    const takers = Array.from({ length: 12 }, (_, i) => closerN(i));
    const id = w.offer(takers.map(t => String(t.email)));
    const outs = await settle(takers.map(t => w.rooms.actions["live.decline"]!(t, { live_id: id, request_id: crypto.randomUUID() })));
    const stale = outs.filter(o => !o.ok);
    expect(stale.map(o => (o.ok ? "" : o.message))).toEqual([]);
    expect(((w.db.t("cockpit_sales_live")[0] as Row).declined_by as string[]).length).toBe(12);
  });
});

describe("room presses from two tabs", () => {
  test("The lead is in, pressed in two tabs on the same version at once: both answer the room with the lead in it", async () => {
    const w = setup();
    const id = await w.openRoom();
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.flush();
    const v = Number(w.room(id).version);
    const outs = await settle([1, 2].map(() => w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "lead_in" })));
    expect(w.room(id).state).toBe("lead_in");
    // The contract: a repeat press is a no-op. The second tab must not say "This changed a moment ago."
    expect(outs.map(o => (o.ok ? "ok" : o.message))).toEqual(["ok", "ok"]);
  });

  test("That was not the lead, pressed twice at once: the count is taken back once and neither press is refused", async () => {
    const w = setup();
    const id = await w.openRoom();
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.flush();
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.flush();
    const v = Number(w.room(id).version);
    const outs = await settle([1, 2].map(() => w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "not_lead" })));
    expect(w.room(id).state).toBe("host_in");
    expect(outs.map(o => (o.ok ? "ok" : o.message))).toEqual(["ok", "ok"]);
  });

  test("two hundred Video link presses for one lead from four tabs (each tab one request id): one room; a tab's own presses all get it, the others hear the lead has a room", async () => {
    const w = setup();
    const tabs = [0, 1, 2, 3].map(() => crypto.randomUUID());
    const presses = tabs.flatMap(rid => Array.from({ length: 50 }, () => ({ rid })));
    const outs = await settle(
      presses.map(p => w.rooms.actions["room.create"]!(setter, { request_id: p.rid, contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" })),
    );
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(1);
    // The stored id is the tab's own, hashed with the seat's email (final review).
    const stored = String(w.db.t("cockpit_sales_rooms")[0]?.request_id);
    const byStored = new Map(await Promise.all(tabs.map(async rid => [await seatRequestId(setter, rid), rid] as const)));
    const winner = byStored.get(stored);
    expect(winner).toBeDefined();
    for (let i = 0; i < presses.length; i++) {
      const o = outs[i]!;
      if (presses[i]!.rid === winner) expect(o.ok ? ((o.value as Row).room as Row).id : o.message).toBe(w.db.t("cockpit_sales_rooms")[0]?.id);
      else expect(o.ok ? "made a second room" : o.code).toBe("lead_has_room");
    }
  });

  test("Open the call's room for a booked call, pressed in two tabs at once: both get the same booked room", async () => {
    const w = setup();
    const start = w.clock.now + 10 * MIN;
    w.db.seed("cockpit_sales_appointments", [{ appointment_id: "demo-1", contact_id: LEAD, call_type: "demo", start_at: new Date(start).toISOString(), status: "confirmed", assigned_user_id: "G-closer" }]);
    w.routes.unshift((m, p) =>
      m === "GET" && p === "/calendars/events/appointments/demo-1"
        ? { appointment: { id: "demo-1", contactId: LEAD, startTime: new Date(start).toISOString(), endTime: new Date(start + 45 * MIN).toISOString(), address: ZOOM_URL, assignedUserId: "G-closer" } }
        : (null as unknown as Row),
    );
    const outs = await settle([1, 2].map(() => w.rooms.actions["room.wrap"]!(closer, { appointment_id: "demo-1", request_id: crypto.randomUUID() })));
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(1);
    expect(outs.map(o => (o.ok ? ((o.value as Row).room as Row).id : `${o.code}: ${o.message}`))).toEqual([
      w.db.t("cockpit_sales_rooms")[0]?.id,
      w.db.t("cockpit_sales_rooms")[0]?.id,
    ]);
  });

  test("I'm available pressed twice at once (a double tap, or the phone and the laptop): one standby room and no standby error", async () => {
    const w = setup({ live: { enabled: true } });
    // Real clocks move between two requests: every read of the clock is a millisecond later.
    w.io.now = () => ++w.clock.now;
    const a = w.rooms.actions["live.availability"]!(closer, { state: "available" });
    const b = w.rooms.actions["live.availability"]!(closer, { state: "available" });
    const outs = await settle([a, b]);
    expect(w.db.t("cockpit_sales_rooms").filter(r => r.purpose === "standby")).toHaveLength(1);
    expect(outs.map(o => (o.ok ? ((o.value as Row).standby_error ?? null) : o.message))).toEqual([null, null]);
  });
});

describe("the link: sends, cancels and re-asks racing", () => {
  test("End pressed while the link is on its way (HighLevel still reading the contact): the lead gets no link to a cancelled room", async () => {
    const w = setup();
    const id = await w.openRoom();
    const held = gate();
    const reached = gate();
    w.contactGate.held = held;
    w.contactGate.reached = reached;
    // worker.ready claims the link; the send starts in the background and waits on HighLevel's contact read.
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await reached.p;
    // Meanwhile the rep ends the room (they reached the lead by phone).
    const v = Number(w.room(id).version);
    await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "on_phone" });
    expect(w.room(id).state).toBe("cancelled");
    held.open();
    await w.flush();
    expect(w.delivered.map(m => m.channel)).toEqual([]);
  });

  test("End pressed while the template is being read back: no email backup follows to a cancelled room", async () => {
    const w = setup({ rooms: { send: { whatsapp_text: false, whatsapp_template: true, email: true }, short_link: true } });
    w.db.seed("cockpit_sales_wa_templates", [{ key: "call_link_ar", active: true, workflow_id: "wf" }]);
    const id = await w.openRoom();
    const inSend = gate();
    const release = gate();
    w.hooks.beforeSend = async row => {
      if (row.kind === "template") {
        inSend.open();
        await release.p;
      }
    };
    // The template is accepted but not seen within 20 s: the email backup would follow.
    w.hooks.sendResult = row => (row.kind === "template" ? { state: "sent", provider_status: "enrolled" } : { state: "sent", provider_status: "sent" });
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await inSend.p;
    await w.rooms.actions["room.end"]!(setter, { room_id: id, version: Number(w.room(id).version), reason: "cancel" });
    release.open();
    await w.flush();
    expect(w.delivered.filter(m => m.channel === "email")).toEqual([]);
  });

  test("Also send by email lands while the WhatsApp link is being recorded: the room keeps both channels and both message ids", async () => {
    const w = setup();
    const id = await w.openRoom();
    const both = gate();
    let waiting = 0;
    const arrived = gate();
    w.hooks.beforeSend = async () => {
      waiting++;
      if (waiting === 2) arrived.open();
      await both.p;
    };
    // The two channel writes reach the database together, each built from the row it read just before:
    // the timing of two requests a few milliseconds apart.
    const real = w.io.db;
    const writes = gate();
    let atWrite = 0;
    w.io.db = async (path, init) => {
      const body = (init?.body ?? null) as Row | null;
      if (init?.method === "PATCH" && body && "link_channels" in body) {
        atWrite++;
        if (atWrite === 2) writes.open();
        await writes.p;
      }
      return real(path, init);
    };
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    const press = w.rooms.actions["room.send"]!(setter, { room_id: id, request_id: crypto.randomUUID(), channel: "email" });
    await arrived.p;
    both.open();
    await settle([press]);
    await w.flush();
    expect(w.delivered.map(m => m.channel).sort()).toEqual(["email", "whatsapp"]);
    const r = w.room(id);
    expect([...(r.link_channels as string[])].sort()).toEqual(["email", "whatsapp_text"]);
    expect(Object.keys(r.link_message_ids as Row).sort()).toEqual(["email", "whatsapp_text"]);
  });

  test("Also send by email pressed in two tabs at once (each tab its own request id): the lead gets one email", async () => {
    const w = setup();
    const id = await w.openRoom();
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.flush();
    await settle([1, 2].map(() => w.rooms.actions["room.send"]!(setter, { room_id: id, request_id: crypto.randomUUID(), channel: "email" })));
    expect(w.delivered.filter(m => m.channel === "email")).toHaveLength(1);
  });

  test("the tick's re-ask finds the first WhatsApp send still in flight, and that send then fails: the room never says the link went on WhatsApp", async () => {
    const w = setup();
    const id = await w.openRoom();
    const slow = gate();
    const inFlight = gate();
    let first = true;
    w.hooks.beforeSend = async row => {
      if (first && row.channel === "whatsapp") {
        first = false;
        inFlight.open();
        await slow.p;
      }
    };
    w.hooks.sendResult = row => (row.channel === "whatsapp" ? new Error("503 Meta did not take it") : { state: "sent", provider_status: "sent" });
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await inFlight.p;
    // HighLevel is slow: a minute later the sweep's tick re-asks the link that was claimed and not sent.
    w.clock.now += 61 * S;
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await new Promise(r => setTimeout(r, 0));
    slow.open();
    await w.flush();
    const r = w.room(id);
    // The WhatsApp text failed at HighLevel, so the room may not list it as a channel the link went on.
    expect(r.link_channels as string[]).not.toContain("whatsapp_text");
  });
});

describe("room.event delivered many times at once", () => {
  test("worker.ready x5, the lead's Zoom join x5 (one event id), sweep.replay x5 and tick x5 at once: one link, one booking, every event handled", async () => {
    const w = setup({ rooms: { count_on_join: true, test_calendar_id: "TESTCAL" } });
    const id = await w.openRoom(closer, { provider: "zoom", call_kind: "intro" });
    const worker = w.events(id).find(e => e.kind === "worker.ready") as Row;
    const joinId = fakeUuid();
    w.db.seed("cockpit_sales_room_events", [
      {
        id: joinId,
        room_id: id,
        kind: "zoom.meeting.participant_joined",
        source: "zoom",
        dedupe_key: `zoom:join:${joinId}`,
        detail: { event: "meeting.participant_joined", event_ts: w.clock.now, payload: { object: { id: "81234567890", participant: { email: "huda@example.com", join_time: new Date(w.clock.now).toISOString() } } } },
      },
    ]);
    w.clock.now += 25 * S;
    const outs = await settle([
      ...Array.from({ length: 5 }, () => w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} })),
      ...Array.from({ length: 5 }, () => w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: joinId, payload: {} })),
      ...Array.from({ length: 5 }, () => w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [worker.id, joinId] } })),
      ...Array.from({ length: 5 }, () => w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } })),
    ]);
    await w.flush();
    expect(outs.filter(o => !o.ok && o.code === "crash")).toHaveLength(0);
    // A minute later the sweep replays whatever was left (a released lease), and ticks again.
    w.clock.now += 61 * S;
    const left = w.events(id).filter(e => !e.handled_at && ["worker", "zoom"].includes(String(e.source))).map(e => String(e.id));
    if (left.length) await w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: left } });
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await w.flush();
    expect(w.delivered).toHaveLength(1);
    expect(w.bookings).toHaveLength(1);
    expect(w.room(id).state).toBe("lead_in");
    expect(w.events(id).filter(e => !e.handled_at && ["worker", "zoom"].includes(String(e.source)))).toHaveLength(0);
  });
});

describe("late and doubled presses on a closing room", () => {
  test("I can't let them in, pressed in two tabs at once (or retried after a lost answer): both answers carry the replacement room", async () => {
    const w = setup();
    // P1's own room for it: a Meet fallback room with a lead (stress2, round 2).
    const id = await w.openRoom(closer, { purpose: "fallback" });
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.flush();
    const v = Number(w.room(id).version);
    const outs = await settle([1, 2].map(() => w.rooms.actions["room.end"]!(closer, { room_id: id, version: v, reason: "admit_blocked" })));
    const live = w.db.t("cockpit_sales_rooms").filter(r => !["ended", "expired", "failed", "cancelled"].includes(String(r.state)));
    expect(live).toHaveLength(1);
    // Without a replacement in the answer the panel makes the room itself, and the lead already has one.
    expect(outs.map(o => (o.ok ? (((o.value as Row).replacement as Row | undefined)?.id ?? (o.value as Row).replacement_refusal ?? "neither") : o.message))).toEqual([
      live[0]?.id,
      live[0]?.id,
    ]);
  });

  test("the lead's Zoom join that happened before the sweep closed the room, delivered after it (webhook lag): the room keeps that the lead joined", async () => {
    const w = setup();
    const id = await w.openRoom(closer, { provider: "zoom", purpose: "fallback", trigger: "no_answer" });
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.flush();
    const joinedAt = w.clock.now + 600 * S - 3 * S; // three seconds before the lead's ten minutes run out
    w.clock.now += 600 * S + 1 * S;
    // The SQL sweep's R4 runs at the minute: no event is stored yet, so it closes the room lead_no_show.
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=in.(open,host_in)`, {
      method: "PATCH",
      body: { state: "expired", end_reason: "lead_no_show", result: "no_join" },
    });
    // Zoom's webhook for the join lands four seconds later.
    w.clock.now += 4 * S;
    const eid = fakeUuid();
    w.db.seed("cockpit_sales_room_events", [
      {
        id: eid,
        room_id: id,
        kind: "zoom.meeting.participant_joined",
        source: "zoom",
        dedupe_key: `zoom:join:${eid}`,
        detail: { event: "meeting.participant_joined", event_ts: joinedAt, payload: { object: { id: "81234567890", participant: { email: "huda@example.com", join_time: new Date(joinedAt).toISOString() } } } },
      },
    ]);
    await settle([w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: eid, payload: {} })]);
    const r = w.room(id);
    // The lead was in the call. A room that forgets it is settled as a no-show by the sweep (S1) and counted as nobody joining.
    expect(Boolean(r.lead_in_at) || r.result === "joined").toBe(true);
  });
});

describe("Away and Take racing on the standby room", () => {
  test("Away pressed while a Take adopts the closer's standby room: the adopted room (now the lead's) is not ended", async () => {
    const w = setup({ live: { enabled: true } });
    const sb = fakeUuid();
    w.db.seed("cockpit_sales_rooms", [
      { id: sb, request_id: fakeUuid(), purpose: "standby", call_kind: "demo", provider: "zoom", host_email: CLOSER, made_by: CLOSER, state: "host_in", join_url: ZOOM_URL, opened_at: w.db.iso(), host_in_at: w.db.iso(), version: 3 },
    ]);
    w.db.seed("cockpit_sales_availability", [{ email: CLOSER, state: "available", until: new Date(w.clock.now + 3_600_000).toISOString(), via: "cockpit" }]);
    const id = w.offer([CLOSER]);
    // The Away press read the standby room as empty; just before its End lands, the Take's claim adopts that room.
    let adopted = false;
    w.db.beforePatch = table => {
      if (table === "cockpit_sales_rooms" && !adopted) {
        adopted = true;
        w.db.liveClaim({ p_live_id: id, p_email: CLOSER, p_version: null });
      }
    };
    await settle([w.rooms.actions["live.availability"]!(closer, { state: "away" })]);
    await w.flush();
    const r = w.room(sb);
    expect(r.purpose).toBe("handover");
    expect(r.contact_id).toBe(LEAD);
    // Away ends empty standby rooms only: the room the lead is being sent to must stay open.
    expect(r.state).toBe("host_in");
  });
});
