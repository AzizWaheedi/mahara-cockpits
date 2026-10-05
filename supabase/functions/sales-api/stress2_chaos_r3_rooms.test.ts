// bun test supabase/functions/sales-api/stress2_chaos_r3_rooms.test.ts
//
// Second series, round 3, chaos: every dependency failing, hanging or
// answering garbage at every step; answers lost after a write landed; the
// function killed between two writes; partial deploys (sales-api ahead of
// migration 20261004a, which production does not have yet); clock skew.
// sales-api's rooms.ts on testfakes.ts (no HighLevel, no database, no Zoom).
// The world below is round 2's (stress2_chaos_r2_rooms.test.ts), copied so
// this file stands alone. A failing test is a finding; tests marked HELD pass.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, DbError, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld, seedLeadZoomJoin } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const LEAD = "stress-chaos2r3-lead-0001";
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
// 1. Partial deploy: this sales-api on a database without 20261004a
//
// rooms.ts keeps working without 20261004a's columns where it writes
// standby_error (live.availability), and its new functions fall back
// (disposition_replace, live_claim's p_at, the message slot). roomlogic's
// meeting_ended (stress2, round 2) writes cockpit_sales_rooms.meeting_ended_at
// with no such fallback: Zoom's meeting.ended for a host who stepped out
// before the lead came fails on the missing column on every try and replay.
// ---------------------------------------------------------------------------

describe("chaos2 r3: this sales-api on a database without 20261004a", () => {
  async function hostStepsOut(schemaHas004a: boolean) {
    const w = world();
    const id = await zoomRoom(w);
    expect(w.room(id).link_sent_at).toBeTruthy();
    const t0 = w.clock.now;
    await zoomEvent(w, id, { event: "meeting.started", event_ts: t0 + 30 * S, payload: meetingObj() }, t0 + 30 * S);
    expect(w.room(id).state).toBe("host_in");
    const refused: string[] = [];
    if (!schemaHas004a) without004a(w, refused);
    // The host closed Zoom by mistake a minute later; Zoom ends the empty meeting. The lead has not come yet.
    w.clock.now = t0 + 90 * S;
    const ended = await zoomEvent(w, id, { event: "meeting.ended", event_ts: t0 + 90 * S, payload: meetingObj() }, t0 + 90 * S);
    // The cron's next three minutes: the sweep replays what is left.
    for (let i = 0; i < 3; i++) await w.minute(id);
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.id === ended.eventId) as Row;
    return { w, id, ended, ev, refused };
  }

  test("HELD: with 20261004a, the host stepping out turns the room back to open with time for the host", async () => {
    const { w, id, ev } = await hostStepsOut(true);
    expect(w.room(id).state).toBe("open");
    expect(ev.handled_at).toBeTruthy();
  });

  test("meeting-ended-write-needs-004a: without 20261004a, Zoom's meeting.ended is refused on every try and the room still says the host is in", async () => {
    const { w, id, ended, ev, refused } = await hostStepsOut(false);
    expect(
      { state: w.room(id).state, handled: Boolean(ev.handled_at) },
      `meeting.ended failed (${ended.error ?? "no error"}); refused writes: ${refused.join(" | ")}`,
    ).toEqual({ state: "open", handled: true });
  });
});

// ---------------------------------------------------------------------------
// 2. Sweep: Zoom's join of the lead, one database call failed or lost
// ---------------------------------------------------------------------------

