// bun test supabase/functions/sales-api/m1_providers_r4_quirks.test.ts
//
// Milestone 1, video-link round 4 (second pass), provider quirks on
// sales-api's side of the video link. The pilot's settings (m1-scope.md
// section 3): rooms on, both providers, every send lane on, test_only with
// the test leads listed, count_on_join, settle, wrap and auto_on_miss off,
// short_link off (so the call_link template lane is never used), live off.
// The WhatsApp gate is open unless a test closes it.
//
// The message service is faked the way index.ts convoSend runs a send (the
// harness of m1_providers_r4.test.ts): the request id's earlier row answers
// a repeat; HighLevel's contact read and, for WhatsApp, its conversation
// search (the 24-hour window) run before the row is written, and a failure
// there is index.ts notSentYet ("not sent yet", nothing written); the row
// is written, the caller's last check runs, then HighLevel's POST: a 429 is
// a certain refusal, a 5xx unclear; a 200 is read back and stored through
// lib.ts stateOf exactly as convoSend stores it. HighLevel's GET
// /conversations/messages/{id} answers what each test sets.
//
// A failing test is a finding; tests marked HELD pass. Nothing leaves this
// process; every lead is invented (stress-...).
import { describe, expect, test } from "bun:test";
import { stateOf, toThread } from "./lib.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal, GhlError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, linkRefusalFinal, linkRetrying } from "./roomlogic.ts";
import { leadSpecificFailure, makeRooms, type RoomDeps } from "./rooms.ts";
import { matchSent } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "stress-m1p4q-setter@stress.invalid";
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
  /** HighLevel's conversation search (convoSend's WhatsApp window read) does not answer: WhatsApp only. */
  searchDown?: boolean;
  /** HighLevel's conversation says the lead last wrote on WhatsApp 30 hours ago, whatever the cockpit's inbox says. */
  hlWindowShut?: boolean;
}

function world(o: { waGate?: boolean; health?: Row[] } = {}) {
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
  if (o.health?.length) w.db.seed("cockpit_sales_messages", o.health);
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
  /** Each WhatsApp send that stopped at HighLevel's conversation search. */
  const searches: { lead: string; at: number }[] = [];
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
    // index.ts notSentYet: HighLevel's contact read threw before the row was written.
    if (l?.contact === "gone")
      throw new ApiRefusal("Not sent: HighLevel or the database did not answer before anything went (HighLevel said 400: Contact not found). Try again in a minute.", 503, {
        certain: true,
        retry: true,
        code: "not_sent_yet",
        cause: "HighLevel said 400: Contact not found",
        cause_status: 400,
      });
    if (l?.contact === "throttled")
      throw new ApiRefusal("Not sent: HighLevel or the database did not answer before anything went (HighLevel said 429: Too Many Requests). Try again in a minute.", 503, {
        certain: true,
        retry: true,
        code: "not_sent_yet",
        cause: "HighLevel said 429: Too Many Requests",
        cause_status: 429,
      });
    // index.ts convoSendOnce: the WhatsApp window is read from HighLevel's conversation search before the row.
    if (channel === "whatsapp" && l?.searchDown) {
      searches.push({ lead: contactId, at: w.clock.now });
      throw new ApiRefusal("Not sent: HighLevel or the database did not answer before anything went (HighLevel answered the conversation search with no list in it). Try again in a minute.", 503, {
        certain: true,
        retry: true,
        code: "not_sent_yet",
        cause: "HighLevel answered the conversation search with no list in it",
      });
    }
    if (channel === "whatsapp" && l?.hlWindowShut)
      throw new ApiRefusal("WhatsApp only takes a free message within 24 hours of the lead's own last message; they last wrote 1 day ago. Email them instead, or wait for them to write.", 409);
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
  return { ...w, rooms, room, addLead, leadWrote, made, ready, opened, tick, minutes, drain, posts, becomes, lines, later, msgs, conversation, leads, ended, searches };
}

const META_131026 = { status: "failed", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } };
const sendByEmail = (w: ReturnType<typeof world>, id: string) =>
  w.rooms.actions["room.send"]!(setter, { room_id: id, request_id: crypto.randomUUID(), channel: "email" });

// ---------------------------------------------------------------------------
// 1. The rep pressed Also send by email after the free text went (the link
//    on both lanes: link_channels [whatsapp_text, email]). The recheck reads
//    only the lane that went last (the email), so the free text is never
//    read again: Meta fails it late (131026, not on WhatsApp), or HighLevel
//    never hands it on (pending). Then the email bounces.
//
// emailBounced "sends the free text instead" on the free text's current
// key: the room's first WhatsApp key, whose row is the old free text
// ("sent" as stored, never read again). The message service answers it as
// the repeat it is (nothing new goes), lateSend calls that "went", and the
// room says "The email bounced, so the link went on WhatsApp." and claims
// the email's line, so nothing reads either lane again. The lead has no
// link on any channel; the rep is told it went.
// ---------------------------------------------------------------------------

