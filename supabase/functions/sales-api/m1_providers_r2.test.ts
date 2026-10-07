// bun test supabase/functions/sales-api/m1_providers_r2.test.ts
//
// Milestone 1, video-link round 2, provider quirks on sales-api's side of
// the video link (the room's link after the worker opens it, and the tick
// that reads it again). Settings are the pilot's (m1-scope.md section 3):
// rooms on, both providers, every send lane on, test_only with the test
// leads listed, count_on_join, settle, wrap and auto_on_miss off,
// short_link off (so the call_link template lane is never used), live off.
// The WhatsApp gate is open unless a test says otherwise (a manager has
// confirmed the WA Connector is off, as the pilot needs for WhatsApp).
//
// The message service is faked the way index.ts convoSend stores its rows,
// with each lead's sends taking their outcomes in order (the first free
// text, then the next, ...). HighLevel's GET /conversations/messages/{id}
// answers with the status the test sets (Meta's status webhook, a bounce).
// A failing test is a finding; tests marked HELD pass. Nothing leaves this
// process; every lead is invented.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "stress-m1p2-setter@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * How one send ends, as convoSend stores it:
 * - "sent": HighLevel read it "sent" (Meta took it, one grey tick) through the read-back;
 * - "pending": HighLevel still said "pending" (its own queue) when the read-back ended;
 * - "delivered": delivered inside the read-back;
 * - "unclear": HighLevel answered 502 after it took the send;
 * - "timeout": HighLevel took the send and never answered (the 25 s timeout, status 0);
 * - "throttled": HighLevel answered 429 (certain: nothing went);
 * - { meta }: failed inside the read-back with Meta's words.
 */
type Outcome = "sent" | "pending" | "delivered" | "unclear" | "timeout" | "throttled" | { meta: string };

interface Lead {
  id: string;
  inboundAgoMs: number | null;
  email?: string | null;
  /** Outcomes of the free texts in order; the last one repeats. */
  text?: Outcome[];
  /** Outcomes of the emails in order; the last one repeats. */
  email_out?: Outcome[];
  /** The contact's first name in HighLevel now (a merge or a form can change it). */
  firstName?: string;
  /** Do not disturb on WhatsApp in HighLevel. */
  dndWhatsapp?: boolean;
}

/**
 * `indexLag`: how long HighLevel's conversation search takes to show what it
 * filed. Since m1 round 3b a lost answer's first check reads from when
 * HighLevel was asked, so a copy shown at once is found at once; the tests
 * of a send that "may have gone" give the search 30 s of lag.
 */
