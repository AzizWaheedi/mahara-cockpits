// bun test supabase/functions/sales-api/m1_providers_r4.test.ts
//
// Milestone 1, video-link round 4, provider quirks on sales-api's side of
// the video link. Settings are the pilot's (m1-scope.md section 3): rooms
// on, both providers, every send lane on, test_only with the test leads
// listed, count_on_join, settle, wrap and auto_on_miss off, short_link off
// (so the call_link template lane is never used), live off. The WhatsApp
// gate is open unless a test closes it.
//
// The message service is faked the way index.ts convoSend runs a send:
// the request id's earlier row answers a repeat; the contact is read first
// (gone or throttled: "not sent yet", nothing written); a free text checks
// the lead's 24 hours; the row is written, the caller's last check runs,
// then HighLevel's POST: a 429 is a certain refusal (row failed), a 5xx an
// unclear send (row unclear), whether or not HighLevel wrote the message
// before it answered; a 200 is read back (break on delivered, read,
// failed, undelivered, opened) and stored through lib.ts stateOf exactly as
// convoSend stores it. The lead's conversation is read the way index.ts
// sentSince reads it (whatsappSentSince with went, toThread, matchSent).
// HighLevel's GET /conversations/messages/{id} answers what each test sets.
//
// A failing test is a finding; tests marked HELD pass. Nothing leaves this
// process; every lead is invented.
import { describe, expect, test } from "bun:test";
import { stateOf, toThread } from "./lib.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal, GhlError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { matchSent } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "stress-m1p4-setter@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * How HighLevel answers one POST /conversations/messages:
 * - ok: a 200 with a message id, then the read-back's statuses in order
 *   (each read 2 s apart; the last one stands when the loop runs out);
 * - throttled: a 429 (HighLevel's burst limit): nothing went;
 * - landed5xx: a 502 after HighLevel wrote the message and handed it on:
 *   the lead has it, and the answer says nothing;
 * - lost5xx: a 503 from the gateway in front of HighLevel: nothing went.
 */
type Post =
  | { kind: "ok"; reads?: string[]; meta?: Row; statusReason?: string }
  | { kind: "throttled" }
  | { kind: "landed5xx" }
  | { kind: "lost5xx" };

interface Lead {
  id: string;
  inboundAgoMs: number | null;
  email?: string | null;
  text?: Post[];
  email_out?: Post[];
  contact?: "ok" | "gone" | "throttled";
}

function world(o: { waGate?: boolean } = {}) {
  const w = fakeWorld();
  const leads = new Map<string, Lead>();
  const jobs: Promise<unknown>[] = [];
  const roomsJson: Row = {
    ...DEFAULT_ROOMS_JSON,
    enabled: true,
    test_only: true,
    test_contacts: [] as string[],
    providers: { zoom: true, meet: true },
    send: { whatsapp_text: true, whatsapp_template: true, email: true },
    count_on_join: false,
    settle: false,
    wrap: false,
    short_link: false,
    fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "intro", auto_on_miss: false },
  };
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: roomsJson },
    { key: "live", value: { enabled: false, slack: false } },
    {
      key: "whatsapp_guard",
      value: o.waGate === false ? { connector_off: false, single_copy_ok_at: null } : { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 },
    },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_wa_templates", [{ key: "call_link_ar", active: true, workflow_id: "wf-call-link" }, { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" }]);
  /** HighLevel's message as GET /conversations/messages/{id} reads it now, by HighLevel message id. */
  const later = new Map<string, Row>();
  /** The lead's conversation as HighLevel keeps it: every message HighLevel wrote, with its status now. */
  const conversation: { lead: string; body: string; status: string; at: number; id: string; channel: "whatsapp" | "email"; meta?: Row; statusReason?: string }[] = [];
  w.routes.push(async (m, p) => {
    const one = /^\/contacts\/([^/?]+)$/.exec(p);
    if (m === "GET" && one) {
      const id = decodeURIComponent(one[1] as string);
      const l = leads.get(id);
      if (!l || l.contact === "gone") throw new GhlError("HighLevel said 400: Contact not found", 400, true);
      if (l.contact === "throttled") throw new GhlError("HighLevel said 429: Too Many Requests", 429, true);
      const email = l.email === undefined ? `${id}@example.com` : l.email;
      return { contact: { id, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", ...(email ? { email } : {}), tags: ["roas-qualified"], country: "KW" } };
    }
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    const msg = /^\/conversations\/messages\/([^/?]+)$/.exec(p);
    if (m === "GET" && msg) {
      const id = decodeURIComponent(msg[1] as string);
      const now = later.get(id);
      if (now) return { message: { id, direction: "outbound", ...now } };
    }
    return null as unknown as Row;
  });
  function addLead(l: Lead): void {
    leads.set(l.id, l);
    (roomsJson.test_contacts as string[]).push(l.id);
    if (l.inboundAgoMs !== null) leadWrote(l.id, l.inboundAgoMs);
  }
  /** The lead writes on WhatsApp (the cockpit's inbox and HighLevel's conversation both have it). */
  function leadWrote(id: string, agoMs = 0): void {
    const at = new Date(w.clock.now - agoMs).toISOString();
    const row = w.db.t("cockpit_sales_inbox").find(r => r.contact_id === id);
    if (row) row.inbound_whatsapp_at = at;
    else w.db.seed("cockpit_sales_inbox", [{ conversation_id: `c-${id}`, contact_id: id, inbound_whatsapp_at: at }]);
  }
  const at = () => new Date(w.clock.now).toISOString();
  const rows = new Map<string, Row>();
  /** Every POST HighLevel was asked for, and whether the lead got the message. */
  const posts: { lead: string; lane: "text" | "email"; at: number; request_id: string; reached: boolean; kind: Post["kind"] }[] = [];
  const used = new Map<string, number>();
  function next(contactId: string, lane: "text" | "email"): Post {
    const l = leads.get(contactId);
    const list = (lane === "email" ? l?.email_out : l?.text) ?? [{ kind: "ok" } as Post];
    const k = `${contactId}:${lane}`;
    const n = used.get(k) ?? 0;
    used.set(k, n + 1);
    return list[Math.min(n, list.length - 1)] as Post;
  }
  const MAY_HAVE_GONE = "The send may have gone; read the conversation in HighLevel before writing to the lead again";
  /** index.ts convoSend, as it runs and stores a send. */
  async function send(requestId: string, contactId: string, channel: "whatsapp" | "email", body: string, subject: string | null, beforeSend?: () => Promise<boolean>) {
    const lane = channel === "email" ? "email" : "text";
    const again = rows.get(requestId);
    if (again) {
      if (String(again.body).trim() !== body.trim() || again.channel !== channel)
        throw new ApiRefusal("That send was already used for other words. Press Send again.", 409);
      return { message: { ...again }, repeated: true };
    }
    const l = leads.get(contactId);
    if (l?.contact === "gone" || l?.contact === "throttled")
      throw new ApiRefusal("Not sent: HighLevel or the database did not answer before anything went. Try again in a minute.", 503, { certain: true, retry: true, code: "not_sent_yet" });
    if (channel === "whatsapp") {
      const inbound = w.db.t("cockpit_sales_inbox").find(r => r.contact_id === contactId)?.inbound_whatsapp_at;
      const t = inbound ? Date.parse(String(inbound)) : Number.NaN;
      if (!Number.isFinite(t) || w.clock.now >= t + 24 * HOUR)
        throw new ApiRefusal("WhatsApp only takes a free message within 24 hours of the lead's own last message. Email them instead, or wait for them to write.", 409);
    }
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, subject, body, source: "room", state: "sending", created_at: at() };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    if (beforeSend && !(await beforeSend().catch(() => false))) {
      rows.delete(requestId);
      const i = w.db.t("cockpit_sales_messages").indexOf(row);
      if (i >= 0) w.db.t("cockpit_sales_messages").splice(i, 1);
      throw new ApiRefusal("Not sent: the room closed before the link went.", 409, { code: "stopped", certain: true });
    }
    row.ghl_asked_at = at();
    const plan = next(contactId, lane);
    const ghlId = `msg-${String(row.id).slice(-8)}`;
    if (plan.kind === "throttled") {
      posts.push({ lead: contactId, lane, at: w.clock.now, request_id: requestId, reached: false, kind: plan.kind });
      row.state = "failed";
      row.error = "HighLevel said 429: Too Many Requests";
      throw new ApiRefusal("HighLevel did not send it: HighLevel said 429: Too Many Requests", 502, { certain: true });
    }
    if (plan.kind === "landed5xx" || plan.kind === "lost5xx") {
      const landed = plan.kind === "landed5xx";
      posts.push({ lead: contactId, lane, at: w.clock.now, request_id: requestId, reached: landed, kind: plan.kind });
      if (landed) conversation.push({ lead: contactId, body, status: "delivered", at: w.clock.now, id: ghlId, channel });
      if (landed) later.set(ghlId, { status: "delivered", messageType: channel === "email" ? "TYPE_EMAIL" : "TYPE_WHATSAPP" });
      const err = landed ? "HighLevel said 502: Bad Gateway" : "HighLevel said 503: Service Unavailable";
      row.state = "unclear";
      row.error = err;
      throw new ApiRefusal(`${MAY_HAVE_GONE} (${err})`, 502, { unclear: true });
    }
    // A 200: HighLevel wrote the message; Meta (or the mail service) decides afterwards.
    const reads = plan.reads?.length ? plan.reads : ["sent"];
    let status = "pending";
    let error: string | null = null;
    for (const st of reads) {
      status = st;
      const [shaped] = toThread(
        [{ id: ghlId, direction: "outbound", status: st, messageType: channel === "email" ? "TYPE_EMAIL" : "TYPE_WHATSAPP", ...(plan.meta ? { meta: plan.meta } : {}), ...(plan.statusReason ? { statusReason: plan.statusReason } : {}) }],
        `c-${contactId}`,
      );
      error = shaped?.error ?? null;
      if (["delivered", "read", "failed", "undelivered", "opened"].includes(st)) break;
    }
    const state = stateOf(status === "pending" && !error ? "sent" : status);
    const reached = !["failed", "undelivered", "bounced", "pending"].includes(status);
    posts.push({ lead: contactId, lane, at: w.clock.now, request_id: requestId, reached, kind: plan.kind });
    conversation.push({ lead: contactId, body, status, at: w.clock.now, id: ghlId, channel, ...(plan.meta ? { meta: plan.meta } : {}) });
    later.set(ghlId, { status, messageType: channel === "email" ? "TYPE_EMAIL" : "TYPE_WHATSAPP", ...(plan.meta ? { meta: plan.meta } : {}) });
    Object.assign(row, {
      state,
      provider_status: status,
      error: state === "failed" ? (error ?? "HighLevel marked it failed without a reason") : null,
      ghl_message_id: ghlId,
      ghl_conversation_id: `c-${contactId}`,
    });
    return { message: { ...row } };
  }
  /** index.ts sentSince over whatsappSentSince (went: true). */
  async function sentSince(contactId: string, since: number, text: string | null | undefined, channel?: "whatsapp" | "email") {
    if (!text) return null;
    const ch = channel ?? "whatsapp";
    const raw = conversation
      .filter(c => c.lead === contactId)
      .map(c => ({
        id: c.id,
        direction: "outbound",
        messageType: c.channel === "email" ? "TYPE_EMAIL" : "TYPE_WHATSAPP",
        status: c.status,
        dateAdded: new Date(c.at).toISOString(),
        body: c.body,
        ...(c.meta ? { meta: c.meta } : {}),
      }))
      .reverse();
    const list = toThread(raw, `c-${contactId}`);
    const hit = matchSent(list, since, text, { went: true, channel: ch });
    if (hit) return { id: hit.id, status: hit.status };
    const failed = matchSent(list, since, text, { channel: ch });
    if (failed) return { id: failed.id, status: failed.status ?? "failed", failed: true, error: failed.error ?? null };
    const others = Boolean(matchSent(list, since, null, { channel: ch }));
    if (ch === "email" && others) return null;
    return false;
  }
  const deps: RoomDeps = {
    io: {
      ...w.io,
      background: p => {
        jobs.push(p.catch(e => w.logs.push(`background: ${String((e as Error)?.message ?? e)}`)));
      },
    },
    audit: async (_who, action, _t, id, _b, after) => {
      w.db.t("stress_audit").push({ action, entity_id: id, after });
    },
    markAppointment: async () => ({ crm: "written" }),
    sendText: (_who, b, opts) => send(b.request_id, b.contact_id, b.channel, b.body, b.subject ?? null, opts?.beforeSend),
    sendTemplate: async () => {
      throw new Error("the template lane is off for the pilot (short_link off): no template is ever sent");
    },
    upcoming: async () => null,
    sentSince,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  async function drain(): Promise<void> {
    for (let i = 0; i < 12; i++) {
      await realSleep(1);
      await Promise.race([Promise.allSettled(jobs.slice()), realSleep(40)]);
    }
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
  /** The lead page's Send a video link (purpose manual), made and opened. */
  async function made(contactId: string, extra: Row = {}): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: contactId,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
      ...extra,
    });
    const id = String((out.room as Row).id);
    await workerOpens(id);
    return id;
  }
  async function ready(id: string): Promise<void> {
    await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await drain();
  }
  async function opened(contactId: string, extra: Row = {}): Promise<string> {
    const id = await made(contactId, extra);
    await ready(id);
    return id;
  }
  async function tick(id: string) {
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await drain();
  }
  async function minutes(id: string, n: number) {
    for (let i = 0; i < n; i++) {
      w.clock.now += MIN;
      await tick(id);
    }
  }
  /** HighLevel's status for a message changes (Meta's status webhook, a bounce). */
  function becomes(ghlId: string, now: Row) {
    later.set(ghlId, now);
    const c = conversation.find(x => x.id === ghlId);
    if (c) {
      c.status = String(now.status);
      if (now.meta) c.meta = now.meta as Row;
    }
  }
  function lines(id: string): string[] {
    return w.db
      .t("cockpit_sales_room_events")
      .filter(e => e.room_id === id && typeof e.text === "string")
      .map(e => String(e.text));
  }
  function msgs(lead: string, channel?: string): Row[] {
    return w.db.t("cockpit_sales_messages").filter(m => m.contact_id === lead && (!channel || m.channel === channel));
  }
  /** The rep ends the room (the panel's End), so the seat can make the next one. */
  function ended(id: string) {
    Object.assign(room(id), { state: "ended", result: "no_join", end_reason: "finished", ended_at: w.db.iso(), version: Number(room(id).version) + 1 });
  }
  return { ...w, rooms, room, addLead, leadWrote, made, ready, opened, tick, minutes, drain, posts, becomes, lines, later, msgs, conversation, leads, ended };
}

