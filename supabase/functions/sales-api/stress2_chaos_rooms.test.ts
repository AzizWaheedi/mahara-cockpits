// bun test supabase/functions/sales-api/stress2_chaos_rooms.test.ts
//
// Second series, round 1, chaos: every dependency failing, hanging or
// answering garbage at a step; an answer lost after its write landed; the
// function killed between two writes. sales-api's side (rooms.ts and
// followupAgent.ts) on testfakes.ts: no HighLevel, no database, no Zoom.
//
// The message service is modelled as index.ts convoSend and sendTemplate
// store their rows (the row first, the request id unique, a repeat answers
// the row as it stands; a template the read-back did not see is "sent" /
// "enrolled"). markAppointment is modelled as index.ts writes it: the
// disposition first, then HighLevel, then the disposition's crm column.
//
// A test that fails here is a finding; once fixed it stays as a regression
// test. Tests marked HELD pass today.
import { describe, expect, test } from "bun:test";
import { makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal, DbError, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, noShowDoubt, type RoomRow } from "./roomlogic.ts";
import { makeRooms, ROOMS_COPY, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld, seedLeadZoomJoin } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const LEAD = "stress-chaos2-lead-0001";
const SETTER = "setter@stress.invalid";
const BOSS = "boss@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const boss: Who = { signed_in: true, seat: true, manager: true, email: BOSS, name: "The manager", role: "manager", ghl_user_id: "G-boss" };
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

/**
 * The fake world, with an io whose database calls a test can wrap (to lose
 * an answer after its write landed, or to fail one read at a chosen step).
 */
function world(o: WorldOpts = {}) {
  const w = fakeWorld(o.start);
  const audits: Row[] = [];
  const delivered: Row[] = [];
  const modes: Record<"text" | "template" | "email", Mode[]> = { text: [], template: [], email: [] };
  /** HighLevel's own appointment status (what B2B's show rate reads). */
  const hl = new Map<string, string>();
  const jobs: Promise<unknown>[] = [];
  /** A test's hook around every database call: return a value to answer it, throw to fail it. */
  let around: ((path: string, init: Row, real: () => Promise<Row[]>) => Promise<Row[]>) | null = null;
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
  w.routes.push(async (m, p, body) => {
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
    if (m === "POST" && p === "/calendars/events/appointments") return { id: `live-${fakeUuid()}` };
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
    for (let i = 0; i < 10; i++) await Promise.race([Promise.allSettled(jobs.slice()), realSleep(40)]);
  }
  const at = () => new Date(w.clock.now).toISOString();
  const msgRows = new Map<string, Row>();

  /** index.ts convoSend / sendTemplate, as they store their rows. */
  async function send(lane: "text" | "template" | "email", requestId: string, channel: "whatsapp" | "email", body: string, extra: Row) {
    const again = msgRows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, channel, body, state: "sending", created_at: at(), ...extra };
    msgRows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    const mode = modes[lane].shift() ?? "ok";
    if (mode === "lost") {
      // HighLevel took it (the lead has it) and its answer never came back.
      delivered.push({ lane, requestId, body });
      row.state = "unclear";
      row.error = "HighLevel did not answer: no answer within 25 s";
      throw new ApiRefusal(`${MAY_HAVE_GONE} (HighLevel did not answer: no answer within 25 s)`, 502, { unclear: true });
    }
    if (mode === "unseen") {
      // HighLevel took the template's enrolment; the 20 s read-back saw nothing (Meta never delivered it).
      row.state = "sent";
      row.provider_status = "enrolled";
      return { message: { ...row } };
    }
    delivered.push({ lane, requestId, body });
    row.state = "sent";
    row.provider_status = lane === "template" ? "delivered" : "sent";
    return { message: { ...row } };
  }

  /** index.ts markAppointment as it writes: the disposition, HighLevel, then the disposition's crm (which may fail). */
  const markKnobs = { crmPatchFails: false };
  async function markAppointment(who: Who, id: string, status: string, opts: Row = {}): Promise<Row> {
    const current = w.db.t("cockpit_sales_dispositions").find(d => d.appointment_id === id && !d.superseded_at);
    if (opts.onlyIfUnmarked && current && !(current.status === status && current.marked_by === who.email))
      throw new ApiRefusal("This call was already marked, so the timer left it as it is.", 409, { code: "marked" });
    if (current && current.status === status && current.crm !== "failed") return { ...current, repeated: true };
    if (current) current.superseded_at = w.db.iso();
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
    // writeMarkToCrm: HighLevel takes the status...
    hl.set(id, status);
    // ...then the cockpit's crm column is written; a database that stops
    // answering here throws out of markAppointment (index.ts svc), after
    // both the disposition and HighLevel's status landed.
    if (markKnobs.crmPatchFails) throw new DbError("database: no answer within 8 s", 0);
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

  function intro(status: string, startMs: number, id = "intro-c2") {
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
  const readyEvent = (id: string) => rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
  const tick = (id: string) => rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
  const setAround = (f: typeof around) => {
    around = f;
  };
  return { ...w, io, rooms, audits, delivered, modes, hl, markKnobs, room, intro, workerOpens, make, readyEvent, tick, drain, setAround };
}

async function outcome(p: Promise<Row>): Promise<{ ok: true; value: Row } | { ok: false; status: number; message: string }> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    if (e instanceof ApiRefusal) return { ok: false, status: e.status, message: e.message };
    return { ok: false, status: 500, message: String((e as Error)?.message ?? e) };
  }
}