describe("chaos2 r3: Zoom's join of the lead, one database call failed or lost at every step", () => {
  async function joinJourney(k: number | null, mode: "fail" | "lost") {
    const w = world({ rooms: { count_on_join: true, send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    w.intro("confirmed", w.clock.now - 3 * MIN);
    const id = await zoomRoom(w, { appointment_id: "intro-r2" });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    const t0 = w.clock.now;
    await zoomEvent(w, id, { event: "meeting.started", event_ts: t0, payload: meetingObj() }, t0);
    w.clock.now += 20 * S;
    let n = 0;
    let plan: ReturnType<typeof faultAt> | null = null;
    if (k === null)
      w.setAround(async (_p, _i, real) => {
        n++;
        return await real();
      });
    else plan = faultAt(w, k, mode);
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
    return { w, id, join, calls: k === null ? n : (plan?.calls() ?? 0), seen: plan?.seen ?? [] };
  }

  test("every fault point: the lead's Zoom join stands, the intro ends marked shown once, or a person is told", async () => {
    const clean = await joinJourney(null, "fail");
    expect(clean.w.room(clean.id).state).toBe("lead_in");
    expect(clean.w.hl.get("intro-r2")).toBe("showed");
    const bad: string[] = [];
    for (const mode of ["fail", "lost"] as const) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { w, id, seen, join } = await joinJourney(k, mode);
        const r = w.room(id);
        const shown = w.hl.get("intro-r2") === "showed";
        // A person told to mark this intro, never sent to look for a live booking the intro's count never makes.
        const told = w.alerts(id).some(a => !/Check HighLevel for a "Live" booking/.test(String(a.message ?? "")));
        const marks = w.db.t("cockpit_sales_dispositions").filter(d => d.appointment_id === "intro-r2" && d.status === "showed");
        const joined = Boolean(r.lead_in_at);
        const ev = w.db.t("cockpit_sales_room_events").find(e => e.id === join.eventId) as Row;
        if (!joined || (!shown && !told) || marks.length > 1 || !ev.handled_at)
          bad.push(
            `${mode}@${k} (${seen[k] ?? "?"}): state=${String(r.state)} lead_in_at=${joined} shown=${shown} told=${told} marks=${marks.length} ` +
              `count_result=${String(r.count_result)} event_handled=${Boolean(ev.handled_at)} error=${(join.error ?? "").slice(0, 60)}`,
          );
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Sweep: "That was not the lead" after the count marked the intro shown,
//    one database call failed or lost at every step
// ---------------------------------------------------------------------------

describe("chaos2 r3: That was not the lead, one database call failed or lost at every step", () => {
  async function undoJourney(k: number | null, mode: "fail" | "lost") {
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
    expect(w.hl.get("intro-r2")).toBe("showed");
    w.clock.now += 30 * S;
    let n = 0;
    let plan: ReturnType<typeof faultAt> | null = null;
    if (k === null)
      w.setAround(async (_p, _i, real) => {
        n++;
        return await real();
      });
    else plan = faultAt(w, k, mode);
    await settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" }));
    await w.drain();
    w.setAround(null);
    // The rep presses again if the first press failed before the room moved.
    if (!w.room(id).count_undo_at && w.room(id).state === "lead_in")
      await settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" }));
    for (let i = 0; i < 12; i++) await w.minute(id);
    return { w, id, calls: k === null ? n : (plan?.calls() ?? 0), seen: plan?.seen ?? [] };
  }

  test("every fault point: the intro is put back as it was (confirmed), or a person is told", async () => {
    const clean = await undoJourney(null, "fail");
    expect(clean.w.hl.get("intro-r2")).toBe("confirmed");
    const bad: string[] = [];
    for (const mode of ["fail", "lost"] as const) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { w, id, seen } = await undoJourney(k, mode);
        const r = w.room(id);
        const current = w.db.t("cockpit_sales_dispositions").filter(d => d.appointment_id === "intro-r2" && !d.superseded_at);
        const back = w.hl.get("intro-r2") === "confirmed" && current.length === 1 && current[0]?.status === "confirmed";
        const told = w.alerts(id).length > 0;
        if (!back && !told)
          bad.push(
            `${mode}@${k} (${seen[k] ?? "?"}): hl=${String(w.hl.get("intro-r2"))} current=${current.map(d => `${String(d.status)}:${String(d.id).slice(0, 8)}`).join(",")} ` +
              `count_result=${String(r.count_result)} undo_at=${Boolean(r.count_undo_at)} state=${String(r.state)}`,
          );
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Zoom's join whose room write landed and whose answer was lost
// ---------------------------------------------------------------------------

describe("chaos2 r3: Zoom's join of the lead, the room's write lands and its answer is lost", () => {
  test("zoom-join-lost-answer-no-audit: the replay finds the room already lead_in: the join that moved it must still have its audit row", async () => {
    const w = world({ rooms: { count_on_join: true, send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    w.intro("confirmed", w.clock.now - 3 * MIN);
    const id = await zoomRoom(w, { appointment_id: "intro-r2" });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    const t0 = w.clock.now;
    await zoomEvent(w, id, { event: "meeting.started", event_ts: t0, payload: meetingObj() }, t0);
    w.clock.now += 20 * S;
    // The room's PATCH to lead_in lands; its answer is lost (the 8 s timeout).
    let lost = false;
    w.setAround(async (path, init, real) => {
      const out = await real();
      if (!lost && init.method === "PATCH" && path.startsWith("cockpit_sales_rooms?") && (init.body as Row)?.state === "lead_in") {
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
    expect(lost).toBe(true);
    for (let i = 0; i < 3; i++) await w.minute(id);
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.id === join.eventId) as Row;
    const audited = w.audits.filter(a => String(a.action).startsWith("room.event.zoom.meeting.participant_joined") && a.entityId === id);
    expect(w.room(id).state).toBe("lead_in");
    expect(ev.handled_at).toBeTruthy();
    expect(audited.length, `audit rows for the join: ${audited.length}; all: ${w.audits.map(a => a.action).join(", ")}`).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. The count's claim lands and its answer is lost
//
// cockpit_sales_room_count_claim writes count_claimed_at under the lead's
// lock and answers the row. Its answer lost (the 8 s timeout after the
// write), runCount throws before it marks anything. The room is then
// "claimed, no result": countClaimable is false, so the tick never runs the
// count again; it only raises count_stuck after 2 minutes, whose words send
// a person to look for a "Live" booking. For a fallback room of a booked
// intro the count was to mark that intro shown: there is no live booking to
// find, and the intro the lead joined stays unmarked.
// ---------------------------------------------------------------------------

describe("chaos2 r3: the count's claim lands and its answer is lost", () => {
  async function claimLost(how: "zoom" | "hand") {
    const w = world({ rooms: { count_on_join: true, send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    w.intro("confirmed", w.clock.now - 3 * MIN);
    const id = how === "zoom" ? await zoomRoom(w, { appointment_id: "intro-r2" }) : await w.make({ appointment_id: "intro-r2" });
    if (how === "hand") await w.workerOpens(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    let lost = 0;
    w.setAround(async (path, _init, real) => {
      const out = await real();
      if (lost === 0 && path === "rpc/cockpit_sales_room_count_claim") {
        lost++;
        throw new DbError("database: no answer within 8 s", 0);
      }
      return out;
    });
    if (how === "zoom") {
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
      await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
      await w.drain();
    }
    w.setAround(null);
    for (let i = 0; i < 10; i++) await w.minute(id);
    const alerts = w.alerts(id).map(a => String(a.message ?? a.p_message ?? ""));
    return { w, id, lost, alerts };
  }

  for (const how of ["zoom", "hand"] as const) {
    test(`count-claim-lost-answer-stuck-wrong-alert (${how} join): the lead joined their booked intro's room: the intro ends marked shown, or the person told is told to mark that intro`, async () => {
      const { w, id, lost, alerts } = await claimLost(how);
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
});

describe("chaos2 r3: the count's claim lands and its answer is lost (a live booking)", () => {
  test("count-claim-lost-answer-stuck-wrong-alert (live booking): a lead with no booked call joins: the live call ends booked and shown, or a person is told to book it", async () => {
    const w = world({ rooms: { count_on_join: true, live_calendar_id: "cal-live", send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    const id = await w.make();
    await w.workerOpens(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    seedLeadZoomJoin(w.db, id);
    let lost = 0;
    w.setAround(async (path, _init, real) => {
      const out = await real();
      if (lost === 0 && path === "rpc/cockpit_sales_room_count_claim") {
        lost++;
        throw new DbError("database: no answer within 8 s", 0);
      }
      return out;
    });
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.drain();
    w.setAround(null);
    for (let i = 0; i < 10; i++) await w.minute(id);
    const r = w.room(id);
    const alerts = w.alerts(id).map(a => String(a.message ?? ""));
    expect(lost).toBe(1);
    const booked = w.bookings.length === 1;
    const toldToBook = alerts.some(a => /book/i.test(a) && !/Check HighLevel for a "Live" booking/.test(a));
    expect(
      { booked_or_told_to_book: booked || toldToBook },
      `bookings=${w.bookings.length} count_result=${String(r.count_result)} claimed=${String(r.count_claimed_at)}; alerts: ${alerts.join(" | ")}`,
    ).toEqual({ booked_or_told_to_book: true });
  });

  test("HELD: with the claim's answer back, the live call is booked once", async () => {
    const w = world({ rooms: { count_on_join: true, live_calendar_id: "cal-live", send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    const id = await w.make();
    await w.workerOpens(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    seedLeadZoomJoin(w.db, id);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.drain();
    expect(w.bookings.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Round 2's link sweep again, with the database functions (the event
//    lease, alerts, the count's claim) inside the fault plan too
// ---------------------------------------------------------------------------

describe("chaos2 r3: the room's link, one database call or function failed or lost at every step", () => {
  async function linkJourney(k: number | null, mode: "fail" | "lost") {
    const w = world();
    const id = await w.make();
    await w.workerOpens(id);
    const plan = k === null ? null : faultAt(w, k, mode);
    let n = 0;
    if (k === null)
      w.setAround(async (_p, _i, real) => {
        n++;
        return await real();
      });
    await settle(w.readyEvent(id));
    await w.drain();
    w.setAround(null);
    for (let i = 0; i < 6; i++) await w.minute(id);
    return { w, id, calls: k === null ? n : (plan?.calls() ?? 0), seen: plan?.seen ?? [] };
  }

  test("every fault point: the lead gets the link once at most, and the room says it went or why not", async () => {
    const clean = await linkJourney(null, "fail");
    expect(clean.w.delivered).toHaveLength(1);
    const bad: string[] = [];
    for (const mode of ["fail", "lost"] as const) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { w, id, seen } = await linkJourney(k, mode);
        const r = w.room(id);
        const said = Boolean(r.link_sent_at) || Boolean(r.refusal);
        if (w.delivered.length > 1 || !said)
          bad.push(`${mode}@${k} (${seen[k] ?? "?"}): deliveries=${w.delivered.length} link_sent_at=${Boolean(r.link_sent_at)} refusal=${String(r.refusal ?? "")}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. Round 2's settle sweep again, with the database functions in the fault plan
// ---------------------------------------------------------------------------

describe("chaos2 r3: the settle, one database call or function failed or lost at every step", () => {
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
      // The SQL sweep posts the settle while its event is not handled.
      if (ev?.handled_at) return;
      w.clock.now = at;
      await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } }).catch(() => null);
    }
    return { w, id, post };
  }

  test("every fault point: the intro ends a no-show, or a person is told for a true reason", async () => {
    const clean = seedSettle();
    let n = 0;
    clean.w.setAround(async (_p, _i, real) => {
      n++;
      return await real();
    });
    await clean.post(START + 21 * MIN);
    clean.w.setAround(null);
    expect(clean.w.hl.get("intro-s12")).toBe("noshow");
    const bad: string[] = [];
    for (const mode of ["fail", "lost"] as const) {
      for (let k = 0; k < n + 2; k++) {
        const { w, id, post } = seedSettle();
        const plan = faultAt(w, k, mode);
        await post(START + 21 * MIN);
        w.setAround(null);
        for (let m = 22; m < 27; m++) await post(START + m * MIN);
        const alerts = w.alerts(id).map(a => String(a.message));
        const noshow = w.hl.get("intro-s12") === "noshow";
        const falseReason = alerts.some(a => /another rep/.test(a));
        if ((!noshow && !alerts.length) || falseReason || (noshow && w.room(id).settled_mark !== "noshow"))
          bad.push(`${mode}@${k} (${plan.seen[k] ?? "?"}): hl=${w.hl.get("intro-s12")} settled=${String(w.room(id).settled_mark)} alerts=${alerts.join(" | ")}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. The function killed between two writes: the k-th call never answers
//    (before it lands, or after), and nothing of that run goes on; the
//    cron's minutes then run as usual.
// ---------------------------------------------------------------------------

function killAt(w: ReturnType<typeof world>, k: number, when: "before" | "after") {
  let n = 0;
  const seen: string[] = [];
  w.setAround(async (path, init, real) => {
    const mine = n++;
    seen.push(`${String(init.method ?? "GET")} ${path.slice(0, 90)}`);
    if (mine !== k) return await real();
    if (when === "after") await real();
    return await new Promise<Row[]>(() => {}); // the run is gone
  });
  return { calls: () => n, seen };
}

describe("chaos2 r3: the function killed between two writes", () => {
  async function linkKilled(k: number, when: "before" | "after") {
    const w = world();
    const id = await w.make();
    await w.workerOpens(id);
    const plan = killAt(w, k, when);
    await Promise.race([settle(w.readyEvent(id)), realSleep(30)]);
    await w.drain();
    w.setAround(null);
    for (let i = 0; i < 8; i++) await w.minute(id);
    return { w, id, seen: plan.seen };
  }

  test("the link: killed at every step, the lead gets the link once at most and the room says it went or why not", async () => {
    const bad: string[] = [];
    for (const when of ["before", "after"] as const) {
      for (let k = 0; k < 40; k++) {
        const { w, id, seen } = await linkKilled(k, when);
        const r = w.room(id);
        const said = Boolean(r.link_sent_at) || Boolean(r.refusal);
        const audited = !r.link_sent_at || w.audits.some(a => a.action === "room.link" && a.entityId === id);
        if (w.delivered.length > 1 || !said || !audited)
          bad.push(`${when}@${k} (${seen[k] ?? "?"}): deliveries=${w.delivered.length} sent=${Boolean(r.link_sent_at)} refusal=${String(r.refusal ?? "")} audited=${audited}`);
      }
    }
    expect(bad).toEqual([]);
  }, 600_000);

  async function countKilled(k: number, when: "before" | "after") {
    const w = world({ rooms: { count_on_join: true, send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    w.intro("confirmed", w.clock.now - 3 * MIN);
    const id = await w.make({ appointment_id: "intro-r2" });
    await w.workerOpens(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    seedLeadZoomJoin(w.db, id);
    const plan = killAt(w, k, when);
    await Promise.race([settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" })), realSleep(30)]);
    await w.drain();
    w.setAround(null);
    // The rep presses again when the press never answered and the room did not move.
    if (w.room(id).state !== "lead_in")
      await settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" }));
    await w.drain();
    for (let i = 0; i < 8; i++) await w.minute(id);
    return { w, id, seen: plan.seen };
  }

  test("the count of a booked intro: killed at every step, the intro ends marked shown or a person is told to mark it", async () => {
    const bad: string[] = [];
    for (const when of ["before", "after"] as const) {
      for (let k = 0; k < 40; k++) {
        const { w, id, seen } = await countKilled(k, when);
        const r = w.room(id);
        const shown = w.hl.get("intro-r2") === "showed";
        const told = w.alerts(id).some(a => !/Check HighLevel for a "Live" booking/.test(String(a.message ?? "")));
        if (!shown && !told)
          bad.push(`${when}@${k} (${seen[k] ?? "?"}): state=${String(r.state)} count_result=${String(r.count_result)} claimed=${Boolean(r.count_claimed_at)} hl=${String(w.hl.get("intro-r2"))}`);
      }
    }
    expect(bad).toEqual([]);
  }, 600_000);
});

describe("chaos2 r3: the function killed between two writes (Zoom's join, That was not the lead)", () => {
  test("Zoom's join of the lead: killed at every step, the join stands and the intro ends marked shown, or a person is told to mark it", async () => {
    const bad: string[] = [];
    for (const when of ["before", "after"] as const) {
      for (let k = 0; k < 40; k++) {
        const w = world({ rooms: { count_on_join: true, send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
        w.intro("confirmed", w.clock.now - 3 * MIN);
        const id = await zoomRoom(w, { appointment_id: "intro-r2" });
        await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
        const t0 = w.clock.now;
        await zoomEvent(w, id, { event: "meeting.started", event_ts: t0, payload: meetingObj() }, t0);
        w.clock.now += 20 * S;
        const plan = killAt(w, k, when);
        const joinAt = w.clock.now;
        await Promise.race([
          zoomEvent(
            w,
            id,
            {
              event: "meeting.participant_joined",
              event_ts: joinAt,
              payload: meetingObj({ participant: { id: "", user_name: "Huda Ali", join_time: new Date(joinAt).toISOString(), participant_uuid: "p-lead" } }),
            },
            joinAt,
          ),
          realSleep(30),
        ]);
        await w.drain();
        w.setAround(null);
        for (let i = 0; i < 6; i++) await w.minute(id);
        const r = w.room(id);
        const shown = w.hl.get("intro-r2") === "showed";
        const told = w.alerts(id).some(a => !/Check HighLevel for a "Live" booking/.test(String(a.message ?? "")));
        if (!r.lead_in_at || (!shown && !told))
          bad.push(`${when}@${k} (${plan.seen[k] ?? "?"}): state=${String(r.state)} joined=${Boolean(r.lead_in_at)} count_result=${String(r.count_result)} hl=${String(w.hl.get("intro-r2"))}`);
      }
    }
    expect(bad).toEqual([]);
  }, 600_000);
});

describe("chaos2 r3: the function killed between two writes (the unseen template)", () => {
  test("killed at every step of an unseen template: the email backs it up once, and the room says what went", async () => {
    const bad: string[] = [];
    for (const when of ["before", "after"] as const) {
      for (let k = 0; k < 45; k++) {
        const w = world({ inboundAgoMs: 48 * HOUR });
        const id = await w.make();
        await w.workerOpens(id);
        w.modes.template.push("unseen");
        const plan = killAt(w, k, when);
        await Promise.race([settle(w.readyEvent(id)), realSleep(30)]);
        await w.drain();
        w.setAround(null);
        for (let i = 0; i < 8; i++) await w.minute(id);
        const r = w.room(id);
        const emails = w.delivered.filter(d => d.lane === "email").length;
        const ch = Array.isArray(r.link_channels) ? (r.link_channels as string[]) : [];
        const templated = w.db.t("cockpit_sales_messages").some(m => m.via === "workflow");
        const wrong = emails === 1 && !ch.includes("email");
        if (emails > 1 || (!r.link_sent_at && !r.refusal) || (templated && r.link_sent_at && !r.link_unconfirmed_at) || wrong)
          bad.push(`${when}@${k} (${plan.seen[k] ?? "?"}): emails=${emails} sent=${Boolean(r.link_sent_at)} unconfirmed=${Boolean(r.link_unconfirmed_at)} channels=${ch.join("+")} refusal=${String(r.refusal ?? "")}`);
      }
    }
    expect(bad).toEqual([]);
  }, 900_000);
});