// ---------------------------------------------------------------------------
// 1. A late WhatsApp failure (Meta's 131026 after HighLevel said "sent"), or
//    a free text HighLevel holds as pending, is backed up by email, and that
//    one email meets HighLevel's burst limit (a 429: nothing went).
//
// The cascade reads a 429 as passing (passingFailure, m1 round 2): its
// lane's key is not spent and the room says "it is tried again in a
// minute". whatsappFailedLate and pendingBackup do not: the email's 429 is
// read as "no email could go", the lane's line is claimed
// (link.failed_late:{room}:whatsapp_text, link.pending:{room}) and the
// recheck stops at that line, so the backup is never asked again. The lead
// has a working address and no link; the rep is told to read it out.
// ---------------------------------------------------------------------------

describe("m1 providers r4: the late backup email meets HighLevel's 429", () => {
  test("HELD (control): the late 131026 is backed up by email when HighLevel takes it", async () => {
    const w = world();
    const LEAD = "stress-m1p4-late-ok";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR });
    const id = await w.opened(LEAD);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    w.clock.now += 90 * S;
    w.becomes(String(text.ghl_message_id), { status: "failed", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } });
    await w.minutes(id, 1);
    expect(w.lines(id).some(t => /so it went by email/.test(t))).toBe(true);
    expect(w.posts.filter(p => p.lead === LEAD && p.lane === "email" && p.reached).length).toBe(1);
  });

  test("late-backup-email-429-said-no-email-never-retried (late failure): HighLevel's 429 on the email backup is said as 'no email could go' and the email is never asked again", async () => {
    const w = world();
    const LEAD = "stress-m1p4-late-429";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, email_out: [{ kind: "throttled" }, { kind: "ok" }] });
    const id = await w.opened(LEAD);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    w.clock.now += 90 * S;
    w.becomes(String(text.ghl_message_id), { status: "failed", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } });
    await w.minutes(id, 6);
    const emails = w.posts.filter(p => p.lead === LEAD && p.lane === "email");
    const said = w.lines(id).filter(t => /WhatsApp failed|email/i.test(t));
    expect(
      { emailReachedLead: emails.some(p => p.reached), saidNoEmailCouldGo: said.some(t => /no email could go/.test(t)) },
      `HighLevel answered the backup email with a 429 once (a burst: the cascade's rule tries it again in a minute) and would take it the next minute; ` +
        `six minutes on the lead has no link (${emails.length} email POST(s): ${JSON.stringify(emails.map(p => p.kind))}) and the room says ${JSON.stringify(said)}`,
    ).toEqual({ emailReachedLead: true, saidNoEmailCouldGo: false });
  });

  test("late-backup-email-429-said-no-email-never-retried (stuck pending): the pending free text's email backup meets a 429 and is never asked again", async () => {
    const w = world();
    const LEAD = "stress-m1p4-pending-429";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: [{ kind: "ok", reads: ["pending"] }], email_out: [{ kind: "throttled" }, { kind: "ok" }] });
    const id = await w.opened(LEAD);
    expect([w.room(id).link_channels, (w.msgs(LEAD, "whatsapp")[0] as Row).provider_status]).toEqual([["whatsapp_text"], "pending"]);
    await w.minutes(id, 6);
    const emails = w.posts.filter(p => p.lead === LEAD && p.lane === "email");
    const said = w.lines(id).filter(t => /WhatsApp has not taken|email/i.test(t));
    expect(
      { emailReachedLead: emails.some(p => p.reached), saidNoEmailCouldGo: said.some(t => /no email could go/.test(t)) },
      `the free text sat in HighLevel's queue; its email backup met one 429 and HighLevel would take it the next minute; six minutes on ` +
        `(${emails.length} email POST(s)) the room says ${JSON.stringify(said)}`,
    ).toEqual({ emailReachedLead: true, saidNoEmailCouldGo: false });
  });
});

