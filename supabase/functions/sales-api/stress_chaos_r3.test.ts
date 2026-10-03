// bun test supabase/functions/sales-api/stress_chaos_r3.test.ts
//
// Chaos round 3 (3 October 2026), sales-api's side: what the room and the
// intro are left with when an outside dependency fails half-way, an answer is
// lost after a write landed, or the function is killed between two lines.
// The bar the CEO set: every room ends in a named state, nothing is sent or
// booked twice, nothing is recorded as done that was not, and a person is
// told what to do.
//
// The message service here is the faithful model of index.ts convoSend and
// sendTemplate from stress_chaos_rooms.test.ts, plus the lead's WhatsApp
// conversation as HighLevel shows it (`convo`): every outbound WhatsApp that
// reached HighLevel is in it, a Meta-failed one with status "failed", and
// sentSince reads it with the real matchSent (sendrules.ts), exactly as
// index.ts whatsappSentSince does.
//
// Tests marked HELD pass today and stay as regression tests. The others state
// the behaviour asked for and fail until it is fixed.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, DbError, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, SETTLE_NOTE, type RoomDeps } from "./rooms.ts";
import { matchSent, type SeenMessage } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const LEAD = "stress-chaos-r3-lead";
const SETTER = "setter@maharamedia.com";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

/**
 * ok: sent. meta_failed: HighLevel took it and Meta failed it (the
 * conversation shows it failed; the row says failed). lost_not_sent: the
 * answer was lost and nothing went (a 5xx from a gateway, the enrolment never
 * reached HighLevel): the row says unclear. kill_after_sent: it went and the
 * row says sent, then the function was killed (a deploy) before rooms.ts got
 * the answer: the promise never settles.
 */
type Mode = "ok" | "meta_failed" | "lost_not_sent" | "kill_after_sent" | "refused_429";
type Lane = "text" | "template" | "email";