function world(o: { waGate?: boolean; emailIdUnreadable?: boolean; indexLag?: number } = {}) {
  const lag = o.indexLag ?? 0;
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
  /** HighLevel's message status as GET /conversations/messages/{id} reads it now, by HighLevel message id. */
  const later = new Map<string, Row>();
  const emailIds = new Set<string>();
  w.routes.push(async (m, p) => {
    const one = /^\/contacts\/([^/?]+)$/.exec(p);
    if (m === "GET" && one) {
      const id = decodeURIComponent(one[1] as string);
      const l = leads.get(id);
      if (!l) return null as unknown as Row;
      const email = l.email === undefined ? `${id}@example.com` : l.email;
      return { contact: { id, firstName: l.firstName ?? "Huda", name: `${l.firstName ?? "Huda"} Ali`, phone: "+96550000000", ...(email ? { email } : {}), tags: ["roas-qualified"], country: "KW", ...(l.dndWhatsapp ? { dndSettings: { WhatsApp: { status: "active" } } } : {}) } };
    }
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    const msg = /^\/conversations\/messages\/([^/?]+)$/.exec(p);
    if (m === "GET" && msg) {
      const id = decodeURIComponent(msg[1] as string);
      // The message service's own note: "an email's id is not always readable this way".
      if (o.emailIdUnreadable && emailIds.has(id)) return null as unknown as Row;
      const now = later.get(id);
      if (now) return { message: { id, direction: "outbound", ...now } };
    }
    return null as unknown as Row;
  });
  function addLead(l: Lead): void {
    leads.set(l.id, l);
    (roomsJson.test_contacts as string[]).push(l.id);
    if (l.inboundAgoMs !== null)
      w.db.seed("cockpit_sales_inbox", [{ conversation_id: `c-${l.id}`, contact_id: l.id, inbound_whatsapp_at: new Date(w.clock.now - l.inboundAgoMs).toISOString() }]);
  }
  const at = () => new Date(w.clock.now).toISOString();
  const rows = new Map<string, Row>();
  /** Sends that reached HighLevel (and may reach the lead), and every ask. */
  const delivered: { lead: string; lane: string; at: number; request_id: string }[] = [];
  const asked: { lead: string; lane: string }[] = [];
  const used = new Map<string, number>();
  /** The lead's conversation as HighLevel shows it: our own sends, with the status HighLevel has for them. */
  const conversation: { lead: string; body: string; status: string; at: number; id: string; channel: string }[] = [];
  function next(contactId: string, lane: "text" | "email"): Outcome {
    const l = leads.get(contactId);
    const list = (lane === "email" ? l?.email_out : l?.text) ?? ["sent"];
    const k = `${contactId}:${lane}`;
    const n = used.get(k) ?? 0;
    used.set(k, n + 1);
    return list[Math.min(n, list.length - 1)] as Outcome;
  }
  /** index.ts convoSend as it stores its rows (request id written first, read back, stored). */
  async function send(lane: "text" | "email", requestId: string, contactId: string, channel: "whatsapp" | "email", body: string) {
    const again = rows.get(requestId);
    if (again) {
      // convoSend's priorTry: a stamped row with other words is refused, never answered as the repeat.
      if (String(again.body).trim() !== body.trim() || again.channel !== channel)
        throw new ApiRefusal("That send was already used for other words. Press Send again.", 409);
      return { message: { ...again }, repeated: true };
    }
    asked.push({ lead: contactId, lane });
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: at() };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    const out = next(contactId, lane);
    const ghlId = `msg-${String(row.id).slice(-8)}`;
    if (channel === "email") emailIds.add(ghlId);
    if (out === "throttled") {
      row.state = "failed";
      row.error = "HighLevel said 429: Too Many Requests";
      throw new ApiRefusal(`HighLevel did not send it: ${String(row.error)}`, 502, { certain: true });
    }
    if (out === "unclear" || out === "timeout") {
      delivered.push({ lead: contactId, lane, at: w.clock.now, request_id: requestId });
      conversation.push({ lead: contactId, body, status: "pending", at: w.clock.now, id: ghlId, channel });
      later.set(ghlId, { status: "pending", messageType: channel === "email" ? "TYPE_EMAIL" : "TYPE_WHATSAPP" });
      // index.ts GHL_CALL_MS: HighLevel's answer is waited for 25 s.
      if (out === "timeout") w.clock.now += 25 * S;
      row.state = "unclear";
      row.error = out === "timeout" ? "HighLevel did not answer within 25 seconds" : "HighLevel said 502: Bad Gateway";
      throw new ApiRefusal(`The send may have gone; read the conversation in HighLevel before writing to the lead again (${String(row.error)})`, 502, { unclear: true });
    }
    if (typeof out === "object") {
      row.state = "failed";
      row.provider_status = "failed";
      row.error = out.meta;
      row.ghl_message_id = ghlId;
      return { message: { ...row } };
    }
    delivered.push({ lead: contactId, lane, at: w.clock.now, request_id: requestId });
    conversation.push({ lead: contactId, body, status: out, at: w.clock.now, id: ghlId, channel });
    row.ghl_message_id = ghlId;
    row.state = out === "delivered" ? "delivered" : "sent";
    row.provider_status = out;
    later.set(ghlId, { status: out, messageType: channel === "email" ? "TYPE_EMAIL" : "TYPE_WHATSAPP" });
    return { message: { ...row } };
  }
  const deps: RoomDeps = {
    io: {
      ...w.io,
      background: p => {
        jobs.push(p.catch(e => w.logs.push(`background: ${String((e as Error)?.message ?? e)}`)));
      },
    },
    audit: async () => {},
    markAppointment: async () => ({ crm: "written" }),
    sendText: (_who, b) => send(b.channel === "email" ? "email" : "text", b.request_id, b.contact_id, b.channel, b.body),
    sendTemplate: async () => {
      throw new Error("the template lane is off for the pilot (short_link off): no template is ever sent");
    },
    upcoming: async () => null,
    // index.ts sentSince: a copy that reached the lead, a failed copy apart, else not there.
    sentSince: async (contactId, since, text, channel) => {
      if (!text) return null;
      const ch = channel ?? "whatsapp";
      const shown = conversation.filter(c => w.clock.now - c.at >= lag);
      const mine = shown.filter(c => c.lead === contactId && c.channel === ch && c.at >= since - 15 * S && c.body.trim() === text.trim());
      const hit = mine.find(c => !["failed", "undelivered"].includes(c.status));
      if (hit) return { id: hit.id, status: hit.status };
      const bad = mine.find(c => ["failed", "undelivered"].includes(c.status));
      if (bad) return { id: bad.id, status: bad.status, failed: true, error: "failed" };
      // index.ts: an email is "not there" only when no email at all went to the lead since.
      if (ch === "email" && shown.some(c => c.lead === contactId && c.channel === "email" && c.at >= since - 15 * S)) return null;
      return false;
    },
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  async function drain(): Promise<void> {
    for (let i = 0; i < 10; i++) {
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
  /** The lead page's Send a video link (purpose manual), as the pilot runs it. */
  async function opened(contactId: string, trigger?: string): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: contactId,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
      ...(trigger ? { trigger } : {}),
    });
    const id = String((out.room as Row).id);
    await workerOpens(id);
    await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await drain();
    return id;
  }
  async function tick(id: string) {
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await drain();
  }
  /** HighLevel's status for a message changes (Meta's status webhook, or the mail server's bounce). */
  function becomes(ghlId: string, status: Row) {
    later.set(ghlId, status);
    const c = conversation.find(x => x.id === ghlId);
    if (c) c.status = String(status.status);
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
  return { ...w, rooms, room, addLead, opened, tick, drain, delivered, asked, becomes, lines, later, msgs, conversation, leads };
}

