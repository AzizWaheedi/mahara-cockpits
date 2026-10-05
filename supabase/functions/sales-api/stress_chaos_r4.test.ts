// bun test supabase/functions/sales-api/stress_chaos_r4.test.ts
//
// Chaos round 4 (3 October 2026), sales-api's side. Every outside
// dependency failing or hanging at a step, answers lost after a write
// landed, the function killed between two lines, the room worker down. The
// bar the CEO set: every room ends in a named state, nothing is sent or
// booked twice, nothing is recorded as done that was not, and the rep is told
// what to do.
//
// The message service is the faithful model of index.ts convoSend and
// sendTemplate used by stress_chaos_r3.test.ts: the message row first (the
// request id is unique, so a repeat answers the row as it stands), then
// HighLevel, then the row's outcome. A template whose read-back did not see
// it within rooms.waits_s.unconfirmed is stored as index.ts stores it: state
// "sent", provider_status "enrolled" (HighLevel took the enrolment; whether
// Meta delivered it is not known).
//
// Tests marked HELD pass today and stay as regression tests. The others state
// the behaviour asked for and fail until it is fixed.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, NOT_MAKING_PREFIX, roomsHealth } from "./roomlogic.ts";
import { makeRooms, SETTLE_NOTE, type RoomDeps } from "./rooms.ts";
import { matchSent, type SeenMessage } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const LEAD = "stress-chaos-r4-lead";
const SETTER = "setter@maharamedia.com";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

/**
 * ok: sent and delivered. unseen: HighLevel took the template's enrolment,
 * and the 20 s read-back never saw it (Meta slow or failing): the row says
 * sent / enrolled and nothing reached the lead. unseen_kill: the same, then
 * the function is killed (a deploy, the wall-clock limit) before rooms.ts
 * gets the answer. refused_429: HighLevel refused outright (certain).
 * lost_not_sent: the answer was lost and nothing went (unclear).
 */
type Mode = "ok" | "unseen" | "unseen_kill" | "refused_429" | "lost_not_sent" | "stalled";
type Lane = "text" | "template" | "email";

