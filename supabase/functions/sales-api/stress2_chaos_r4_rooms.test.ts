// bun test supabase/functions/sales-api/stress2_chaos_r4_rooms.test.ts
//
// Second series, round 4, chaos: answers lost AFTER the write landed, in the
// shapes the real outside world gives them. Rounds 2 and 3 modelled a lost
// answer as liveio's DbError with status 0 (the fetch itself failing). But
// liveio.ts (makeLiveIO) turns only the fetch() call into a DbError: the
// body is read afterwards (res.text(), JSON.parse) with nothing around it.
// So a 200 whose body is cut (the connection reset mid-answer, or the 8 s
// timeout firing after the headers came) is a raw TypeError or
// DOMException, and a 200 whose body is not JSON (a proxy's page) is a
// SyntaxError. Every "the answer was lost, read the row back" recovery that
// checks `e instanceof DbError && status 0 / 5xx` misses both.
//
// The fault here is produced by makeLiveIO itself, over a fetch whose 200
// answer is cut or garbled after the write landed in the fake database.
// sales-api's rooms.ts on testfakes.ts (no HighLevel, no database, no Zoom).
// The world below is round 3's, copied so this file stands alone. A failing
// test is a finding; tests marked HELD pass.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, DbError, makeLiveIO, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld, seedLeadZoomJoin } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const LEAD = "stress-chaos2r4-lead-0001";
const SETTER = "setter@stress.invalid";
const BOSS = "boss@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const MAY_HAVE_GONE = "The send may have gone; read the conversation in HighLevel before writing to the lead again";

const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Mode = "ok" | "unseen" | "lost";

interface WorldOpts {
  inboundAgoMs?: number;
  rooms?: Row;
  live?: Row;
  start?: number;
}

/** The fake world, with an io whose database calls a test can wrap. */
function world(o: WorldOpts = {}) {
  const w = fakeWorld(o.start);
  const audits: Row[] = [];
  const delivered: Row[] = [];
  const modes: Record<"text" | "template" | "email", Mode[]> = { text: [], template: [], email: [] };
  const hl = new Map<string, string>();
  const jobs: Promise<unknown>[] = [];
  const open = new Set<Promise<unknown>>();
  const dead = new Set<Promise<unknown>>();
  let around: ((path: string, init: Row, real: () => Promise<Row[]>) => Promise<Row[]>) | null = null;
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        // Settle and booked-call rooms on: these tests are about what they do (both ship off, Milestone 1).
        settle: true,
        wrap: true,
        enabled: true,
        test_only: false,
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        short_link: true,
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
        ...(o.rooms ?? {}),
      },
    },
    { key: "live", value: { enabled: false, ...(o.live ?? {}) } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: BOSS, name: "The manager", role: "manager", ghl_user_id: "G-boss", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: new Date(w.clock.now - 5 * S).toISOString() }]);
  w.db.seed("cockpit_sales_inbox", [
    { conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - (o.inboundAgoMs ?? HOUR)).toISOString() },
  ]);
  w.db.seed("cockpit_sales_wa_templates", [
    { key: "call_link_ar", active: true, workflow_id: "wf-call-link" },
    { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" },
  ]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" };
  /** HighLevel faults: the k-th HighLevel call (counted from arm()) fails once. */
  const ghlFault = { at: -1, n: 0, mode: "unclear" as "unclear" | "garbage" };
  const bookings: Row[] = [];
  w.routes.push(async (m, p, body) => {
    const k = ghlFault.n++;
    if (k === ghlFault.at) {
      if (ghlFault.mode === "unclear") throw Object.assign(new Error("HighLevel did not answer within 25 seconds"), { status: 0 });
      // Garbage: a 200 with a body nothing in it reads (an HTML page passed through as an object).
      return { html: "<html>502 Bad Gateway</html>" } as Row;
    }
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: [] };
    const one = /^\/calendars\/events\/appointments\/([^/?]+)$/.exec(p);
    if (one) {
      const id = decodeURIComponent(one[1] as string);
      const a = w.db.t("cockpit_sales_appointments").find(x => x.appointment_id === id);
      if (m === "GET")
        return a
          ? { appointment: { id, appointmentStatus: hl.get(id) ?? a.status, startTime: a.start_at, endTime: a.end_at, assignedUserId: a.assigned_user_id } }
          : (null as unknown as Row);
      if (m === "PUT") {
        const st = (body as Row | undefined)?.appointmentStatus;
        if (typeof st === "string") hl.set(id, st);
        return { ok: true };
      }
    }
    if (m === "POST" && p === "/calendars/events/appointments") {
      const id = `live-${fakeUuid()}`;
      bookings.push({ id, body });
      return { id };
    }
    if (m === "DELETE") return { ok: true };
    return null as unknown as Row;
  });

  const io: LiveIO = {
    ...w.io,
    db: (path, init = {}) => (around ? around(path, init as Row, () => w.io.db(path, init)) : w.io.db(path, init)),
    // Round 3: database functions go through the same fault plan (path "rpc/{fn}").
    rpc: (fn, args) =>
      around
        ? around(`rpc/${fn}`, { method: "POST", body: args }, async () => [{ __rpc: await w.io.rpc(fn, args) }]).then(r => (r[0] as Row).__rpc)
        : w.io.rpc(fn, args),
    background: p => {
      const q: Promise<unknown> = p
        .catch(e => w.logs.push(`background: ${String((e as Error)?.message ?? e)}`))
        .finally(() => open.delete(q));
      open.add(q);
      jobs.push(q);
    },
  };
  async function drain(): Promise<void> {
    // Round 3: a job still running after these rounds is a killed run (killAt): never waited for again.
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
    const row: Row = { id: fakeUuid(), request_id: requestId, channel, body, state: "sending", created_at: at(), ...extra };
    msgRows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    const mode = modes[lane].shift() ?? "ok";
    if (mode === "lost") {
      delivered.push({ lane, requestId, body });
      row.state = "unclear";
      row.error = "HighLevel did not answer: no answer within 25 s";
      throw new ApiRefusal(`${MAY_HAVE_GONE} (HighLevel did not answer: no answer within 25 s)`, 502, { unclear: true });
    }
    if (mode === "unseen") {
      row.state = "sent";
      row.provider_status = "enrolled";
      return { message: { ...row } };
    }
    delivered.push({ lane, requestId, body });
    row.state = "sent";
    row.provider_status = lane === "template" ? "delivered" : "sent";
    return { message: { ...row } };
  }

  /**
   * index.ts markAppointment as it writes: the appointment and the current
   * mark read, the current mark superseded, the new mark inserted, then
   * HighLevel, then the mark's crm. svc throws a plain Error on a database
   * failure (index.ts svc: "database 503: ..."), never an ApiRefusal.
   */
  const markKnobs = { failBeforeWrite: 0, failAfterSupersede: 0 };
  async function markAppointment(who: Who, id: string, status: string, opts: Row = {}): Promise<Row> {
    if (markKnobs.failBeforeWrite > 0) {
      markKnobs.failBeforeWrite--;
      throw new Error("database 503: upstream connect error or disconnect/reset before headers");
    }
    const current = w.db.t("cockpit_sales_dispositions").find(d => d.appointment_id === id && !d.superseded_at);
    if (opts.onlyIfUnmarked && current && !(current.status === status && current.marked_by === who.email))
      throw new ApiRefusal("This call was already marked, so the timer left it as it is.", 409, { code: "marked" });
    if (current && current.status === status && current.crm !== "failed") return { ...current, repeated: true };
    if (current) current.superseded_at = w.db.iso();
    if (markKnobs.failAfterSupersede > 0) {
      markKnobs.failAfterSupersede--;
      throw new Error("The database did not answer within 20 seconds");
    }
    const made: Row = {
      id: fakeUuid(),
      appointment_id: id,
      status,
      marked_by: who.email,
      note: (opts.note as string | undefined) ?? null,
      superseded_at: null,
      marked_at: w.db.iso(),
      crm: "pending",
    };
    w.db.t("cockpit_sales_dispositions").push(made);
    hl.set(id, status);
    made.crm = opts.quiet ? "quiet" : "written";
    return { ...made };
  }

  const deps: RoomDeps = {
    io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: (who, id, status, opts) => markAppointment(who, id, status, opts as Row),
    sendText: (_who, b) => send(b.channel === "email" ? "email" : "text", b.request_id, b.channel, b.body, { contact_id: b.contact_id }),
    sendTemplate: (_who, t) =>
      send("template", t.requestId, "whatsapp", `Your Mahara call is ready. Join here: https://call.maharamedia.com/${t.buttonVariable?.join_code ?? ""}`, {
        template_key: t.key,
        via: "workflow",
        contact_id: t.contactId,
      }),
    upcoming: async () => null,
    sentSince: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;

  function intro(status: string, startMs: number, id = "intro-r2") {
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: id,
        contact_id: LEAD,
        call_type: "intro",
        calendar_id: "cal-intro",
        status,
        start_at: new Date(startMs).toISOString(),
        end_at: new Date(startMs + 30 * MIN).toISOString(),
        assigned_user_id: "G-setter",
      },
    ]);
    hl.set(id, status);
  }

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
  async function make(b: Row = {}): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      ...b,
    });
    return String((out.room as Row).id);
  }
  const readyEvent = (id: string) => rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
  const tick = (id: string) => rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
  /** The SQL sweep's replay: worker and Zoom events left unhandled and not held. */
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
  /** One minute of the cron: the sweep's replay, then its tick for the room. */
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
  const alerts = (id: string) => w.db.t("cockpit_sales_alerts").filter(a => !a.resolved_at && String(a.dedupe_key ?? "").startsWith(`room:${id}:`));
  return {
    ...w,
    io,
    rooms,
    audits,
    delivered,
    modes,
    hl,
    markKnobs,
    ghlFault,
    bookings,
    room,
    intro,
    workerOpens,
    make,
    readyEvent,
    tick,
    replay,
    minute,
    drain,
    setAround,
    alerts,
  };
}