// ---------------------------------------------------------------------------
// 1. The link went both ways, and the second way fails after it went.
//
// rooms.ts tick reads a link again only while it went one way:
// `!(waLane && ch.includes("email"))`, and recheckLink returns at once for a
// link on both lanes ("backed up already"). So a backup that fails late is
// never read:
//  a. the free text fails late at Meta (131026), the email goes as its
//     backup and then bounces: the panel says "WhatsApp failed the link
//     after it was sent, so it went by email." while the lead has nothing;
//  b. an email-first link (a bad number) bounces, the free text goes in its
//     place, and Meta fails it late: the panel says "The email bounced, so
//     the link went on WhatsApp." while the lead has nothing.
// ---------------------------------------------------------------------------

describe("m1 providers r2: the backup that fails after it went", () => {
  test("HELD (control): the free text's late 131026 is read and the email backs it up", async () => {
    const w = world();
    const LEAD = "stress-m1p2-late-text-control";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: ["sent"], email_out: ["sent"] });
    const id = await w.opened(LEAD);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    w.clock.now += 90 * S;
    w.becomes(String(text.ghl_message_id), { status: "failed", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } });
    w.clock.now += MIN;
    await w.tick(id);
    expect(w.delivered.filter(d => d.lead === LEAD).map(d => d.lane)).toEqual(["text", "email"]);
    expect(w.lines(id).some(t => /so it went by email/.test(t))).toBe(true);
  });

  test("backup-email-bounce-never-read: the email that backed up a failed free text bounces, and the room still says it went by email", async () => {
    const w = world();
    const LEAD = "stress-m1p2-backup-bounce";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, email: "huda@typo-domain.invalid", text: ["sent"], email_out: ["sent"] });
    const id = await w.opened(LEAD);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    // Meta fails the free text 90 s after it went (the lead is not on WhatsApp).
    w.clock.now += 90 * S;
    w.becomes(String(text.ghl_message_id), { status: "failed", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } });
    w.clock.now += MIN;
    await w.tick(id);
    const mail = w.msgs(LEAD, "email")[0] as Row;
    expect([w.room(id).link_channels, mail?.state]).toEqual([["whatsapp_text", "email"], "sent"]);
    // The backup email bounces two minutes later.
    w.clock.now += 2 * MIN;
    w.becomes(String(mail.ghl_message_id), { status: "failed", messageType: "TYPE_EMAIL", meta: { error: "550 5.1.1 The email account that you tried to reach does not exist" } });
    for (let i = 0; i < 5; i++) {
      w.clock.now += MIN;
      await w.tick(id);
    }
    const reads = w.ghlCalls.filter(c => c.method === "GET" && c.path === `/conversations/messages/${String(mail.ghl_message_id)}`).length;
    const said = w.lines(id);
    expect(
      { emailReadAgain: reads > 0, bounceSaid: said.some(t => /bounc|did not arrive|did not reach/i.test(t)) },
      `the backup email bounced; over five ticks its status was read ${reads} times, and the room's last word on the link is ` +
        `${JSON.stringify(said.filter(t => /link|WhatsApp|email/i.test(t)))}: the rep is told it went by email while the lead has nothing`,
    ).toEqual({ emailReadAgain: true, bounceSaid: true });
  });

  test("bounce-replacement-text-fails-late-never-read: an email-first link bounces, the free text replaces it, Meta fails it late, the room says it went on WhatsApp", async () => {
    const w = world();
    const LEAD = "stress-m1p2-bounce-then-131026";
    // A bad number (email goes first). The free text Meta takes, then fails late.
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, email: "huda@typo-domain.invalid", text: ["sent"], email_out: ["sent"] });
    const id = await w.opened(LEAD, "bad_number");
    const mail = w.msgs(LEAD, "email")[0] as Row;
    expect(w.room(id).link_channels).toEqual(["email"]);
    w.clock.now += 2 * MIN;
    w.becomes(String(mail.ghl_message_id), { status: "failed", messageType: "TYPE_EMAIL", meta: { error: "550 5.1.1 no such user" } });
    w.clock.now += MIN;
    await w.tick(id);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    expect([w.room(id).link_channels, text?.state]).toEqual([["email", "whatsapp_text"], "sent"]);
    expect(w.lines(id).some(t => /so the link went on WhatsApp/.test(t))).toBe(true);
    // Meta fails the free text 90 s later (131026: not on WhatsApp).
    w.clock.now += 90 * S;
    w.becomes(String(text.ghl_message_id), { status: "failed", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } });
    for (let i = 0; i < 5; i++) {
      w.clock.now += MIN;
      await w.tick(id);
    }
    const reads = w.ghlCalls.filter(c => c.method === "GET" && c.path === `/conversations/messages/${String(text.ghl_message_id)}`).length;
    const r = w.room(id);
    expect(
      { textReadAgain: reads > 0, failureSaid: w.lines(id).some(t => /WhatsApp failed|did not arrive|did not reach|read the link out/i.test(t)) },
      `the free text that replaced the bounced email failed at Meta; over five ticks it was read ${reads} times, and the room still says ` +
        `${JSON.stringify(w.lines(id).filter(t => /link|WhatsApp|email/i.test(t)))} with link_channels ${JSON.stringify(r.link_channels)}`,
    ).toEqual({ textReadAgain: true, failureSaid: true });
  });
});

