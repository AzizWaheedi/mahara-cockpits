// bun test supabase/functions/sales-api/m1_providers_r6.test.ts
//
// Milestone 1, video-link round 6, provider quirks on sales-api's side of
// the video link. The pilot's settings (m1-scope.md section 3): rooms on,
// both providers, every send lane on, test_only with the test leads listed,
// count_on_join, settle, wrap and auto_on_miss off, short_link off (so the
// call_link template lane is never used), live off. The WhatsApp gate is
// open unless a test closes it.
//
// The harness is m1_providers_r5.test.ts's (index.ts convoSend as it runs
// and stores a send), copied so this file stands alone.
//
// A failing test is a finding; tests marked HELD pass. Nothing leaves this
// process; every lead is invented (stress-...).
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
const SETTER = "stress-m1p6-setter@stress.invalid";
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
const BOUNCED = { status: "bounced", messageType: "TYPE_EMAIL" };
const sendByEmail = (w: ReturnType<typeof world>, id: string) =>
  w.rooms.actions["room.send"]!(setter, { room_id: id, request_id: crypto.randomUUID(), channel: "email" });
const statusOf = async (w: ReturnType<typeof world>, id: string) =>
  (await w.rooms.actions["room.status"]!(setter, { room_id: id })) as { room: Row; events: Row[] };

// ---------------------------------------------------------------------------
// 1. The link went on WhatsApp (Meta's one grey tick), and the lead asked
//    for it by email too, so the rep pressed Also send by email. The email
//    bounces; the minute's read (recheckLink reads only the link's LAST lane,
//    email) finds the free text still "sent" at HighLevel and emailBounced
//    answers it with that same free text: "The email bounced, so the link
//    went on WhatsApp." (failedLate claims link.failed_late:{room}:email).
//    Meta then fails the free text (131026, the number is not on WhatsApp),
//    as it does seconds to minutes after "sent". Every later minute
//    recheckLink reads the last lane again, finds its failed-late line
//    claimed (failedLateNoted) and returns: the free text's failure is never
//    read, the panel keeps saying "The email bounced. The link went on
//    WhatsApp at ...", and the room's view lists WhatsApp as standing. The
//    lead has no working link and the rep waits for them.
// ---------------------------------------------------------------------------

describe("m1 providers r6: the free text fails after the bounce's line said it went", () => {
  async function bothLanes(w: ReturnType<typeof world>, lead: string) {
    w.addLead({ id: lead, inboundAgoMs: 2 * HOUR, text: [{ kind: "ok", reads: ["sent"] }], email_out: [{ kind: "ok", reads: ["delivered"] }] });
    const id = await w.opened(lead);
    expect(w.room(id).link_channels).toEqual(["whatsapp_text"]);
    w.clock.now += 20 * S;
    await sendByEmail(w, id);
    await w.drain();
    expect(w.room(id).link_channels).toEqual(["whatsapp_text", "email"]);
    const text = w.msgs(lead, "whatsapp")[0] as Row;
    const mail = w.msgs(lead, "email")[0] as Row;
    return { id, textGhl: String(text.ghl_message_id), mailGhl: String(mail.ghl_message_id) };
  }

  test("HELD (control): Meta fails the free text before the bounce is read, and the room says neither way reached the lead", async () => {
    const w = world();
    const LEAD = "stress-m1p6-bounce-text-ctl";
    const { id, textGhl, mailGhl } = await bothLanes(w, LEAD);
    w.becomes(mailGhl, BOUNCED);
    w.becomes(textGhl, META_131026);
    await w.minutes(id, 3);
    const st = await statusOf(w, id);
    expect(st.room.link_failed).toEqual(expect.arrayContaining(["email", "whatsapp_text"]));
    expect(w.lines(id)).toContain("The email bounced too, so neither way reached the lead. Read the link out.");
  });

  test("bounce-line-whatsapp-went-then-whatsapp-fails-never-read: the room keeps saying the link went on WhatsApp after Meta failed it", async () => {
    const w = world();
    const LEAD = "stress-m1p6-bounce-text";
    const { id, textGhl, mailGhl } = await bothLanes(w, LEAD);
    w.becomes(mailGhl, BOUNCED);
    await w.minutes(id, 1);
    expect(w.lines(id)).toContain("The email bounced, so the link went on WhatsApp.");
    // Meta's verdict on the free text comes in after that minute's read.
    w.becomes(textGhl, META_131026);
    await w.minutes(id, 4);
    const st = await statusOf(w, id);
    const failed = (st.room.link_failed as string[] | undefined) ?? [];
    const waLines = w.lines(id).filter(t => /WhatsApp failed|neither way|not on WhatsApp/i.test(t));
    expect(
      { whatsappSaidFailed: failed.includes("whatsapp_text"), lines: waLines.length > 0 },
      `Meta failed the free text (131026) after the bounce's line; four minutes later the room's failed lanes are ${JSON.stringify(failed)} ` +
        `and its timeline says ${JSON.stringify(w.lines(id).filter(t => /link|email|WhatsApp/i.test(t)))}`,
    ).toEqual({ whatsappSaidFailed: true, lines: true });
  });
});