async function settle<T>(p: Promise<T>): Promise<void> {
  try {
    await p;
  } catch {
    /* the press or event failed: the cron's re-asks are what is under test */
  }
}

/**
 * A fault plan for the k-th database call made after `arm()`: "fail" throws
 * before the call reaches the database; "lost" lets it land and throws its
 * answer away (the 20 s timeout after the write). Only once.
 */
function faultAt(w: ReturnType<typeof world>, k: number, mode: "fail" | "lost") {
  let n = 0;
  const seen: string[] = [];
  w.setAround(async (path, init, real) => {
    const mine = n++;
    seen.push(`${String(init.method ?? "GET")} ${path.slice(0, 90)}`);
    if (mine !== k) return await real();
    if (mode === "fail") throw new DbError("database: no answer within 20 s", 0);
    await real();
    throw new DbError("database: no answer within 20 s", 0);
  });
  return { calls: () => n, seen };
}

// ---------------------------------------------------------------------------
// Helpers of this round
// ---------------------------------------------------------------------------

const MEETING = "81234567890";
const ZOOM_URL = `https://us06web.zoom.us/j/${MEETING}?pwd=stress`;

/** A Zoom fallback room for the lead, made, opened by the worker and its link asked for. */
async function zoomRoom(w: ReturnType<typeof world>, b: Row = {}): Promise<string> {
  const id = await w.make({ provider: "zoom", ...b });
  await w.workerOpens(id);
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { provider_meeting_id: MEETING, join_url: ZOOM_URL } });
  await settle(w.readyEvent(id));
  await w.drain();
  return id;
}

/** The door's stored Zoom event (its kept shape), then sales-api's room.event for it; the answer is returned or the error. */
async function zoomEvent(w: ReturnType<typeof world>, id: string, detail: Row, at: number): Promise<{ eventId: string; error: string | null }> {
  const eventId = fakeUuid();
  w.db.seed("cockpit_sales_room_events", [
    {
      id: eventId,
      room_id: id,
      kind: `zoom.${String(detail.event)}`,
      source: "zoom",
      dedupe_key: `zoom:${String(detail.event)}:${eventId}`,
      at: new Date(at).toISOString(),
      text: `Zoom: ${String(detail.event)}.`,
      detail,
    },
  ]);
  let error: string | null = null;
  try {
    await w.rooms.desk["room.event"]!(desk, { kind: `zoom.${String(detail.event)}`, event_id: eventId, payload: {} });
  } catch (e) {
    error = String((e as Error)?.message ?? e);
  }
  await w.drain();
  return { eventId, error };
}

const meetingObj = (extra: Row = {}) => ({ object: { id: MEETING, uuid: "u1==", host_id: "Z-setter", ...extra } });

/**
 * The database as production has it today: 20261003a to d applied,
 * 20261004a not. PostgREST refuses a write that names a column it does not
 * have (400, PGRST204), and a read that selects one (400, 42703).
 */