// ---------------------------------------------------------------------------
// 2. A send HighLevel accepted and never handed on: the free text sits at
//    "pending" (HighLevel's own queue) for the lead's whole ten minutes.
//
// convoSend stores a free text HighLevel still calls pending at the end of
// its 20 s read-back as state "sent" (provider_status "pending"). The tick
// reads it again every minute (m1 round 1), but acts only on a failure:
// a link that never leaves HighLevel's queue is never doubted, never backed
// up by email (the lead has an address), and the panel says "Link sent on
// WhatsApp" for the whole ten minutes. A WhatsApp template nobody saw in
// 20 s is followed by email at once (link_unconfirmed_at); the free text
// stuck at the same "nobody saw it" has no such rule.
// ---------------------------------------------------------------------------

describe("m1 providers r2: a free text HighLevel never hands to Meta", () => {
  test("free-text-stuck-pending-never-backed-up: a link pending in HighLevel for ten minutes is never doubted or emailed", async () => {
    const w = world();
    const LEAD = "stress-m1p2-stuck-pending";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: ["pending"], email_out: ["sent"] });
    const id = await w.opened(LEAD);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    expect([w.room(id).link_channels, text.state, text.provider_status]).toEqual([["whatsapp_text"], "sent", "pending"]);
    for (let i = 0; i < 9; i++) {
      w.clock.now += MIN;
      await w.tick(id);
    }
    const reads = w.ghlCalls.filter(c => c.method === "GET" && c.path === `/conversations/messages/${String(text.ghl_message_id)}`).length;
    const r = w.room(id);
    expect(
      {
        emailBackup: w.delivered.some(d => d.lead === LEAD && d.lane === "email"),
        doubtSaid: Boolean(r.link_unconfirmed_at) || w.lines(id).some(t => /not confirm|not delivered|did not arrive|still waiting/i.test(t)),
      },
      `nine minutes after the press HighLevel still has the free text "pending" (read ${reads} times); no email went to a lead who has one, ` +
        `and the room says ${JSON.stringify(w.lines(id).filter(t => /Link sent/.test(t)))} with link_unconfirmed_at ${JSON.stringify(r.link_unconfirmed_at ?? null)}`,
    ).toEqual({ emailBackup: true, doubtSaid: true });
  });
});

