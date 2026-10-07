// bun test supabase/functions/sales-api/m1_providers_r5.test.ts
//
// Milestone 1, video-link round 5, provider quirks on sales-api's side of
// the video link. The pilot's settings (m1-scope.md section 3): rooms on,
// both providers, every send lane on, test_only with the test leads listed,
// count_on_join, settle, wrap and auto_on_miss off, short_link off (so the
// call_link template lane is never used), live off. The WhatsApp gate is
// open unless a test closes it.
//
// The harness is m1_providers_r4_quirks.test.ts's (index.ts convoSend as it
// runs and stores a send), with one more HighLevel answer: its own 400 or
// 422 about the lead ("refused"), stored failed with "HighLevel said 4xx".
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
const SETTER = "stress-m1p5-setter@stress.invalid";
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
  /** HighLevel answers its own 400 or 422 about this lead: certainly not sent. */
  | { kind: "refused"; status: 400 | 422; message: string }
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

function world(o: { waGate?: boolean; health?: Row[]; hosts?: Row[] } = {}) {
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
  w.db.seed("cockpit_sales_room_hosts", o.hosts ?? [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
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
    if (plan.kind === "refused") {
      posts.push({ lead: contactId, lane, at: w.clock.now, request_id: requestId, reached: false, kind: plan.kind });
      row.state = "failed";
      row.error = `HighLevel said ${plan.status}: ${plan.message}`;
      throw new ApiRefusal(`HighLevel did not send it: HighLevel said ${plan.status}: ${plan.message}`, 502, { certain: true });
    }
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
// 1. The email bounces while HighLevel's contacts read is throttled (its
//    429 burst limit). The window was shut at the press, so the link went by
//    email only; the lead writes on WhatsApp; the email bounces.
//    emailBounced reads the contact with readContact, which turns "HighLevel
//    did not answer" into null, the same as "no contact": no plan is read,
//    the line stays "The email bounced. Read the link out." and it is claimed
//    as the email lane's late-failure line (failedLate). Every later minute
//    finds the line said (failedLateNoted) and does nothing, so the free text
//    that could reach the lead never goes. whatsappFailedLate and
//    pendingBackup read the same contact with readContactOrGone and say the
//    doubt now, the backup the next minute (doubtContactUnread); the bounce
//    does not.
// ---------------------------------------------------------------------------

describe("m1 providers r5: the bounce read while HighLevel's contacts read answers 429", () => {
  test("HELD (control): the bounce read with the contact readable sends the free text", async () => {
    const w = world();
    const LEAD = "stress-m1p5-bounce429-ctl";
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

  test("bounce-backup-lost-to-contact-read-429: one throttled contact read at the bounce, and the free text never goes", async () => {
    const w = world();
    const LEAD = "stress-m1p5-bounce429";
    w.addLead({ id: LEAD, inboundAgoMs: null, email_out: [{ kind: "ok", reads: ["delivered"] }] });
    const id = await w.opened(LEAD);
    expect(w.room(id).link_channels).toEqual(["email"]);
    w.leadWrote(LEAD);
    const mail = w.msgs(LEAD, "email")[0] as Row;
    w.becomes(String(mail.ghl_message_id), { status: "bounced", messageType: "TYPE_EMAIL" });
    // HighLevel's burst limit on its contacts read for that one minute.
    const lead = w.leads.get(LEAD) as { contact?: string };
    lead.contact = "throttled";
    await w.minutes(id, 1);
    lead.contact = "ok";
    await w.minutes(id, 4);
    const texts = w.posts.filter(p => p.lead === LEAD && p.lane === "text").length;
    expect(
      { texts, lines: w.lines(id).filter(t => /bounced/i.test(t)) },
      `The lead's window was open and nothing held WhatsApp; one 429 on HighLevel's contacts read at the bounce, then four minutes ` +
        `of a readable contact, and ${texts} free text went (the timeline: ${JSON.stringify(w.lines(id).filter(t => /bounced/i.test(t)))})`,
    ).toEqual({ texts: 1, lines: ["The email bounced, so the link went on WhatsApp."] });
  });
});

// ---------------------------------------------------------------------------
// 2. HighLevel answers the link's send with its own 400 about the lead (an
//    address HighLevel will not send to). index.ts convoSend stores the row
//    failed and answers "HighLevel did not send it: HighLevel said 400: ...".
//    rooms.ts passingFailure reads every "HighLevel said 400" or "422" as a
//    refusal that passes in a minute (it was widened for HighLevel's
//    gateway pages during a deploy). So a refusal that will never pass is
//    said as "HighLevel did not take the link yet (...), so it is tried
//    again in a minute": the panel's "retrying" moment, with no read-out,
//    for the ten minutes of LINK_RETRY_S, and a new send to HighLevel every
//    minute on a fresh key (a passing refusal spends none of the lane's
//    LINK_RETRIES). The rep waits while the lead's ten minutes run out.
// ---------------------------------------------------------------------------

describe("m1 providers r5: HighLevel's own 400 about the lead", () => {
  test("HELD (control): a refusal with the lead's own words (not 4xx) is said as final, and nothing more goes", async () => {
    const w = world({ waGate: false });
    const LEAD = "stress-m1p5-refused-ctl";
    w.addLead({ id: LEAD, inboundAgoMs: null, email_out: [{ kind: "ok", reads: ["failed"], meta: { error: "Mailbox does not exist" } }] });
    const id = await w.opened(LEAD);
    await w.minutes(id, 3);
    expect(linkRefusalFinal(w.room(id).refusal)).toBe(true);
    expect(w.posts.filter(p => p.lead === LEAD).length).toBe(1);
  });

  test("lead-specific-highlevel-400-said-as-retrying: ten minutes of 'tried again in a minute' and a send every minute for an address HighLevel refuses", async () => {
    const w = world({ waGate: false });
    const LEAD = "stress-m1p5-refused-400";
    w.addLead({
      id: LEAD,
      inboundAgoMs: null,
      email_out: [{ kind: "refused", status: 400, message: "The email address of this contact is not valid" }],
    });
    const id = await w.opened(LEAD);
    const first = String(w.room(id).refusal ?? "");
    await w.minutes(id, 6);
    const sends = w.posts.filter(p => p.lead === LEAD).length;
    const said = String(w.room(id).refusal ?? "");
    expect(
      { retryingAtPress: linkRetrying(first), sendsInSixMinutes: sends, stillRetrying: linkRetrying(said) },
      `HighLevel refused the email for this lead's address (400). The room said ${JSON.stringify(first)} at the press, ` +
        `asked HighLevel ${sends} times in six minutes, and still says ${JSON.stringify(said)}`,
    ).toEqual({ retryingAtPress: false, sendsInSixMinutes: 1, stillRetrying: false });
  });
});

// ---------------------------------------------------------------------------
// 3. The closer's Zoom meeting ends early. The host check (desk.py rooms
//    --check-hosts, every 10 minutes) saw the closer in a Zoom meeting at
//    10:03 and stored zoom_live_until as the meeting's own scheduled end
//    (start_time + duration: 11:00, Zoom's scheduled length, desk/rooms.py
//    zoom_seat). The meeting ends at 10:05, as most do before their slot
//    runs out. At 10:06 the closer's call to a lead does not connect and
//    they press Send a video link on Zoom: sales-api's providerRefusal reads
//    zoom_live from that column and refuses "Your Zoom is in another
//    meeting. End it or use Meet.", though it has ended, until the next host
//    check (up to ten minutes). The room worker reads Zoom's live list itself
//    at the create, so the refusal is only the column's.
// ---------------------------------------------------------------------------

describe("m1 providers r5: a Zoom meeting that ended before its scheduled end", () => {
  const CLOSER = "stress-m1p5-closer@stress.invalid";
  const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer" };
  function hosts(liveUntilMs: number | null, checkedAgoMs: number): Row[] {
    const now = Date.parse("2026-10-04T07:00:00Z");
    return [
      { email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true },
      {
        email: CLOSER,
        zoom_user_id: "Z-closer",
        zoom_status: "licensed",
        google_ok: true,
        zoom_live_until: liveUntilMs === null ? null : new Date(now + liveUntilMs).toISOString(),
        checked_at: new Date(now - checkedAgoMs).toISOString(),
      },
    ];
  }
  async function press(w: ReturnType<typeof world>, lead: string) {
    w.db.seed("cockpit_sales_people", [{ email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer", active: true }]);
    return w.rooms.actions["room.create"]!(closer, {
      request_id: crypto.randomUUID(),
      contact_id: lead,
      provider: "zoom",
      call_kind: "intro",
      purpose: "manual",
    }).then(
      out => ({ made: true, said: String(((out as Row).room as Row)?.state ?? "") }),
      e => ({ made: false, said: String((e as Error).message) }),
    );
  }

  test("HELD (control): with the host check's last read showing no live meeting, the closer's Zoom room is asked for", async () => {
    const w = world({ hosts: hosts(null, 3 * MIN) });
    const LEAD = "stress-m1p5-zoombusy-ctl";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR });
    const out = await press(w, LEAD);
    expect(out.made).toBe(true);
  });

  test("zoom-busy-held-to-scheduled-end: a meeting the check saw three minutes ago, ended since, refuses the closer's Zoom rooms until its scheduled end", async () => {
    // Seen at 10:03 (checked_at three minutes ago); scheduled to end at 11:00 (54 minutes from now); ended at 10:05.
    const w = world({ hosts: hosts(54 * MIN, 3 * MIN) });
    const LEAD = "stress-m1p5-zoombusy";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR });
    const out = await press(w, LEAD);
    expect(
      out,
      "The host check saw the closer in a meeting three minutes ago and stored its scheduled end (54 minutes on); the meeting has " +
        `ended. The closer's Zoom room after a missed call was answered: ${JSON.stringify(out.said)}`,
    ).toEqual({ made: true, said: expect.anything() });
  });
});

// ---------------------------------------------------------------------------
// 4. Meta's pair rate limit (131056: too many messages from the business
//    number to the same lead in a short time) is about one lead and one
//    moment: the rep's missed-call message and the link a few seconds apart
//    can meet it. rooms.ts leadSpecificFailure (the room source's WhatsApp
//    health) leaves out Meta's per-lead codes in META_LEAD_FAILURES and
//    HighLevel's 429; 131056 is in neither, so two leads who met it in the
//    room source's hour read as "WhatsApp video links are failing", and
//    every next lead's link skips WhatsApp for the hour.
// ---------------------------------------------------------------------------

describe("m1 providers r5: Meta's pair rate limit counts against the number", () => {
  const ago = (ms: number) => new Date(Date.parse("2026-10-04T07:00:00Z") - ms).toISOString();
  const health = (errors: string[]): Row[] => [
    ...[1, 2, 3].map(n => ({ id: fakeUuid(), request_id: crypto.randomUUID(), contact_id: `stress-m1p5-h-ok-${n}`, channel: "whatsapp", source: "room", state: "delivered", created_at: ago((10 + n) * MIN) })),
    ...errors.map((error, n) => ({ id: fakeUuid(), request_id: crypto.randomUUID(), contact_id: `stress-m1p5-h-bad-${n}`, channel: "whatsapp", source: "room", state: "failed", error, created_at: ago((20 + n) * MIN) })),
  ];

  test("HELD (control): two leads not on WhatsApp (131026) leave the number healthy", async () => {
    const w = world({ health: health(["Message Undeliverable. (131026)", "Message Undeliverable. (131026)"]) });
    const LEAD = "stress-m1p5-pair-ctl";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR });
    const id = await w.opened(LEAD);
    expect(w.room(id).link_channels).toEqual(["whatsapp_text"]);
  });

  test("pair-rate-limit-131056-counts-against-room-whatsapp-health: two leads at Meta's pair rate limit switch the next lead's link to email", async () => {
    const pair = "(#131056) (Business Account, Consumer Account) pair rate limit hit";
    const w = world({ health: health([pair, pair]) });
    const LEAD = "stress-m1p5-pair";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR });
    const id = await w.opened(LEAD);
    expect(
      { nextLeadChannels: w.room(id).link_channels, readAsLeadSpecific: leadSpecificFailure(pair) },
      `the room source's hour holds 3 delivered and 2 free texts Meta refused at its pair rate limit (131056, one lead and one moment); ` +
        `the next lead (window open, on WhatsApp) got the link on ${JSON.stringify(w.room(id).link_channels)}`,
    ).toEqual({ nextLeadChannels: ["whatsapp_text"], readAsLeadSpecific: true });
  });
});