const MISSING_004A = ["meeting_ended_at", "standby_error", "standby_error_at", "zoom_capped_until"];
function without004a(w: ReturnType<typeof world>, refused: string[]) {
  w.setAround(async (path, init, real) => {
    const body = init.body && typeof init.body === "object" ? (init.body as Row) : null;
    // Fix round 3: the event lease's token is 20261004a's too (the function's
    // p_token, the column lease_token); sales-api leases and releases without it.
    if (path === "rpc/cockpit_sales_room_event_lease" && body && "p_token" in body) {
      refused.push("RPC cockpit_sales_room_event_lease p_token");
      throw new DbError("database 404: Could not find the function public.cockpit_sales_room_event_lease(p_dedupe_key, p_event_id, p_seconds, p_token) in the schema cache", 404, "PGRST202");
    }
    if (/[?&]lease_token=/.test(path)) {
      refused.push(`${String(init.method ?? "GET")} ${path.split("?")[0]} lease_token`);
      throw new DbError(`database 400: column ${path.split("?")[0]}.lease_token does not exist`, 400, "42703");
    }
    const named = body ? MISSING_004A.find(c => Object.prototype.hasOwnProperty.call(body, c)) : undefined;
    if (named) {
      refused.push(`${String(init.method ?? "GET")} ${path.split("?")[0]} ${named}`);
      throw new DbError(`database 400: Could not find the '${named}' column of '${path.split("?")[0]}' in the schema cache`, 400, "PGRST204");
    }
    const sel = /[?&]select=([^&]*)/.exec(path)?.[1] ?? "";
    const col = MISSING_004A.find(c => sel.split(",").includes(c));
    if (col) {
      refused.push(`GET ${path.split("?")[0]} ${col}`);
      throw new DbError(`database 400: column ${path.split("?")[0]}.${col} does not exist`, 400, "42703");
    }
    return await real();
  });
}


// ---------------------------------------------------------------------------
// Round 4: the answer lost after the write landed, as makeLiveIO throws it
// ---------------------------------------------------------------------------

const ENV_VALUES: Record<string, string> = { SUPABASE_URL: "https://db.stress.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-stress" };
const ENV = (k: string) => ENV_VALUES[k] ?? "";

/** A 200 whose body is cut half way (the connection reset mid-answer). */
function cutBody(): Response {
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('[{"id":"'));
        c.error(new TypeError("error reading a body from connection: connection reset"));
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
/** A 200 whose body is no JSON (a proxy's page passed through). */
const garbled = () => new Response("<html><body>upstream sent a page</body></html>", { status: 200 });

const cutIo = makeLiveIO({ env: ENV, fetch: (async () => cutBody()) as unknown as typeof fetch, log: () => {} });
const garbIo = makeLiveIO({ env: ENV, fetch: (async () => garbled()) as unknown as typeof fetch, log: () => {} });

type Lost = "dberror0" | "cut" | "garbage";
/** What the real makeLiveIO throws for this call when its answer is lost after the write landed. */
async function lostAnswer(how: Lost, path: string, init: Row): Promise<never> {
  if (how === "dberror0") throw new DbError("database: no answer within 8 s", 0);
  const io = how === "cut" ? cutIo : garbIo;
  if (path.startsWith("rpc/")) await io.rpc(path.slice(4), (init.body ?? {}) as Row);
  else await io.db(path, init as never);
  throw new Error("the answer was expected to be lost");
}

describe("chaos2 r4: what makeLiveIO throws for a 200 whose answer is cut or garbled", () => {
  test("liveio: a cut body and a garbled body are not DbError (the recoveries read status 0 or 5xx of a DbError)", async () => {
    const shapes: string[] = [];
    for (const how of ["cut", "garbage"] as const) {
      try {
        await lostAnswer(how, "cockpit_sales_rooms?id=eq.x", { method: "PATCH", body: {} });
      } catch (e) {
        shapes.push(`${how}: ${(e as Error).constructor.name} DbError=${e instanceof DbError} status=${String((e as { status?: unknown }).status)}`);
      }
    }
    // Recorded, not asserted: the shape is the cause of the findings below.
    console.log(shapes.join("\n"));
    expect(shapes.length).toBe(2);
  });
});