// ---------------------------------------------------------------------------
// 1. A template nobody saw, and a database blip right after link_sent_at
// ---------------------------------------------------------------------------

describe("chaos2: the unseen template's backup once link_sent_at is written", () => {
  test("HELD: the template is unseen and the database answers: the email backs it up and the room says not confirmed", async () => {
    const w = world({ inboundAgoMs: 30 * HOUR });
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.template = ["unseen"];
    await w.readyEvent(id);
    await w.drain();
    expect(w.delivered.map(d => d.lane)).toEqual(["email"]);
    expect(w.room(id).link_unconfirmed_at ?? null).not.toBeNull();
  });

  test("unseen-backup-lost-after-link-sent: the template is unseen and the database misses one read right after link_sent_at landed: the minute's re-ask must still back it up by email (or at least say not confirmed)", async () => {
    const w = world({ inboundAgoMs: 30 * HOUR }); // the 24-hour window is shut: the template leads, email backs it up
    w.intro("confirmed", w.clock.now + 5 * MIN);
    const id = await w.make({ appointment_id: "intro-c2" });
    expect(w.room(id).appointment_id).toBe("intro-c2");
    await w.workerOpens(id);
    w.modes.template = ["unseen"];
    // recordSent: its first write (link_sent_at, through applyLoop) lands;
    // the read of the room that follows it (for link_channels) gets no answer
    // within 8 s, once. Everything else answers.
    let armed = false;
    let blipped = false;
    w.setAround(async (path, init, real) => {
      const method = String(init.method ?? "GET");
      if (!blipped && armed && method === "GET" && path === `cockpit_sales_rooms?id=eq.${id}&select=*`) {
        blipped = true;
        throw new DbError("database: no answer within 8 s", 0);
      }
      const out = await real();
      if (method === "PATCH" && path.startsWith(`cockpit_sales_rooms?id=eq.${id}`) && (init.body as Row | undefined)?.link_sent_at) armed = true;
      return out;
    });
    await w.readyEvent(id);
    await w.drain();
    expect(blipped).toBe(true);
    // The blip was one read: the database answers again for the minute's re-ask.
    w.setAround(null);
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    const r = w.room(id);
    // Fixed in fix round 1: the template nobody saw is never a sure send.
    // link_unconfirmed_at lands with link_sent_at, the blip no longer skips
    // the backup, and the email reaches the lead (once).
    expect(r.link_sent_at ?? null).not.toBeNull();
    expect(r.link_unconfirmed_at ?? null).not.toBeNull();
    expect(w.delivered.map(d => d.lane)).toEqual(["email"]);
    // The settle reads the room as it is: had the email not gone, the
    // unseen template alone is never evidence of a no-show.
    const templateOnly = { ...r, link_channels: ["whatsapp_template"] } as unknown as RoomRow;
    expect(noShowDoubt(templateOnly, { short_link: true })).not.toBeNull();
  });

  test("unseen-backup-lost-after-link-sent (kill): the function is stopped (a deploy, the wall clock) right after link_sent_at landed: the re-ask must still back the template up", async () => {
    const w = world({ inboundAgoMs: 30 * HOUR });
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.template = ["unseen"];
    let killed = false;
    w.setAround(async (path, init, real) => {
      const out = await real();
      if (!killed && String(init.method) === "PATCH" && path.startsWith(`cockpit_sales_rooms?id=eq.${id}`) && (init.body as Row | undefined)?.link_sent_at) {
        killed = true;
        return await new Promise<never>(() => undefined); // the isolate is gone
      }
      return out;
    });
    void w.readyEvent(id);
    await w.drain();
    expect(killed).toBe(true);
    w.setAround(null);
    w.clock.now += 91 * S; // past the send's own lease
    await w.tick(id);
    await w.drain();
    expect(w.delivered.map(d => d.lane)).toContain("email");
    expect(w.room(id).link_unconfirmed_at ?? null).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. "Also send by email" whose answer was lost
// ---------------------------------------------------------------------------

describe("chaos2: Also send by email, its answer lost", () => {
  test("room-send-unclear-says-not-sent: HighLevel takes the email and its answer is lost: neither press may say 'Not sent' (it may have gone)", async () => {
    const w = world({ inboundAgoMs: 1 * HOUR });
    const id = await w.make();
    await w.workerOpens(id);
    await w.readyEvent(id);
    await w.drain();
    // The link went on WhatsApp (the free text).
    expect(w.delivered.map(d => d.lane)).toEqual(["text"]);
    w.modes.email = ["lost"];
    const first = await outcome(w.rooms.actions["room.send"]!(setter, { room_id: id, request_id: crypto.randomUUID(), channel: "email" }));
    // The email reached the lead; only HighLevel's answer was lost.
    expect(w.delivered.map(d => d.lane)).toEqual(["text", "email"]);
    expect(first.ok).toBe(false);
    // The rep presses again a moment later.
    const second = await outcome(w.rooms.actions["room.send"]!(setter, { room_id: id, request_id: crypto.randomUUID(), channel: "email" }));
    expect(second.ok).toBe(false);
    const said = [first, second].map(o => (o.ok ? "" : o.message));
    // Nothing went twice (held today).
    expect(w.delivered.filter(d => d.lane === "email")).toHaveLength(1);
    // Asked for: a send that may have gone is never told as "Not sent" (the
    // rep would read it as failed and send the link some other way).
    for (const s of said) expect(s.startsWith("Not sent")).toBe(false);
    expect(said[1]).toMatch(/may have gone/i);
  });
});

// ---------------------------------------------------------------------------
// 3. The live count's mark of the room's intro, its answer lost
// ---------------------------------------------------------------------------

describe("chaos2: the count's mark whose answer was lost", () => {
  test("count-mark-lost-answer-recorded-failed: the count marks the intro shown, HighLevel takes it, and the database stops answering on the mark's last write: 'That was not the lead' must still take the show back", async () => {
    const w = world({ rooms: { count_on_join: true, send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    const start = w.clock.now - 3 * MIN;
    w.intro("confirmed", start);
    const id = await w.make({ appointment_id: "intro-c2" });
    expect(w.room(id).appointment_id).toBe("intro-c2");
    await w.workerOpens(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    seedLeadZoomJoin(w.db, id);
    w.markKnobs.crmPatchFails = true;
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.drain();
    // The count's mark landed: the cockpit's copy and HighLevel both say shown.
    expect(w.hl.get("intro-c2")).toBe("showed");
    const shown = w.db.t("cockpit_sales_dispositions").filter(d => d.appointment_id === "intro-c2" && !d.superseded_at);
    expect(shown.map(d => d.status)).toEqual(["showed"]);
    w.markKnobs.crmPatchFails = false;
    // A minute later the setter sees it was a colleague, not the lead.
    w.clock.now += 1 * MIN;
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
    await w.drain();
    await w.tick(id);
    await w.drain();
    // Today the count recorded "failed" (nothing to take back), so the show
    // the count made stays in HighLevel and in the cockpit: B2B counts a show
    // for a lead who never came.
    expect(w.hl.get("intro-c2")).toBe("confirmed");
    const after = w.db.t("cockpit_sales_dispositions").filter(d => d.appointment_id === "intro-c2" && !d.superseded_at);
    expect(after.map(d => d.status)).not.toContain("showed");
  });
});

// ---------------------------------------------------------------------------
// 4. A standby room the worker could not make, then Available again
// ---------------------------------------------------------------------------

describe("chaos2: a failed standby room", () => {
  test("standby-failed-reads-as-flood: Google fails the standby room; the setter presses Available again two minutes later: the answer must not say the room 'closed under 10 minutes ago'", async () => {
    const start = Date.parse("2026-10-04T08:00:00Z"); // Sunday 11:00 Kuwait, inside live hours
    const w = world({ start, live: { enabled: true, standby: true, hours: { days: [6, 0, 1, 2, 3, 4], from: "10:00", to: "20:00", tz: "Asia/Kuwait" } } });
    const first = await w.rooms.actions["live.availability"]!(setter, { state: "available" });
    const standby = w.db.t("cockpit_sales_rooms").find(r => r.purpose === "standby") as Row;
    expect(standby).toBeTruthy();
    expect(first.standby_error ?? null).toBeNull();
    // The worker claims it and Google answers 503: the room fails with the worker's sentence.
    Object.assign(standby, {
      state: "failed",
      result: "failed",
      error: "Google did not answer, so the Meet room was not made. Try again in a minute.",
      ended_at: w.db.iso(),
      version: Number(standby.version) + 2,
    });
    w.clock.now += 2 * MIN;
    const again = await w.rooms.actions["live.availability"]!(setter, { state: "available" });
    // Today: the failed room is the same ten minutes' standby room, so the
    // answer is the flood sentence, about a room the rep never closed.
    expect(again.standby_error).not.toBe(ROOMS_COPY.standby_flood);
  });
});

// ---------------------------------------------------------------------------
// 5. Answers lost after the write landed: the audit row
// ---------------------------------------------------------------------------

describe("chaos2: a manager's wave press whose answer was lost", () => {
  function agentWorld() {
    const w = fakeWorld(Date.parse("2026-10-04T08:00:00Z"));
    const audits: Row[] = [];
    w.db.seed("cockpit_sales_settings", [
      { key: "followups", value: { enabled: true, waves: { per_day: 40, holdout_share: 0.1 } } },
      { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" } },
    ]);
    let loseNext: ((path: string, init: Row) => boolean) | null = null;
    const io: LiveIO = {
      ...w.io,
      db: async (path, init = {}) => {
        const out = await w.io.db(path, init);
        if (loseNext && loseNext(path, init as Row)) {
          loseNext = null;
          throw new DbError("database: no answer within 8 s", 0);
        }
        return out;
      },
    };
    const agent = makeFollowupAgent({
      io,
      audit: async (who, action, _t, id, before, after) => {
        audits.push({ who: who.email, action, id, before, after });
      },
      sendFollowup: async () => ({ followup: { status: "sent" }, message: { state: "sent" } }),
      whatsappHealth: async () => ({ paused: false, why: "" }),
    });
    return { ...w, agent, audits, lose: (f: typeof loseNext) => (loseNext = f) };
  }

  test("wave-press-lost-answer-no-audit: Start a wave lands and its answer is lost; the manager presses again: the wave that messages the backlog has its start audit row", async () => {
    const w = agentWorld();
    w.lose((p, i) => p === "cockpit_sales_followup_waves" && i.method === "POST");
    const first = await outcome(w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "no_show_cancelled" }));
    expect(first.ok).toBe(false);
    const again = await outcome(w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "no_show_cancelled" }));
    expect(again.ok).toBe(true);
    const waves = w.db.t("cockpit_sales_followup_waves");
    expect(waves).toHaveLength(1);
    expect(waves[0]?.state).toBe("running");
    expect(w.audits.filter(a => a.action === "followup.wave.start")).toHaveLength(1);
  });

  test("wave-press-lost-answer-no-audit (stop): Stop lands and its answer is lost; the manager presses again: the stop has its audit row", async () => {
    const w = agentWorld();
    const started = await w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "no_show_cancelled" });
    const waveId = String((started.wave as Row).id);
    w.lose((p, i) => p.startsWith(`cockpit_sales_followup_waves?id=eq.${waveId}&state=`) && i.method === "PATCH");
    const first = await outcome(w.agent.actions["followup.wave"]!(boss, { op: "stop", wave_id: waveId }));
    expect(first.ok).toBe(false);
    const again = await outcome(w.agent.actions["followup.wave"]!(boss, { op: "stop", wave_id: waveId }));
    expect(again.ok).toBe(true);
    expect(w.db.t("cockpit_sales_followup_waves")[0]?.state).toBe("done");
    expect(w.audits.filter(a => a.action === "followup.wave.stop")).toHaveLength(1);
  });
});

describe("chaos2: a room press whose answer was lost", () => {
  test("room-press-lost-answer-no-audit: End room lands and its answer is lost; the rep's retry: the end has its audit row and its timeline line", async () => {
    const w = world();
    const id = await w.make({ purpose: "manual" });
    await w.workerOpens(id);
    const v = Number(w.room(id).version);
    let lost = false;
    w.setAround(async (path, init, real) => {
      const out = await real();
      if (!lost && String(init.method) === "PATCH" && path.startsWith(`cockpit_sales_rooms?id=eq.${id}&`) && (init.body as Row | undefined)?.state === "cancelled") {
        lost = true;
        throw new DbError("database: no answer within 8 s", 0);
      }
      return out;
    });
    const first = await outcome(w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "cancel" }));
    expect(lost).toBe(true);
    expect(first.ok).toBe(false);
    const second = await outcome(w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "cancel" }));
    expect(w.room(id).state).toBe("cancelled");
    // The retry is answered as the room stands (no error for a press that did what it asked).
    expect(second.ok).toBe(true);
    expect(w.audits.filter(a => a.action === "room.end" && a.entityId === id)).toHaveLength(1);
    expect(w.db.t("cockpit_sales_room_events").filter(e => e.room_id === id && e.kind === "room.end")).toHaveLength(1);
  });
});