// ---------------------------------------------------------------------------
// 2. The link went by email only (the lead's WhatsApp window was shut), the
//    lead then wrote on WhatsApp ("I can't find your email"), and the email
//    bounced. emailBounced sends the free text instead, and HighLevel
//    answers that POST with a 502 after it wrote the message and handed it
//    to Meta: the lead has the link on WhatsApp.
//
// emailBounced keeps sent.ok and sent.stopped apart and nothing else: an
// unclear send (may have gone) falls through with the line still
// EVENT_TEXT.link_bounced, "The email bounced. Read the link out, or send
// it on WhatsApp.", and the line is claimed, so the recheck stops there and
// the WhatsApp copy is never looked for in the conversation. The rep sends
// the link on WhatsApp a second time, as the room told them to.
// whatsappFailedLate, pendingBackup and pendingEmail each say "may have
// gone" for the same answer.
// ---------------------------------------------------------------------------

describe("m1 providers r4: the bounce's WhatsApp backup whose answer was lost", () => {
  async function bounced(textPost: Post) {
    const w = world();
    const LEAD = `stress-m1p4-bounce-${textPost.kind}`;
    w.addLead({ id: LEAD, inboundAgoMs: null, text: [textPost], email_out: [{ kind: "ok", reads: ["delivered"] }] });
    const id = await w.opened(LEAD);
    expect(w.room(id).link_channels).toEqual(["email"]);
    // The lead writes on WhatsApp: their window is open now.
    w.clock.now += 30 * S;
    w.leadWrote(LEAD);
    // The mail server's bounce comes after "delivered".
    w.clock.now += 30 * S;
    const mail = w.msgs(LEAD, "email")[0] as Row;
    w.becomes(String(mail.ghl_message_id), { status: "failed", messageType: "TYPE_EMAIL", meta: { error: "Email bounced: mailbox does not exist" } });
    await w.minutes(id, 4);
    return { w, id, LEAD };
  }

  test("HELD (control): the bounce's free text that HighLevel took is said as gone on WhatsApp", async () => {
    const { w, id } = await bounced({ kind: "ok", reads: ["delivered"] });
    expect(w.lines(id).some(t => t === "The email bounced, so the link went on WhatsApp.")).toBe(true);
  });

  test("bounce-backup-text-unclear-tells-rep-send-on-whatsapp: the free text HighLevel took behind a 502 is never said, and the room tells the rep to send it on WhatsApp", async () => {
    const { w, id, LEAD } = await bounced({ kind: "landed5xx" });
    const reached = w.posts.filter(p => p.lead === LEAD && p.lane === "text" && p.reached).length;
    expect(reached).toBe(1);
    const said = w.lines(id).filter(t => /bounced|WhatsApp/i.test(t));
    const r = w.room(id);
    expect(
      {
        tellsRepToSendOnWhatsapp: said.some(t => /send it on WhatsApp/i.test(t)),
        whatsappCopyKnown: (r.link_channels as string[]).includes("whatsapp_text") || said.some(t => /may have gone on WhatsApp|WhatsApp message may have gone|went on WhatsApp/i.test(t)),
      },
      `the lead has the link on WhatsApp (HighLevel wrote it and answered 502); four minutes on the room says ${JSON.stringify(said)}, ` +
        `link_channels ${JSON.stringify(r.link_channels)}, so the rep sends the link on WhatsApp a second time`,
    ).toEqual({ tellsRepToSendOnWhatsapp: false, whatsappCopyKnown: true });
  });
});

