// bun test supabase/functions/sales-api/stress_chaos_rooms.test.ts
//
// Chaos round 1 (3 October 2026): every outside dependency failing or
// hanging at every step, answers lost after a write landed, the function
// killed between two lines (a deploy mid-room), and the replays that follow.
// The bar: every room ends in a named state, nothing is sent or booked twice,
// and the rep is told what to do.
//
// The message service here is a faithful model of index.ts convoSend and
// sendTemplate, not a convenience fake: a row is written first ("sending",
// unique request id), then HighLevel is called, then the row is updated; a
// repeat of the request id returns the row as it stands, whatever its state.
// `delivered` is what actually reached the lead's phone or inbox, which is
// what a lost answer makes different from what the cockpit believes.
//
// Tests marked HELD pass today and stay as regression tests. The others
// state the behaviour the CEO asked for and fail until it is fixed.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, DbError, GhlError, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const LEAD = "VjPfR4Cc1Y0OFvaqeor5";
const SETTER = "setter@maharamedia.com";
const CLOSER = "closer@maharamedia.com";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

type Mode = "ok" | "lost_answer" | "db_after_send" | "hang" | "meta_failed";
type Lane = "text" | "template" | "email";

/** Real time, so promises the fakes resolve get to run (the fake clock never moves on its own). */
const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function chaosWorld(o: { rooms?: Row; live?: Row } = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  const rows = new Map<string, Row>();
  const delivered: Row[] = [];
  const modes: Record<Lane, Mode[]> = { text: [], template: [], email: [] };
  const hung: { lane: Lane; release: (outcome: "sent" | "failed") => void }[] = [];
  const jobs: Promise<unknown>[] = [];
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        short_link: true,
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
        ...(o.rooms ?? {}),
      },
    },
    { key: "live", value: { enabled: false, standby: true, ...(o.live ?? {}) } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: SETTER, zoom_user_id: null, zoom_status: "pending", google_ok: true },
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
  ]);
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - 3_600_000).toISOString() }]);
  w.db.seed("cockpit_sales_wa_templates", [{ key: "call_link_ar", active: true, workflow_id: "wf-call-link" }]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["cockpit-test"], country: "KW" };
  w.routes.push((m, p) => (m === "GET" && p === `/contacts/${LEAD}` ? { contact } : (null as unknown as Row)));

  // Background work (EdgeRuntime.waitUntil): tracked here, so a job the test
  // hangs (a killed isolate) never blocks waiting for the others.
  const io: LiveIO = {
    ...w.io,
    background: p => {
      jobs.push(p.catch(e => w.logs.push(`background: ${String((e as Error)?.message ?? e)}`)));
    },
  };
  async function drain(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await Promise.race([Promise.allSettled(jobs.slice()), realSleep(40)]);
    }
  }

  /** convoSend / sendTemplate, as index.ts writes them. */
  async function send(lane: Lane, requestId: string, channel: "whatsapp" | "email", extra: Row): Promise<{ message: Row; repeated?: boolean }> {
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, channel, state: "sending", ...extra };
    rows.set(requestId, row);
    let mode = modes[lane].shift() ?? "ok";
    if (mode === "hang") {
      const outcome = await new Promise<"sent" | "failed">(release => hung.push({ lane, release }));
      mode = outcome === "sent" ? "ok" : "meta_failed";
    }
    if (mode === "lost_answer") {
      // HighLevel sent it, its answer never came: convoSend marks the row
      // failed and answers "HighLevel did not send it".
      delivered.push({ lane, requestId, ...extra });
      row.state = "failed";
      row.error = "HighLevel did not answer: no answer within 15 s";
      throw new ApiRefusal("HighLevel did not send it: HighLevel did not answer: no answer within 15 s", 502);
    }
    if (mode === "db_after_send") {
      // HighLevel sent it; the database write of the result did not answer.
      delivered.push({ lane, requestId, ...extra });
      throw new DbError("database: no answer within 8 s", 0);
    }
    if (mode === "meta_failed") {
      row.state = "failed";
      row.error = "Meta did not deliver it";
      row.provider_status = "failed";
      return { message: { ...row } };
    }
    delivered.push({ lane, requestId, ...extra });
    row.state = "sent";
    row.provider_status = "sent";
    return { message: { ...row } };
  }

  const deps: RoomDeps = {
    io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({}),
    sendText: (_who, b) => send(b.channel === "email" ? "email" : "text", b.request_id, b.channel, { body: b.body }),
    sendTemplate: (_who, t) => send("template", t.requestId, "whatsapp", { template_key: t.key, via: "workflow" }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  const events = (id?: string) => w.db.t("cockpit_sales_room_events").filter(e => !id || e.room_id === id);
  const whatsappDelivered = () => delivered.filter(d => d.lane === "text" || d.lane === "template");

  /** The room worker's handshake (contract v2 section 7): claim, store worker.ready, open. */
  async function workerOpens(id: string, url = MEET_URL) {
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
  async function make(who: Who = setter, b: Row = {}): Promise<string> {
    const out = await rooms.actions["room.create"]!(who, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
      ...b,
    });
    return String((out.room as Row).id);
  }
  async function readyEvent(id: string) {
    return await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
  }
  async function tick(id: string) {
    return await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
  }
  /** The next database call matching `match` lands, and then its answer is lost. */
  function loseAnswer(match: (method: string, path: string) => boolean) {
    const real = w.db.db.bind(w.db);
    let armed = true;
    w.db.db = async (path, init = {}) => {
      const out = await real(path, init);
      if (armed && match(init.method ?? "GET", path)) {
        armed = false;
        throw new DbError("database: no answer within 8 s", 0);
      }
      return out;
    };
  }
  return { ...w, io, rooms, audits, rows, delivered, modes, hung, room, events, whatsappDelivered, workerOpens, make, readyEvent, tick, drain, loseAnswer };
}

// ---------------------------------------------------------------------------
// The link: never twice, and never "sent" when it did not go
// ---------------------------------------------------------------------------

describe("chaos: the lead's link", () => {
  test("HighLevel sends the WhatsApp text but its answer is lost: the template must not go too (two WhatsApps to one lead)", async () => {
    const w = chaosWorld();
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.text.push("lost_answer");
    await w.readyEvent(id);
    await w.drain();
    // The lead got the text. A second WhatsApp with the same link is the
    // double send the CEO ruled out; an unclear send must stop the cascade.
    expect(w.whatsappDelivered().length).toBe(1);
  });

  test("HighLevel sends the WhatsApp text, then the database write of its result fails: no second channel goes", async () => {
    const w = chaosWorld();
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.text.push("db_after_send");
    await w.readyEvent(id);
    await w.drain();
    expect(w.delivered.length).toBe(1);
  });

  test("a deploy kills the send between its row and HighLevel: the re-ask must not record a link that never went", async () => {
    const w = chaosWorld({ rooms: { send: { whatsapp_text: true, whatsapp_template: false, email: false } } });
    const id = await w.make();
    await w.workerOpens(id);
    // The isolate dies inside convoSend after its "sending" row: the promise never settles.
    w.modes.text.push("hang");
    await w.readyEvent(id);
    await w.drain();
    expect(w.room(id).link_claimed_at).toBeTruthy();
    expect(w.delivered).toHaveLength(0);
    // The sweep's tick re-asks a minute later, with the same request id.
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    // Nothing reached the lead, so the room must not say the link went
    // ("Link sent on WhatsApp at ..." while the lead has nothing).
    expect(w.delivered).toHaveLength(0);
    expect(w.room(id).link_sent_at ?? null).toBeNull();
  });

  test("HighLevel slow: the tick's re-ask overlaps a send still in flight, which then fails at Meta: the room must not list WhatsApp as sent", async () => {
    const w = chaosWorld({ rooms: { send: { whatsapp_text: true, whatsapp_template: false, email: true } } });
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.text.push("hang");
    await w.readyEvent(id);
    await w.drain();
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    // The first send finally answers: Meta refused it.
    for (const h of w.hung.splice(0)) h.release("failed");
    await w.drain();
    const r = w.room(id);
    const sentLanes = new Set(w.delivered.map(d => (d.lane === "email" ? "email" : "whatsapp_text")));
    // Every channel the room lists must be one the lead actually got.
    for (const ch of (r.link_channels as string[]) ?? []) expect([ch, sentLanes.has(ch)]).toEqual([ch, true]);
  });

  test("sales-api was down for the sweep's three replays of worker.ready (given up): the tick must still send the link", async () => {
    const w = chaosWorld({ rooms: { send: { whatsapp_text: true, whatsapp_template: false, email: false } } });
    const id = await w.make();
    await w.workerOpens(id);
    // E0: three picks with no answer, then handled with detail.gave_up.
    const ev = w.events(id).find(e => e.kind === "worker.ready") as Row;
    Object.assign(ev, { handled_at: w.db.iso(), tries: 3, detail: { ...(ev.detail as Row), gave_up: true } });
    w.clock.now += 4 * MIN;
    await w.tick(id);
    await w.drain();
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    // The room is open with a lead and a join link: either the link goes, or
    // the panel is told why ("Room ready." for ten minutes is neither).
    const r = w.room(id);
    expect(Boolean(w.delivered.length === 1 || r.refusal)).toBe(true);
  });

  test("HELD: a deploy kills the background send right after the link was claimed (no message row yet): the tick sends it once", async () => {
    const w = chaosWorld({ rooms: { send: { whatsapp_text: true, whatsapp_template: false, email: false } } });
    const id = await w.make();
    await w.workerOpens(id);
    // The settings read inside sendLink never answers: the isolate is gone.
    const real = w.db.db.bind(w.db);
    let killed = true;
    w.db.db = async (path, init = {}) => {
      if (killed && path.startsWith("cockpit_sales_settings?key=in.(rooms,whatsapp_guard,messaging)")) {
        killed = false;
        return await new Promise<Row[]>(() => {});
      }
      return real(path, init);
    };
    await w.readyEvent(id);
    await w.drain();
    expect(w.room(id).link_claimed_at).toBeTruthy();
    expect(w.delivered).toHaveLength(0);
    for (let minute = 0; minute < 3; minute++) {
      w.clock.now += 61 * S;
      await w.tick(id);
      await w.drain();
    }
    expect(w.delivered).toHaveLength(1);
    expect(w.room(id).link_sent_at).toBeTruthy();
  });

  test("HELD: the ready write lands and its answer is lost: the lead still gets exactly one link", async () => {
    const w = chaosWorld({ rooms: { send: { whatsapp_text: true, whatsapp_template: false, email: false } } });
    const id = await w.make();
    await w.workerOpens(id);
    w.loseAnswer((m, p) => m === "PATCH" && p.startsWith(`cockpit_sales_rooms?id=eq.${id}`));
    await w.readyEvent(id).catch(() => null);
    await w.drain();
    expect(w.room(id).link_claimed_at).toBeTruthy();
    for (let minute = 0; minute < 3; minute++) {
      w.clock.now += 61 * S;
      await w.tick(id);
      const ev = w.events(id).find(e => e.kind === "worker.ready" && !e.handled_at);
      if (ev) await w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [ev.id] } });
      await w.drain();
    }
    expect(w.delivered).toHaveLength(1);
    expect(w.room(id).link_sent_at).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// "I can't let them in": the replacement room under failure
// ---------------------------------------------------------------------------

describe("chaos: admit_blocked", () => {
  test("the database stalls while the Zoom replacement is made, after the Meet room was cancelled: the answer still names what to do", async () => {
    const w = chaosWorld();
    const id = await w.make(setter, { purpose: "fallback" });
    await w.workerOpens(id);
    // The setter's Zoom is pending, so give them a usable Zoom for the replacement.
    const host = w.db.t("cockpit_sales_room_hosts").find(h => h.email === SETTER) as Row;
    Object.assign(host, { zoom_status: "licensed", zoom_user_id: "Z-setter" });
    w.db.faults.push({ prefix: "cockpit_sales_room_hosts?email=eq.", method: "GET", error: new DbError("database: no answer within 8 s", 0), times: 1 });
    let answer: Row | null = null;
    let thrown: unknown = null;
    try {
      answer = await w.rooms.actions["room.end"]!(setter, { room_id: id, version: Number(w.room(id).version), reason: "admit_blocked" });
    } catch (e) {
      thrown = e;
    }
    // The Meet room is cancelled either way (the lead is knocking at a closed room).
    expect(w.room(id).state).toBe("cancelled");
    // A bare 500 leaves the rep with a closed room and no button: the answer
    // must carry the replacement or the sentence that says what to do next.
    expect(thrown === null || thrown instanceof ApiRefusal).toBe(true);
    if (answer) expect(Boolean(answer.replacement || answer.replacement_refusal)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The live booking: an answer lost after HighLevel made it
// ---------------------------------------------------------------------------

describe("chaos: the live booking", () => {
  test("HighLevel makes the booking but its answer is lost: the room must not say failed while a booking stands, nor book again", async () => {
    const w = chaosWorld({ rooms: { count_on_join: true, test_calendar_id: "TESTCAL", send: { whatsapp_text: false, whatsapp_template: false, email: true } } });
    const bookings: Row[] = [];
    w.routes.unshift((m, p, body) => {
      if (m === "POST" && p === "/calendars/events/appointments") {
        bookings.push({ id: `bk-${bookings.length + 1}`, ...(body as Row) });
        throw new GhlError("HighLevel did not answer: no answer within 15 s", 0);
      }
      if (m === "GET" && p.startsWith("/contacts/") && p.includes("/appointments"))
        return { events: bookings.map(b => ({ id: b.id, calendarId: b.calendarId, startTime: b.startTime })) };
      if (m === "PUT" || m === "DELETE") return { ok: true };
      return null as unknown as Row;
    });
    const id = await w.make();
    await w.workerOpens(id);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.drain();
    for (let minute = 0; minute < 3; minute++) {
      w.clock.now += 61 * S;
      await w.tick(id);
      await w.drain();
    }
    expect(bookings).toHaveLength(1);
    // "failed" tells the rep to book it by hand: a second booking for one lead.
    const r = w.room(id);
    expect([r.count_result, r.count_appointment_id ?? null]).not.toEqual(["failed", null]);
  });
});

describe("chaos: That was not the lead", () => {
  test("HighLevel deletes the live booking but its answer is lost: the undo must still land (the retry's 404 means gone)", async () => {
    const w = chaosWorld({ rooms: { count_on_join: true, test_calendar_id: "TESTCAL", send: { whatsapp_text: false, whatsapp_template: false, email: true } } });
    const bookings = new Set<string>();
    let loseDelete = true;
    w.routes.unshift((m, p) => {
      if (m === "POST" && p === "/calendars/events/appointments") {
        bookings.add("live-appt-1");
        return { id: "live-appt-1" };
      }
      if (m === "DELETE" && p === "/calendars/events/live-appt-1") {
        if (!bookings.has("live-appt-1")) throw new GhlError("HighLevel said 404: Event not found", 404);
        bookings.delete("live-appt-1");
        if (loseDelete) {
          loseDelete = false;
          throw new GhlError("HighLevel did not answer: no answer within 15 s", 0);
        }
        return { succeded: true };
      }
      if (m === "PUT") return { ok: true };
      return null as unknown as Row;
    });
    const id = await w.make();
    await w.workerOpens(id);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.drain();
    expect(w.room(id).count_result).toBe("booked");
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
    await w.drain();
    for (let minute = 0; minute < 5; minute++) {
      w.clock.now += 61 * S;
      await w.tick(id);
      await w.drain();
    }
    expect(bookings.size).toBe(0);
    // HighLevel has no booking; the room must not keep counting one.
    expect(w.room(id).count_result).toBe("undone");
  });
});

describe("chaos: audit rows", () => {
  test("the room insert lands and its answer is lost; the rep's retry (same request id) returns the room: the room still has its room.create audit row", async () => {
    const w = chaosWorld();
    w.loseAnswer((m, p) => m === "POST" && p === "cockpit_sales_rooms");
    const request_id = crypto.randomUUID();
    const body = { request_id, contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" };
    const first = await w.rooms.actions["room.create"]!(setter, body).then(() => null, e => e);
    expect(first).toBeInstanceOf(DbError);
    const again = await w.rooms.actions["room.create"]!(setter, body);
    const id = String((again.room as Row).id);
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(1);
    expect(w.audits.filter(a => a.action === "room.create" && a.entityId === id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The handover take under failure
// ---------------------------------------------------------------------------

describe("chaos: live.take", () => {
  function offer(w: ReturnType<typeof chaosWorld>): string {
    const liveId = fakeUuid();
    w.db.seed("cockpit_sales_live", [
      {
        id: liveId,
        request_id: fakeUuid(),
        contact_id: LEAD,
        asked_by: SETTER,
        kind: "demo",
        reason: "on_call",
        state: "offered",
        offered_to: [CLOSER],
        offer_until: new Date(w.clock.now + 2 * MIN).toISOString(),
      },
    ]);
    return liveId;
  }

  test("the write that links the handover to its new room fails: the claim must stay replayable, or the handover expires under a live call", async () => {
    const w = chaosWorld({ live: { enabled: true } });
    const liveId = offer(w);
    w.db.faults.push({ prefix: `cockpit_sales_live?id=eq.${liveId}&room_id=is.null`, method: "PATCH", error: new DbError("database: no answer within 8 s", 0), times: 1 });
    const out = await w.rooms.actions["live.take"]!(closer, { live_id: liveId, request_id: crypto.randomUUID() });
    const roomId = String((out.room as Row | undefined)?.id ?? "");
    expect(roomId).not.toBe("");
    const l = w.db.t("cockpit_sales_live").find(x => x.id === liveId) as Row;
    const claimed = w.events().find(e => e.kind === "live.claimed") as Row;
    // Without room_id the sweep's L2 expires the handover at claim + 120 s
    // ("The closer who took it did not get into the room in time") while the
    // closer and the lead are in that very room.
    expect(Boolean(l.room_id === roomId || !claimed.handled_at)).toBe(true);
  });

  test("HELD: the claim lands and its answer is lost: a second Take finishes it, and the replay makes no second room", async () => {
    const w = chaosWorld({ live: { enabled: true } });
    const liveId = offer(w);
    const realRpc = w.db.rpc.bind(w.db);
    let lose = true;
    w.db.rpc = async (fn, args) => {
      const out = await realRpc(fn, args);
      if (lose && fn === "cockpit_sales_live_claim") {
        lose = false;
        throw new DbError("database: no answer within 8 s", 0);
      }
      return out;
    };
    const request_id = crypto.randomUUID();
    const first = await w.rooms.actions["live.take"]!(closer, { live_id: liveId, request_id }).then(() => null, e => e);
    expect(first).toBeInstanceOf(DbError);
    const again = await w.rooms.actions["live.take"]!(closer, { live_id: liveId, request_id });
    expect((again.room as Row | undefined)?.id).toBeTruthy();
    // The sweep replays live.claimed once its lease runs out.
    w.clock.now += 61 * S;
    const ev = w.events().find(e => e.kind === "live.claimed" && !e.handled_at);
    if (ev) await w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [ev.id] } });
    await w.drain();
    const mine = w.db.t("cockpit_sales_rooms").filter(r => r.handover_id === liveId);
    expect(mine).toHaveLength(1);
    expect(w.events().filter(e => e.kind === "live.claimed" && !e.handled_at)).toHaveLength(0);
  });
});