describe("m1 providers r4 quirks: the bounce's WhatsApp backup answered by the old free text", () => {
  test("HELD (control): with the email only, a bounce sends a fresh free text that HighLevel takes", async () => {
    const w = world();
    const LEAD = "stress-m1p4q-bounce-ctl";
    // The window is shut at the press (email only), and the lead writes on WhatsApp a minute later.
    w.addLead({ id: LEAD, inboundAgoMs: null, email_out: [{ kind: "ok", reads: ["delivered"] }] });
    const id = await w.opened(LEAD);
    expect(w.room(id).link_channels).toEqual(["email"]);
    w.leadWrote(LEAD);
    const mail = w.msgs(LEAD, "email")[0] as Row;
    w.becomes(String(mail.ghl_message_id), { status: "bounced", messageType: "TYPE_EMAIL" });
    await w.minutes(id, 2);
    expect(w.posts.filter(p => p.lead === LEAD && p.lane === "text").length).toBe(1);
    expect(w.lines(id)).toContain("The email bounced, so the link went on WhatsApp.");
  });

  test("bounce-backup-answered-by-unread-earlier-text (late 131026): the room says the link went on WhatsApp after the bounce, and nothing went", async () => {
    const w = world();
    const LEAD = "stress-m1p4q-both-131026";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: [{ kind: "ok", reads: ["sent"] }], email_out: [{ kind: "ok", reads: ["delivered"] }] });
    const id = await w.opened(LEAD);
    expect(w.room(id).link_channels).toEqual(["whatsapp_text"]);
    // The rep sends it both ways, as the panel allows.
    await sendByEmail(w, id);
    await w.drain();
    expect(w.room(id).link_channels).toEqual(["whatsapp_text", "email"]);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    const mail = w.msgs(LEAD, "email")[0] as Row;
    // Meta fails the free text 40 s on (not on WhatsApp); the address bounces.
    w.clock.now += 40 * S;
    w.becomes(String(text.ghl_message_id), META_131026);
    w.becomes(String(mail.ghl_message_id), { status: "bounced", messageType: "TYPE_EMAIL" });
    await w.minutes(id, 4);
    const textPosts = w.posts.filter(p => p.lead === LEAD && p.lane === "text");
    // What the lead holds now, as HighLevel's conversation shows it.
    const reached = w.conversation.filter(c => c.lead === LEAD && !["failed", "bounced", "pending", "undelivered"].includes(c.status));
    const said = w.lines(id).filter(t => /bounced|WhatsApp/i.test(t));
    expect(
      { saysWentOnWhatsApp: said.includes("The email bounced, so the link went on WhatsApp."), saysNeitherReached: said.some(t => /neither way reached|Read the link out/.test(t)) },
      `the free text failed at Meta (131026) and the email bounced: the lead has the link on no channel (${reached.length} message(s) reached them, ` +
        `${textPosts.length} WhatsApp POST(s) in all, so nothing new went after the bounce); the room's lines: ${JSON.stringify(said)}`,
    ).toEqual({ saysWentOnWhatsApp: false, saysNeitherReached: true });
  });

  test("bounce-backup-answered-by-unread-earlier-text (stuck pending): HighLevel never handed the free text on, the email bounces, and the room says it went on WhatsApp", async () => {
    const w = world();
    const LEAD = "stress-m1p4q-both-pending";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: [{ kind: "ok", reads: ["pending"] }], email_out: [{ kind: "ok", reads: ["delivered"] }] });
    const id = await w.opened(LEAD);
    expect((w.msgs(LEAD, "whatsapp")[0] as Row).provider_status).toBe("pending");
    await sendByEmail(w, id);
    await w.drain();
    expect(w.room(id).link_channels).toEqual(["whatsapp_text", "email"]);
    const mail = w.msgs(LEAD, "email")[0] as Row;
    w.clock.now += 30 * S;
    w.becomes(String(mail.ghl_message_id), { status: "bounced", messageType: "TYPE_EMAIL" });
    await w.minutes(id, 4);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    const said = w.lines(id).filter(t => /bounced|WhatsApp|HighLevel/i.test(t));
    expect(
      { saysWentOnWhatsApp: said.includes("The email bounced, so the link went on WhatsApp."), textStatusAtHighLevel: w.later.get(String(text.ghl_message_id))?.status },
      `HighLevel still holds the free text as pending and the email bounced; the room's lines: ${JSON.stringify(said)}`,
    ).toEqual({ saysWentOnWhatsApp: false, textStatusAtHighLevel: "pending" });
  });
});