const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function world(o: { inboundAgoMs?: number } = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  const rows = new Map<string, Row>();
  const delivered: Row[] = [];
  const convo: (SeenMessage & { at: string })[] = [];
  const modes: Record<Lane, Mode[]> = { text: [], template: [], email: [] };
  const jobs: Promise<unknown>[] = [];
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
  w.db.seed("cockpit_sales_inbox", [
    { conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - (o.inboundAgoMs ?? HOUR)).toISOString() },
  ]);
  w.db.seed("cockpit_sales_wa_templates", [
    { key: "call_link_ar", active: true, workflow_id: "wf-call-link" },
    { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" },
  ]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" };
  w.routes.push((m, p) => (m === "GET" && p === `/contacts/${LEAD}` ? { contact } : (null as unknown as Row)));

  const io: LiveIO = {
    ...w.io,
    background: p => {
      jobs.push(p.catch(e => w.logs.push(`background: ${String((e as Error)?.message ?? e)}`)));
    },
  };
  async function drain(): Promise<void> {
    for (let i = 0; i < 6; i++) await Promise.race([Promise.allSettled(jobs.slice()), realSleep(40)]);
  }
  const at = () => new Date(w.clock.now).toISOString();

  /** convoSend / sendTemplate as index.ts writes them: the row first, then HighLevel, then the row's outcome. */
  async function send(lane: Lane, requestId: string, channel: "whatsapp" | "email", body: string, extra: Row): Promise<{ message: Row; repeated?: boolean }> {
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, channel, body, state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
    // The same row in cockpit_sales_messages, as index.ts writes it (the
    // room's link re-ask reads its earlier sends there).
    w.db.t("cockpit_sales_messages").push(row);
    const mode = modes[lane].shift() ?? "ok";
    if (mode === "lost_not_sent") {
      row.state = "unclear";
      row.error = "HighLevel did not answer: no answer within 25 s";
      throw new ApiRefusal("It may have gone: HighLevel did not answer in time. Check the conversation before sending again. (no answer within 25 s)", 502, { unclear: true });
    }
    if (mode === "refused_429") {
      row.state = "failed";
      row.error = "HighLevel said 429: Too many requests";
      // index.ts marks HighLevel's outright refusal certain (fix round 3).
      throw new ApiRefusal("HighLevel did not send it: HighLevel said 429: Too many requests", 502, { certain: true });
    }
    if (mode === "meta_failed") {
      if (channel === "whatsapp") convo.push({ id: fakeUuid(), direction: "outbound", channel: "whatsapp", body, at: at(), status: "failed" });
      row.state = "failed";
      row.error = "Meta did not deliver it: re-engagement message";
      row.provider_status = "failed";
      return { message: { ...row } };
    }
    delivered.push({ lane, requestId, body });
    if (channel === "whatsapp") convo.push({ id: fakeUuid(), direction: "outbound", channel: "whatsapp", body, at: at(), status: "delivered" });
    row.state = "sent";
    row.provider_status = lane === "template" ? "delivered" : "sent";
    if (mode === "kill_after_sent") return await new Promise<never>(() => undefined);
    return { message: { ...row } };
  }

  const deps: RoomDeps = {
    io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({}),
    sendText: (_who, b) => send(b.channel === "email" ? "email" : "text", b.request_id, b.channel, b.body, {}),
    sendTemplate: (_who, t) =>
      send("template", t.requestId, "whatsapp", `Your Mahara call is ready. Join here: https://call.maharamedia.com/${t.buttonVariable?.join_code ?? ""}`, {
        template_key: t.key,
        via: "workflow",
      }),
    upcoming: async () => null,
    // index.ts: Boolean((await whatsappSentSince(contactId, since, text)).hit), with the real matchSent.
    sentSince: async (_contactId, since, text) => Boolean(matchSent(convo, since, text)),
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  const whatsappDelivered = () => delivered.filter(d => d.lane === "text" || d.lane === "template");

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
    const cur = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: MEET_URL,
        provider_meeting_id: `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(cur.version) + 1,
      },
    });
  }
  async function make(): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
    });
    return String((out.room as Row).id);
  }
  const readyEvent = (id: string) => rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
  const tick = (id: string) => rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
  /** The next database call matching `match` fails before it lands (a database blip). */
  function failOnce(match: (method: string, path: string, body: unknown) => boolean) {
    const real = w.db.db.bind(w.db);
    let armed = true;
    w.db.db = async (path, init = {}) => {
      if (armed && match(init.method ?? "GET", path, init.body)) {
        armed = false;
        throw new DbError("database: no answer within 8 s", 0);
      }
      return await real(path, init);
    };
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
  return { ...w, io, rooms, audits, rows, delivered, convo, modes, room, whatsappDelivered, workerOpens, make, readyEvent, tick, drain, failOnce, loseAnswer };
}

// ---------------------------------------------------------------------------
// "It may have gone": the conversation is read for it, and only it counts
// ---------------------------------------------------------------------------

describe("chaos r3: a link that may have gone is checked against the conversation", () => {
  test("Meta fails the free WhatsApp text, then the template's enrolment answer is lost and nothing went: the room must not say the link was sent", async () => {
    const w = world();
    const id = await w.make();
    await w.workerOpens(id);
    // The text reaches HighLevel and Meta refuses it (the conversation shows
    // it failed); six seconds later the template's enrolment gets no answer,
    // and it never reached HighLevel.
    w.modes.text.push("meta_failed");
    w.modes.template.push("lost_not_sent");
    await w.readyEvent(id);
    await w.drain();
    expect(w.whatsappDelivered()).toEqual([]);
    // matchSent reads a template's send with no words, so the failed text from
    // six seconds before counts as "the template went": link_sent_at is set,
    // the lead's ten minutes start, and the panel says the link went.
    const r = w.room(id);
    expect(r.link_sent_at ?? null).toBeNull();
    expect((r.link_channels as string[]) ?? []).not.toContain("whatsapp_template");
  });

  test("the template's enrolment answer is lost and nothing went; a minute later the setter writes 'Are you free now?' on WhatsApp: the re-ask must not record that as the link", async () => {
    // The lead last wrote 30 hours ago: no free text, the template first.
    const w = world({ inboundAgoMs: 30 * HOUR });
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.template.push("lost_not_sent");
    await w.readyEvent(id);
    await w.drain();
    expect(w.room(id).link_sent_at ?? null).toBeNull();
    expect(String(w.room(id).refusal ?? "")).toMatch(/may have gone/i);
    // The panel tells the setter to check the conversation: they see nothing
    // there and write to the lead by hand.
    w.clock.now += 30 * S;
    w.convo.push({ id: fakeUuid(), direction: "outbound", channel: "whatsapp", body: "Hi Huda, are you free for a quick call now?", at: new Date(w.clock.now).toISOString(), status: "delivered" });
    w.clock.now += 40 * S;
    await w.tick(id);
    await w.drain();
    // The template never went: the room must still say so, never "Link sent on WhatsApp".
    expect(w.room(id).link_sent_at ?? null).toBeNull();
    expect(w.audits.filter(a => a.action === "room.link" && (a.after as Row)?.confirmed_from_conversation === true)).toEqual([]);
  });

  test("HELD: the template went and its answer was lost: the conversation shows it, so the re-ask records it as sent and nothing else goes", async () => {
    const w = world({ inboundAgoMs: 30 * HOUR });
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.template.push("lost_not_sent");
    await w.readyEvent(id);
    await w.drain();
    // It did go after all: the workflow ran behind the lost answer.
    w.convo.push({
      id: fakeUuid(),
      direction: "outbound",
      channel: "whatsapp",
      body: `Your Mahara call is ready. Join here: https://call.maharamedia.com/${String(w.room(id).code)}`,
      at: new Date(w.clock.now + 3 * S).toISOString(),
      status: "delivered",
    });
    w.clock.now += 70 * S;
    await w.tick(id);
    await w.drain();
    expect(w.room(id).link_sent_at).toBeTruthy();
    expect(w.delivered.filter(d => d.lane === "email")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The re-ask after a send that went: it resumes, never plans afresh
// ---------------------------------------------------------------------------

describe("chaos r3: the link's re-ask after a send that went", () => {
  test("the WhatsApp text goes, then the record of it fails (a database blip) and the lead's 24 hours close before the re-ask: no second WhatsApp", async () => {
    // The lead last wrote 23 hours 59 minutes 30 seconds ago: the free text
    // goes now, and a minute later only the template would.
    const w = world({ inboundAgoMs: 24 * HOUR - 30 * S });
    const id = await w.make();
    await w.workerOpens(id);
    // The text is sent; the write of link_sent_at gets no answer and did not land.
    w.failOnce((m, p, b) => m === "PATCH" && p.startsWith("cockpit_sales_rooms?") && Boolean((b as Row | undefined)?.link_sent_at));
    await w.readyEvent(id);
    await w.drain();
    expect(w.whatsappDelivered().length).toBe(1);
    expect(w.room(id).link_sent_at ?? null).toBeNull();
    // The sweep's tick, a minute later: the text's own row says sent, but the
    // re-ask plans the channels afresh from the lead's window, now closed.
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    expect(w.whatsappDelivered().length).toBe(1);
    expect(w.room(id).link_sent_at).toBeTruthy();
  });

  test("a deploy kills the send right after HighLevel took the text, and the lead's 24 hours close before the re-ask: no second WhatsApp", async () => {
    const w = world({ inboundAgoMs: 24 * HOUR - 30 * S });
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.text.push("kill_after_sent");
    await w.readyEvent(id);
    await w.drain();
    expect(w.whatsappDelivered().length).toBe(1);
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    expect(w.whatsappDelivered().length).toBe(1);
  });

  test("HELD: the text goes and the record fails, with the window still open: the re-ask records the same send, nothing else goes", async () => {
    const w = world();
    const id = await w.make();
    await w.workerOpens(id);
    w.failOnce((m, p, b) => m === "PATCH" && p.startsWith("cockpit_sales_rooms?") && Boolean((b as Row | undefined)?.link_sent_at));
    await w.readyEvent(id);
    await w.drain();
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    expect(w.whatsappDelivered().length).toBe(1);
    expect(w.room(id).link_sent_at).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// A send HighLevel refused outright: certain, so it is said plainly and tried again
// ---------------------------------------------------------------------------

describe("chaos r3: a send HighLevel refused outright", () => {
  function emailOnly() {
    const w = world();
    const m = w.db.t("cockpit_sales_settings").find(r => r.key === "messaging") as Row;
    m.value = { whatsapp: false, email: true };
    return w;
  }

  test("HighLevel answers 429 to the link's email (nothing went): the panel must not say it may have gone", async () => {
    const w = emailOnly();
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.email.push("refused_429");
    await w.readyEvent(id);
    await w.drain();
    expect(w.delivered).toEqual([]);
    // convoSend throws "HighLevel did not send it" with status 502, and
    // rooms.ts unclearSend reads every 5xx as "may have gone": the setter is
    // told to check a conversation for an email that certainly never went.
    expect(String(w.room(id).refusal ?? "")).not.toMatch(/may have gone/i);
  });

  test("HighLevel answers 429 to the link's email, then recovers: the minute's re-ask, or Also send by email, sends it once", async () => {
    const w = emailOnly();
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.email.push("refused_429");
    await w.readyEvent(id);
    await w.drain();
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    // The room's email key (mahara-room/link/{room}/email) now names a failed
    // row: the re-ask and every press of Also send by email get that row back
    // ("Not sent: HighLevel did not send it"), for as long as the room lives.
    let pressed: unknown = null;
    if (!w.delivered.some(d => d.lane === "email")) {
      try {
        await w.rooms.actions["room.send"]!(setter, { room_id: id, request_id: crypto.randomUUID(), channel: "email" });
      } catch (e) {
        pressed = (e as Error).message;
      }
    }
    expect(pressed).toBeNull();
    expect(w.delivered.filter(d => d.lane === "email").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// room.wrap: the insert lands and its answer is lost
// ---------------------------------------------------------------------------

describe("chaos r3: room.wrap after a lost answer", () => {
  test("the booked room's insert lands and its answer is lost; the retry (same request id) returns the room: the room still has its room.wrap audit row", async () => {
    const w = world();
    const start = w.clock.now + 10 * MIN;
    w.db.seed("cockpit_sales_appointments", [
      { appointment_id: "intro-r3", contact_id: LEAD, call_type: "intro", start_at: new Date(start).toISOString(), status: "confirmed", assigned_user_id: "G-setter" },
    ]);
    w.routes.push((m, p) =>
      m === "GET" && p === "/calendars/events/appointments/intro-r3"
        ? {
            appointment: {
              id: "intro-r3",
              contactId: LEAD,
              startTime: new Date(start).toISOString(),
              endTime: new Date(start + 15 * MIN).toISOString(),
              address: MEET_URL,
              assignedUserId: "G-setter",
            },
          }
        : (null as unknown as Row),
    );
    const requestId = crypto.randomUUID();
    w.loseAnswer((m, p) => m === "POST" && p === "cockpit_sales_rooms");
    await expect(w.rooms.actions["room.wrap"]!(setter, { appointment_id: "intro-r3", request_id: requestId })).rejects.toThrow();
    const out = await w.rooms.actions["room.wrap"]!(setter, { appointment_id: "intro-r3", request_id: requestId });
    const id = String((out.room as Row).id);
    expect(w.db.t("cockpit_sales_rooms").filter(r => r.appointment_id === "intro-r3")).toHaveLength(1);
    // Every write leaves an audit row: the retry answers the room and never writes the wrap's.
    expect(w.audits.filter(a => a.action === "room.wrap" && a.entityId === id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// worker.failed for a room that went another way
// ---------------------------------------------------------------------------

describe("chaos r3: worker.failed for a room the rep cancelled", () => {
  test("the setter cancels while Zoom refuses the meeting, and the worker dies before it closes its own worker.failed: room.event finishes it, never leaves it to be given up as a lost event", async () => {
    const w = world();
    const id = await w.make();
    // The worker claimed it; the setter pressed Cancel during creating.
    const r = w.room(id);
    Object.assign(r, { state: "cancelled", result: "cancelled", end_reason: "cancel", ended_at: w.db.iso(), version: Number(r.version) + 2 });
    // Zoom refused the meeting: the worker stored worker.failed, its fail
    // write missed (the room is cancelled), and it was killed before
    // close_event (or the lease call hit a database blip).
    w.db.seed("cockpit_sales_room_events", [
      {
        id: fakeUuid(),
        room_id: id,
        kind: "worker.failed",
        source: "worker",
        dedupe_key: `worker.failed:${id}`,
        handled_at: null,
        text: "The room could not be made: Zoom refused the meeting.",
        detail: { error: "Zoom refused the meeting.", worker_run: "run-1" },
      },
    ]);
    const ev = () => w.db.t("cockpit_sales_room_events").find(e => e.dedupe_key === `worker.failed:${id}`) as Row;
    // The sweep replays it every 20 s: each time sales-api releases it,
    // because the room is not "failed", and it never can be. After ten tries
    // E0 gives it up, and the watchdog raises "the room worker's word was
    // never read, so the room may show the wrong state" for a room that is
    // simply cancelled.
    for (let i = 0; i < 3; i++) {
      await w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [String(ev().id)] } });
      w.clock.now += 21 * S;
    }
    expect(ev().handled_at ?? null).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The settle's no-show must reach HighLevel, or a person is told
// ---------------------------------------------------------------------------

function settleWorld(o: { linkNeverWent?: string } = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  /** HighLevel's appointment status writes (what B2B's show rate reads). */
  const ghlStatus: Row[] = [];
  const hang = { on: false };
  /** How index.ts markAppointment's HighLevel half ends: written, or failed (crm failed). */
  const crm = { mode: "written" as "written" | "failed" };
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false, short_link: true, providers: { zoom: true, meet: true } } },
    { key: "live", value: { enabled: false } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: null, zoom_status: "pending", google_ok: true }]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" };
  w.routes.push((m, p) => (m === "GET" && p === `/contacts/${LEAD}` ? { contact } : (null as unknown as Row)));
  const start = w.clock.now - 25 * MIN;
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: "appt-r3",
      contact_id: LEAD,
      calendar_id: "cal-intro",
      call_type: "intro",
      start_at: new Date(start).toISOString(),
      status: "confirmed",
      assigned_user_id: "G-setter",
    },
  ]);
  const roomId = fakeUuid();
  // The Meet fallback room for the setter's own intro: the short link went
  // and was never opened, and the room expired with nobody in it.
  w.db.seed("cockpit_sales_rooms", [
    {
      id: roomId,
      request_id: fakeUuid(),
      code: "R3SETL",
      contact_id: LEAD,
      purpose: "fallback",
      call_kind: "intro",
      provider: "meet",
      host_email: SETTER,
      made_by: SETTER,
      state: "expired",
      result: "no_join",
      end_reason: "lead_no_show",
      version: 4,
      join_url: MEET_URL,
      appointment_id: "appt-r3",
      appointment_start_at: new Date(start).toISOString(),
      requested_at: new Date(start + MIN).toISOString(),
      opened_at: new Date(start + MIN).toISOString(),
      ...(o.linkNeverWent
        ? { link_claimed_at: new Date(start + MIN).toISOString(), link_channels: [], refusal: o.linkNeverWent }
        : { link_sent_at: new Date(start + 2 * MIN).toISOString(), link_channels: ["whatsapp_text"] }),
      ended_at: new Date(start + 13 * MIN).toISOString(),
    },
  ]);
  w.db.seed("cockpit_sales_room_events", [
    {
      id: fakeUuid(),
      room_id: roomId,
      kind: "sweep.settle",
      source: "settle",
      dedupe_key: `sweep.settle:${roomId}`,
      at: new Date(w.clock.now - MIN).toISOString(),
      handled_at: null,
      tries: 0,
      detail: { appointment_id: "appt-r3" },
    },
  ]);
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    // index.ts markAppointment: the disposition row first (crm pending), then
    // writeMarkToCrm, which records crm written, or failed when HighLevel did
    // not take it, and returns normally either way.
    markAppointment: async (who, id, status, opts) => {
      const current = w.db.t("cockpit_sales_dispositions").find(d => d.appointment_id === id && !d.superseded_at);
      if (opts.onlyIfUnmarked && current && !(current.status === status && current.marked_by === who.email))
        throw new ApiRefusal("This call was already marked, so the timer left it as it is.", 409, { code: "marked" });
      if (current && current.status === status && current.crm !== "failed") return { ...current, repeated: true };
      if (current) current.superseded_at = new Date(w.clock.now).toISOString();
      const row: Row = { id: fakeUuid(), appointment_id: id, status, note: opts.note ?? null, marked_by: who.email, crm: "pending" };
      w.db.t("cockpit_sales_dispositions").push(row);
      if (hang.on) return await new Promise<never>(() => undefined); // a deploy kills it before HighLevel is written
      if (crm.mode === "failed") {
        row.crm = "failed";
        row.crm_error = "HighLevel said 503: Service Unavailable";
        return { ...row };
      }
      ghlStatus.push({ id, status });
      row.crm = "quiet";
      return { ...row };
    },
    sendText: async () => ({ message: { state: "sent" } }),
    sendTemplate: async () => ({ message: { state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const settle = () => rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [roomId] } });
  const room = () => w.db.t("cockpit_sales_rooms").find(r => r.id === roomId) as Row;
  const event = () => w.db.t("cockpit_sales_room_events").find(e => e.dedupe_key === `sweep.settle:${roomId}`) as Row;
  const alerts = () => w.db.t("cockpit_sales_alerts").filter(a => String(a.dedupe_key).startsWith(`room:${roomId}`));
  return { ...w, rooms, audits, ghlStatus, hang, crm, roomId, settle, room, event, alerts };
}

describe("chaos r3: the settle's no-show and HighLevel", () => {
  test("HELD: HighLevel takes the no-show: the room is settled and HighLevel says noshow", async () => {
    const w = settleWorld();
    await w.settle();
    expect(w.ghlStatus).toEqual([{ id: "appt-r3", status: "noshow" }]);
    expect(w.room().settled_mark).toBe("noshow");
  });

  test("HighLevel answers 503 while the settle writes the no-show: the intro stays 'confirmed' there (a show for B2B), so the settle must try again or tell a person", async () => {
    const w = settleWorld();
    w.crm.mode = "failed";
    await w.settle();
    await w.flush();
    // markAppointment kept the cockpit's mark with crm failed and answered
    // normally; the settle took that as done: settled_mark noshow, the event
    // handled, and no alert. HighLevel still says confirmed.
    expect(w.ghlStatus).toEqual([]);
    const retried = !w.event().handled_at;
    const told = w.alerts().some(a => a.kind === "room_mark_intro" && !a.resolved_at);
    expect(retried || told).toBe(true);
  });

  test("a deploy kills the settle between the cockpit's no-show and HighLevel's: the replay finds its own mark and must still get it to HighLevel (or tell a person)", async () => {
    const w = settleWorld();
    w.hang.on = true;
    void w.settle(); // the isolate dies inside markAppointment, after the disposition row (crm pending)
    await realSleep(30);
    expect(w.db.t("cockpit_sales_dispositions").map(d => d.crm)).toEqual(["pending"]);
    // The lease runs out; the sweep posts the settle again.
    w.hang.on = false;
    w.clock.now += 31 * S;
    await w.settle();
    await w.flush();
    // The replay sees "the timer's own no-show from an earlier try" and calls
    // the room settled: HighLevel was never written, the mark stays "sending
    // to HighLevel" for ever (mark.retry refuses a pending mark), and nobody is told.
    const told = w.alerts().some(a => a.kind === "room_mark_intro" && !a.resolved_at);
    expect(w.ghlStatus.length > 0 || told).toBe(true);
  });
  test("fix round 3: a no-show still on its way to HighLevel (pending for under two minutes) is asked again later; once it is stuck, a person is told", async () => {
    const w = settleWorld();
    w.hang.on = true;
    void w.settle();
    await realSleep(30);
    const d = w.db.t("cockpit_sales_dispositions")[0] as Row;
    d.marked_at = new Date(w.clock.now).toISOString();
    w.hang.on = false;
    w.clock.now += 31 * S;
    await w.settle();
    await w.flush();
    // Under two minutes old: it may yet land, so the settle is released, nobody is told yet.
    expect(w.event().handled_at ?? null).toBeNull();
    expect(w.alerts().filter(a => a.kind === "room_mark_intro")).toHaveLength(0);
    w.clock.now += 3 * MIN;
    await w.settle();
    await w.flush();
    expect(w.alerts().some(a => a.kind === "room_mark_intro" && !a.resolved_at)).toBe(true);
    expect(w.room().settled_mark).toBe("none");
  });

  test("the link never reached the lead (HighLevel down: 'may have gone', never confirmed) and the room expired: the intro must not be marked a no-show by the timer", async () => {
    const w = settleWorld({ linkNeverWent: "The link may have gone on WhatsApp. Check the conversation before sending it again, or read it out." });
    await w.settle();
    await w.flush();
    // noShowDoubt reads "the short link was never opened" as evidence nobody
    // came, but the lead never had the short link: the no-show is a hard
    // number in B2B's show rate, so a person decides.
    expect(w.ghlStatus.filter(g => g.status === "noshow")).toEqual([]);
    expect(w.room().settled_mark).toBe("none");
    expect(w.alerts().some(a => a.kind === "room_mark_intro")).toBe(true);
  });

  test("the link went on no channel at all (every channel refused) and the room expired: the intro must not be marked a no-show by the timer", async () => {
    const w = settleWorld({ linkNeverWent: "The link did not go on any channel (HighLevel did not send it: HighLevel said 429: Too many requests)." });
    await w.settle();
    await w.flush();
    expect(w.ghlStatus.filter(g => g.status === "noshow")).toEqual([]);
  });
});

// Keep SETTLE_NOTE imported: the settle's own mark is told by it.
void SETTLE_NOTE;