describe("m1 providers r6: Also send by email held by HighLevel while Meta fails the free text", () => {
  test("HELD (control): with the email alone stuck at pending, the room doubts it and says so", async () => {
    const w = world({ waGate: false });
    const LEAD = "stress-m1p6-stuck-mail-ctl";
    w.addLead({ id: LEAD, inboundAgoMs: null, email_out: [{ kind: "ok", reads: ["pending"] }] });
    const id = await w.opened(LEAD);
    expect(w.room(id).link_channels).toEqual(["email"]);
    await w.minutes(id, 3);
    expect(Boolean(w.room(id).link_unconfirmed_at)).toBe(true);
  });

  test("text-failed-late-beside-stuck-press-email-never-read: Meta fails the free text, the pressed email never leaves HighLevel, and the room still says the link went", async () => {
    const w = world();
    const LEAD = "stress-m1p6-stuck-mail";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: [{ kind: "ok", reads: ["sent"] }], email_out: [{ kind: "ok", reads: ["pending"] }] });
    const id = await w.opened(LEAD);
    w.clock.now += 20 * S;
    await sendByEmail(w, id);
    await w.drain();
    expect(w.room(id).link_channels).toEqual(["whatsapp_text", "email"]);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    // Meta: the number is not on WhatsApp; HighLevel keeps the email at "pending" (its read answers so every minute).
    w.becomes(String(text.ghl_message_id), META_131026);
    await w.minutes(id, 6);
    const r = w.room(id);
    const st = await statusOf(w, id);
    expect(
      { doubted: Boolean(r.link_unconfirmed_at), failed: st.room.link_failed ?? [], held: st.room.link_held ?? [] },
      `six minutes after Meta failed the free text (131026) with the pressed email still pending at HighLevel, the room has ` +
        `link_unconfirmed_at ${String(r.link_unconfirmed_at ?? null)} and its timeline says ${JSON.stringify(w.lines(id).filter(t => /link|email|WhatsApp/i.test(t)))}`,
    ).toEqual({ doubted: true, failed: expect.arrayContaining(["whatsapp_text"]), held: expect.anything() });
  });
});

// ---------------------------------------------------------------------------
// 3. The link went on WhatsApp. The rep presses Also send by email while
//    HighLevel's contacts read answers its 429 (its burst limit), so the
//    message service stops before anything goes (not_sent_yet). The press is
//    answered rightly ("HighLevel did not answer, so the email has not gone.
//    Press it again in a minute."), but sendOn's shared sendFailed also
//    writes the room's timeline line link.waiting: "HighLevel did not
//    answer, so the link has not gone yet. It is tried again in a minute."
//    The link went minutes ago, and nothing tries the press again: the
//    room's own lanes stop once link_sent_at stands. The same line follows a
//    press for a lead merged away since (the press itself now says gone).
// ---------------------------------------------------------------------------