// ---------------------------------------------------------------------------
// 3. An email link that bounces within seconds (a mistyped address: the
//    mail service's hard bounce lands inside the 20 s read-back).
//
// rooms.ts reads HighLevel's "bounced" as a failure (statusById: failed,
// undelivered or bounced). The message service does not: its read-back
// loop never breaks on "bounced" and lib.ts stateOf has no word for it, so
// convoSend stores the row as "sending" (provider_status "bounced"). The
// room reads a "sending" row as a send still running: nothing is said for
// a send's budget (90 s), then the row is marked unclear, the
// conversation check finds the copy (went excludes only failed and
// undelivered) and records "Link sent by email." for the email that
// bounced; only the next minute's recheck says the bounce.
// ---------------------------------------------------------------------------

describe("m1 providers r4: an email link that bounces inside the read-back", () => {
  test("HELD (control): lib.ts stateOf reads HighLevel's failure words as failed", () => {
    expect([stateOf("failed"), stateOf("undelivered")]).toEqual(["failed", "failed"]);
  });

  test("readback-bounced-stored-as-sending-then-said-sent: the room says 'Link sent by email.' for an email that bounced in the first seconds", async () => {
    const w = world({ waGate: false });
    const LEAD = "stress-m1p4-fast-bounce";
    w.addLead({ id: LEAD, inboundAgoMs: null, email_out: [{ kind: "ok", reads: ["pending", "bounced", "bounced", "bounced", "bounced", "bounced", "bounced", "bounced", "bounced", "bounced"] }] });
    const id = await w.opened(LEAD);
    const mail = w.msgs(LEAD, "email")[0] as Row;
    const stored = { state: mail.state, provider_status: mail.provider_status };
    const timeline: { minute: number; lines: string[] }[] = [];
    for (let i = 1; i <= 4; i++) {
      w.clock.now += MIN;
      await w.tick(id);
      timeline.push({ minute: i, lines: w.lines(id).filter(t => /Link sent|bounced/i.test(t)) });
    }
    const said = w.lines(id);
    const firstBounce = timeline.find(t => t.lines.some(l => /bounced/i.test(l)))?.minute ?? null;
    expect(
      { saidSentForBouncedEmail: said.includes("Link sent by email."), bounceSaidByMinute2: firstBounce !== null && firstBounce <= 2 },
      `HighLevel read the email "bounced" inside the read-back; the message service stored ${JSON.stringify(stored)}, and the room's lines by minute were ` +
        `${JSON.stringify(timeline)}`,
    ).toEqual({ saidSentForBouncedEmail: false, bounceSaidByMinute2: true });
  });
});