// ---------------------------------------------------------------------------
// 2. The cascade's free text fails for good (Meta's 131026 in the read-back,
//    or HighLevel's own 24-hour check refusing it while the cockpit's inbox
//    called the window open), and the email right after it meets
//    HighLevel's burst limit (a 429: nothing went, and it passes in a
//    minute).
//
// sendLinkHeld says a refusal is tried again only when EVERY lane's refusal
// is passing (m1 round 2, throttled-all-lanes-said-final). One hard refusal
// on a lane that is now out of the running makes the whole link final: "the
// link did not go on any channel (...)", linkRefusalFinal, and the minute's
// re-ask never asks the email again, though the email is the one lane left
// and HighLevel would take it a minute later.
// ---------------------------------------------------------------------------

describe("m1 providers r4 quirks: a hard WhatsApp refusal beside an email 429", () => {
  test("HELD (control): a 429 on both lanes is tried again, and the email goes the next minute", async () => {
    const w = world();
    const LEAD = "stress-m1p4q-429-both";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: [{ kind: "throttled" }, { kind: "ok" }], email_out: [{ kind: "throttled" }, { kind: "ok" }] });
    const id = await w.opened(LEAD);
    expect(linkRetrying(w.room(id).refusal)).toBe(true);
    await w.minutes(id, 2);
    expect(w.room(id).link_sent_at).toBeTruthy();
  });

  test("hard-text-refusal-then-email-429-said-final (131026 in the read-back): the link is said final and the email is never asked again", async () => {
    const w = world();
    const LEAD = "stress-m1p4q-131026-429";
    w.addLead({
      id: LEAD,
      inboundAgoMs: 2 * HOUR,
      text: [{ kind: "ok", reads: ["failed"], meta: { error: "Message Undeliverable. (131026)" } }],
      email_out: [{ kind: "throttled" }, { kind: "ok", reads: ["delivered"] }],
    });
    const id = await w.opened(LEAD);
    const first = String(w.room(id).refusal ?? "");
    await w.minutes(id, 5);
    const emails = w.posts.filter(p => p.lead === LEAD && p.lane === "email");
    expect(
      { finalAtOnce: linkRefusalFinal(first), emailReachedLead: emails.some(p => p.reached) },
      `the free text failed for good (not on WhatsApp) and HighLevel answered the email's POST with one 429; the room said ${JSON.stringify(first)} ` +
        `and five minutes on the email was asked ${emails.length} time(s) (${JSON.stringify(emails.map(p => p.kind))})`,
    ).toEqual({ finalAtOnce: false, emailReachedLead: true });
  });

  test("hard-text-refusal-then-email-429-said-final (HighLevel's window check): the inbox called the window open, HighLevel's conversation did not, and the email's 429 makes the link final", async () => {
    const w = world();
    const LEAD = "stress-m1p4q-window-429";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, hlWindowShut: true, email_out: [{ kind: "throttled" }, { kind: "ok", reads: ["delivered"] }] });
    const id = await w.opened(LEAD);
    const first = String(w.room(id).refusal ?? "");
    await w.minutes(id, 5);
    const emails = w.posts.filter(p => p.lead === LEAD && p.lane === "email");
    expect(
      { finalAtOnce: linkRefusalFinal(first), emailReachedLead: emails.some(p => p.reached) },
      `the room said ${JSON.stringify(first)}; five minutes on the email was asked ${emails.length} time(s)`,
    ).toEqual({ finalAtOnce: false, emailReachedLead: true });
  });
});

// ---------------------------------------------------------------------------
// 3. HighLevel's conversation search (which convoSend reads for the lead's
//    24 hours, WhatsApp only) does not answer, while the contact read and
//    the email lane work. The message service stops before the row ("not
//    sent yet"), and sendLinkHeld returns at once ("HighLevel did not
//    answer ... tried again in a minute") without trying the next lane. For
//    as long as the search is down the email is never asked, and at
//    LINK_RETRY_S the link is said final ("HighLevel did not take the link
//    in 10 minutes"), with the email never tried once.
// ---------------------------------------------------------------------------