const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function world(o: { inboundAgoMs?: number; introStartIn?: number } = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  const rows = new Map<string, Row>();
  const delivered: Row[] = [];
  const convo: (SeenMessage & { at: string })[] = [];
  const modes: Record<Lane, Mode[]> = { text: [], template: [], email: [] };
  /** Held while index.ts sendTemplate reads its setup before the message row is written (a slow database). */
  const gate: { template: Promise<void> | null } = { template: null };
  const jobs: Promise<unknown>[] = [];
  /** HighLevel's appointment status writes (what B2B's show rate reads). */
  const ghlStatus: Row[] = [];
  /**
   * HighLevel's side of a template (index.ts sendTemplate): the room code is
   * written to the contact's join field, then the contact is enrolled in the
   * call_link workflow, which reads the field when it runs. `queue` holds
   * enrolments HighLevel accepted and has not run yet (its workflows
   * delayed: mode "stalled").
   */
  const hl = { join: "" as string, queue: [] as { requestId: string }[] };
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
  // The room worker reported a few seconds ago (the health line is green).
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: new Date(w.clock.now - 5 * S).toISOString() }]);
  w.db.seed("cockpit_sales_inbox", [
    { conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - (o.inboundAgoMs ?? HOUR)).toISOString() },
  ]);
  w.db.seed("cockpit_sales_wa_templates", [
    { key: "call_link_ar", active: true, workflow_id: "wf-call-link" },
    { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" },
  ]);
  // The setter's own intro with this lead, a few minutes ahead (the fallback room is its room).
  const introStart = w.clock.now + (o.introStartIn ?? 5 * MIN);
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: "appt-r4",
      contact_id: LEAD,
      calendar_id: "cal-intro",
      call_type: "intro",
      start_at: new Date(introStart).toISOString(),
      status: "confirmed",
      assigned_user_id: "G-setter",
    },
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
    for (let i = 0; i < 8; i++) {
      // A macrotask first, so a press's background job is registered before it is waited for.
      await realSleep(1);
      await Promise.race([Promise.allSettled(jobs.slice()), realSleep(40)]);
    }
  }
  const at = () => new Date(w.clock.now).toISOString();

  async function send(lane: Lane, requestId: string, channel: "whatsapp" | "email", body: string, extra: Row): Promise<{ message: Row; repeated?: boolean }> {
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, channel, body, state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
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
      throw new ApiRefusal("HighLevel did not send it: HighLevel said 429: Too many requests", 502, { certain: true });
    }
    if (mode === "stalled") {
      // HighLevel took the enrolment; its workflow has not run yet, so the
      // 20 s read-back saw nothing.
      hl.queue.push({ requestId });
      row.state = "sent";
      row.provider_status = "enrolled";
      return { message: { ...row } };
    }
    if (mode === "unseen" || mode === "unseen_kill") {
      // HighLevel took the enrolment; the read-back saw nothing in 20 s.
      row.state = "sent";
      row.provider_status = "enrolled";
      if (mode === "unseen_kill") return await new Promise<never>(() => undefined);
      return { message: { ...row } };
    }
    delivered.push({ lane, requestId, body });
    if (channel === "whatsapp") convo.push({ id: fakeUuid(), direction: "outbound", channel: "whatsapp", body, at: at(), status: "delivered" });
    row.state = "sent";
    row.provider_status = lane === "template" ? "delivered" : "sent";
    return { message: { ...row } };
  }

  const deps: RoomDeps = {
    io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async (who, id, status, opts) => {
      const current = w.db.t("cockpit_sales_dispositions").find(d => d.appointment_id === id && !d.superseded_at);
      if (opts.onlyIfUnmarked && current && !(current.status === status && current.marked_by === who.email))
        throw new ApiRefusal("This call was already marked, so the timer left it as it is.", 409, { code: "marked" });
      const row: Row = { id: fakeUuid(), appointment_id: id, status, note: opts.note ?? null, marked_by: who.email, crm: "quiet" };
      w.db.t("cockpit_sales_dispositions").push(row);
      ghlStatus.push({ id, status });
      return { ...row };
    },
    // The rows carry the lead, as index.ts stores them.
    sendText: (_who, b) => send(b.channel === "email" ? "email" : "text", b.request_id, b.channel, b.body, { contact_id: b.contact_id }),
    sendTemplate: async (_who, t) => {
      if (gate.template) await gate.template;
      if (!rows.has(t.requestId)) hl.join = t.buttonVariable?.join_code ?? "";
      return await send("template", t.requestId, "whatsapp", `Your Mahara call is ready. Join here: https://call.maharamedia.com/${t.buttonVariable?.join_code ?? ""}`, {
        template_key: t.key,
        via: "workflow",
        contact_id: t.contactId,
      });
    },
    upcoming: async () => null,
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
  /** The setter's fallback room for their own intro, on Meet. */
  async function make(): Promise<string> {
    // The room worker is up: it reports every run (the health line is green).
    const st = w.db.t("cockpit_sales_worker_status").find(x => x.job === "rooms");
    if (st) st.at = new Date(w.clock.now - 5 * S).toISOString();
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      appointment_id: "appt-r4",
    });
    return String((out.room as Row).id);
  }
  const readyEvent = (id: string) => rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
  const tick = (id: string) => rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });

  /** The SQL sweep's R4 at the lead's deadline: nobody opened the link, nobody pressed The lead is in. */
  function sweepExpires(id: string) {
    const r = room(id);
    Object.assign(r, {
      state: "expired",
      result: "no_join",
      end_reason: "lead_no_show",
      ended_at: w.db.iso(),
      version: Number(r.version) + 1,
    });
  }
  /** The sweep's S1 queues the settle and the tick posts it as sweep.settle (start + settle has passed). */
  async function settle(id: string) {
    w.db.seed("cockpit_sales_room_events", [
      {
        id: fakeUuid(),
        room_id: id,
        kind: "sweep.settle",
        source: "settle",
        dedupe_key: `sweep.settle:${id}`,
        at: w.db.iso(),
        handled_at: null,
        tries: 0,
        detail: { appointment_id: "appt-r4" },
      },
    ]);
    return await rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
  }
  /** HighLevel's workflows run again: every enrolment still queued sends the template with the join field as it is now. */
  function highLevelCatchesUp() {
    for (const q of hl.queue.splice(0)) {
      const body = `Your Mahara call is ready. Join here: https://call.maharamedia.com/${hl.join}`;
      delivered.push({ lane: "template", requestId: q.requestId, body });
      convo.push({ id: fakeUuid(), direction: "outbound", channel: "whatsapp", body, at: at(), status: "delivered" });
    }
  }
  return { ...w, io, rooms, audits, rows, delivered, convo, modes, gate, ghlStatus, hl, room, whatsappDelivered, workerOpens, make, readyEvent, tick, drain, sweepExpires, settle, highLevelCatchesUp };
}