// ---------------------------------------------------------------------------
// 4. Meta fails a free text late (131026, the lead is not on WhatsApp: a
//    reason about one lead), and HighLevel gives the reason in a field the
//    message service reads (lib.ts errorOf: meta.errorMessage,
//    meta.failedReason, statusReason) but the recheck does not
//    (statusById reads meta.error, error and errorMessage only).
//
// The recheck stores the late failure as "HighLevel marked it failed", so
// leadSpecificFailure cannot see the 131026 and the room source's WhatsApp
// health counts it against the number. Two such leads among the hour's
// room sends and every next lead's link skips WhatsApp ("WhatsApp video
// links are failing") while the number is fine.
// ---------------------------------------------------------------------------

describe("m1 providers r4: a late failure's reason in a field the recheck does not read", () => {
  async function hour(meta: Row) {
    const w = world();
    // Three earlier rooms' links this hour, delivered (the message service's rows).
    for (let i = 0; i < 3; i++)
      w.db.seed("cockpit_sales_messages", [
        {
          id: fakeUuid(),
          request_id: crypto.randomUUID(),
          contact_id: `stress-m1p4-earlier-${i}`,
          channel: "whatsapp",
          body: "Hi there, your call is ready now. Join here: https://meet.google.com/aaa-bbbb-ccc",
          source: "room",
          state: "delivered",
          provider_status: "delivered",
          created_at: new Date(w.clock.now - (40 - i) * MIN).toISOString(),
        },
      ]);
    for (const n of [1, 2]) {
      const LEAD = `stress-m1p4-notwa-${n}`;
      w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR });
      const id = await w.opened(LEAD);
      const text = w.msgs(LEAD, "whatsapp")[0] as Row;
      w.clock.now += 90 * S;
      w.becomes(String(text.ghl_message_id), { status: "failed", messageType: "TYPE_WHATSAPP", meta });
      await w.minutes(id, 1);
      w.ended(id);
      w.clock.now += 2 * MIN;
    }
    const NEXT = "stress-m1p4-next-lead";
    w.addLead({ id: NEXT, inboundAgoMs: 2 * HOUR });
    const id = await w.opened(NEXT);
    const failedRows = w.db
      .t("cockpit_sales_messages")
      .filter(m => m.source === "room" && m.channel === "whatsapp" && m.state === "failed")
      .map(m => String(m.error));
    return { w, id, NEXT, failedRows };
  }

  test("HELD (control): the same late 131026 in meta.error leaves the number healthy, and the next lead's link goes on WhatsApp", async () => {
    const { w, id } = await hour({ error: "Message Undeliverable. (131026)" });
    expect(w.room(id).link_channels).toEqual(["whatsapp_text"]);
  });

  test("late-failure-reason-field-unread-counts-against-whatsapp-health: two leads not on WhatsApp switch every next lead's link to email", async () => {
    const { w, id, failedRows } = await hour({ failedReason: "Message Undeliverable. (131026)" });
    const r = w.room(id);
    expect(
      { nextLeadChannels: r.link_channels, storedReasons: failedRows },
      `two leads not on WhatsApp (Meta's 131026, given by HighLevel in meta.failedReason, which lib.ts errorOf reads) were stored as ${JSON.stringify(failedRows)}; ` +
        `the next lead, whose WhatsApp window is open, got the link on ${JSON.stringify(r.link_channels)}`,
    ).toEqual({ nextLeadChannels: ["whatsapp_text"], storedReasons: ["Message Undeliverable. (131026)", "Message Undeliverable. (131026)"] });
  });

  test("late-failure-reason-field-unread-counts-against-whatsapp-health (object shape): Meta's error as an object in meta.error is stored as '[object Object]'", async () => {
    const { w, id, failedRows } = await hour({ error: { code: 131026, title: "Message undeliverable" } });
    const r = w.room(id);
    expect(
      { nextLeadChannels: r.link_channels, codeKept: failedRows.map(e => /131026/.test(e)) },
      `Meta's error came as an object (lib.ts errorOf stringifies it); the recheck stored ${JSON.stringify(failedRows)}, and the next lead got the link on ${JSON.stringify(r.link_channels)}`,
    ).toEqual({ nextLeadChannels: ["whatsapp_text"], codeKept: [true, true] });
  });
});

