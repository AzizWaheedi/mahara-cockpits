// bun test supabase/functions/sales-api/stress2_chaos_r2_rooms.test.ts
//
// Second series, round 2, chaos: every dependency failing, hanging or
// answering garbage at every step; an answer lost after its write landed;
// the function killed between two writes. sales-api's rooms.ts on
// testfakes.ts (no HighLevel, no database, no Zoom).
//
// Two kinds of test: single scenarios found by reading, and sweeps that
// fail (or lose the answer of) the k-th database call of a journey, for
// every k, then let the minute's re-asks (the SQL sweep's tick and replay)
// run with the database answering again, and check what a lead and a
// manager are left with.
//
// A test that fails here is a finding; once fixed it stays as a regression
// test. Tests marked HELD pass today.
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
const LEAD = "stress-chaos2r2-lead-0001";
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
    background: p => {
      jobs.push(p.catch(e => w.logs.push(`background: ${String((e as Error)?.message ?? e)}`)));
    },
  };
  async function drain(): Promise<void> {
    for (let i = 0; i < 12; i++) await Promise.race([Promise.allSettled(jobs.slice()), realSleep(30)]);
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
// 1. The count's mark of a booked intro, when the database blinks first
// ---------------------------------------------------------------------------

describe("chaos2 r2: the count's mark meets a database blip before it writes", () => {
  async function joinedIntro(o: { failBeforeWrite?: number; failAfterSupersede?: number; repMark?: string } = {}) {
    const w = world({ rooms: { count_on_join: true, send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    const start = w.clock.now - 3 * MIN;
    w.intro("confirmed", start);
    if (o.repMark)
      w.db.seed("cockpit_sales_dispositions", [
        { id: "rep-mark-1", appointment_id: "intro-r2", status: o.repMark, marked_by: SETTER, note: null, superseded_at: null, marked_at: w.db.iso(), crm: "written" },
      ]);
    const id = await w.make({ appointment_id: "intro-r2" });
    expect(w.room(id).appointment_id).toBe("intro-r2");
    await w.workerOpens(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    seedLeadZoomJoin(w.db, id);
    w.markKnobs.failBeforeWrite = o.failBeforeWrite ?? 0;
    w.markKnobs.failAfterSupersede = o.failAfterSupersede ?? 0;
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.drain();
    return { w, id };
  }

  test("HELD: with the database answering, the lead's join marks the booked intro shown", async () => {
    const { w } = await joinedIntro();
    expect(w.hl.get("intro-r2")).toBe("showed");
  });

  test("count-mark-blip-final-failed-silent: the mark's first read fails (a 503 from the database) before anything is written: the count must be asked again or a person told, never left 'failed' with the intro unmarked and nobody told", async () => {
    const { w, id } = await joinedIntro({ failBeforeWrite: 1 });
    // The database answers again; the cron runs for five minutes.
    for (let i = 0; i < 5; i++) await w.minute(id);
    const shown = w.hl.get("intro-r2") === "showed";
    const told = w.alerts(id).length > 0;
    // Today: count_result "failed" (final: not claimable, not in flight), no
    // alert, no re-ask; the lead came and the intro stays "confirmed" with
    // nobody asked to mark it.
    expect({ count_result: w.room(id).count_result, shown, told }).toEqual(
      expect.objectContaining({ shown: true }) as unknown as { count_result: unknown; shown: boolean; told: boolean },
    );
  });

  test("count-mark-blip-final-failed-silent (supersede): the rep's own 'confirmed' mark is superseded and the new mark's insert gets no answer: the call is left with no current mark at all, and the count says failed", async () => {
    const { w, id } = await joinedIntro({ failAfterSupersede: 1, repMark: "confirmed" });
    for (let i = 0; i < 5; i++) await w.minute(id);
    const current = w.db.t("cockpit_sales_dispositions").filter(d => d.appointment_id === "intro-r2" && !d.superseded_at);
    const told = w.alerts(id).length > 0;
    // The rep's mark is gone and nothing replaced it; nobody is told.
    expect(current.length > 0 || told).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Sweep: the link journey with one database call failed or lost
// ---------------------------------------------------------------------------

describe("chaos2 r2: the room's link, one database call failed or lost at every step", () => {
  async function linkJourney(k: number | null, mode: "fail" | "lost") {
    const w = world();
    const id = await w.make();
    await w.workerOpens(id);
    const plan = k === null ? null : faultAt(w, k, mode);
    if (k === null) {
      let n = 0;
      w.setAround(async (_p, _i, real) => {
        n++;
        return await real();
      });
      await settle(w.readyEvent(id));
      await w.drain();
      w.setAround(null);
      return { w, id, calls: n };
    }
    await settle(w.readyEvent(id));
    await w.drain();
    w.setAround(null);
    for (let i = 0; i < 6; i++) await w.minute(id);
    return { w, id, calls: plan?.calls() ?? 0, seen: plan?.seen ?? [] };
  }

  test("every fault point: the lead gets the link once at most, and the room says it went or why not", async () => {
    const clean = await linkJourney(null, "fail");
    expect(clean.w.delivered).toHaveLength(1);
    const bad: string[] = [];
    for (const mode of ["fail", "lost"] as const) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { w, id, seen } = await linkJourney(k, mode);
        const r = w.room(id);
        const deliveries = w.delivered.length;
        const said = Boolean(r.link_sent_at) || Boolean(r.refusal);
        const audited = !r.link_sent_at || w.audits.some(a => a.action === "room.link" && a.entityId === id);
        if (deliveries > 1 || !said || !audited)
          bad.push(`${mode}@${k} (${seen?.[k] ?? "?"}): deliveries=${deliveries} link_sent_at=${Boolean(r.link_sent_at)} refusal=${String(r.refusal ?? "")} audited=${audited}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Sweep: the count of a booked intro with one database call failed or lost
// ---------------------------------------------------------------------------

describe("chaos2 r2: the count of a booked intro, one database call failed or lost at every step", () => {
  async function countJourney(k: number | null, mode: "fail" | "lost") {
    const w = world({ rooms: { count_on_join: true, send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    const start = w.clock.now - 3 * MIN;
    w.intro("confirmed", start);
    const id = await w.make({ appointment_id: "intro-r2" });
    await w.workerOpens(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    seedLeadZoomJoin(w.db, id);
    let n = 0;
    let plan: ReturnType<typeof faultAt> | null = null;
    if (k === null)
      w.setAround(async (_p, _i, real) => {
        n++;
        return await real();
      });
    else plan = faultAt(w, k, mode);
    await settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" }));
    await w.drain();
    w.setAround(null);
    if (k !== null) for (let i = 0; i < 6; i++) await w.minute(id);
    return { w, id, calls: k === null ? n : (plan?.calls() ?? 0), seen: plan?.seen ?? [] };
  }

  test("every fault point: the intro ends marked shown, or a person is told which intro to mark", async () => {
    const clean = await countJourney(null, "fail");
    expect(clean.w.hl.get("intro-r2")).toBe("showed");
    const bad: string[] = [];
    for (const mode of ["fail", "lost"] as const) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { w, id, seen } = await countJourney(k, mode);
        const r = w.room(id);
        const shown = w.hl.get("intro-r2") === "showed";
        const told = w.alerts(id).length > 0;
        // The press itself failed before the room moved: the rep presses again (not under test).
        if (r.state !== "lead_in" && !r.lead_in_at) continue;
        if (!shown && !told)
          bad.push(`${mode}@${k} (${seen[k] ?? "?"}): count_result=${String(r.count_result)} claimed=${Boolean(r.count_claimed_at)} appt=${String(r.count_appointment_id ?? "")}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Sweep: HighLevel failing (no answer, or a 200 of garbage) at every call
// ---------------------------------------------------------------------------

describe("chaos2 r2: HighLevel failing or answering garbage at every call of the link and the count", () => {
  test("the link: every HighLevel fault point leaves one link at most and a room that says what happened", async () => {
    const bad: string[] = [];
    for (const mode of ["unclear", "garbage"] as const) {
      for (let k = 0; k < 8; k++) {
        const w = world();
        const id = await w.make();
        await w.workerOpens(id);
        w.ghlFault.n = 0;
        w.ghlFault.at = k;
        w.ghlFault.mode = mode;
        await settle(w.readyEvent(id));
        await w.drain();
        for (let i = 0; i < 6; i++) await w.minute(id);
        const r = w.room(id);
        if (w.delivered.length > 1 || !(r.link_sent_at || r.refusal))
          bad.push(`${mode}@${k}: deliveries=${w.delivered.length} sent=${Boolean(r.link_sent_at)} refusal=${String(r.refusal ?? "")}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("the count of a booked intro: every HighLevel fault point ends marked shown or with a person told", async () => {
    const bad: string[] = [];
    for (const mode of ["unclear", "garbage"] as const) {
      for (let k = 0; k < 8; k++) {
        const w = world({ rooms: { count_on_join: true, send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
        w.intro("confirmed", w.clock.now - 3 * MIN);
        const id = await w.make({ appointment_id: "intro-r2" });
        await w.workerOpens(id);
        await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
        seedLeadZoomJoin(w.db, id);
        w.ghlFault.n = 0;
        w.ghlFault.at = k;
        w.ghlFault.mode = mode;
        await settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" }));
        await w.drain();
        for (let i = 0; i < 6; i++) await w.minute(id);
        const r = w.room(id);
        if (w.hl.get("intro-r2") !== "showed" && !w.alerts(id).length)
          bad.push(`${mode}@${k}: count_result=${String(r.count_result)} appt=${String(r.count_appointment_id ?? "")}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Sweep: the unseen template and its email backup, one database call failed or lost
// ---------------------------------------------------------------------------

describe("chaos2 r2: the unseen template's backup, one database call failed or lost at every step", () => {
  async function unseenJourney(k: number | null, mode: "fail" | "lost") {
    // The lead last wrote two days ago: the window is shut, so the template goes first.
    const w = world({ inboundAgoMs: 48 * HOUR });
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.template.push("unseen");
    let n = 0;
    let plan: ReturnType<typeof faultAt> | null = null;
    if (k === null)
      w.setAround(async (_p, _i, real) => {
        n++;
        return await real();
      });
    else plan = faultAt(w, k, mode);
    await settle(w.readyEvent(id));
    await w.drain();
    w.setAround(null);
    if (k !== null) for (let i = 0; i < 6; i++) await w.minute(id);
    return { w, id, calls: k === null ? n : (plan?.calls() ?? 0), seen: plan?.seen ?? [] };
  }

  test("every fault point: the email backs the template up once, and the room says what went", async () => {
    const clean = await unseenJourney(null, "fail");
    expect(clean.w.delivered.map(d => d.lane)).toEqual(["email"]);
    expect(clean.w.room(clean.id).link_channels).toEqual(expect.arrayContaining(["whatsapp_template", "email"]));
    const bad: string[] = [];
    for (const mode of ["fail", "lost"] as const) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { w, id, seen } = await unseenJourney(k, mode);
        const r = w.room(id);
        const emails = w.delivered.filter(d => d.lane === "email").length;
        const ch = Array.isArray(r.link_channels) ? (r.link_channels as string[]) : [];
        // A template went (its row is there): the panel must say it was not
        // confirmed, and must not say "the email did not go" when it went.
        // (A template route or wait that could not be read sends email only: fine.)
        const templated = w.db.t("cockpit_sales_messages").some(m => m.via === "workflow");
        const wrong = emails === 1 && !ch.includes("email");
        if (emails > 1 || !r.link_sent_at || (templated && !r.link_unconfirmed_at) || wrong)
          bad.push(`${mode}@${k} (${seen[k] ?? "?"}): emails=${emails} sent=${Boolean(r.link_sent_at)} unconfirmed=${Boolean(r.link_unconfirmed_at)} channels=${ch.join("+")}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Sweep: the live booking (a lead with no intro), one database call failed or lost
// ---------------------------------------------------------------------------

describe("chaos2 r2: the live booking, one database call failed or lost at every step", () => {
  async function bookJourney(k: number | null, mode: "fail" | "lost") {
    const w = world({ rooms: { count_on_join: true, live_calendar_id: "cal-live", send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    const id = await w.make();
    await w.workerOpens(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    seedLeadZoomJoin(w.db, id);
    let n = 0;
    let plan: ReturnType<typeof faultAt> | null = null;
    if (k === null)
      w.setAround(async (_p, _i, real) => {
        n++;
        return await real();
      });
    else plan = faultAt(w, k, mode);
    await settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" }));
    await w.drain();
    w.setAround(null);
    if (k !== null) for (let i = 0; i < 6; i++) await w.minute(id);
    return { w, id, calls: k === null ? n : (plan?.calls() ?? 0), seen: plan?.seen ?? [] };
  }

  test("every fault point: one booking at most, and it is shown or a person is told", async () => {
    const clean = await bookJourney(null, "fail");
    expect(clean.w.bookings).toHaveLength(1);
    expect(clean.w.room(clean.id).count_result).toBe("booked");
    const bad: string[] = [];
    for (const mode of ["fail", "lost"] as const) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { w, id, seen } = await bookJourney(k, mode);
        const r = w.room(id);
        if (r.state !== "lead_in" && !r.lead_in_at) continue;
        const shown = w.bookings.length === 1 && w.hl.get(String(w.bookings[0]?.id)) === "showed";
        const told = w.alerts(id).length > 0;
        if (w.bookings.length > 1 || (!shown && !told))
          bad.push(`${mode}@${k} (${seen[k] ?? "?"}): bookings=${w.bookings.length} count_result=${String(r.count_result)} appt=${String(r.count_appointment_id ?? "")}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. The host's own seat row not read: read as "no HighLevel user"
// ---------------------------------------------------------------------------

describe("chaos2 r2: the host's seat row cannot be read for one moment", () => {
  /** Thursday 8 October 2026, 10:00 Kuwait. */
  const START = Date.parse("2026-10-08T07:00:00.000Z");
  function settleWorld() {
    const w = world({ start: START, rooms: { count_on_join: true } });
    w.intro("confirmed", START, "intro-settle");
    const id = fakeUuid();
    w.db.seed("cockpit_sales_rooms", [
      {
        id,
        request_id: fakeUuid(),
        code: "K7Q2MX",
        contact_id: LEAD,
        purpose: "fallback",
        trigger: "no_answer",
        call_kind: "intro",
        provider: "zoom",
        host_email: SETTER,
        made_by: SETTER,
        appointment_id: "intro-settle",
        appointment_start_at: new Date(START).toISOString(),
        state: "expired",
        result: "no_join",
        end_reason: "lead_no_show",
        join_url: "https://us06web.zoom.us/j/81234567890?pwd=abc",
        provider_meeting_id: "81234567890",
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
      {
        room_id: id,
        kind: "zoom.meeting.started",
        source: "zoom",
        dedupe_key: `zoom:meeting.started:${id}`,
        at: new Date(START + 2 * MIN).toISOString(),
        handled_at: new Date(START + 2 * MIN).toISOString(),
      },
    ]);
    async function post(at: number) {
      w.db.insertOne(
        "cockpit_sales_room_events",
        { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due." },
        "ignore",
        "dedupe_key",
      );
      w.clock.now = at;
      return await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    }
    return { w, id, post };
  }
  /** The host's seat row (cockpit_sales_people) does not answer once, the 503 of a pooler restart. */
  function blinkPeople(w: ReturnType<typeof world>, nth = 0) {
    let seen = 0;
    w.setAround(async (path, _init, real) => {
      if (path.startsWith(`cockpit_sales_people?email=eq.${encodeURIComponent(SETTER)}`) && seen++ === nth)
        throw new DbError("database 503: upstream connect error", 503);
      return await real();
    });
  }

  test("HELD: with the database answering, the settle marks the unattended intro a no-show", async () => {
    const { w, id, post } = settleWorld();
    await post(START + 21 * MIN);
    expect(w.hl.get("intro-settle")).toBe("noshow");
    expect(w.room(id).settled_mark).toBe("noshow");
  });

  test("host-seat-blip-read-as-another-reps-call (settle): one failed read of the host's seat row: the settle must try again, never give the intro up as 'booked with another rep'", async () => {
    const { w, id, post } = settleWorld();
    blinkPeople(w, 0);
    await post(START + 21 * MIN);
    w.setAround(null);
    // The sweep posts the settle again a minute later, as it does for a released event.
    await post(START + 22 * MIN);
    const alerts = w.alerts(id).map(a => String(a.message));
    // Today: settled_mark "none" for good, the event finished, and a manager
    // told the intro is "booked with another rep": the setter's own intro.
    expect({ settled: w.room(id).settled_mark, hl: w.hl.get("intro-settle"), alerts }).toEqual({ settled: "noshow", hl: "noshow", alerts: [] });
  });

  async function introJoin() {
    const w = world({ rooms: { count_on_join: true, send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    w.intro("confirmed", w.clock.now - 3 * MIN);
    const id = await w.make({ appointment_id: "intro-r2" });
    await w.workerOpens(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    seedLeadZoomJoin(w.db, id);
    return { w, id };
  }
  test("host-seat-blip-read-as-another-reps-call (count, intro): one failed read of the host's seat row while the lead's join is counted: the intro must be marked shown, never alerted as another rep's", async () => {
    const bad: string[] = [];
    for (let nth = 0; nth < 6; nth++) {
      const { w, id } = await introJoin();
      blinkPeople(w, nth);
      await settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" }));
      await w.drain();
      w.setAround(null);
      for (let i = 0; i < 4; i++) await w.minute(id);
      const alerts = w.alerts(id).map(a => String(a.message));
      if (!w.room(id).lead_in_at) continue;
      if (w.hl.get("intro-r2") !== "showed" || alerts.length)
        bad.push(`seat read #${nth}: hl=${w.hl.get("intro-r2")} count_result=${String(w.room(id).count_result)} alerts=${alerts.join(" | ")}`);
    }
    expect(bad).toEqual([]);
  });

  async function liveJoin() {
    const w = world({ rooms: { count_on_join: true, live_calendar_id: "cal-live", send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    const id = await w.make();
    await w.workerOpens(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    seedLeadZoomJoin(w.db, id);
    return { w, id };
  }
  test("host-seat-blip-read-as-another-reps-call (count, live booking): one failed read of the host's seat row: the live call must be booked on a later minute, never 'failed' for good with nobody told", async () => {
    const bad: string[] = [];
    for (let nth = 0; nth < 6; nth++) {
      const { w, id } = await liveJoin();
      blinkPeople(w, nth);
      await settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" }));
      await w.drain();
      w.setAround(null);
      for (let i = 0; i < 4; i++) await w.minute(id);
      if (!w.room(id).lead_in_at) continue;
      if (w.bookings.length !== 1 || w.room(id).count_result !== "booked")
        bad.push(`seat read #${nth}: bookings=${w.bookings.length} count_result=${String(w.room(id).count_result)} alerts=${w.alerts(id).length}`);
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. room.wrap when HighLevel answers 200 with no appointment in it
// ---------------------------------------------------------------------------

describe("chaos2 r2: room.wrap reads HighLevel's appointment as garbage", () => {
  function wrapWorld(answer: "ok" | "empty" | "event_shape") {
    const w = world();
    const start = w.clock.now + 10 * MIN;
    w.db.seed("cockpit_sales_appointments", [
      { appointment_id: "intro-wrap", contact_id: LEAD, call_type: "intro", start_at: new Date(start).toISOString(), status: "confirmed", assigned_user_id: "G-setter" },
    ]);
    const appt = {
      id: "intro-wrap",
      contactId: LEAD,
      startTime: new Date(start).toISOString(),
      endTime: new Date(start + 15 * MIN).toISOString(),
      address: MEET_URL,
      assignedUserId: "G-setter",
    };
    w.routes.unshift((m, p) => {
      if (!(m === "GET" && p === "/calendars/events/appointments/intro-wrap")) return null as unknown as Row;
      // A gateway's 200 with an empty object, or the event under another key.
      if (answer === "empty") return { traceId: "x" } as Row;
      if (answer === "event_shape") return { event: appt } as Row;
      return { appointment: appt };
    });
    return w;
  }

  test("HELD: HighLevel answers the appointment: the booked call's room opens on its Meet link", async () => {
    const w = wrapWorld("ok");
    const out = await w.rooms.actions["room.wrap"]!(setter, { appointment_id: "intro-wrap", request_id: crypto.randomUUID() });
    expect((out.room as Row).provider).toBe("meet");
  });

  test("wrap-garbage-answer-says-phone-call: HighLevel answers 200 with no appointment object: the rep must be told HighLevel was not read (try again), never 'This call is on the phone' for a video call", async () => {
    const w = wrapWorld("empty");
    let said = "";
    try {
      await w.rooms.actions["room.wrap"]!(setter, { appointment_id: "intro-wrap", request_id: crypto.randomUUID() });
    } catch (e) {
      said = String((e as Error).message);
    }
    // Today: "This call is on the phone. There is no link to send." The setter
    // phones the lead, who is waiting on the booked call's Meet link.
    expect(said).not.toContain("on the phone");
  });
});

// ---------------------------------------------------------------------------
// 9. Sweep: "I can't let them in" with one database call failed or lost
// ---------------------------------------------------------------------------

describe("chaos2 r2: I can't let them in, one database call failed or lost at every step", () => {
  async function admitJourney(k: number | null, mode: "fail" | "lost") {
    const w = world();
    const id = await w.make();
    await w.workerOpens(id);
    await settle(w.readyEvent(id));
    await w.drain();
    const firstLinks = w.delivered.length;
    // The Meet knock nobody can admit: the rep presses I can't let them in.
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { host_in_at: w.db.iso(), state: "host_in", version: Number(w.room(id).version) + 1 } });
    let n = 0;
    let plan: ReturnType<typeof faultAt> | null = null;
    if (k === null)
      w.setAround(async (_p, _i, real) => {
        n++;
        return await real();
      });
    else plan = faultAt(w, k, mode);
    const v = Number(w.room(id).version);
    let answer: Row | null = null;
    try {
      answer = await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "admit_blocked" });
    } catch {
      answer = null;
    }
    w.setAround(null);
    if (answer === null) {
      // The press failed: the rep presses again (the same version).
      answer = await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "admit_blocked" }).catch(() => null);
    }
    const replacements = () => w.db.t("cockpit_sales_rooms").filter(r => r.id !== id && r.contact_id === LEAD && r.state !== "failed");
    // The worker makes whatever replacement was asked for; the cron runs.
    for (const r of replacements()) if (r.state === "requested") await w.workerOpens(String(r.id));
    for (const r of replacements()) await settle(w.readyEvent(String(r.id)));
    await w.drain();
    for (let i = 0; i < 4; i++) for (const r of replacements()) await w.minute(String(r.id));
    return { w, id, answer, firstLinks, replacements: replacements(), calls: k === null ? n : (plan?.calls() ?? 0), seen: plan?.seen ?? [] };
  }

  test("every fault point: one replacement at most, its link once, and the rep has the room or a sentence", async () => {
    const clean = await admitJourney(null, "fail");
    expect(clean.replacements).toHaveLength(1);
    expect(clean.w.delivered).toHaveLength(2);
    const bad: string[] = [];
    for (const mode of ["fail", "lost"] as const) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { w, answer, replacements, seen } = await admitJourney(k, mode);
        const said = Boolean(answer && (answer.replacement || answer.replacement_refusal));
        const linked = replacements.every(r => r.link_sent_at || r.refusal);
        if (replacements.length > 1 || w.delivered.length > 2 || !said || !linked)
          bad.push(`${mode}@${k} (${seen[k] ?? "?"}): replacements=${replacements.length} deliveries=${w.delivered.length} answered=${said} linked=${linked}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 10. Sweep: I'm available (the standby room) with one database call failed or lost
// ---------------------------------------------------------------------------

describe("chaos2 r2: I'm available, one database call failed or lost at every step", () => {
  const START = Date.parse("2026-10-04T08:00:00Z"); // Sunday 11:00 Kuwait, inside live hours
  const LIVE = { enabled: true, standby: true, hours: { days: [6, 0, 1, 2, 3, 4], from: "10:00", to: "20:00", tz: "Asia/Kuwait" } };
  async function availableJourney(k: number | null, mode: "fail" | "lost") {
    const w = world({ start: START, live: LIVE });
    let n = 0;
    let plan: ReturnType<typeof faultAt> | null = null;
    if (k === null)
      w.setAround(async (_p, _i, real) => {
        n++;
        return await real();
      });
    else plan = faultAt(w, k, mode);
    let first: Row | null = null;
    try {
      first = await w.rooms.actions["live.availability"]!(setter, { state: "available" });
    } catch {
      first = null;
    }
    w.setAround(null);
    // The strip's press failed: the rep presses again a moment later.
    if (first === null) {
      w.clock.now += 5 * S;
      first = await w.rooms.actions["live.availability"]!(setter, { state: "available" }).catch(() => null);
    }
    const status = await w.rooms.actions["live.status"]!(setter, {}).catch(() => null);
    const standby = w.db.t("cockpit_sales_rooms").filter(r => r.purpose === "standby" && !["ended", "expired", "failed", "cancelled"].includes(String(r.state)));
    const avail = w.db.t("cockpit_sales_availability").find(a => a.email === SETTER);
    return { w, first, status, standby, avail, calls: k === null ? n : (plan?.calls() ?? 0), seen: plan?.seen ?? [] };
  }

  test("every fault point: the seat is Available with one standby room, or the strip says why not", async () => {
    const clean = await availableJourney(null, "fail");
    expect(clean.standby).toHaveLength(1);
    expect(clean.avail?.state).toBe("available");
    const bad: string[] = [];
    for (const mode of ["fail", "lost"] as const) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { standby, avail, status, seen } = await availableJourney(k, mode);
        const said = Boolean(status && status.standby_error);
        if (standby.length > 1 || avail?.state !== "available" || (standby.length === 0 && !said))
          bad.push(`${mode}@${k} (${seen[k] ?? "?"}): standby=${standby.length} state=${String(avail?.state)} said=${said}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 11. Sweep: Make a room (room.create) with one database call failed or lost,
//     then the rep's retry on the same request id
// ---------------------------------------------------------------------------

describe("chaos2 r2: Make a room, one database call failed or lost at every step", () => {
  async function createJourney(k: number | null, mode: "fail" | "lost") {
    const w = world();
    const requestId = crypto.randomUUID();
    const ask = () =>
      w.rooms.actions["room.create"]!(setter, { request_id: requestId, contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "fallback" });
    let n = 0;
    let plan: ReturnType<typeof faultAt> | null = null;
    if (k === null)
      w.setAround(async (_p, _i, real) => {
        n++;
        return await real();
      });
    else plan = faultAt(w, k, mode);
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
    return { w, out, said, live, calls: k === null ? n : (plan?.calls() ?? 0), seen: plan?.seen ?? [] };
  }

  test("every fault point: the retry answers the one room, with its audit row and timeline line", async () => {
    const clean = await createJourney(null, "fail");
    expect(clean.live).toHaveLength(1);
    const bad: string[] = [];
    for (const mode of ["fail", "lost"] as const) {
      for (let k = 0; k < clean.calls + 2; k++) {
        const { w, out, said, live, seen } = await createJourney(k, mode);
        const id = live[0]?.id;
        const audited = !id || w.audits.filter(a => a.action === "room.create" && a.entityId === id).length === 1;
        const answered = out ? String((out.room as Row | undefined)?.id ?? "") === String(id ?? "") : false;
        // A timeline line that could not be stored is only logged, by design (claimLine): not checked.
        if (live.length > 1 || !audited || (live.length === 1 && !answered))
          bad.push(`${mode}@${k} (${seen[k] ?? "?"}): rooms=${live.length} audited=${audited} answered=${answered} said=${said.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 12. Sweep: the settle of an unattended intro, one database call failed or lost
// ---------------------------------------------------------------------------

describe("chaos2 r2: the settle, one database call failed or lost at every step", () => {
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
// 13. The unseen template's backup email went, and its channel write failed
// ---------------------------------------------------------------------------

describe("chaos2 r2: the backup email's channel is not recorded", () => {
  test("unseen-backup-channel-lost-says-email-did-not-go: the template is unseen, the backup email goes, and the one write that adds 'email' to the room's channels fails: the room must end up saying the email went (the panel otherwise says 'the email did not go. Read the link out')", async () => {
    const w = world({ inboundAgoMs: 48 * HOUR });
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.template.push("unseen");
    let failed = false;
    w.setAround(async (path, init, real) => {
      const body = init.body as Row | undefined;
      if (
        !failed &&
        String(init.method) === "PATCH" &&
        path.startsWith(`cockpit_sales_rooms?id=eq.${id}&link_channels=`) &&
        Array.isArray(body?.link_channels) &&
        (body?.link_channels as string[]).includes("email")
      ) {
        failed = true;
        throw new DbError("database: no answer within 8 s", 0);
      }
      return await real();
    });
    await settle(w.readyEvent(id));
    await w.drain();
    w.setAround(null);
    expect(failed).toBe(true);
    for (let i = 0; i < 5; i++) await w.minute(id);
    const r = w.room(id);
    expect(w.delivered.map(d => d.lane)).toEqual(["email"]);
    expect(r.link_unconfirmed_at).toBeTruthy();
    // Today: link_channels stays ["whatsapp_template"]; the backup is
    // "settled" (its link.unconfirmed line says it went by email), so no
    // re-ask repairs it, and the panel's not_confirmed sentence reads
    // "WhatsApp did not confirm the template and the email did not go".
    expect(r.link_channels).toEqual(expect.arrayContaining(["email"]));
  });
});