describe("m1 providers r4 quirks: HighLevel's conversation search down, its email lane up", () => {
  test("whatsapp-presend-read-down-email-never-tried: eleven minutes of 'tried again in a minute', the email never asked, then said final", async () => {
    const w = world();
    const LEAD = "stress-m1p4q-search-down";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, searchDown: true, email_out: [{ kind: "ok", reads: ["delivered"] }] });
    const id = await w.opened(LEAD);
    await w.minutes(id, 11);
    const emails = w.posts.filter(p => p.lead === LEAD && p.lane === "email");
    const searches = w.searches.filter(s => s.lead === LEAD).length;
    expect(
      { emailAsked: emails.length > 0, linkSent: Boolean(w.room(id).link_sent_at) },
      `the lead has a working email address; the free text stopped ${searches} time(s) at the conversation search; ` +
        `eleven minutes on the room says ${JSON.stringify(w.room(id).refusal)} and the email was asked ${emails.length} time(s)`,
    ).toEqual({ emailAsked: true, linkSent: true });
  });
});

// ---------------------------------------------------------------------------
// 4. Meta's per-lead failures in words, with no code: "Message
//    Undeliverable." (131026), "Message failed to send because more than 24
//    hours have passed since the customer last replied to this number."
//    (131047), "This message was not delivered to maintain healthy
//    ecosystem engagement." (131049).
//
// rooms.ts windowShutFailure reads 131047 by its words as well as its code;
// leadSpecificFailure (the room source's WhatsApp health) reads codes only.
// So two leads whose number is not on WhatsApp in the room source's hour
// read as "WhatsApp video links are failing", and every next lead's link
// skips WhatsApp for the hour.
// ---------------------------------------------------------------------------

describe("m1 providers r4 quirks: Meta's per-lead failures in words count against the number", () => {
  const ago = (ms: number) => new Date(Date.parse("2026-10-04T07:00:00Z") - ms).toISOString();
  const health = (errors: string[]): Row[] => [
    ...[1, 2, 3].map(n => ({ id: fakeUuid(), request_id: crypto.randomUUID(), contact_id: `stress-m1p4q-h-ok-${n}`, channel: "whatsapp", source: "room", state: "delivered", created_at: ago((10 + n) * MIN) })),
    ...errors.map((error, n) => ({ id: fakeUuid(), request_id: crypto.randomUUID(), contact_id: `stress-m1p4q-h-bad-${n}`, channel: "whatsapp", source: "room", state: "failed", error, created_at: ago((20 + n) * MIN) })),
  ];

  test("HELD (control): the same two failures with Meta's codes leave the number healthy, and the next lead's link goes on WhatsApp", async () => {
    const w = world({ health: health(["Message Undeliverable. (131026)", "Message Undeliverable. (131026)"]) });
    const LEAD = "stress-m1p4q-health-ctl";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR });
    const id = await w.opened(LEAD);
    expect(w.room(id).link_channels).toEqual(["whatsapp_text"]);
  });

  test("wordy-meta-lead-failure-counts-against-room-whatsapp-health: two leads not on WhatsApp (Meta's words, no code) switch the next lead's link to email", async () => {
    const words = [
      "Message Undeliverable.",
      "Message failed to send because more than 24 hours have passed since the customer last replied to this number.",
    ];
    const w = world({ health: health(words) });
    const LEAD = "stress-m1p4q-health-words";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR });
    const id = await w.opened(LEAD);
    expect(
      {
        nextLeadChannels: w.room(id).link_channels,
        readAsLeadSpecific: [...words, "This message was not delivered to maintain healthy ecosystem engagement."].map(x => leadSpecificFailure(x)),
      },
      `the room source's hour holds 3 delivered and 2 failed free texts, each failure about one lead only (Meta's words without the code); ` +
        `the next lead (window open, on WhatsApp) got the link on ${JSON.stringify(w.room(id).link_channels)}`,
    ).toEqual({ nextLeadChannels: ["whatsapp_text"], readAsLeadSpecific: [true, true, true] });
  });
});

// ---------------------------------------------------------------------------
// 5. The lead is merged away in HighLevel after the link went (the contact
//    read answers 400 "Contact not found"), and the rep presses Also send by
//    email. The message service stops before the row ("not sent yet", its
//    cause HighLevel's 400 for the contact), and room.send answers
//    ROOMS_COPY.email_not_yet: "HighLevel did not answer, so the email has
//    not gone. Press it again in a minute." HighLevel did answer: the lead
//    is gone, and every press says the same. The cascade itself says
//    contact_gone_send for the same answer.
// ---------------------------------------------------------------------------