// ---------------------------------------------------------------------------
// 5. The link's email went after a late WhatsApp failure (or the free text
//    went after a bounce), and HighLevel never hands that backup on: it
//    still reads "pending" minutes later.
//
// recheckLink reads the backup lane (the one that went last) every minute,
// and both "stuck pending" rules (PENDING_STUCK_MS: pendingBackup for a
// free text, pendingEmail for an email) only run when the link went on one
// lane (lanes.length === 1). A backup HighLevel holds is never doubted: the
// room keeps saying "WhatsApp failed the link after it was sent, so it
// went by email." while nothing reached the lead.
// ---------------------------------------------------------------------------

describe("m1 providers r4: a backup HighLevel never hands on", () => {
  test("HELD (control): the pilot's only lane, an email stuck pending, is doubted", async () => {
    const w = world({ waGate: false });
    const LEAD = "stress-m1p4-email-only-pending";
    w.addLead({ id: LEAD, inboundAgoMs: null, email_out: [{ kind: "ok", reads: ["pending"] }] });
    const id = await w.opened(LEAD);
    await w.minutes(id, 4);
    expect(w.lines(id).some(t => /HighLevel has not sent the email yet/.test(t))).toBe(true);
  });

  test("backup-email-stuck-pending-never-doubted: the late failure's email backup sits at pending for eight minutes and the room says it went", async () => {
    const w = world();
    const LEAD = "stress-m1p4-backup-pending";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, email_out: [{ kind: "ok", reads: ["pending"] }] });
    const id = await w.opened(LEAD);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    w.clock.now += 90 * S;
    w.becomes(String(text.ghl_message_id), { status: "failed", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } });
    await w.minutes(id, 8);
    const mail = w.msgs(LEAD, "email")[0] as Row;
    const reads = w.ghlCalls.filter(c => c.method === "GET" && c.path === `/conversations/messages/${String(mail.ghl_message_id)}`).length;
    const said = w.lines(id).filter(t => /email|WhatsApp/i.test(t));
    expect(
      { doubted: said.some(t => /has not sent the email|not left|not confirm|still pending|Read the link out/i.test(t)) },
      `HighLevel read the backup email "pending" ${reads} times over eight minutes (never handed to its mail service); the room says ${JSON.stringify(said)}`,
    ).toEqual({ doubted: true });
  });

  test("backup-email-stuck-pending-never-doubted (free text after a bounce): the bounce's WhatsApp backup sits at pending and the room says it went on WhatsApp", async () => {
    const w = world();
    const LEAD = "stress-m1p4-bounce-text-pending";
    w.addLead({ id: LEAD, inboundAgoMs: null, text: [{ kind: "ok", reads: ["pending"] }], email_out: [{ kind: "ok", reads: ["delivered"] }] });
    const id = await w.opened(LEAD);
    expect(w.room(id).link_channels).toEqual(["email"]);
    w.clock.now += 30 * S;
    w.leadWrote(LEAD);
    w.clock.now += 30 * S;
    const mail = w.msgs(LEAD, "email")[0] as Row;
    w.becomes(String(mail.ghl_message_id), { status: "failed", messageType: "TYPE_EMAIL", meta: { error: "Email bounced: mailbox does not exist" } });
    await w.minutes(id, 8);
    const said = w.lines(id).filter(t => /email|WhatsApp/i.test(t));
    expect(
      { doubted: said.some(t => /has not taken|not confirm|still pending|neither way/i.test(t)) },
      `the free text that replaced the bounced email sat in HighLevel's queue for eight minutes; the room says ${JSON.stringify(said)}`,
    ).toEqual({ doubted: true });
  });
});