// ---------------------------------------------------------------------------
// 3. The pilot's email link (the WhatsApp gate closed, as production has it
//    today) bounces, and HighLevel will not read the email by its message id.
//
// index.ts convoSend's own read-back says so: "an email's id is not always
// readable this way". recheckLink reads an email's bounce only through
// GET /conversations/messages/{id}; when that does not answer it returns
// ("the next minute asks again") and asks the same unreadable question
// every minute. The lead's conversation, which sentSince already reads and
// which shows the bounced email as failed, is never read for it.
// ---------------------------------------------------------------------------

describe("m1 providers r2: an email link HighLevel will not read by id", () => {
  test("email-bounce-unread-when-id-unreadable: a bounced email link whose id HighLevel will not read is never seen to bounce", async () => {
    const w = world({ waGate: false, emailIdUnreadable: true });
    const LEAD = "stress-m1p2-email-id-unreadable";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, email: "huda@typo-domain.invalid", email_out: ["sent"] });
    const id = await w.opened(LEAD);
    const mail = w.msgs(LEAD, "email")[0] as Row;
    expect([w.room(id).link_channels, mail.state]).toEqual([["email"], "sent"]);
    w.clock.now += 2 * MIN;
    // The conversation shows the email failed (the bounce); GET by its id answers nothing.
    w.becomes(String(mail.ghl_message_id), { status: "failed", messageType: "TYPE_EMAIL", meta: { error: "550 5.1.1 no such user" } });
    for (let i = 0; i < 6; i++) {
      w.clock.now += MIN;
      await w.tick(id);
    }
    const r = w.room(id);
    expect(
      { doubtSaid: Boolean(r.link_unconfirmed_at) || w.lines(id).some(t => /bounc|did not arrive/i.test(t)) },
      `the email link bounced and HighLevel shows it failed in the lead's conversation; HighLevel would not read it by id, so over six ticks ` +
        `the room still says ${JSON.stringify(w.lines(id).filter(t => /Link sent/.test(t)))}`,
    ).toEqual({ doubtSaid: true });
  });
});