describe("m1 providers r4 quirks: Also send by email for a lead merged away", () => {
  test("send-by-email-merged-contact-said-highlevel-did-not-answer: every press is told HighLevel did not answer and to press again", async () => {
    const w = world();
    const LEAD = "stress-m1p4q-merged-send";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR });
    const id = await w.opened(LEAD);
    expect(w.room(id).link_channels).toEqual(["whatsapp_text"]);
    (w.leads.get(LEAD) as Lead).contact = "gone";
    const said: string[] = [];
    for (let i = 0; i < 3; i++) {
      w.clock.now += MIN;
      const out = await sendByEmail(w, id).catch(e => e as ApiRefusal);
      said.push(out instanceof ApiRefusal ? out.message : "went");
    }
    expect(
      { saysGone: said.every(s => /not in HighLevel|merged|deleted/i.test(s)), saysPressAgain: said.some(s => /press it again/i.test(s)) },
      `HighLevel answered each contact read with 400 Contact not found (merged); the rep was told ${JSON.stringify(said)}`,
    ).toEqual({ saysGone: true, saysPressAgain: false });
  });
});

// ---------------------------------------------------------------------------
// 6. The host deletes the room's Zoom meeting in Zoom after the link went
//    (8 minutes in), and Zoom's meeting.deleted reaches the door only on
//    Zoom's retry, five minutes later (the door did not answer the first
//    delivery). Meanwhile the sweep's R4 closed the room at the lead's ten
//    minutes: expired, lead_no_show, result no_join ("Closed: the lead did
//    not join in 10 minutes.").
//
// applyRoomEvent refuses every event on a final room except a late join or
// knock, so Zoom's word that the link was dead from minute 8 is dropped:
// the room stays the lead's no-show, and the next room's link (the rep's
// "send a new link") never says the first one no longer works
// (replacedDeleted reads end_reason meeting_deleted only).
// ---------------------------------------------------------------------------

describe("m1 providers r4 quirks: Zoom's meeting.deleted delivered late, after the timer's close", () => {
  test("zoom-deleted-late-after-timer-close-kept-as-no-show: the meeting deleted at minute 8 stays the lead's no-show", async () => {
    const w = world({ waGate: false });
    const LEAD = "stress-m1p4q-zoom-late-deleted";
    w.addLead({ id: LEAD, inboundAgoMs: null, email_out: [{ kind: "ok", reads: ["delivered"] }] });
    const madeOut = await w.rooms.actions["room.create"]!(setter, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "zoom", call_kind: "intro", purpose: "manual" });
    const id = String((madeOut.room as Row).id);
    const meeting = "86012349999";
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(w.room(id).version) + 1 },
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
        join_url: `https://us06web.zoom.us/j/${meeting}?pwd=stress`,
        provider_meeting_id: meeting,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(w.room(id).version) + 1,
      },
    });
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.drain();
    expect(w.room(id).link_channels).toEqual(["email"]);
    const deletedAt = w.clock.now + 8 * MIN;
    // Minute 10: the sweep's R4 (cockpit_sales_rooms_close ... 'expired', 'lead_no_show', result no_join).
    w.clock.now += 10 * MIN;
    Object.assign(w.room(id), {
      state: "expired",
      end_reason: "lead_no_show",
      result: "no_join",
      ended_at: w.db.iso(),
      version: Number(w.room(id).version) + 1,
    });
    // Minute 13: Zoom's retry of the deletion reaches the door.
    w.clock.now += 3 * MIN;
    const code = String(w.room(id).code);
    const evId = "22222222-3333-4444-8555-666666666666";
    w.db.seed("cockpit_sales_room_events", [
      {
        id: evId,
        room_id: id,
        kind: "zoom.meeting.deleted",
        source: "zoom",
        at: w.db.iso(),
        dedupe_key: `zoom:meeting.deleted:uuid-${meeting}`,
        detail: { event: "meeting.deleted", event_ts: deletedAt, payload: { object: { id: meeting, uuid: `uuid-${meeting}`, topic: `Mahara call ${code}` } } },
      },
    ]);
    const answer = await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.deleted", event_id: evId, payload: {} }).catch(e => (e as Error).message);
    await w.drain();
    const r = w.room(id);
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.id === evId) as Row;
    expect(
      { end_reason: r.end_reason, result: r.result },
      `the host deleted the meeting at minute 8 (Zoom's own event time), two minutes before the lead's ten ran out; the room still reads ` +
        `${JSON.stringify({ state: r.state, end_reason: r.end_reason, result: r.result })}, the lead's no-show on a link that was dead ` +
        `(the door's answer: ${JSON.stringify(answer)}; the event ${JSON.stringify({ handled_at: ev.handled_at ?? null, text: ev.text ?? null })})`,
    ).toEqual({ end_reason: "meeting_deleted", result: "failed" });
  });
});