// ---------------------------------------------------------------------------
// 6. The late backup's email meets a 503 from the gateway in front of
//    HighLevel (nothing went), or a 502 after HighLevel wrote it (it went).
//
// whatsappFailedLate says "the email may have gone. Check the
// conversation, or read the link out." and claims the lane's line; the
// unclear email is not on link_channels, so recheckLink reads the free
// text's lane, stops at that line, and nobody ever reads the conversation
// for the email. The cascade, given the same 503 on its own email, reads
// the conversation and, not there a send's budget on, sends the email on
// the lane's next key within two minutes (m1 round 1). Here the lead never
// gets the link, and the room never learns which.
// ---------------------------------------------------------------------------

describe("m1 providers r4: the late backup email whose answer was lost", () => {
  test("HELD (control): the cascade's own email meets the same 503 and goes on its next key", async () => {
    const w = world({ waGate: false });
    const LEAD = "stress-m1p4-cascade-503";
    w.addLead({ id: LEAD, inboundAgoMs: null, email_out: [{ kind: "lost5xx" }, { kind: "ok" }] });
    const id = await w.opened(LEAD);
    await w.minutes(id, 4);
    expect(w.posts.filter(p => p.lead === LEAD && p.lane === "email" && p.reached).length).toBe(1);
    expect(w.room(id).link_channels).toEqual(["email"]);
  });

  test("late-backup-email-unclear-never-resolved: a late failure's email backup lost to a gateway 503 is never sent and never looked for", async () => {
    const w = world();
    const LEAD = "stress-m1p4-late-503";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, email_out: [{ kind: "lost5xx" }, { kind: "ok" }] });
    const id = await w.opened(LEAD);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    w.clock.now += 90 * S;
    w.becomes(String(text.ghl_message_id), { status: "failed", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } });
    await w.minutes(id, 6);
    const emails = w.posts.filter(p => p.lead === LEAD && p.lane === "email");
    const said = w.lines(id).filter(t => /email/i.test(t));
    expect(
      { emailReachedLead: emails.some(p => p.reached), stillMayHaveGone: said.some(t => /may have gone/i.test(t)) && !said.some(t => /so it went by email/.test(t)) },
      `the gateway answered the backup email 503 and nothing went (${JSON.stringify(emails.map(p => p.kind))}); six minutes on the room still says ${JSON.stringify(said)}`,
    ).toEqual({ emailReachedLead: true, stillMayHaveGone: false });
  });
});

// ---------------------------------------------------------------------------
// 7. HighLevel's 429 on the contact read when the link is due: the room's
//    timeline line lower-cases the first letter of the reason, so a reason
//    that starts with a name reads "Not sent: highLevel did not answer...".
// ---------------------------------------------------------------------------

describe("m1 providers r4: the not-sent line's first word", () => {
  test("not-sent-line-lowercases-highlevel: the timeline says 'highLevel'", async () => {
    const w = world();
    const LEAD = "stress-m1p4-contact-429";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR });
    const id = await w.made(LEAD);
    (w.leads.get(LEAD) as Lead).contact = "throttled";
    await w.ready(id);
    const said = w.lines(id).filter(t => /^Not sent/.test(t));
    expect(said.length).toBeGreaterThan(0);
    expect(said.filter(t => /\bhighLevel\b|\bwhatsApp\b/.test(t)), `the rep's timeline reads ${JSON.stringify(said)}`).toEqual([]);
  });
});