describe("chaos2 r4: Zoom's join of the lead, the room's write lands and its answer is cut", () => {
  async function joinLost(how: Lost) {
    const w = world({ rooms: { count_on_join: true, send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    w.intro("confirmed", w.clock.now - 3 * MIN);
    const id = await zoomRoom(w, { appointment_id: "intro-r2" });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    const t0 = w.clock.now;
    await zoomEvent(w, id, { event: "meeting.started", event_ts: t0, payload: meetingObj() }, t0);
    w.clock.now += 20 * S;
    let lost = false;
    w.setAround(async (path, init, real) => {
      const out = await real();
      if (!lost && init.method === "PATCH" && path.startsWith("cockpit_sales_rooms?") && (init.body as Row)?.state === "lead_in") {
        lost = true;
        return await lostAnswer(how, path, init);
      }
      return out;
    });
    const joinAt = w.clock.now;
    const join = await zoomEvent(
      w,
      id,
      {
        event: "meeting.participant_joined",
        event_ts: joinAt,
        payload: meetingObj({ participant: { id: "", user_name: "Huda Ali", join_time: new Date(joinAt).toISOString(), participant_uuid: "p-lead" } }),
      },
      joinAt,
    );
    w.setAround(null);
    for (let i = 0; i < 4; i++) await w.minute(id);
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.id === join.eventId) as Row;
    const audited = w.audits.filter(a => String(a.action).startsWith("room.event.zoom.meeting.participant_joined") && a.entityId === id);
    return { w, id, lost, ev, audited, join };
  }

  test("HELD: the lost answer as a DbError status 0 (round 3's model): the join's audit row stands", async () => {
    const { w, id, lost, ev, audited } = await joinLost("dberror0");
    expect(lost).toBe(true);
    expect([w.room(id).state, Boolean(ev.handled_at), audited.length]).toEqual(["lead_in", true, 1]);
  });

  for (const how of ["cut", "garbage"] as const) {
    test(`lost-body-bypasses-lost-answer-readback (zoom join, ${how}): the join's write landed and its 200 answer was ${how}: the join must keep its audit row`, async () => {
      const { w, id, lost, ev, audited, join } = await joinLost(how);
      expect(lost).toBe(true);
      expect(
        { state: w.room(id).state, handled: Boolean(ev.handled_at), audit_rows: audited.length },
        `join error: ${join.error ?? "none"}; audits: ${w.audits.map(a => a.action).join(", ")}`,
      ).toEqual({ state: "lead_in", handled: true, audit_rows: 1 });
    });
  }
});

describe("chaos2 r4: the count's claim lands and its answer is cut", () => {
  async function claimLost(how: Lost, by: "zoom" | "hand" | "live") {
    const live = by === "live";
    const w = world({
      rooms: { count_on_join: true, ...(live ? { live_calendar_id: "cal-live" } : {}), send: { whatsapp_text: false, whatsapp_template: false, email: false } },
    });
    if (!live) w.intro("confirmed", w.clock.now - 3 * MIN);
    const id = by === "zoom" ? await zoomRoom(w, { appointment_id: "intro-r2" }) : await w.make(live ? {} : { appointment_id: "intro-r2" });
    if (by !== "zoom") await w.workerOpens(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    let lost = 0;
    w.setAround(async (path, init, real) => {
      const out = await real();
      if (lost === 0 && path === "rpc/cockpit_sales_room_count_claim") {
        lost++;
        return await lostAnswer(how, path, init);
      }
      return out;
    });
    if (by === "zoom") {
      const t0 = w.clock.now;
      await zoomEvent(w, id, { event: "meeting.started", event_ts: t0, payload: meetingObj() }, t0);
      w.clock.now += 20 * S;
      await zoomEvent(
        w,
        id,
        {
          event: "meeting.participant_joined",
          event_ts: w.clock.now,
          payload: meetingObj({ participant: { id: "", user_name: "Huda Ali", join_time: new Date(w.clock.now).toISOString(), participant_uuid: "p-lead" } }),
        },
        w.clock.now,
      );
    } else {
      seedLeadZoomJoin(w.db, id);
      await settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" }));
      await w.drain();
    }
    w.setAround(null);
    for (let i = 0; i < 10; i++) await w.minute(id);
    const alerts = w.alerts(id).map(a => String(a.message ?? a.p_message ?? ""));
    return { w, id, lost, alerts };
  }

  test("HELD: the claim's answer lost as a DbError status 0 (round 3's model): the intro ends marked shown", async () => {
    const { w, lost } = await claimLost("dberror0", "hand");
    expect(lost).toBe(1);
    expect(w.hl.get("intro-r2")).toBe("showed");
  });

  for (const how of ["cut", "garbage"] as const) {
    for (const by of ["zoom", "hand"] as const) {
      test(`lost-body-bypasses-lost-answer-readback (count claim, ${by} join, ${how}): the lead joined their booked intro's room: the intro ends marked shown, or a person is told to mark that intro`, async () => {
        const { w, id, lost, alerts } = await claimLost(how, by);
        expect(lost).toBe(1);
        const r = w.room(id);
        const shown = w.hl.get("intro-r2") === "showed";
        const toldToMarkIntro = alerts.some(a => /intro/i.test(a) && /mark/i.test(a));
        expect(
          { shown_or_told_to_mark_the_intro: shown || toldToMarkIntro },
          `count_claimed_at=${String(r.count_claimed_at)} count_result=${String(r.count_result)} intro=${String(w.hl.get("intro-r2"))}; alerts: ${alerts.join(" | ")}`,
        ).toEqual({ shown_or_told_to_mark_the_intro: true });
      });
    }
    test(`lost-body-bypasses-lost-answer-readback (count claim, live booking, ${how}): a lead with no booked call joins: the live call ends booked, or a person is told to book it`, async () => {
      const { w, id, lost, alerts } = await claimLost(how, "live");
      expect(lost).toBe(1);
      const r = w.room(id);
      const booked = w.bookings.length === 1;
      const toldToBook = alerts.some(a => /book/i.test(a) && !/Check HighLevel for a "Live" booking/.test(a));
      expect(
        { booked_or_told_to_book: booked || toldToBook },
        `bookings=${w.bookings.length} count_result=${String(r.count_result)} claimed=${String(r.count_claimed_at)}; alerts: ${alerts.join(" | ")}`,
      ).toEqual({ booked_or_told_to_book: true });
    });
  }
});

// ---------------------------------------------------------------------------
// Round 4 sweeps: round 3's journeys, the k-th database call's answer lost
// after it landed in the two shapes the real io throws (cut, garbage)
// ---------------------------------------------------------------------------

function cutAt(w: ReturnType<typeof world>, k: number, how: Lost) {
  let n = 0;
  const seen: string[] = [];
  w.setAround(async (path, init, real) => {
    const mine = n++;
    seen.push(`${String(init.method ?? "GET")} ${path.slice(0, 90)}`);
    const out = await real();
    if (mine !== k) return out;
    return await lostAnswer(how, path, init);
  });
  return { calls: () => n, seen };
}
function counting(w: ReturnType<typeof world>) {
  let n = 0;
  w.setAround(async (_p, _i, real) => {
    n++;
    return await real();
  });
  return () => n;
}

describe("chaos2 r4 sweep: Zoom's join of the lead, the k-th answer cut or garbled", () => {
  async function joinJourney(k: number | null, how: Lost) {
    const w = world({ rooms: { count_on_join: true, send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    w.intro("confirmed", w.clock.now - 3 * MIN);
    const id = await zoomRoom(w, { appointment_id: "intro-r2" });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    const t0 = w.clock.now;
    await zoomEvent(w, id, { event: "meeting.started", event_ts: t0, payload: meetingObj() }, t0);
    w.clock.now += 20 * S;
    const count = k === null ? counting(w) : null;
    const plan = k === null ? null : cutAt(w, k, how);
    const joinAt = w.clock.now;
    const join = await zoomEvent(
      w,
      id,
      {
        event: "meeting.participant_joined",
        event_ts: joinAt,
        payload: meetingObj({ participant: { id: "", user_name: "Huda Ali", join_time: new Date(joinAt).toISOString(), participant_uuid: "p-lead" } }),
      },
      joinAt,
    );
    w.setAround(null);
    for (let i = 0; i < 5; i++) await w.minute(id);
    return { w, id, join, calls: count ? count() : (plan?.calls() ?? 0), seen: plan?.seen ?? [] };
  }

  test("every cut point: the join stands with its audit row, the intro ends marked shown once, or a person is told", async () => {
    const clean = await joinJourney(null, "cut");
    expect(clean.w.hl.get("intro-r2")).toBe("showed");
    const bad: string[] = [];
    for (const how of (process.env.R4_MODES?.split(",") ?? ["cut", "garbage"]) as Lost[]) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { w, id, seen, join } = await joinJourney(k, how);
        const r = w.room(id);
        const shown = w.hl.get("intro-r2") === "showed";
        const told = w.alerts(id).some(a => !/Check HighLevel for a "Live" booking/.test(String(a.message ?? "")));
        const marks = w.db.t("cockpit_sales_dispositions").filter(d => d.appointment_id === "intro-r2" && d.status === "showed");
        const ev = w.db.t("cockpit_sales_room_events").find(e => e.id === join.eventId) as Row;
        const audited = w.audits.filter(a => String(a.action).startsWith("room.event.zoom.meeting.participant_joined") && a.entityId === id).length;
        if (!r.lead_in_at || (!shown && !told) || marks.length > 1 || !ev.handled_at || audited !== 1)
          bad.push(
            `${how}@${k} (${seen[k] ?? "?"}): state=${String(r.state)} shown=${shown} told=${told} marks=${marks.length} ` +
              `count_result=${String(r.count_result)} handled=${Boolean(ev.handled_at)} join_audits=${audited}`,
          );
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("chaos2 r4 sweep: That was not the lead, the k-th answer cut or garbled", () => {
  async function undoJourney(k: number | null, how: "cut" | "garbage") {
    const w = world({ rooms: { count_on_join: true, send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    w.intro("confirmed", w.clock.now - 3 * MIN);
    w.db.seed("cockpit_sales_dispositions", [
      { id: "prior-confirmed", appointment_id: "intro-r2", status: "confirmed", marked_by: SETTER, note: null, superseded_at: null, marked_at: new Date(w.clock.now - HOUR).toISOString(), crm: "written" },
    ]);
    const id = await w.make({ appointment_id: "intro-r2" });
    await w.workerOpens(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    seedLeadZoomJoin(w.db, id);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.drain();
    w.clock.now += 30 * S;
    const count = k === null ? counting(w) : null;
    const plan = k === null ? null : cutAt(w, k, how);
    await settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" }));
    await w.drain();
    w.setAround(null);
    // The rep presses again if the press failed before the room moved.
    if (!w.room(id).count_undo_at && w.room(id).state === "lead_in")
      await settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" }));
    for (let i = 0; i < 12; i++) await w.minute(id);
    return { w, id, calls: count ? count() : (plan?.calls() ?? 0), seen: plan?.seen ?? [] };
  }

  test("every cut point: the intro is put back as it was (confirmed), or a person is told", async () => {
    const clean = await undoJourney(null, "cut");
    expect(clean.w.hl.get("intro-r2")).toBe("confirmed");
    const bad: string[] = [];
    for (const how of ["cut", "garbage"] as const) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { w, id, seen } = await undoJourney(k, how);
        const r = w.room(id);
        const current = w.db.t("cockpit_sales_dispositions").filter(d => d.appointment_id === "intro-r2" && !d.superseded_at);
        const back = w.hl.get("intro-r2") === "confirmed" && current.length === 1 && current[0]?.status === "confirmed";
        const told = w.alerts(id).length > 0;
        if (!back && !told)
          bad.push(
            `${how}@${k} (${seen[k] ?? "?"}): hl=${String(w.hl.get("intro-r2"))} current=${current.map(d => String(d.status)).join(",")} ` +
              `count_result=${String(r.count_result)} undo_at=${Boolean(r.count_undo_at)} state=${String(r.state)}`,
          );
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("chaos2 r4 sweep: the count of a booked intro (I'm in, The lead is in), the k-th answer cut or garbled", () => {
  async function countJourney(k: number | null, how: Lost) {
    const w = world({ rooms: { count_on_join: true, send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    w.intro("confirmed", w.clock.now - 3 * MIN);
    const id = await w.make({ appointment_id: "intro-r2" });
    await w.workerOpens(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    seedLeadZoomJoin(w.db, id);
    const count = k === null ? counting(w) : null;
    const plan = k === null ? null : cutAt(w, k, how);
    await settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" }));
    await w.drain();
    w.setAround(null);
    if (w.room(id).state !== "lead_in")
      await settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" }));
    await w.drain();
    for (let i = 0; i < 8; i++) await w.minute(id);
    return { w, id, calls: count ? count() : (plan?.calls() ?? 0), seen: plan?.seen ?? [] };
  }

  test("every cut point: the intro ends marked shown once, or a person is told to mark it", async () => {
    const clean = await countJourney(null, "cut");
    expect(clean.w.hl.get("intro-r2")).toBe("showed");
    const bad: string[] = [];
    for (const how of (process.env.R4_MODES?.split(",") ?? ["cut", "garbage"]) as Lost[]) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { w, id, seen } = await countJourney(k, how);
        const r = w.room(id);
        const shown = w.hl.get("intro-r2") === "showed";
        const told = w.alerts(id).some(a => !/Check HighLevel for a "Live" booking/.test(String(a.message ?? "")));
        const marks = w.db.t("cockpit_sales_dispositions").filter(d => d.appointment_id === "intro-r2" && d.status === "showed");
        const markAudits = w.audits.filter(a => a.action === "room.mark.lead_in" || String(a.action).startsWith("room.mark")).length;
        if ((!shown && !told) || marks.length > 1 || markAudits < 1)
          bad.push(`${how}@${k} (${seen[k] ?? "?"}): state=${String(r.state)} shown=${shown} told=${told} marks=${marks.length} count_result=${String(r.count_result)} mark_audits=${markAudits}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("chaos2 r4 sweep: the room's link, the k-th answer cut or garbled", () => {
  async function linkJourney(k: number | null, how: "cut" | "garbage") {
    const w = world();
    const id = await w.make();
    await w.workerOpens(id);
    const count = k === null ? counting(w) : null;
    const plan = k === null ? null : cutAt(w, k, how);
    await settle(w.readyEvent(id));
    await w.drain();
    w.setAround(null);
    for (let i = 0; i < 6; i++) await w.minute(id);
    return { w, id, calls: count ? count() : (plan?.calls() ?? 0), seen: plan?.seen ?? [] };
  }

  test("every cut point: the lead gets the link once at most, and the room says it went or why not", async () => {
    const clean = await linkJourney(null, "cut");
    expect(clean.w.delivered).toHaveLength(1);
    const bad: string[] = [];
    for (const how of ["cut", "garbage"] as const) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { w, id, seen } = await linkJourney(k, how);
        const r = w.room(id);
        const said = Boolean(r.link_sent_at) || Boolean(r.refusal);
        const audited = !r.link_sent_at || w.audits.some(a => a.action === "room.link" && a.entityId === id);
        if (w.delivered.length > 1 || !said || !audited)
          bad.push(`${how}@${k} (${seen[k] ?? "?"}): deliveries=${w.delivered.length} link_sent_at=${Boolean(r.link_sent_at)} refusal=${String(r.refusal ?? "")} audited=${audited}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("chaos2 r4 sweep: I can't let them in, the k-th answer cut or garbled", () => {
  async function admitJourney(k: number | null, how: Lost) {
    const w = world();
    const id = await w.make();
    await w.workerOpens(id);
    await settle(w.readyEvent(id));
    await w.drain();
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { host_in_at: w.db.iso(), state: "host_in", version: Number(w.room(id).version) + 1 } });
    const count = k === null ? counting(w) : null;
    const plan = k === null ? null : cutAt(w, k, how);
    const v = Number(w.room(id).version);
    let answer: Row | null = null;
    try {
      answer = await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "admit_blocked" });
    } catch {
      answer = null;
    }
    w.setAround(null);
    if (answer === null) answer = await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "admit_blocked" }).catch(() => null);
    const replacements = () => w.db.t("cockpit_sales_rooms").filter(r => r.id !== id && r.contact_id === LEAD && r.state !== "failed");
    for (const r of replacements()) if (r.state === "requested") await w.workerOpens(String(r.id));
    for (const r of replacements()) await settle(w.readyEvent(String(r.id)));
    await w.drain();
    for (let i = 0; i < 4; i++) for (const r of replacements()) await w.minute(String(r.id));
    return { w, id, answer, replacements: replacements(), calls: count ? count() : (plan?.calls() ?? 0), seen: plan?.seen ?? [] };
  }

  test("every cut point: one replacement at most, its link once, and the rep has the room or a sentence", async () => {
    const clean = await admitJourney(null, "cut");
    expect(clean.replacements).toHaveLength(1);
    const bad: string[] = [];
    for (const how of (process.env.R4_MODES?.split(",") ?? ["cut", "garbage"]) as Lost[]) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { w, answer, replacements, seen } = await admitJourney(k, how);
        const said = Boolean(answer && (answer.replacement || answer.replacement_refusal));
        const linked = replacements.every(r => r.link_sent_at || r.refusal);
        if (replacements.length > 1 || w.delivered.length > 2 || !said || !linked)
          bad.push(`${how}@${k} (${seen[k] ?? "?"}): replacements=${replacements.length} deliveries=${w.delivered.length} answered=${said} linked=${linked}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("chaos2 r4 sweep: I'm available, the k-th answer cut or garbled", () => {
  const START = Date.parse("2026-10-04T08:00:00Z");
  const LIVE = { enabled: true, standby: true, hours: { days: [6, 0, 1, 2, 3, 4], from: "10:00", to: "20:00", tz: "Asia/Kuwait" } };
  async function availableJourney(k: number | null, how: Lost) {
    const w = world({ start: START, live: LIVE });
    const count = k === null ? counting(w) : null;
    const plan = k === null ? null : cutAt(w, k, how);
    let first: Row | null = null;
    try {
      first = await w.rooms.actions["live.availability"]!(setter, { state: "available" });
    } catch {
      first = null;
    }
    w.setAround(null);
    if (first === null) {
      w.clock.now += 5 * S;
      first = await w.rooms.actions["live.availability"]!(setter, { state: "available" }).catch(() => null);
    }
    const status = await w.rooms.actions["live.status"]!(setter, {}).catch(() => null);
    const standby = w.db.t("cockpit_sales_rooms").filter(r => r.purpose === "standby" && !["ended", "expired", "failed", "cancelled"].includes(String(r.state)));
    const avail = w.db.t("cockpit_sales_availability").find(a => a.email === SETTER);
    return { w, first, status, standby, avail, calls: count ? count() : (plan?.calls() ?? 0), seen: plan?.seen ?? [] };
  }

  test("every cut point: the seat is Available with one standby room, or the strip says why not", async () => {
    const clean = await availableJourney(null, "cut");
    expect(clean.standby).toHaveLength(1);
    const bad: string[] = [];
    for (const how of (process.env.R4_MODES?.split(",") ?? ["cut", "garbage"]) as Lost[]) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { standby, avail, status, seen } = await availableJourney(k, how);
        const said = Boolean(status && status.standby_error);
        if (standby.length > 1 || avail?.state !== "available" || (standby.length === 0 && !said))
          bad.push(`${how}@${k} (${seen[k] ?? "?"}): standby=${standby.length} state=${String(avail?.state)} said=${said}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("chaos2 r4 sweep: the settle, the k-th answer cut or garbled", () => {
  const START = Date.parse("2026-10-08T07:00:00.000Z");
  function seedSettle() {
    const w = world({ start: START });
    w.intro("confirmed", START, "intro-s12");
    const id = fakeUuid();
    w.db.seed("cockpit_sales_rooms", [
      {
        id,
        request_id: fakeUuid(),
        code: "K7Q2MY",
        contact_id: LEAD,
        purpose: "fallback",
        trigger: "no_answer",
        call_kind: "intro",
        provider: "zoom",
        host_email: SETTER,
        made_by: SETTER,
        appointment_id: "intro-s12",
        appointment_start_at: new Date(START).toISOString(),
        state: "expired",
        result: "no_join",
        end_reason: "lead_no_show",
        join_url: "https://us06web.zoom.us/j/81234567891?pwd=abc",
        provider_meeting_id: "81234567891",
        requested_at: new Date(START + 1 * MIN).toISOString(),
        opened_at: new Date(START + 1 * MIN).toISOString(),
        link_sent_at: new Date(START + 1 * MIN + 5 * S).toISOString(),
        link_channels: ["whatsapp_text"],
        host_in_at: new Date(START + 2 * MIN).toISOString(),
        ended_at: new Date(START + 15 * MIN).toISOString(),
        version: 4,
      },
    ]);
    w.db.seed("cockpit_sales_room_events", [
      { room_id: id, kind: "zoom.meeting.started", source: "zoom", dedupe_key: `zoom:meeting.started:${id}`, at: new Date(START + 2 * MIN).toISOString(), handled_at: new Date(START + 2 * MIN).toISOString() },
    ]);
    async function post(at: number) {
      w.db.insertOne("cockpit_sales_room_events", { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due." }, "ignore", "dedupe_key");
      const ev = w.db.t("cockpit_sales_room_events").find(e => e.dedupe_key === `sweep.settle:${id}`);
      if (ev?.handled_at) return;
      w.clock.now = at;
      await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } }).catch(() => null);
    }
    return { w, id, post };
  }

  test("every cut point: the intro ends a no-show with its audit row, or a person is told for a true reason", async () => {
    const clean = seedSettle();
    const n = counting(clean.w);
    await clean.post(START + 21 * MIN);
    const calls = n();
    clean.w.setAround(null);
    expect(clean.w.hl.get("intro-s12")).toBe("noshow");
    const bad: string[] = [];
    for (const how of (process.env.R4_MODES?.split(",") ?? ["cut", "garbage"]) as Lost[]) {
      for (let k = 0; k < calls + 2; k++) {
        const { w, id, post } = seedSettle();
        const plan = cutAt(w, k, how);
        await post(START + 21 * MIN);
        w.setAround(null);
        for (let m = 22; m < 27; m++) await post(START + m * MIN);
        const alerts = w.alerts(id).map(a => String(a.message));
        const noshow = w.hl.get("intro-s12") === "noshow";
        const falseReason = alerts.some(a => /another rep/.test(a));
        const audited = w.audits.some(a => a.action === "room.settle" && a.entityId === id);
        if ((!noshow && !alerts.length) || falseReason || (noshow && (w.room(id).settled_mark !== "noshow" || !audited)))
          bad.push(`${how}@${k} (${plan.seen[k] ?? "?"}): hl=${w.hl.get("intro-s12")} settled=${String(w.room(id).settled_mark)} audited=${audited} alerts=${alerts.join(" | ")}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("chaos2 r4 sweep: the unseen template's backup, the k-th answer cut or garbled", () => {
  async function unseenJourney(k: number | null, how: Lost) {
    const w = world({ inboundAgoMs: 48 * HOUR });
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.template.push("unseen");
    const count = k === null ? counting(w) : null;
    const plan = k === null ? null : cutAt(w, k, how);
    await settle(w.readyEvent(id));
    await w.drain();
    w.setAround(null);
    if (k !== null) for (let i = 0; i < 6; i++) await w.minute(id);
    return { w, id, calls: count ? count() : (plan?.calls() ?? 0), seen: plan?.seen ?? [] };
  }

  test("every cut point: the email backs the template up once, and the room says what went", async () => {
    const clean = await unseenJourney(null, "cut");
    expect(clean.w.delivered.map(d => d.lane)).toEqual(["email"]);
    const bad: string[] = [];
    for (const how of (process.env.R4_MODES?.split(",") ?? ["cut", "garbage"]) as Lost[]) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { w, id, seen } = await unseenJourney(k, how);
        const r = w.room(id);
        const emails = w.delivered.filter(d => d.lane === "email").length;
        const ch = Array.isArray(r.link_channels) ? (r.link_channels as string[]) : [];
        const templated = w.db.t("cockpit_sales_messages").some(m => m.via === "workflow");
        const wrong = emails === 1 && !ch.includes("email");
        if (emails > 1 || !r.link_sent_at || (templated && !r.link_unconfirmed_at) || wrong)
          bad.push(`${how}@${k} (${seen[k] ?? "?"}): emails=${emails} sent=${Boolean(r.link_sent_at)} unconfirmed=${Boolean(r.link_unconfirmed_at)} channels=${ch.join("+")}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("chaos2 r4 sweep: Make a room, the k-th answer cut or garbled, then the rep's retry", () => {
  async function createJourney(k: number | null, how: Lost) {
    const w = world();
    const requestId = crypto.randomUUID();
    const ask = () =>
      w.rooms.actions["room.create"]!(setter, { request_id: requestId, contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "fallback" });
    const count = k === null ? counting(w) : null;
    const plan = k === null ? null : cutAt(w, k, how);
    let out: Row | null = null;
    let said = "";
    try {
      out = await ask();
    } catch (e) {
      said = String((e as Error).message);
    }
    w.setAround(null);
    if (out === null) {
      try {
        out = await ask();
      } catch (e) {
        said = String((e as Error).message);
      }
    }
    const live = w.db.t("cockpit_sales_rooms").filter(r => r.contact_id === LEAD && !["ended", "expired", "failed", "cancelled"].includes(String(r.state)));
    return { w, out, said, live, calls: count ? count() : (plan?.calls() ?? 0), seen: plan?.seen ?? [] };
  }

  test("every cut point: the retry answers the one room, with its audit row", async () => {
    const clean = await createJourney(null, "cut");
    expect(clean.live).toHaveLength(1);
    const bad: string[] = [];
    for (const how of (process.env.R4_MODES?.split(",") ?? ["cut", "garbage"]) as Lost[]) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { w, out, said, live, seen } = await createJourney(k, how);
        const id = live[0]?.id;
        const audited = !id || w.audits.filter(a => a.action === "room.create" && a.entityId === id).length === 1;
        const answered = out ? String((out.room as Row | undefined)?.id ?? "") === String(id ?? "") : false;
        if (live.length > 1 || !audited || (live.length === 1 && !answered))
          bad.push(`${how}@${k} (${seen[k] ?? "?"}): rooms=${live.length} audited=${audited} answered=${answered} said=${said.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Round 4, the round-3 model (DbError status 0) at the writes after the room
// write: the event's own finish, and the settle's settled_mark
// ---------------------------------------------------------------------------

describe("chaos2 r4: Zoom's join, the event's finish write lands and its answer is lost", () => {
  test("zoom-join-finish-lost-no-audit: the room moved to lead_in, then the event's handled_at write lost its answer: the join must keep its audit row", async () => {
    const w = world({ rooms: { count_on_join: true, send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    w.intro("confirmed", w.clock.now - 3 * MIN);
    const id = await zoomRoom(w, { appointment_id: "intro-r2" });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    const t0 = w.clock.now;
    await zoomEvent(w, id, { event: "meeting.started", event_ts: t0, payload: meetingObj() }, t0);
    w.clock.now += 20 * S;
    let lost = false;
    w.setAround(async (path, init, real) => {
      const out = await real();
      if (!lost && init.method === "PATCH" && path.startsWith("cockpit_sales_room_events?") && (init.body as Row)?.handled_at && w.room(id).state === "lead_in") {
        lost = true;
        throw new DbError("database: no answer within 8 s", 0);
      }
      return out;
    });
    const joinAt = w.clock.now;
    const join = await zoomEvent(
      w,
      id,
      {
        event: "meeting.participant_joined",
        event_ts: joinAt,
        payload: meetingObj({ participant: { id: "", user_name: "Huda Ali", join_time: new Date(joinAt).toISOString(), participant_uuid: "p-lead" } }),
      },
      joinAt,
    );
    w.setAround(null);
    for (let i = 0; i < 4; i++) await w.minute(id);
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.id === join.eventId) as Row;
    const audited = w.audits.filter(a => String(a.action).startsWith("room.event.zoom.meeting.participant_joined") && a.entityId === id);
    expect(lost).toBe(true);
    expect(
      { state: w.room(id).state, handled: Boolean(ev.handled_at), join_audit_rows: audited.length },
      `join error: ${join.error ?? "none"}; audits: ${w.audits.map(a => a.action).join(", ")}`,
    ).toEqual({ state: "lead_in", handled: true, join_audit_rows: 1 });
  });
});

describe("chaos2 r4: the settle's settled_mark write lands and its answer is lost", () => {
  test("settle-mark-lost-answer-no-audit: the intro is marked a no-show and the room's settled_mark landed with its answer lost: the settle must keep its room.settle audit row", async () => {
    const START = Date.parse("2026-10-08T07:00:00.000Z");
    const w = world({ start: START });
    w.intro("confirmed", START, "intro-s12");
    const id = fakeUuid();
    w.db.seed("cockpit_sales_rooms", [
      {
        id, request_id: fakeUuid(), code: "K7Q2MZ", contact_id: LEAD, purpose: "fallback", trigger: "no_answer", call_kind: "intro",
        provider: "zoom", host_email: SETTER, made_by: SETTER, appointment_id: "intro-s12", appointment_start_at: new Date(START).toISOString(),
        state: "expired", result: "no_join", end_reason: "lead_no_show", join_url: "https://us06web.zoom.us/j/81234567891?pwd=abc",
        provider_meeting_id: "81234567891", requested_at: new Date(START + 1 * MIN).toISOString(), opened_at: new Date(START + 1 * MIN).toISOString(),
        link_sent_at: new Date(START + 1 * MIN + 5 * S).toISOString(), link_channels: ["whatsapp_text"], host_in_at: new Date(START + 2 * MIN).toISOString(),
        ended_at: new Date(START + 15 * MIN).toISOString(), version: 4,
      },
    ]);
    w.db.seed("cockpit_sales_room_events", [
      { room_id: id, kind: "zoom.meeting.started", source: "zoom", dedupe_key: `zoom:meeting.started:${id}`, at: new Date(START + 2 * MIN).toISOString(), handled_at: new Date(START + 2 * MIN).toISOString() },
    ]);
    async function post(at: number) {
      w.db.insertOne("cockpit_sales_room_events", { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due." }, "ignore", "dedupe_key");
      const ev = w.db.t("cockpit_sales_room_events").find(e => e.dedupe_key === `sweep.settle:${id}`);
      if (ev?.handled_at) return;
      w.clock.now = at;
      await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } }).catch(() => null);
    }
    let lost = false;
    w.setAround(async (path, init, real) => {
      const out = await real();
      if (!lost && init.method === "PATCH" && path.startsWith("cockpit_sales_rooms?") && (init.body as Row)?.settled_mark === "noshow") {
        lost = true;
        throw new DbError("database: no answer within 8 s", 0);
      }
      return out;
    });
    await post(START + 21 * MIN);
    w.setAround(null);
    for (let m = 22; m < 27; m++) await post(START + m * MIN);
    const audited = w.audits.filter(a => a.action === "room.settle" && a.entityId === id).length;
    expect(lost).toBe(true);
    expect({ hl: w.hl.get("intro-s12"), settled: w.room(id).settled_mark, room_settle_audits: audited }).toEqual({ hl: "noshow", settled: "noshow", room_settle_audits: 1 });
  });
});

// ---------------------------------------------------------------------------
// Round 4: a read answered 200 with an empty body. makeLiveIO reads it as
// "no rows" (liveio.ts db: `text ? JSON.parse(text) : []`), the same as a
// table with nothing in it. zoomEvent then finds no room by id nor by
// meeting, and closes the lead's join as "an event for a meeting that is no
// cockpit room": handled, never replayed, never applied.
// ---------------------------------------------------------------------------

const emptyIo = makeLiveIO({ env: ENV, fetch: (async () => new Response("", { status: 200 })) as unknown as typeof fetch, log: () => {} });

describe("chaos2 r4: Zoom's join while the room reads answer 200 with an empty body", () => {
  test("liveio (fixed): a 200 with an empty body is an unread answer (DbError status 0), never 'no rows'", async () => {
    let err: unknown = null;
    try {
      await emptyIo.db("cockpit_sales_rooms?id=eq.x&select=*");
    } catch (e) {
      err = e;
    }
    expect(err instanceof DbError && err.status === 0).toBe(true);
  });

  test("empty-answer-read-as-no-room-drops-zoom-join: the lead's join on the room's own meeting must stay for the replay (or be applied), never be closed as 'no cockpit room'", async () => {
    const w = world({ rooms: { count_on_join: true, send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    w.intro("confirmed", w.clock.now - 3 * MIN);
    const id = await zoomRoom(w, { appointment_id: "intro-r2" });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    const t0 = w.clock.now;
    await zoomEvent(w, id, { event: "meeting.started", event_ts: t0, payload: meetingObj() }, t0);
    w.clock.now += 20 * S;
    // For one request, the database's answers to room reads come back 200 and empty.
    let empties = 0;
    w.setAround(async (path, init, real) => {
      if ((init.method ?? "GET") === "GET" && path.startsWith("cockpit_sales_rooms?") && empties < 2) {
        empties++;
        await real();
        return await emptyIo.db(path, init as never);
      }
      return await real();
    });
    const joinAt = w.clock.now;
    const join = await zoomEvent(
      w,
      id,
      {
        event: "meeting.participant_joined",
        event_ts: joinAt,
        payload: meetingObj({ participant: { id: "", user_name: "Huda Ali", join_time: new Date(joinAt).toISOString(), participant_uuid: "p-lead" } }),
      },
      joinAt,
    );
    w.setAround(null);
    for (let i = 0; i < 4; i++) await w.minute(id);
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.id === join.eventId) as Row;
    expect(empties).toBeGreaterThanOrEqual(1);
    expect(
      { joined: Boolean(w.room(id).lead_in_at), state: w.room(id).state },
      `event text: ${String(ev.text)}; detail: ${JSON.stringify(ev.detail)}`,
    ).toEqual({ joined: true, state: "lead_in" });
  });
});