// ---------------------------------------------------------------------------
// 4. HighLevel answers 502 after it took the link, and the lead's contact
//    changes before the minute's re-ask: HighLevel merges a duplicate into
//    it (or a form fills the name), so its first name is not what it was.
//
// sendOn writes the link's words afresh on every try, from the contact as
// HighLevel has it now, and asks the message service again on the same
// request id. convoSend's priorTry answers a stamped row with other words
// "That send was already used for other words. Press Send again." (409),
// which sendOn takes as a plain failure: the re-ask in sendLinkHeld does
// nothing with it, so the conversation is never read for the send that may
// have gone. A copy Meta failed (131026) is never backed up by email, and
// the panel says "may have gone" for the room's whole life. "Also send by
// email" after an unclear email the same way answers the rep "Not sent:
// That send was already used for other words. Press Send again." on every
// press.
// ---------------------------------------------------------------------------

describe("m1 providers r2: the lead's name changes in HighLevel after a send whose answer was lost", () => {
  test("HELD (control): with the name unchanged, the re-ask reads the conversation, finds the copy failed and emails the link", async () => {
    const w = world({ indexLag: 30 * S });
    const LEAD = "stress-m1p2-unclear-same-name";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: ["timeout", { meta: "Message Undeliverable. (131026)" }], email_out: ["sent"] });
    const id = await w.opened(LEAD);
    expect(String(w.room(id).refusal ?? "")).toMatch(/may have gone on WhatsApp/);
    const ghlId = (w.conversation.find(c => c.lead === LEAD) as { id: string }).id;
    w.clock.now += 20 * S;
    w.becomes(ghlId, { status: "failed", messageType: "TYPE_WHATSAPP" });
    for (let i = 0; i < 3; i++) {
      w.clock.now += MIN;
      await w.tick(id);
    }
    expect(w.delivered.filter(d => d.lead === LEAD).map(d => d.lane)).toEqual(["text", "email"]);
    expect(String(w.room(id).refusal ?? "")).not.toMatch(/may have gone/);
  });

  test("renamed-lead-reask-refused-as-other-words: a re-ask after a merge renamed the lead never reads the conversation, so a failed copy is never backed up", async () => {
    const w = world({ indexLag: 30 * S });
    const LEAD = "stress-m1p2-unclear-renamed";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: ["timeout", { meta: "Message Undeliverable. (131026)" }], email_out: ["sent"], firstName: "Huda" });
    const id = await w.opened(LEAD);
    expect(String(w.room(id).refusal ?? "")).toMatch(/may have gone on WhatsApp/);
    const ghlId = (w.conversation.find(c => c.lead === LEAD) as { id: string }).id;
    // HighLevel merges a duplicate into the lead: the first name is now the duplicate's.
    (w.leads.get(LEAD) as Lead).firstName = "Hoda";
    // Meta fails the copy that went (131026).
    w.clock.now += 20 * S;
    w.becomes(ghlId, { status: "failed", messageType: "TYPE_WHATSAPP" });
    for (let i = 0; i < 8; i++) {
      w.clock.now += MIN;
      await w.tick(id);
    }
    const r = w.room(id);
    expect(
      { emailWent: w.delivered.some(d => d.lead === LEAD && d.lane === "email"), panel: String(r.refusal ?? "") },
      `the free text's only copy failed at Meta, but eight minutes of re-asks were each refused by the message service as "other words" ` +
        `(the greeting now says Hoda); the room still says ${JSON.stringify(r.refusal)} and no email went to a lead who has one`,
    ).toEqual({ emailWent: true, panel: expect.not.stringMatching(/may have gone on WhatsApp/) as unknown as string });
  });

  test("renamed-lead-also-send-by-email-says-other-words: Also send by email after an unclear email answers 'already used for other words' on every press", async () => {
    const w = world({ waGate: false, indexLag: 30 * S });
    const LEAD = "stress-m1p2-email-renamed";
    w.addLead({ id: LEAD, inboundAgoMs: null, email_out: ["timeout", "sent"], firstName: "Huda" });
    const id = await w.opened(LEAD);
    expect(String(w.room(id).refusal ?? "")).toMatch(/may have gone by email/);
    (w.leads.get(LEAD) as Lead).firstName = "Hoda";
    w.clock.now += 2 * MIN;
    const answers: string[] = [];
    for (let i = 0; i < 2; i++) {
      try {
        const out = await w.rooms.actions["room.send"]!(setter, { room_id: id, request_id: crypto.randomUUID(), channel: "email" });
        answers.push(String((out as Row).note ?? "sent"));
      } catch (e) {
        answers.push(String((e as Error).message));
      }
      w.clock.now += 30 * S;
    }
    expect(
      answers.some(a => /already used for other words/i.test(a)),
      `the rep pressed Also send by email twice after the lead's name changed in HighLevel and was told ${JSON.stringify(answers)}: ` +
        "a sentence about the message service's request ids, with no way to send the link or learn whether the first email went",
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. HighLevel's 429s: a burst, and a minutes-long run of them.
//
// convoSend reads a 429 as certain (nothing went) and stores the row failed;
// rooms.ts moves a lane to its next link key on a failed row (LINK_RETRIES
// is 3, so four keys a lane), and the sweep asks again every minute. Once a
// lane's four keys are spent, currentKey answers the last failed key, and
// the message service answers that row as the repeat: nothing is asked of
// HighLevel again for this room, and "Also send by email" answers the rep
// with the old 429 ("Not sent: HighLevel did not send it: HighLevel said
// 429") although HighLevel is answering again.
// ---------------------------------------------------------------------------

describe("m1 providers r2: HighLevel's 429s on the link", () => {
  test("HELD (control): one 429 on the email is followed by the email a minute later", async () => {
    const w = world({ waGate: false });
    const LEAD = "stress-m1p2-429-once";
    w.addLead({ id: LEAD, inboundAgoMs: null, email_out: ["throttled", "sent"] });
    const id = await w.opened(LEAD);
    expect(w.room(id).link_sent_at ?? null).toBe(null);
    w.clock.now += MIN;
    await w.tick(id);
    expect(w.room(id).link_channels).toEqual(["email"]);
  });

  test("throttled-keys-spent-strands-email: four minutes of 429s spend the room's email keys, and Also send by email repeats the old 429 for good", async () => {
    const w = world({ waGate: false });
    const LEAD = "stress-m1p2-429-run";
    // HighLevel throttles the location for four minutes (a burst from another job), then answers again.
    w.addLead({ id: LEAD, inboundAgoMs: null, email_out: ["throttled", "throttled", "throttled", "throttled", "sent"] });
    const id = await w.opened(LEAD);
    for (let i = 0; i < 4; i++) {
      w.clock.now += MIN;
      await w.tick(id);
    }
    // HighLevel answers again: the minute's re-ask and the rep's press.
    w.clock.now += MIN;
    await w.tick(id);
    let said = "";
    try {
      await w.rooms.actions["room.send"]!(setter, { room_id: id, request_id: crypto.randomUUID(), channel: "email" });
      said = "sent";
    } catch (e) {
      said = String((e as Error).message);
    }
    const r = w.room(id);
    expect(
      { linkWent: Boolean(r.link_sent_at), press: said },
      `HighLevel answered again after four minutes of 429s, but the room's link never went (${w.asked.length} asks reached the message service) ` +
        `and the rep's Also send by email answered ${JSON.stringify(said)}; the room says ${JSON.stringify(r.refusal)}`,
    ).toEqual({ linkWent: true, press: "sent" });
  });

  test("throttled-all-lanes-said-final: a 429 on both lanes is said as 'did not go on any channel' with no word that it is tried again, then the link goes a minute later", async () => {
    const w = world();
    const LEAD = "stress-m1p2-429-both";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: ["throttled", "sent"], email_out: ["throttled", "sent"] });
    const id = await w.opened(LEAD);
    const first = String(w.room(id).refusal ?? "");
    w.clock.now += MIN;
    await w.tick(id);
    const after = w.room(id);
    expect(after.link_channels).toEqual(["whatsapp_text"]);
    expect(
      /again|in a minute/i.test(first),
      `a momentary 429 on both lanes put ${JSON.stringify(first)} on the panel; a minute later the sweep sent the link on WhatsApp ` +
        "without the rep being told it would try again (a rep who read the link out, or pressed End, did so on a sentence that was not final)",
    ).toBe(true);
  });
});

describe("m1 providers r2: a WhatsApp link HighLevel will not read by id", () => {
  test("text-unread-by-id-never-doubted: a free text whose id HighLevel answers 404 for, and which is not in the lead's conversation, is never doubted", async () => {
    const w = world();
    const LEAD = "stress-m1p2-text-404";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: ["pending"], email_out: ["sent"] });
    const id = await w.opened(LEAD);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    // HighLevel dropped it: GET by its id answers 404, and the conversation does not have it.
    w.later.delete(String(text.ghl_message_id));
    const i = w.conversation.findIndex(c => c.id === String(text.ghl_message_id));
    if (i >= 0) w.conversation.splice(i, 1);
    for (let n = 0; n < 8; n++) {
      w.clock.now += MIN;
      await w.tick(id);
    }
    const r = w.room(id);
    expect(
      { emailBackup: w.delivered.some(d => d.lead === LEAD && d.lane === "email"), doubtSaid: Boolean(r.link_unconfirmed_at) },
      `HighLevel answers 404 for the link's message id and the lead's conversation has no such message; eight minutes on, the room still says ` +
        `${JSON.stringify(w.lines(id).filter(t => /Link sent/.test(t)))} and nothing backed it up`,
    ).toEqual({ emailBackup: true, doubtSaid: true });
  });
});