// ---------------------------------------------------------------------------
// 5. HighLevel's gateway answers the second room's link with a 503 (nothing
//    went), seconds after the first room's link went to the same lead. The
//    rep sent a Meet link, ended that room a few seconds later (the lead
//    asked for another time slot, or the rep pressed the wrong provider) and
//    sent a new one (15 seconds between the two sends). The message service stores the second send "unclear"
//    (a 5xx: it may have gone), and rooms.ts maybeSent reads the lead's
//    conversation for it (conversationVerdict over index.ts sentSince):
//    matchSent looks back 20 seconds before the send was asked, and
//    sendrules.ts sameText calls two messages the same when one starts with
//    the other's first 60 characters. Both rooms' links start "Hi Huda, your
//    call with Tara Setter from Mahara Media is ready now. Join here:", so
//    the first room's delivered message is taken as the second room's send:
//    its row is confirmed "sent" with the first message's HighLevel id, the
//    room says "Link sent on WhatsApp." and nothing more goes. The lead has
//    only the first room's link, which is closed.
// ---------------------------------------------------------------------------

describe("m1 providers r5: a lost send matched to the previous room's link", () => {
  const SECOND_URL = "https://meet.google.com/xyz-wxyz-xyz";
  async function twoRooms(w: ReturnType<typeof world>, lead: string, gapMs: number) {
    const first = await w.opened(lead);
    expect(w.room(first).link_channels).toEqual(["whatsapp_text"]);
    w.clock.now += gapMs;
    w.ended(first);
    const second = await w.made(lead);
    w.room(second).join_url = SECOND_URL;
    await w.ready(second);
    return { first, second };
  }

  test("HELD (control): the same lost send a minute after the first room's link is read as not there and goes again", async () => {
    const w = world();
    const LEAD = "stress-m1p5-twin-ctl";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: [{ kind: "ok", reads: ["delivered"] }, { kind: "lost5xx" }, { kind: "ok", reads: ["delivered"] }] });
    const { second } = await twoRooms(w, LEAD, 2 * MIN);
    expect(w.room(second).link_sent_at ?? null).toBeNull();
    await w.minutes(second, 3);
    const reached = w.conversation.filter(c => c.lead === LEAD && c.body.includes(SECOND_URL));
    expect(reached.length).toBe(1);
  });

  test("lost-send-matched-to-previous-room-link: the second room's link never went, and the room says it went on WhatsApp", async () => {
    const w = world();
    const LEAD = "stress-m1p5-twin";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: [{ kind: "ok", reads: ["delivered"] }, { kind: "lost5xx" }, { kind: "ok", reads: ["delivered"] }] });
    const { second } = await twoRooms(w, LEAD, 0);
    await w.minutes(second, 3);
    const reached = w.conversation.filter(c => c.lead === LEAD && c.body.includes(SECOND_URL));
    const r = w.room(second);
    const [a, b] = w.posts.filter(p => p.lead === LEAD).map(p => new Date(p.at).toISOString().slice(11, 19));
    expect(
      { secondLinkReachedLead: reached.length, roomSaysSent: Boolean(r.link_sent_at) },
      `The first room's link went at ${a}Z; the rep ended that room and the second room's link met a gateway 503 at ${b}Z (nothing went). ` +
        `The second room says ${JSON.stringify(w.lines(second).filter(t => /Link sent|link/i.test(t)))}, link_sent_at ${String(r.link_sent_at ?? null)}; ` +
        `messages with the second room's link in the lead's conversation: ${reached.length}`,
    ).toEqual({ secondLinkReachedLead: 1, roomSaysSent: true });
  });
});