// ---------------------------------------------------------------------------
// A template Meta has not delivered (unseen) is not a sure send
// ---------------------------------------------------------------------------

describe("chaos r4: the WhatsApp template nobody saw", () => {
  test("HELD: the template is unseen and the backup email goes: the room says not confirmed", async () => {
    const w = world({ inboundAgoMs: 30 * HOUR }); // the 24-hour window is shut: the template leads, email backs it up
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.template = ["unseen"];
    await w.readyEvent(id);
    await w.drain();
    expect(w.delivered.map(d => d.lane)).toEqual(["email"]);
    expect(w.room(id).link_unconfirmed_at ?? null).not.toBeNull();
  });

  test("Meta sits on the template (unseen) and HighLevel refuses the backup email (429): the room must not read as a sure send", async () => {
    const w = world({ inboundAgoMs: 30 * HOUR });
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.template = ["unseen"];
    w.modes.email = ["refused_429"];
    await w.readyEvent(id);
    await w.drain();
    // Nothing reached the lead: the template is unseen and the email was refused.
    expect(w.delivered).toEqual([]);
    const r = w.room(id);
    // Today: link_sent_at is set, link_channels says WhatsApp, and
    // link_unconfirmed_at stays null, so the panel says "Link sent on
    // WhatsApp" (roomMoment "sent") with nothing to check. "Not confirmed"
    // reads link_unconfirmed_at only (contract v2 section 3).
    expect(r.link_sent_at ?? null).not.toBeNull();
    expect(r.link_unconfirmed_at ?? null).not.toBeNull();
  });

  test("a deploy kills the send after HighLevel took the template's enrolment (unseen) and before the email backup: the minute's re-ask must still back it up by email", async () => {
    const w = world({ inboundAgoMs: 30 * HOUR });
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.template = ["unseen_kill"];
    void w.readyEvent(id);
    await w.drain();
    // The isolate died with the template's row saying sent / enrolled: no link_sent_at yet.
    expect(w.room(id).link_sent_at ?? null).toBeNull();
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    // The re-ask finds the template's row "sent" and records it as the
    // link, with no email and no "not confirmed": the one template Meta never
    // delivered is now a sure send on the panel.
    expect(w.room(id).link_sent_at ?? null).not.toBeNull();
    expect(w.delivered.map(d => d.lane)).toContain("email");
    expect(w.room(id).link_unconfirmed_at ?? null).not.toBeNull();
  });

  test("Meta sits on the template, the email backup is refused, the room expires: the timer must not mark the booked intro a no-show", async () => {
    const w = world({ inboundAgoMs: 30 * HOUR });
    const id = await w.make();
    expect(w.room(id).appointment_id).toBe("appt-r4");
    await w.workerOpens(id);
    w.modes.template = ["unseen"];
    w.modes.email = ["refused_429"];
    await w.readyEvent(id);
    await w.drain();
    expect(w.delivered).toEqual([]);
    // Ten minutes on nobody opened the short link (the lead never had it).
    w.clock.now += 11 * MIN;
    w.sweepExpires(id);
    // The intro's start + 20 minutes.
    w.clock.now += 20 * MIN;
    await w.settle(id);
    await w.drain();
    // noShowDoubt reads "the short link went and was never opened" as
    // evidence that nobody came; the link never reached the lead.
    expect(w.ghlStatus.filter(g => g.status === "noshow")).toEqual([]);
  });
});