// ---------------------------------------------------------------------------
// 6. The email link bounces for a lead WhatsApp cannot take it to.
//
// emailBounced writes "The email bounced. Read the link out, or send it on
// WhatsApp." whenever the free text did not go in its place, whatever the
// reason: the lead's do-not-disturb on WhatsApp in HighLevel, or their
// 24-hour window shut (a free text from the conversation is refused, and
// the room panel has no WhatsApp button). The rep is told to send it on
// WhatsApp to a lead who asked not to be contacted there.
// ---------------------------------------------------------------------------

describe("m1 providers r2: the bounce line for a lead WhatsApp cannot reach", () => {
  test("bounce-line-offers-whatsapp-despite-dnd: a lead with do-not-disturb on WhatsApp is offered to the rep on WhatsApp after a bounce", async () => {
    const w = world();
    const LEAD = "stress-m1p2-bounce-dnd";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, email: "huda@typo-domain.invalid", email_out: ["sent"], dndWhatsapp: true });
    const id = await w.opened(LEAD);
    const mail = w.msgs(LEAD, "email")[0] as Row;
    expect(w.room(id).link_channels).toEqual(["email"]);
    w.clock.now += 2 * MIN;
    w.becomes(String(mail.ghl_message_id), { status: "failed", messageType: "TYPE_EMAIL", meta: { error: "550 5.1.1 no such user" } });
    w.clock.now += MIN;
    await w.tick(id);
    const said = w.lines(id).filter(t => /bounced/.test(t));
    expect(said.length).toBe(1);
    expect(
      said.some(t => /send it on WhatsApp/i.test(t)),
      `the lead has do-not-disturb on WhatsApp in HighLevel, and the room told the rep ${JSON.stringify(said)}`,
    ).toBe(false);
  });

  test("bounce-line-offers-whatsapp-window-shut: a lead whose WhatsApp window is shut is offered to the rep on WhatsApp after a bounce", async () => {
    const w = world();
    const LEAD = "stress-m1p2-bounce-window";
    w.addLead({ id: LEAD, inboundAgoMs: 3 * 24 * HOUR, email: "huda@typo-domain.invalid", email_out: ["sent"] });
    const id = await w.opened(LEAD);
    const mail = w.msgs(LEAD, "email")[0] as Row;
    expect(w.room(id).link_channels).toEqual(["email"]);
    w.clock.now += 2 * MIN;
    w.becomes(String(mail.ghl_message_id), { status: "failed", messageType: "TYPE_EMAIL", meta: { error: "550 5.1.1 no such user" } });
    w.clock.now += MIN;
    await w.tick(id);
    const said = w.lines(id).filter(t => /bounced/.test(t));
    expect(said.length).toBe(1);
    expect(
      said.some(t => /send it on WhatsApp/i.test(t)),
      `the lead last wrote three days ago (only a template reaches them, and the template lane is off), and the room told the rep ${JSON.stringify(said)}`,
    ).toBe(false);
  });
});