describe("m1 providers r6: Also send by email meets HighLevel's 429 on the contact after the link went", () => {
  test("press-email-contact-429-timeline-says-link-not-gone: the timeline says the link has not gone and is tried again, after it went on WhatsApp", async () => {
    const w = world();
    const LEAD = "stress-m1p6-press429";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: [{ kind: "ok", reads: ["delivered"] }] });
    const id = await w.opened(LEAD);
    expect(w.lines(id)).toContain("Link sent on WhatsApp.");
    w.clock.now += 40 * S;
    const lead = w.leads.get(LEAD) as { contact?: string };
    lead.contact = "throttled";
    const said = await sendByEmail(w, id).then(
      () => "answered ok",
      e => String((e as Error).message),
    );
    lead.contact = "ok";
    await w.minutes(id, 3);
    const wrong = w.lines(id).filter(t => /link has not gone yet/i.test(t));
    expect(
      { wrongLines: wrong, emailsAsked: w.posts.filter(p => p.lead === LEAD && p.lane === "email").length },
      `the press was answered ${JSON.stringify(said)}; the room's timeline, after "Link sent on WhatsApp.", says ${JSON.stringify(w.lines(id))}`,
    ).toEqual({ wrongLines: [], emailsAsked: 0 });
  });
});

// ---------------------------------------------------------------------------
// 4. The pilot's email-only link (the WhatsApp gate closed): HighLevel keeps
//    the email at "pending" past PENDING_STUCK_MS, so pendingEmail writes
//    link.pending:{room} and the panel says "HighLevel has not sent the
//    email yet. Read the link out" (or, for a link nobody can read out,
//    "Copy the link and send it another way."). HighLevel then hands it on:
//    its own read says "delivered" a few minutes later. laneFacts reads
//    link_held from that line alone, and recheckLink only updates the
//    message row's status, so the room keeps saying HighLevel holds the
//    email for the rest of its life: the rep never learns the email reached
//    the lead (and may have sent the link a second way, as told).
// ---------------------------------------------------------------------------

describe("m1 providers r6: the email HighLevel held goes after all", () => {
  test("HELD (control): the held email is said as held while HighLevel still holds it", async () => {
    const w = world({ waGate: false });
    const LEAD = "stress-m1p6-held-ctl";
    w.addLead({ id: LEAD, inboundAgoMs: null, email_out: [{ kind: "ok", reads: ["pending"] }] });
    const id = await w.opened(LEAD);
    await w.minutes(id, 3);
    const st = await statusOf(w, id);
    expect(st.room.link_held).toEqual(["email"]);
  });

  test("held-email-delivered-later-still-said-held: the room keeps saying HighLevel has not sent the email after it was delivered", async () => {
    const w = world({ waGate: false });
    const LEAD = "stress-m1p6-held";
    w.addLead({ id: LEAD, inboundAgoMs: null, email_out: [{ kind: "ok", reads: ["pending"] }] });
    const id = await w.opened(LEAD);
    await w.minutes(id, 3);
    expect(w.lines(id)).toContain("HighLevel has not sent the email yet. Read the link out.");
    const mail = w.msgs(LEAD, "email")[0] as Row;
    // HighLevel hands the email on at last; its own read now says delivered.
    w.becomes(String(mail.ghl_message_id), { status: "delivered", messageType: "TYPE_EMAIL" });
    await w.minutes(id, 3);
    const st = await statusOf(w, id);
    const row = w.msgs(LEAD, "email")[0] as Row;
    expect(
      { held: st.room.link_held ?? [], doubted: Boolean(st.room.link_unconfirmed_at) },
      `HighLevel's read of the email says ${String(row.provider_status)} (row ${String(row.state)}) three minutes on; the room's view still has ` +
        `link_held ${JSON.stringify(st.room.link_held)} and link_unconfirmed_at ${String(st.room.link_unconfirmed_at ?? null)}; its timeline: ` +
        `${JSON.stringify(w.lines(id).filter(t => /email|link/i.test(t)))}`,
    ).toEqual({ held: [], doubted: false });
  });
});