describe("chaos r4: HighLevel's workflows run late", () => {
  test("room A's template sits in HighLevel's delayed workflow queue; the setter makes room B for the same lead; when the queue runs, the lead must not get room B's link twice on WhatsApp", async () => {
    const w = world({ inboundAgoMs: 30 * HOUR }); // window shut: the template leads, email backs it up
    const a = await w.make();
    await w.workerOpens(a);
    w.modes.template = ["stalled"];
    await w.readyEvent(a);
    await w.drain();
    // Room A: HighLevel took the enrolment and has not run it; the email went.
    expect(w.hl.queue).toHaveLength(1);
    expect(w.room(a).link_unconfirmed_at ?? null).not.toBeNull();
    // Nobody came; the room closes. A quarter of an hour on, the setter
    // tries again with a new room for the same lead.
    w.clock.now += 11 * MIN;
    w.sweepExpires(a);
    w.clock.now += 4 * MIN;
    const b = await w.make();
    expect(b).not.toBe(a);
    await w.workerOpens(b);
    w.modes.template = ["stalled"];
    await w.readyEvent(b);
    await w.drain();
    const codeB = String(w.room(b).code);
    // HighLevel's workflows run again: room A's enrolment reads the join
    // field as it is now (room B's code), and so does room B's.
    w.highLevelCatchesUp();
    const withB = w.whatsappDelivered().filter(d => String(d.body).endsWith(`/${codeB}`));
    // Today: two identical WhatsApp templates with room B's link reach the
    // lead seconds apart (and the duplicate detector, once on, reads that as
    // the WA Connector copying sends and pauses WhatsApp for every rep).
    expect(withB.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Overlapping re-asks while HighLevel and the database are slow
// ---------------------------------------------------------------------------

describe("chaos r4: the minute's re-ask overlaps a link still on its way", () => {
  test("HighLevel refuses the WhatsApp text (429) and the template's setup reads crawl (slow database) past the minute: the re-ask must not send the text while the template still goes", async () => {
    const w = world({ inboundAgoMs: HOUR }); // window open: text first, then the template
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.text = ["refused_429", "ok"];
    let release: () => void = () => undefined;
    w.gate.template = new Promise<void>(r => {
      release = r;
    });
    void w.readyEvent(id);
    await w.drain();
    // The first send: the text refused (its row failed), the template's
    // setup reads still running, so it has no row yet.
    expect(w.rows.size).toBe(1);
    // The minute's re-ask (link claimed 60 s ago, never sent).
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    // The database answers; the first send's template goes on.
    w.gate.template = null;
    release();
    await w.drain();
    // Today the re-ask sees only a refused text, plans afresh, and sends the
    // text on its next request id; the first send's template goes as well:
    // two links on WhatsApp to one lead.
    expect(w.whatsappDelivered().length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// The room worker is down (the VPS, its cron, or its keys)
// ---------------------------------------------------------------------------

describe("chaos r4: the room worker is down", () => {
  test("room.create while the room worker last reported 10 minutes ago: the rep is told at once what to do instead, not left on 'Making your room' for a minute", async () => {
    const w = world();
    const st = w.db.t("cockpit_sales_worker_status").find(s => s.job === "rooms") as Row;
    st.at = new Date(w.clock.now - 10 * MIN).toISOString();
    const started = w.clock.now;
    let answer: unknown;
    try {
      answer = await w.rooms.actions["room.create"]!(setter, {
        request_id: crypto.randomUUID(),
        contact_id: LEAD,
        provider: "meet",
        call_kind: "intro",
        purpose: "fallback",
        appointment_id: "appt-r4",
      });
    } catch (e) {
      answer = e;
    }
    // Today: the room is inserted "requested", the answer comes after the
    // 15 s wait still "requested", the sweep fails it at 60 s with "Try
    // again.", and the panel's Try Zoom makes another room no worker will
    // make. The lead waits on the phone the whole time.
    expect(answer).toBeInstanceOf(ApiRefusal);
    expect(String((answer as ApiRefusal).message)).toMatch(/phone|your own|read/i);
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(0);
    expect(w.clock.now - started).toBeLessThan(5 * S);
  });

  const ask = (w: ReturnType<typeof world>) =>
    w.rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      appointment_id: "appt-r4",
    }).then(
      () => null,
      e => e as ApiRefusal,
    );

  test("room.create while the worker writes fresh rows but makes no rooms (its clock a minute off, its setting unread): refused at once, and the health line says the same (final review)", async () => {
    const w = world();
    const st = w.db.t("cockpit_sales_worker_status").find(s => s.job === "rooms") as Row;
    Object.assign(st, {
      ok: false,
      at: new Date(w.clock.now - 20 * S).toISOString(),
      detail: `${NOT_MAKING_PREFIX}The VPS clock is 95 seconds ahead of the database's, so no room is claimed until it is fixed.`,
    });
    const refusal = await ask(w);
    expect(refusal).toBeInstanceOf(ApiRefusal);
    expect(refusal?.extra.code).toBe("worker_down");
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(0);
    const h = roomsHealth({ now: w.clock.now, last_run_at: st.at, rooms_today: 0, failed_today: 0, status: st });
    expect(h.worker_ok).toBe(false);
    expect(h.line).toBe(
      "The room worker is running but making no rooms: the VPS clock is 95 seconds ahead of the database's, so no room is claimed until it is fixed. Call the lead or send your own link until it is fixed.",
    );
  });

  test("a fresh row that is only failing (a provider down) still makes rooms: room.create goes ahead", async () => {
    const w = world();
    const st = w.db.t("cockpit_sales_worker_status").find(s => s.job === "rooms") as Row;
    Object.assign(st, { ok: false, at: new Date(w.clock.now - 20 * S).toISOString(), detail: "Working. Zoom is not answering, so new Zoom rooms fail at once until it answers again." });
    expect(await ask(w)).toBeNull();
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(1);
  });

  test("a worker that never ran (no status row, the read worked): refused at once; a read that failed lets the room go ahead", async () => {
    const w = world();
    w.db.tables.cockpit_sales_worker_status = [];
    w.db.roomWorkerRunning = false;
    expect((await ask(w))?.extra.code).toBe("worker_down");
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(0);
    const w2 = world();
    w2.db.faults.push({ prefix: "cockpit_sales_worker_status", method: "GET", error: new Error("database blip"), times: 1 });
    expect(await ask(w2)).toBeNull();
  });

  test("the health line when the worker is down names a next step that does not need the worker", () => {
    const now = Date.parse("2026-10-04T10:00:00Z");
    const h = roomsHealth({ now, last_run_at: new Date(now - 10 * MIN).toISOString(), rooms_today: 4, failed_today: 1 });
    expect(h.worker_ok).toBe(false);
    // Today: "Rooms are down. The room worker last ran at 12:50. New rooms
    // cannot be made." The rep is not told to phone the lead or send their
    // own meeting link.
    expect(h.line).toMatch(/phone|your own|WhatsApp/i);
  });
});

// ---------------------------------------------------------------------------
// The lead's open is lost on the way to the room row
// ---------------------------------------------------------------------------

function openLostWorld() {
  const w = fakeWorld();
  const ghlStatus: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false, short_link: true, providers: { zoom: true, meet: true } } },
    { key: "live", value: { enabled: false } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" };
  w.routes.push((m, p) => (m === "GET" && p === `/contacts/${LEAD}` ? { contact } : (null as unknown as Row)));
  const start = w.clock.now - 25 * MIN;
  w.db.seed("cockpit_sales_appointments", [
    { appointment_id: "appt-r4-open", contact_id: LEAD, calendar_id: "cal-intro", call_type: "intro", start_at: new Date(start).toISOString(), status: "confirmed", assigned_user_id: "G-setter" },
  ]);
  const roomId = fakeUuid();
  // The Meet fallback room for the setter's own intro: the short link went
  // by WhatsApp; the room expired with nobody pressed in.
  w.db.seed("cockpit_sales_rooms", [
    {
      id: roomId,
      request_id: fakeUuid(),
      code: "R4OPEN",
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
      appointment_id: "appt-r4-open",
      appointment_start_at: new Date(start).toISOString(),
      requested_at: new Date(start + MIN).toISOString(),
      opened_at: new Date(start + MIN).toISOString(),
      link_claimed_at: new Date(start + MIN).toISOString(),
      link_sent_at: new Date(start + 2 * MIN).toISOString(),
      link_channels: ["whatsapp_text"],
      ended_at: new Date(start + 13 * MIN).toISOString(),
    },
  ]);
  w.db.seed("cockpit_sales_room_events", [
    { id: fakeUuid(), room_id: roomId, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${roomId}`, at: new Date(w.clock.now - MIN).toISOString(), handled_at: null, tries: 0, detail: { appointment_id: "appt-r4-open" } },
  ]);
  const deps: RoomDeps = {
    io: w.io,
    audit: async () => undefined,
    markAppointment: async (who, id, status, opts) => {
      const row: Row = { id: fakeUuid(), appointment_id: id, status, note: opts.note ?? null, marked_by: who.email, crm: "quiet" };
      w.db.t("cockpit_sales_dispositions").push(row);
      ghlStatus.push({ id, status });
      return { ...row };
    },
    sendText: async () => ({ message: { state: "sent" } }),
    sendTemplate: async () => ({ message: { state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const settle = () => rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [roomId] } });
  const room = () => w.db.t("cockpit_sales_rooms").find(r => r.id === roomId) as Row;
  return { ...w, rooms, ghlStatus, roomId, settle, room };
}

describe("chaos r4: the lead's open that never reached the room row", () => {
  test("HELD: nobody opened the short link and the room expired: the timer marks the intro a no-show", async () => {
    const w = openLostWorld();
    await w.settle();
    await w.flush();
    expect(w.ghlStatus).toEqual([{ id: "appt-r4-open", status: "noshow" }]);
  });

  test("the door stored the lead's open (door.open) but its write of the room's open time timed out: the timer must not mark the intro a no-show", async () => {
    const w = openLostWorld();
    // sales-live recordOpen: the door.open event landed, then the PATCH of
    // first_open_at ran out of its 3 s (a slow database). The lead went on to
    // Meet: the door answered the join link before it recorded anything.
    w.db.seed("cockpit_sales_room_events", [
      {
        id: fakeUuid(),
        room_id: w.roomId,
        kind: "door.open",
        source: "door",
        dedupe_key: `open:${w.roomId}:d1`,
        at: new Date(w.clock.now - 22 * MIN).toISOString(),
        handled_at: new Date(w.clock.now - 22 * MIN).toISOString(),
        text: "The lead opened the link on a phone.",
        detail: { device: "phone", room_state: "open" },
      },
    ]);
    await w.settle();
    await w.flush();
    // Today the settle reads only the room's first_open_at and last_open_at:
    // "a short link never opened" is taken as evidence nobody came, and B2B's
    // show rate gets a no-show for a lead who opened the link.
    expect(w.ghlStatus.filter(g => g.status === "noshow")).toEqual([]);
  });
});

void SETTLE_NOTE;