describe("chaos2: a hand mark whose answer was lost", () => {
  test("room-press-lost-answer-no-audit (mark): I'm in lands and its answer is lost; the rep's retry: the mark has its audit row and its timeline line", async () => {
    const w = world();
    const id = await w.make({ purpose: "manual" });
    await w.workerOpens(id);
    const v = Number(w.room(id).version);
    let lost = false;
    w.setAround(async (path, init, real) => {
      const out = await real();
      if (!lost && String(init.method) === "PATCH" && path.startsWith(`cockpit_sales_rooms?id=eq.${id}&`) && (init.body as Row | undefined)?.state === "host_in") {
        lost = true;
        throw new DbError("database: no answer within 8 s", 0);
      }
      return out;
    });
    const first = await outcome(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "host_in" }));
    expect(lost).toBe(true);
    expect(first.ok).toBe(false);
    const second = await outcome(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "host_in" }));
    await w.drain();
    expect(w.room(id).state).toBe("host_in");
    expect(second.ok).toBe(true);
    expect(w.audits.filter(a => a.action === "room.mark.host_in" && a.entityId === id)).toHaveLength(1);
    expect(w.db.t("cockpit_sales_room_events").filter(e => e.room_id === id && e.kind === "room.mark.host_in")).toHaveLength(1);
  });
});
